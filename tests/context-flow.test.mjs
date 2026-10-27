import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Studio } from '../server/studio.mjs';
import { Llama } from '../server/llama.mjs';
import { runAgent } from '../server/agent.mjs';
import { createPipelineExecutor } from '../server/pipeline-executor.mjs';

// Exercise the shared adapter through its real callers, without starting or
// downloading a model. Token counts are deterministic fixture measurements.
function localEngine(t, complete) {
  const completions = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body);
    if (String(url).endsWith('/apply-template')) return Response.json({ prompt: JSON.stringify(body.messages) });
    if (String(url).endsWith('/tokenize')) return Response.json({ tokens: Array(Math.ceil(String(body.content).length / 4)).fill(1) });
    assert.ok(String(url).endsWith('/v1/chat/completions'), `Unexpected engine endpoint: ${url}`);
    completions.push(structuredClone(body));
    const message = complete?.(body, completions.length) || { content: 'console.log("done");' };
    if (!body.stream) return Response.json({ choices: [{ finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }] });
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: message.content } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  return completions;
}

function loadedEngine(context = 4096) {
  const engine = new Llama('/unused/context-fixture');
  engine.port = 1;
  engine.contextTokens = context;
  engine.load = async function (model, _runtime, signal, _update, nextContext) {
    signal.throwIfAborted(); this.modelId = model.id; this.contextTokens = nextContext;
  };
  return engine;
}

async function studioFixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-context-flow-'));
  const studio = new Studio(dir);
  for (const folder of [studio.uploadDir, studio.outputDir, studio.workDir]) await fs.mkdir(folder, { recursive: true });
  studio.config = { mainAgentModelId: 'guide', systemPrompt: 'Return useful code.', backend: 'cpu', context: 4096, maxTokens: 1024, temperature: .1, agentMaxSteps: 2, agentTimeoutSeconds: 30 };
  studio.registry = { models: ['guide', 'coder'].map(id => ({ id, name: id, kind: 'chat', available: true })), runtimes: { chat: { backend: 'cpu' } } };
  studio.catalog = [];
  studio.llama = loadedEngine();
  studio.orchestrator = loadedEngine();
  studio.loadOrchestrator = async (model, signal) => { signal.throwIfAborted(); studio.orchestrator.modelId = model.id; studio.orchestrator.contextTokens = 4096; };
  studio.sampleMemory = async () => {};
  studio.assertModelMemory = () => {};
  t.after(async () => { await studio.close(); await fs.rm(dir, { recursive: true, force: true }); });
  return studio;
}

async function settled(studio, job) {
  const deadline = Date.now() + 3000;
  while (['queued', 'running'].includes(job.status) || studio.active?.job.id === job.id) {
    if (Date.now() > deadline) throw new Error('Context fixture queue did not settle.');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return studio.sessions.find(session => session.id === job.sessionId).messages.find(message => message.jobId === job.id);
}

test('code chat removes old history while keeping the latest request, attachment, and saved conversation intact', async t => {
  const completions = localEngine(t);
  const studio = await studioFixture(t);
  const session = await studio.newSession();
  const old = [
    { id: 'old-user', role: 'user', content: 'Old request '.repeat(2500) },
    { id: 'old-assistant', role: 'assistant', content: 'Old result '.repeat(2500), status: 'completed' }
  ];
  session.messages.push(...structuredClone(old));
  const source = 'function identity(value) { return value; }\n// Preserve this exact source.';
  await fs.writeFile(path.join(studio.uploadDir, 'source.js'), source);
  const request = 'Add types to the attached function. Preserve its behavior. LATEST_REQUEST_SENTINEL';
  const job = await studio.enqueue({ sessionId: session.id, kind: 'chat', modelId: 'coder', prompt: request, attachments: ['source.js'] });
  const message = await settled(studio, job);
  assert.equal(job.status, 'completed');
  assert.equal(completions.length, 1);
  assert.deepEqual(completions[0].messages.map(item => item.role), ['system', 'user']);
  assert.ok(completions[0].messages[1].content.startsWith(request));
  assert.ok(completions[0].messages[1].content.includes(source));
  assert.deepEqual(session.messages.slice(0, 2), old);
  assert.equal(message.content, 'console.log("done");', 'Context notices must not replace or enter generated code.');
  assert.equal(message.contextUsage.removedMessages, 2);
  assert.ok(message.contextUsage.promptTokens + message.contextUsage.responseTokens <= 4096);
  assert.equal(job.contextUsage.contextTokens, 4096);
});

test('an oversized current request fails clearly without silent truncation or blocking later work', async t => {
  const completions = localEngine(t);
  const studio = await studioFixture(t);
  const session = await studio.newSession();
  const prompt = 'Required source code: ' + 'x'.repeat(20000) + '\nDO_NOT_DROP_THE_END';
  const first = await studio.enqueue({ sessionId: session.id, kind: 'chat', modelId: 'coder', prompt });
  const failure = await settled(studio, first);
  assert.equal(first.status, 'failed');
  assert.match(failure.error, /context/i);
  assert.match(failure.error, /4096|4,096/);
  assert.match(failure.error, /shorten|smaller|increase/i);
  assert.equal(completions.length, 0, 'Inference must not receive a truncated current request.');
  assert.equal(session.messages[0].content, prompt);
  const next = await studio.enqueue({ sessionId: session.id, kind: 'chat', modelId: 'coder', prompt: 'A small new request.' });
  assert.equal((await settled(studio, next)).content, 'console.log("done");');
  assert.equal(next.status, 'completed', 'A failed large request must not poison subsequent turns in the same conversation.');
  assert.equal(completions.length, 1);
});

test('agent synthesis preserves the current tool-call pair after removing older conversation history', async t => {
  const call = { id: 'call-code', type: 'function', function: { name: 'run_chat', arguments: JSON.stringify({ modelId: 'coder', prompt: 'Write the requested function.' }) } };
  const completions = localEngine(t, (_body, number) => number === 1 ? { content: null, tool_calls: [call] } : { content: 'The specialist returned its code.' });
  const studio = await studioFixture(t);
  studio.llama.generate = async (_messages, _settings, signal, token) => { signal.throwIfAborted(); token('function answer() { return 42; }'); };
  const job = { id: 'agent-job', modelId: 'guide', attachments: [] }, message = {};
  const request = 'Use the coding specialist to write a function that returns 42.';
  const history = [{ role: 'user', content: 'Old topic '.repeat(3000) }, { role: 'assistant', content: 'Old answer '.repeat(3000) }, { role: 'user', content: request }];
  const original = structuredClone(history);
  await runAgent(studio, job, message, history, new AbortController().signal);
  assert.equal(completions.length, 2);
  const synthesis = completions[1].messages;
  assert.deepEqual(synthesis.map(item => item.role), ['system', 'user', 'assistant', 'tool']);
  assert.equal(synthesis[1].content, request);
  assert.deepEqual(synthesis[2].tool_calls, [call]);
  assert.equal(synthesis[3].tool_call_id, call.id);
  assert.equal(JSON.parse(synthesis[3].content).text, 'function answer() { return 42; }');
  assert.deepEqual(history, original);
  assert.equal(message.content, 'The specialist returned its code.');
  assert.equal(message.contextUsage.contextTokens, 4096);
});

test('a pipeline using the resident guide budgets against its actual 4096-token window', async t => {
  const completions = localEngine(t);
  const studio = await studioFixture(t);
  studio.config.context = 8192;
  const updates = [];
  const execute = createPipelineExecutor(studio);
  const node = { id: 'guide-code', type: 'code', modelId: 'guide', prompt: 'x'.repeat(13000), settings: { context: 8192, maxTokens: 1024 } };
  const context = { input: '', attachments: [], results: {}, artifacts: [], signal: new AbortController().signal, runId: 'run-guide-context', onUpdate: value => updates.push(value) };
  await assert.rejects(execute(node, context), error => /context/i.test(error.message) && /4096|4,096/.test(error.message));
  assert.equal(completions.length, 0);
  assert.equal(studio.config.context, 8192, 'Budgeting must not silently change the user setting.');
  assert.equal(studio.orchestrator.modelId, 'guide', 'A request-size error must leave the lightweight guide resident.');
  assert.ok(!updates.some(update => update.text), 'No partial or fabricated result should be emitted.');
});
