import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Studio } from '../server/studio.mjs';
import { LlamaPool } from '../server/llama-pool.mjs';
import { MemoryMonitor } from '../server/memory.mjs';

const GiB = 2 ** 30;

function stubMemoryMonitor() {
  const control = { budgetBytes: 8 * GiB, samples: 0 };
  const totalBytes = 16 * GiB, reserveBytes = Math.round(totalBytes * .1);
  control.monitor = new MemoryMonitor({
    total: () => totalBytes,
    free: () => control.budgetBytes + reserveBytes,
    host: async () => {
      control.samples++;
      const availableBytes = control.budgetBytes + reserveBytes;
      return { total: totalBytes, totalBytes, free: availableBytes, availableBytes, usedBytes: totalBytes - availableBytes, reserveBytes, modelBudgetBytes: control.budgetBytes, availableSource: 'os' };
    },
    processes: async pids => new Map(pids.map(pid => [pid, Math.round(.1 * GiB)]))
  });
  return control;
}

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-studio-memory-'));
  const studio = new Studio(dir), events = [];
  const memory = stubMemoryMonitor();
  let nextPid = 100;
  const makeEngine = () => ({
    modelId: null, child: null, runtimeKey: null, toolCalling: false,
    async load(model, runtime, signal, update, context, toolCalling = false) {
      signal.throwIfAborted();
      const key = JSON.stringify({ runtime, context, toolCalling });
      if (this.modelId === model.id && this.runtimeKey === key && this.child) return;
      await this.unload();
      this.modelId = model.id; this.runtimeKey = key; this.toolCalling = toolCalling;
      this.child = { pid: ++nextPid, exitCode: null, signalCode: null };
      events.push(`load:${model.id}`); update?.(`Loaded ${model.name}`);
    },
    async unload() {
      if (this.modelId) events.push(`unload:${this.modelId}`);
      this.modelId = null; this.child = null; this.runtimeKey = null;
    },
    async generate(_messages, _settings, signal, onToken) { signal.throwIfAborted(); events.push(`generate:${this.modelId}`); onToken(`${this.modelId} completed`); },
    async turn() { return { content: 'Agent completed.' }; }
  });
  studio.memoryMonitor = memory.monitor;
  studio.llama = new LlamaPool(studio.workDir, makeEngine);
  studio.orchestrator = makeEngine();
  studio.rescan = async () => {}; studio.telemetry = async () => {};
  await studio.init();
  studio.config = { ...studio.config, mainAgentModelId: 'guide', backend: 'cpu', maxTokens: 100 };
  studio.catalog = ['guide', 'coder', 'writer', 'reasoner'].map(id => ({ id, memoryGB: .2, defaultOrchestrator: id === 'guide' }));
  studio.registry = {
    models: studio.catalog.map(entry => ({ id: entry.id, catalogId: entry.id, name: entry.id, kind: 'chat', available: true, file: `/fixture/${entry.id}.gguf` })),
    runtimes: { chat: { binary: '/fixture/llama-server', backend: 'cpu' } }
  };
  await studio.orchestrator.load(studio.registry.models[0], studio.registry.runtimes.chat, studio.lifecycle.signal, () => {}, 4096, true);
  await studio.sampleMemory();
  t.after(async () => { await studio.close(); await fs.rm(dir, { recursive: true, force: true }); });
  return { studio, events, memory, makeEngine };
}

async function settled(studio, jobId) {
  const deadline = Date.now() + 4000;
  while (studio.active || ['queued', 'running'].includes(studio.jobs.find(job => job.id === jobId)?.status)) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the local job to finish.');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

const ids = studio => studio.snapshot().loadedModels.map(row => row.modelId).sort();
const pipeline = modelId => ({
  schemaVersion: 1, name: 'Memory integration', description: 'Local memory integration fixture',
  nodes: [{ id: 'work', name: 'Work', type: 'chat', modelId, prompt: 'Complete the task', dependsOn: [], position: { x: 100, y: 200 }, settings: {}, memoryPolicy: 'auto' }]
});

test('manual loads retain several pinned specialists and targeted unload removes only the selected model', async t => {
  const { studio, events } = await fixture(t);
  const guideChild = studio.orchestrator.child;
  await studio.loadModel('coder'); await studio.loadModel('writer'); await studio.loadModel('reasoner');
  assert.deepEqual(ids(studio), ['coder', 'guide', 'reasoner', 'writer']);
  assert.equal(studio.snapshot().loadedModels.filter(row => row.role === 'specialist' && row.pinned).length, 3);
  assert.equal(new Set(studio.snapshot().loadedModels.map(row => row.pid)).size, 4);
  await studio.unloadModel('writer');
  assert.deepEqual(ids(studio), ['coder', 'guide', 'reasoner']);
  assert.equal(studio.llama.modelId, 'reasoner');
  assert.equal(studio.orchestrator.child, guideChild);
  assert.deepEqual(events.filter(event => event.startsWith('unload:')), ['unload:writer']);
  await assert.rejects(studio.unloadModel('guide'), /guide stays loaded/);
  await studio.unloadModel();
  assert.deepEqual(ids(studio), ['guide']);
});

test('fresh host headroom rejects an additional model without unloading a resident model', async t => {
  const { studio, events, memory } = await fixture(t);
  await studio.loadModel('coder');
  const child = studio.llama.child;
  const samplesBefore = memory.samples;
  memory.budgetBytes = Math.round(.05 * GiB);
  await assert.rejects(studio.loadModel('writer'), /available after the safety buffer/);
  assert.ok(memory.samples > samplesBefore);
  assert.deepEqual(ids(studio), ['coder', 'guide']);
  assert.equal(studio.llama.child, child);
  assert.equal(studio.llama.isPinned('coder'), true);
  assert.equal(events.includes('load:writer'), false);
  assert.equal(events.includes('unload:coder'), false);
  assert.equal(studio.loadingModel, false);
});

test('normal chat reuses a pinned specialist and leaves other manually loaded models resident', async t => {
  const { studio, events } = await fixture(t);
  await studio.loadModel('coder'); await studio.loadModel('writer');
  const coderChild = studio.llama.instances().find(row => row.modelId === 'coder').engine.child;
  const job = await studio.enqueue({ kind: 'chat', modelId: 'coder', prompt: 'Write a short function' });
  await settled(studio, job.id);
  assert.equal(job.status, 'completed');
  assert.deepEqual(ids(studio), ['coder', 'guide', 'writer']);
  assert.equal(studio.llama.child, coderChild);
  assert.ok(studio.llama.instances().every(row => row.pinned));
  assert.equal(events.includes('unload:writer'), false);
  assert.equal(studio.sessions[0].messages.at(-1).content, 'coder completed');
});

test('pipeline automatic cleanup preserves manual preloads while releasing its temporary specialist', async t => {
  const { studio, events } = await fixture(t);
  await studio.loadModel('coder');
  const coderChild = studio.llama.child;
  const definition = pipeline('coder');
  definition.nodes.push({ ...definition.nodes[0], id: 'temporary', name: 'Temporary specialist', modelId: 'writer', dependsOn: ['work'], position: { x: 400, y: 200 } });
  const saved = await studio.pipelines.save(definition);
  const run = await studio.runPipeline({ pipelineId: saved.id });
  await settled(studio, run.id);
  assert.equal(run.status, 'completed', run.error);
  assert.ok(events.includes('generate:coder'));
  assert.ok(events.includes('generate:writer'));
  assert.ok(events.includes('unload:writer'));
  assert.equal(events.includes('unload:coder'), false);
  assert.deepEqual(ids(studio), ['coder', 'guide']);
  assert.equal(studio.llama.instances()[0].engine.child, coderChild);
  assert.equal(studio.llama.isPinned('coder'), true);
});

test('pipeline execution enforces current host headroom before starting a temporary model', async t => {
  const { studio, events, memory } = await fixture(t);
  await studio.loadModel('coder');
  const saved = await studio.pipelines.save(pipeline('writer'));
  memory.budgetBytes = Math.round(.05 * GiB);
  const run = await studio.runPipeline({ pipelineId: saved.id });
  await settled(studio, run.id);
  assert.equal(run.status, 'failed');
  assert.match(run.error, /available after the safety buffer/);
  assert.equal(events.includes('load:writer'), false);
  assert.deepEqual(ids(studio), ['coder', 'guide']);
});

test('a pinned model does not authorize another process using those weights as a custom agent', async t => {
  const { studio, events, memory, makeEngine } = await fixture(t);
  await studio.loadModel('coder');
  studio.pipelineAgent = makeEngine();
  const definition = pipeline('coder'); definition.nodes[0].type = 'agent';
  const saved = await studio.pipelines.save(definition);
  memory.budgetBytes = Math.round(.05 * GiB);
  const run = await studio.runPipeline({ pipelineId: saved.id });
  await settled(studio, run.id);
  assert.equal(run.status, 'failed');
  assert.match(run.error, /available after the safety buffer/);
  assert.equal(events.filter(event => event === 'load:coder').length, 1);
  assert.equal(studio.pipelineAgent.child, null);
  assert.equal(studio.llama.isPinned('coder'), true);
  assert.deepEqual(ids(studio), ['coder', 'guide']);
});

test('capacity accounting counts the same model twice when it will occupy two processes', async t => {
  const { studio } = await fixture(t);
  await studio.loadModel('coder');
  // A single copy fits the machine, but two copies plus the guide do not.
  studio.catalog.find(entry => entry.id === 'coder').memoryGB = (os.totalmem() / GiB - 1.2) * .75;
  const model = studio.registry.models.find(model => model.id === 'coder');
  assert.doesNotThrow(() => studio.assertModelMemory(model));
  assert.throws(() => studio.assertModelMemory(model, { role: 'pipeline-agent' }), /alongside TIM and the loaded models/);
});

test('memory rows retain distinct roles and measurements when a model has two resident processes', async t => {
  const { studio, makeEngine } = await fixture(t);
  await studio.loadModel('coder');
  studio.pipelineAgent = makeEngine();
  const definition = pipeline('coder');
  Object.assign(definition.nodes[0], { type: 'agent', memoryPolicy: 'keep' });
  const saved = await studio.pipelines.save(definition);
  const run = await studio.runPipeline({ pipelineId: saved.id });
  await settled(studio, run.id);
  assert.equal(run.status, 'completed', run.error);
  await studio.sampleMemory();
  const state = studio.snapshot();
  const copies = state.loadedModels.filter(row => row.modelId === 'coder');
  assert.equal(copies.length, 2);
  assert.deepEqual(copies.map(row => row.role).sort(), ['pipeline-agent', 'specialist']);
  assert.equal(new Set(copies.map(row => row.pid)).size, 2);
  assert.ok(copies.every(row => row.memorySource === 'measured'));
  assert.equal(state.memory.modelRssBytes, state.loadedModels.reduce((sum, row) => sum + row.rssBytes, 0));
  await studio.unloadModel('coder');
  assert.deepEqual(ids(studio), ['guide']);
});

test('custom-agent delegation samples the persistent guide alongside the agent and pinned specialist', async t => {
  const { studio, makeEngine } = await fixture(t);
  await studio.loadModel('coder');
  let sampledDuringDelegation;
  const specialist = studio.llama.instances()[0].engine;
  const generate = specialist.generate.bind(specialist);
  specialist.generate = async (...args) => {
    sampledDuringDelegation = studio.snapshot().loadedModels;
    return generate(...args);
  };
  studio.pipelineAgent = makeEngine();
  let turn = 0;
  studio.pipelineAgent.turn = async () => ++turn === 1 ? {
    content: null,
    tool_calls: [{ id: 'delegate-coder', type: 'function', function: { name: 'run_chat', arguments: JSON.stringify({ modelId: 'coder', prompt: 'Write a short function' }) } }]
  } : { content: 'The specialist completed the task.' };
  const definition = pipeline('writer');
  Object.assign(definition.nodes[0], { type: 'agent', memoryPolicy: 'keep' });
  const saved = await studio.pipelines.save(definition);
  const run = await studio.runPipeline({ pipelineId: saved.id });
  await settled(studio, run.id);
  assert.equal(run.status, 'completed', run.error);
  const rows = sampledDuringDelegation;
  assert.ok(rows, 'The registered specialist must run.');
  assert.deepEqual(rows.map(row => row.role).sort(), ['guide', 'pipeline-agent', 'specialist']);
  assert.ok(rows.every(row => row.memorySource === 'measured'), 'All three actual processes must be present in the admission sample.');
});
