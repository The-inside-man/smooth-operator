import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Studio } from '../server/studio.mjs';
import { startServer } from '../server/index.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const node = (id, options = {}) => ({ id, name: id, type: 'chat', modelId: 'local', prompt: `Complete ${id}`, dependsOn: [], position: { x: 100, y: 200 }, settings: {}, memoryPolicy: 'auto', ...options });
const definition = nodes => ({ schemaVersion: 1, name: 'Local pipeline', description: 'Queue integration test', nodes });
async function until(predicate, label = 'state transition') {
  const deadline = Date.now() + 4000;
  while (!predicate()) { if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`); await new Promise(resolve => setTimeout(resolve, 5)); }
}
async function gate(signal, pending) {
  signal.throwIfAborted();
  let abort;
  try { await Promise.race([pending, new Promise((_resolve, reject) => { abort = () => reject(signal.reason || new Error('Cancelled')); signal.addEventListener('abort', abort, { once: true }); })]); }
  finally { signal.removeEventListener('abort', abort); }
}
function configure(studio) {
  studio.config = { mainAgentModelId: 'local', systemPrompt: 'test', backend: 'cpu', context: 4096, maxTokens: 100, temperature: .1, agentMaxSteps: 4, agentTimeoutSeconds: 30 };
  studio.registry = { models: [{ id: 'local', name: 'Local fixture', kind: 'chat', available: true }], runtimes: { chat: { backend: 'cpu' } } };
  const engine = () => ({ modelId: null, async load(model) { this.modelId = model.id; }, async unload() { this.modelId = null; }, async generate(_messages, _settings, signal, onToken) { signal.throwIfAborted(); onToken('Manual response'); } });
  studio.llama = engine(); studio.orchestrator = engine();
  studio.rescan = async () => {}; studio.telemetry = async () => {};
}
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-pipeline-queue-'));
  const studio = new Studio(directory), studios = [studio]; configure(studio);
  for (const name of ['uploads', 'outputs', 'work']) await fs.mkdir(path.join(directory, name));
  await studio.pipelines.init();
  t.after(async () => { for (const item of studios) await item.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { studio, directory, studios };
}
const settled = (studio, id) => until(() => !studio.active && !['queued', 'running'].includes(studio.jobs.find(job => job.id === id)?.status), 'job to settle');

test('pipeline steps and normal chat share one global inference queue without overlap', async t => {
  const { studio } = await fixture(t);
  const started = deferred(), release = deferred(), events = []; let active = 0, maxActive = 0;
  studio.pipelines.executeStep = async (step, context) => {
    active++; maxActive = Math.max(active, maxActive); events.push(`${step.id}:start`);
    if (step.id === 'a') { started.resolve(); await gate(context.signal, release.promise); }
    events.push(`${step.id}:end`); active--; return { text: `Result ${step.id}` };
  };
  studio.llama.generate = async (_messages, _settings, signal, token) => { signal.throwIfAborted(); active++; maxActive = Math.max(active, maxActive); events.push('chat'); token('Manual response'); active--; };
  const saved = await studio.pipelines.save(definition([node('a'), node('b', { dependsOn: ['a'] })]));
  const run = await studio.runPipeline({ pipelineId: saved.id }); await started.promise;
  const manual = await studio.enqueue({ kind: 'chat', modelId: 'local', prompt: 'Manual task' });
  assert.equal(manual.status, 'queued'); assert.deepEqual(events, ['a:start']);
  release.resolve(); await settled(studio, manual.id);
  assert.equal(run.status, 'completed'); assert.equal(manual.status, 'completed'); assert.equal(maxActive, 1);
  assert.deepEqual(events, ['a:start', 'a:end', 'b:start', 'b:end', 'chat']);
  assert.equal(studio.jobs.find(job => job.id === run.id).progress, 100);
});

test('queued pause remains effective while its persistence is pending and another job finishes', async t => {
  const { studio } = await fixture(t);
  const manualStarted = deferred(), manualRelease = deferred(), pauseApplied = deferred(), pauseRelease = deferred(); let steps = 0;
  studio.llama.generate = async (_messages, _settings, signal, token) => { manualStarted.resolve(); await gate(signal, manualRelease.promise); token('Done'); };
  studio.pipelines.executeStep = async () => { steps++; return { text: 'Done' }; };
  const manual = await studio.enqueue({ kind: 'chat', modelId: 'local', prompt: 'First' }); await manualStarted.promise;
  const saved = await studio.pipelines.save(definition([node('a')]));
  const run = await studio.runPipeline({ pipelineId: saved.id }); assert.equal(run.status, 'queued');
  const originalChanged = studio.pipelines.changed.bind(studio.pipelines);
  studio.pipelines.changed = async () => { if (run.status === 'paused') { pauseApplied.resolve(); await pauseRelease.promise; } await originalChanged(); };
  const pausing = studio.pausePipeline(run.id); await pauseApplied.promise;
  assert.equal(studio.jobs.find(job => job.id === run.id).status, 'queued');
  manualRelease.resolve(); await settled(studio, manual.id);
  assert.equal(steps, 0); assert.equal(run.status, 'paused'); assert.equal(studio.active, null);
  pauseRelease.resolve(); await pausing; studio.pipelines.changed = originalChanged;
  assert.equal(studio.jobs.find(job => job.id === run.id).status, 'paused');
  await studio.resumePipeline(run.id); await settled(studio, run.id);
  assert.equal(run.status, 'completed'); assert.equal(steps, 1);
});

test('active pause finishes one step, then resume keeps completed outputs and the same queue job', async t => {
  const { studio } = await fixture(t);
  const started = deferred(), release = deferred(), calls = [];
  studio.pipelines.executeStep = async (step, context) => { calls.push(step.id); if (step.id === 'a') { started.resolve(); await gate(context.signal, release.promise); } else assert.equal(context.results.a.text, 'Result a'); return { text: `Result ${step.id}` }; };
  const saved = await studio.pipelines.save(definition([node('a'), node('b', { dependsOn: ['a'] })]));
  const run = await studio.runPipeline({ pipelineId: saved.id }); await started.promise;
  await studio.pausePipeline(run.id); release.resolve(); await settled(studio, run.id);
  assert.equal(run.status, 'paused'); assert.deepEqual(calls, ['a']); assert.equal(run.nodeRuns[0].text, 'Result a');
  await studio.resumePipeline(run.id); await settled(studio, run.id);
  assert.equal(run.status, 'completed'); assert.deepEqual(calls, ['a', 'b']);
  assert.equal(studio.jobs.filter(job => job.id === run.id).length, 1);
});

test('paused pipeline cannot resume while a manual model load owns the specialist process', async t => {
  const { studio } = await fixture(t);
  studio.config.mainAgentModelId = 'guide';
  const loadStarted = deferred(), loadRelease = deferred(), events = [];
  studio.llama.load = async (_model, _runtime, signal) => { events.push('load:start'); loadStarted.resolve(); await gate(signal, loadRelease.promise); events.push('load:end'); };
  studio.pipelines.executeStep = async () => { events.push('pipeline'); return { text: 'Done' }; };
  const saved = await studio.pipelines.save(definition([node('a')]));
  const run = await studio.pipelines.createRun({ pipelineId: saved.id }); await studio.pipelines.pause(run.id);
  const loading = studio.loadModel('local'); await loadStarted.promise;
  try {
    await assert.rejects(studio.resumePipeline(run.id), /finish loading/);
    assert.equal(run.status, 'paused'); assert.equal(studio.jobs.length, 0); assert.deepEqual(events, ['load:start']);
  } finally { loadRelease.resolve(); await loading; }
  await studio.resumePipeline(run.id); await settled(studio, run.id);
  assert.equal(run.status, 'completed'); assert.deepEqual(events, ['load:start', 'load:end', 'pipeline']);
});

test('a manual load starting during resume preflight holds the queue until loading finishes', async t => {
  const { studio } = await fixture(t);
  studio.config.mainAgentModelId = 'guide';
  const checking = deferred(), preflightRelease = deferred(), loadStarted = deferred(), loadRelease = deferred(), events = [];
  studio.llama.load = async (_model, _runtime, signal) => { events.push('load:start'); loadStarted.resolve(); await gate(signal, loadRelease.promise); events.push('load:end'); };
  studio.pipelines.executeStep = async () => { assert.equal(studio.loadingModel, false); events.push('pipeline'); return { text: 'Done' }; };
  const saved = await studio.pipelines.save(definition([node('a')]));
  const run = await studio.pipelines.createRun({ pipelineId: saved.id }); await studio.pipelines.pause(run.id);
  const validate = studio.pipelines.validateModel;
  studio.pipelines.validateModel = async step => { await validate(step); checking.resolve(); await preflightRelease.promise; };
  const resuming = studio.resumePipeline(run.id); await checking.promise;
  const loading = studio.loadModel('local'); await loadStarted.promise;
  try {
    preflightRelease.resolve(); await resuming;
    assert.equal(run.status, 'queued'); assert.equal(studio.active, null); assert.deepEqual(events, ['load:start']);
  } finally { preflightRelease.resolve(); loadRelease.resolve(); await loading; }
  await settled(studio, run.id);
  assert.equal(run.status, 'completed'); assert.deepEqual(events, ['load:start', 'load:end', 'pipeline']);
});

test('cancelling an active pipeline aborts its step and releases the shared queue for later chat', async t => {
  const { studio } = await fixture(t);
  const started = deferred(), never = deferred(), calls = [];
  studio.pipelines.executeStep = async (step, context) => { calls.push(step.id); started.resolve(); await gate(context.signal, never.promise); return { text: 'Unexpected' }; };
  const saved = await studio.pipelines.save(definition([node('a'), node('b', { dependsOn: ['a'] })]));
  const run = await studio.runPipeline({ pipelineId: saved.id }); await started.promise;
  const manual = await studio.enqueue({ kind: 'chat', modelId: 'local', prompt: 'Later' });
  await studio.cancel(run.id); await settled(studio, manual.id);
  assert.equal(run.status, 'cancelled'); assert.deepEqual(calls, ['a']); assert.equal(manual.status, 'completed');
  assert.equal(studio.jobs.find(job => job.id === run.id).status, 'cancelled');
  assert.deepEqual(run.nodeRuns.map(step => step.status), ['cancelled', 'skipped']);
});

test('closing the app interrupts active pipelines and restart resumes only unfinished steps explicitly', async t => {
  const { studio, directory, studios } = await fixture(t);
  const started = deferred(), never = deferred(), calls = [];
  studio.pipelines.executeStep = async (step, context) => { calls.push(step.id); if (step.id === 'b') { started.resolve(); await gate(context.signal, never.promise); } return { text: `Result ${step.id}` }; };
  const saved = await studio.pipelines.save(definition([node('a'), node('b', { dependsOn: ['a'] }), node('c', { dependsOn: ['b'] })]));
  const run = await studio.runPipeline({ pipelineId: saved.id }); await started.promise;
  await studio.close(); assert.equal(run.status, 'interrupted'); assert.equal(run.nodeRuns[0].status, 'completed');
  const reopened = new Studio(directory); configure(reopened); studios.push(reopened);
  const resumed = [];
  reopened.pipelines.executeStep = async (step, context) => { resumed.push(step.id); if (step.id === 'b') assert.equal(context.results.a.text, 'Result a'); return { text: `Resumed ${step.id}` }; };
  await reopened.init(); assert.deepEqual(resumed, []); assert.equal(reopened.pipelines.getRun(run.id).status, 'interrupted'); assert.equal(reopened.active, null);
  await reopened.resumePipeline(run.id); await settled(reopened, run.id);
  assert.deepEqual(calls, ['a', 'b']); assert.deepEqual(resumed, ['b', 'c']); assert.equal(reopened.pipelines.getRun(run.id).status, 'completed');
});

test('pipeline HTTP endpoints enforce local mutation checks and graph validation is a true dry run', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-pipeline-api-'));
  const originalRescan = Studio.prototype.rescan, originalTelemetry = Studio.prototype.telemetry;
  Studio.prototype.rescan = async () => {}; Studio.prototype.telemetry = async () => {};
  let service;
  try { service = await startServer({ port: 0, dataDir: directory, autoSetup: false }); }
  finally { Studio.prototype.rescan = originalRescan; Studio.prototype.telemetry = originalTelemetry; }
  t.after(async () => { await service?.close(); await fs.rm(directory, { recursive: true, force: true }); });
  configure(service.studio);
  const calls = [];
  service.studio.pipelines.executeStep = async step => { calls.push(step.id); return { text: `Result ${step.id}` }; };
  const post = (route, value, headers = {}) => fetch(service.url + route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tim-request': '1', ...headers }, body: JSON.stringify(value) });
  let response = await fetch(service.url + '/api/pipelines/save', { method: 'POST', body: JSON.stringify({ pipeline: definition([node('a')]) }) }); assert.equal(response.status, 403);
  response = await post('/api/pipelines/save', { pipeline: definition([node('a')]) }, { origin: 'https://unrelated.example' }); assert.equal(response.status, 403);
  response = await post('/api/pipelines/validate', { pipeline: definition([node('a')]) }); assert.equal(response.status, 200); assert.equal((await response.json()).valid, true);
  assert.equal(service.studio.pipelines.definitions.length, 0); assert.equal(service.studio.pipelines.runs.length, 0); assert.equal(service.studio.jobs.length, 0); assert.deepEqual(calls, []);
  for (const invalid of [definition([node('a', { type: 'shell' })]), definition([node('a', { settings: { command: 'run something' } })]), definition([node('a', { prompt: '{{steps.future.output}}' })])]) {
    response = await post('/api/pipelines/validate', { pipeline: invalid }); assert.equal(response.status, 400);
  }
  response = await post('/api/pipelines/save', { pipeline: definition([node('a')]) }); assert.equal(response.status, 200); const saved = await response.json();
  response = await post('/api/pipelines/run', { pipelineId: saved.id, attachments: ['../secret.txt'] }); assert.equal(response.status, 400);
  await fs.writeFile(path.join(directory, 'secret.txt'), 'private'); await fs.symlink(path.join(directory, 'secret.txt'), path.join(directory, 'uploads/link.txt'));
  response = await post('/api/pipelines/run', { pipelineId: saved.id, attachments: ['link.txt'] }); assert.equal(response.status, 400);
  assert.equal(service.studio.jobs.length, 0); assert.deepEqual(calls, []);
  response = await post('/api/pipelines/run', { pipelineId: saved.id, input: 'Run this locally' }); assert.equal(response.status, 200); const run = await response.json(); await settled(service.studio, run.id);
  response = await fetch(service.url + '/api/state'); const state = await response.json();
  assert.equal(state.pipelines[0].id, saved.id); assert.equal(state.pipelineRuns[0].status, 'completed'); assert.deepEqual(calls, ['a']);
  response = await post('/api/pipelines/delete', { id: saved.id }); assert.equal(response.status, 200); assert.equal(service.studio.pipelines.definitions.length, 0); assert.equal(service.studio.pipelines.runs.length, 1);
});
