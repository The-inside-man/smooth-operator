import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Studio } from '../server/studio.mjs';

const contextUsage = { removedMessages: 2, contextTokens: 4096, promptTokens: 1800, responseTokens: 1024, method: 'fixture' };
const missingAnswer = /empty|blank|no.*(?:answer|text|response|content)/i;
const definition = nodes => ({ schemaVersion: 1, name: 'Empty response regression', description: '', nodes });
const node = (id, overrides = {}) => ({ id, name: id, type: 'code', modelId: 'qwen3-4b', prompt: `Complete ${id}`, dependsOn: [], position: { x: 100, y: 100 }, settings: {}, memoryPolicy: 'auto', ...overrides });

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-empty-reply-'));
  const studio = new Studio(directory);
  for (const name of ['work', 'outputs', 'uploads']) await fs.mkdir(path.join(directory, name));
  studio.config = { mainAgentModelId: 'guide', systemPrompt: 'Write useful answers and code.', backend: 'cpu', context: 4096, maxTokens: 1024, temperature: .1, agentMaxSteps: 2, agentTimeoutSeconds: 30 };
  studio.registry = { models: [
    { id: 'guide', name: 'TIM guide', kind: 'chat', available: true },
    { id: 'qwen3-4b', name: 'Qwen3 4B', kind: 'chat', available: true },
    { id: 'coder', name: 'Qwen2.5 0.5B', kind: 'chat', available: true }
  ], runtimes: { chat: { backend: 'cpu' } } };
  studio.catalog = [];
  const engine = () => ({
    modelId: null,
    async load(model, _runtime, signal) { signal.throwIfAborted(); this.modelId = model.id; },
    async unload() { this.modelId = null; },
    async generate(_messages, _settings, signal, onToken) { signal.throwIfAborted(); onToken('A useful answer.'); },
    async turn(_messages, _settings, signal) { signal.throwIfAborted(); return { content: 'A useful answer.' }; }
  });
  studio.llama = engine(); studio.orchestrator = engine();
  studio.loadOrchestrator = async (model, signal) => { signal.throwIfAborted(); studio.orchestrator.modelId = model.id; };
  studio.sampleMemory = async () => {};
  studio.assertModelMemory = () => {};
  await studio.pipelines.init();
  t.after(async () => { await studio.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return studio;
}

async function settled(studio, id) {
  const deadline = Date.now() + 4000;
  while (studio.active || ['queued', 'running'].includes(studio.jobs.find(job => job.id === id)?.status)) {
    if (Date.now() >= deadline) throw new Error('Empty-response fixture did not settle.');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const job = studio.jobs.find(item => item.id === id);
  return studio.sessions.find(session => session.id === job.sessionId)?.messages.find(message => message.jobId === id);
}

for (const kind of ['chat', 'code']) test(`manual ${kind} cannot finish successfully with only a context notice and no answer`, async t => {
  const studio = await fixture(t);
  let attempts = 0;
  studio.llama.generate = async (_messages, _settings, signal, onToken, onContext) => {
    signal.throwIfAborted();
    if (++attempts === 1) { onContext(contextUsage); if (kind === 'code') onToken(' \n\t'); }
    else onToken('The next request completed.');
  };
  const first = await studio.enqueue({ kind, modelId: 'qwen3-4b', prompt: 'Create a small Mac system-statistics script.' });
  const failed = await settled(studio, first.id);
  assert.equal(first.status, 'failed');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.content.trim(), '');
  assert.match(failed.error, missingAnswer);
  assert.deepEqual(failed.contextUsage, contextUsage, 'The useful context notice may remain, but is not an answer.');
  assert.equal(studio.registry.models.find(model => model.id === 'qwen3-4b').validation, 'Last run failed');
  const next = await studio.enqueue({ kind, modelId: 'qwen3-4b', sessionId: first.sessionId, prompt: 'Try a short answer.' });
  assert.equal((await settled(studio, next.id)).content, 'The next request completed.');
  assert.equal(next.status, 'completed', 'An empty response must release the shared queue.');
});

for (const kind of ['chat', 'code']) test(`manual Qwen3 ${kind} requests a visible answer without spending the reply budget on thinking`, async t => {
  const studio = await fixture(t);
  const original = structuredClone(studio.config);
  const requests = [];
  studio.llama.generate = async (messages, settings, signal, onToken) => {
    signal.throwIfAborted(); requests.push({ messages, settings }); onToken('printf "System statistics\\n"');
  };
  const job = await studio.enqueue({ kind, modelId: 'qwen3-4b', prompt: 'Write a small shell script for my Mac.' });
  const message = await settled(studio, job.id);
  assert.equal(job.status, 'completed');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].settings.enableThinking, false);
  assert.deepEqual(studio.config, original, 'Per-request response settings must not mutate saved preferences.');
  assert.equal(message.content, 'printf "System statistics\\n"');
});

test('a manual response that runs out of reply tokens stays failed and preserves the streamed code', async t => {
  const studio = await fixture(t);
  const partial = '#!/bin/zsh\nprintf "System statistics\\n"\nsysctl -n hw.memsize\n';
  studio.llama.generate = async (_messages, _settings, signal, onToken, onContext) => {
    signal.throwIfAborted(); onContext(contextUsage); onToken(partial);
    throw new Error('The response was truncated because it reached the response token limit. Increase response tokens and retry.');
  };
  const job = await studio.enqueue({ kind: 'code', modelId: 'qwen3-4b', prompt: 'Create a system-statistics script.' });
  const message = await settled(studio, job.id);
  assert.equal(job.status, 'failed'); assert.equal(message.status, 'failed');
  assert.equal(message.content, partial, 'Keep useful partial content, visibly marked as failed.');
  assert.match(message.error, /truncated.*token/i);
  assert.deepEqual(message.contextUsage, contextUsage);
});

for (const type of ['chat', 'code']) test(`a pipeline ${type} step fails on a blank answer and blocks dependent steps`, async t => {
  const studio = await fixture(t);
  const requests = [];
  studio.llama.generate = async (_messages, settings, signal, onToken, onContext) => {
    signal.throwIfAborted(); requests.push(settings); onContext(contextUsage); onToken(' \n');
  };
  const saved = await studio.pipelines.save(definition([node('draft', { type }), node('review', { dependsOn: ['draft'] })]));
  const run = await studio.runPipeline({ pipelineId: saved.id });
  await settled(studio, run.id);
  assert.equal(run.status, 'failed');
  assert.equal(studio.jobs.find(job => job.id === run.id).status, 'failed');
  assert.deepEqual(run.nodeRuns.map(step => step.status), ['failed', 'skipped']);
  assert.match(run.nodeRuns[0].error, missingAnswer);
  assert.equal(run.nodeRuns[0].text.trim(), '');
  assert.deepEqual(run.nodeRuns[0].contextUsage, contextUsage);
  assert.equal(requests.length, 1, 'A downstream agent must not receive an empty successful result.');
  assert.equal(requests[0].enableThinking, false);
});

test('a pipeline preserves a partial code result while marking truncation and its dependents as failed or skipped', async t => {
  const studio = await fixture(t);
  const partial = '#!/bin/zsh\nprintf "Memory: "\nsysctl -n hw.memsize\n';
  studio.llama.generate = async (_messages, _settings, signal, onToken, onContext) => {
    signal.throwIfAborted(); onContext(contextUsage); onToken(partial);
    throw new Error('Response truncated at the reply token limit.');
  };
  const saved = await studio.pipelines.save(definition([node('draft'), node('review', { dependsOn: ['draft'] })]));
  const run = await studio.runPipeline({ pipelineId: saved.id });
  await settled(studio, run.id);
  assert.equal(run.status, 'failed');
  assert.deepEqual(run.nodeRuns.map(step => step.status), ['failed', 'skipped']);
  assert.equal(run.nodeRuns[0].text, partial);
  assert.match(run.nodeRuns[0].error, /truncated.*token/i);
  assert.deepEqual(run.nodeRuns[0].contextUsage, contextUsage);
});

test('an agent receives a failed tool result when its text specialist returns no answer', async t => {
  const studio = await fixture(t);
  let turns = 0;
  studio.llama.generate = async (_messages, _settings, signal, onToken, onContext) => {
    signal.throwIfAborted(); onContext(contextUsage); onToken(' \n');
  };
  studio.orchestrator.turn = async messages => {
    if (++turns === 1) return { content: null, tool_calls: [{ id: 'write-code', type: 'function', function: { name: 'run_chat', arguments: JSON.stringify({ modelId: 'coder', prompt: 'Write the requested Mac script.' }) } }] };
    const result = JSON.parse(messages.at(-1).content);
    assert.equal(result.status, 'failed');
    assert.match(result.error, missingAnswer);
    assert.ok(!result.text?.trim(), 'An empty specialist must not be represented as a successful text result.');
    return { content: 'The coding specialist returned no answer. Please retry.' };
  };
  const job = await studio.enqueue({ kind: 'agent', prompt: 'Use a coding specialist to write a Mac statistics script.' });
  const message = await settled(studio, job.id);
  assert.equal(job.status, 'completed', 'The guide can honestly report the failed specialist task.');
  assert.equal(job.children[0].status, 'failed');
  assert.match(job.children[0].phase, missingAnswer);
  assert.deepEqual(job.children[0].contextUsage, contextUsage);
  assert.equal(message.content, 'The coding specialist returned no answer. Please retry.');
});

test('an agent preserves partial specialist code and reports the failure to its guide', async t => {
  const studio = await fixture(t);
  const partial = '#!/bin/zsh\nsysctl -n hw.memsize\n';
  let turns = 0;
  studio.llama.generate = async (_messages, settings, signal, onToken, onContext) => {
    signal.throwIfAborted();
    assert.equal(settings.enableThinking, false);
    onContext(contextUsage); onToken(partial);
    throw new Error('The model reached its response token limit before finishing.');
  };
  studio.orchestrator.turn = async messages => {
    if (++turns === 1) return { content: null, tool_calls: [{ id: 'write-code', type: 'function', function: { name: 'run_chat', arguments: JSON.stringify({ modelId: 'coder', prompt: 'Write the requested Mac script.' }) } }] };
    const result = JSON.parse(messages.at(-1).content);
    assert.equal(result.status, 'failed');
    assert.equal(result.text, partial);
    assert.match(result.error, /response token limit/);
    return { content: 'The specialist reached its response limit. Its partial code is retained below.' };
  };
  const job = await studio.enqueue({ kind: 'agent', prompt: 'Use a coding specialist to write a Mac statistics script.' });
  const message = await settled(studio, job.id);
  assert.equal(job.status, 'completed');
  assert.equal(job.children[0].status, 'failed');
  assert.equal(job.children[0].result.text, partial);
  assert.deepEqual(job.children[0].contextUsage, contextUsage);
  assert.match(message.content, /partial code is retained/);
});
