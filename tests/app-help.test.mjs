import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../server/agent.mjs';

const question = 'Hey, how can i guild a pipeline using this application?';
function fixture(reply = { content: 'Open Pipelines, choose New pipeline, then Add step.' }) {
  const turns = [], events = [];
  const studio = {
    config: { systemPrompt: 'Local assistant', mainAgentModelId: 'guide', agentMaxSteps: 2, maxTokens: 1024 },
    catalog: [{ id: 'coder', name: 'Catalog-only Coder', kind: 'chat', bestFor: ['Python'], memoryGB: 2 }],
    registry: { models: [{ id: 'guide', name: 'Guide', kind: 'chat', available: true }, { id: 'coder', name: 'Coder', kind: 'chat', available: true }], runtimes: { chat: { backend: 'cpu' } } },
    pipelines: { definitions: [{ name: 'PRIVATE RECIPE NAME', nodes: [{ prompt: 'PRIVATE RECIPE PROMPT' }] }], runs: [] },
    orchestrator: { modelId: 'guide', async turn(messages, settings, signal, tools) { signal.throwIfAborted(); turns.push({ messages: structuredClone(messages), settings, tools }); return reply; } },
    llama: { modelId: null, async unload() { events.push('unload'); }, async generate() { events.push('generate'); } },
    async loadOrchestrator() {}, async loadChat() { events.push('load'); }, async generateMedia() { events.push('media'); },
    uploadDir: '/unused', outputDir: '/unused', changed() {}, async persist() {}
  };
  return { studio, turns, events, job: { id: 'help', modelId: 'guide', attachments: [] }, message: {} };
}

test('reported pipeline question gets current UI instructions and no inference tools or catalog distraction', async () => {
  const { studio, turns, events, job, message } = fixture();
  await runAgent(studio, job, message, [{ role: 'user', content: question }], new AbortController().signal);
  const system = turns[0].messages[0].content;
  assert.match(system, /TIM STUDIO APPLICATION GUIDE/); assert.match(system, /Pipelines/); assert.match(system, /Run input/); assert.match(system, /Run pipeline/);
  assert.doesNotMatch(system, /Model catalog:|Catalog-only Coder|PRIVATE RECIPE/);
  assert.match(system, /"savedPipelines":1/);
  assert.deepEqual(turns[0].tools, []); assert.deepEqual(events, []); assert.deepEqual(job.children, []);
  assert.equal(turns[0].settings.temperature, 0);
  assert.match(job.phase, /explaining the application/); assert.equal(message.content, 'Open Pipelines, choose New pipeline, then Add step.');
});

test('help uses bounded user context and current manual instead of repeating outdated assistant guesses', async () => {
  const { studio, turns, job, message } = fixture();
  const history = [{ role: 'user', content: 'OLDER USER CONTEXT '.repeat(5000) }, { role: 'assistant', content: 'OUTDATED GUESS: TIM has no pipeline builder. '.repeat(5000) }, { role: 'user', content: question + ' '.repeat(10000) }];
  await runAgent(studio, job, message, history, new AbortController().signal);
  const messages = turns[0].messages;
  assert.equal(messages.length, 2); assert.equal(messages[1].role, 'user');
  assert.match(messages[0].content, /current guide takes precedence over older assistant guesses/);
  assert.doesNotMatch(JSON.stringify(messages), /OUTDATED GUESS/);
  assert.match(messages[1].content, /guild a pipeline/); assert.match(messages[1].content, /Long question shortened/);
  assert.ok(messages[1].content.length < 4200); assert.ok(JSON.stringify(messages).length < 10000);
});

test('a model cannot execute a registered specialist during an application-help-only turn', async () => {
  const reply = { content: null, tool_calls: [{ id: 'unexpected', type: 'function', function: { name: 'run_chat', arguments: JSON.stringify({ modelId: 'coder', prompt: 'Run work while explaining a button' }) } }] };
  const { studio, turns, events, job, message } = fixture(reply);
  await assert.rejects(runAgent(studio, job, message, [{ role: 'user', content: question }], new AbortController().signal), /not an available registered capability/);
  assert.deepEqual(turns[0].tools, []); assert.deepEqual(events, []); assert.deepEqual(job.children, []);
});

test('model recommendations retain the catalog and existing specialist capabilities', async () => {
  const { studio, turns, job, message } = fixture({ content: 'A Coder model suits Python work.' });
  await runAgent(studio, job, message, [{ role: 'user', content: 'Which coding model should I use for Python?' }], new AbortController().signal);
  assert.match(turns[0].messages[0].content, /Catalog-only Coder/);
  assert.ok(turns[0].tools.some(tool => tool.function.name === 'run_chat'));
  assert.equal(turns[0].settings.toolChoice, undefined);
});

test('requests to operate app controls receive the actual capability limit before user instructions', async () => {
  const { studio, turns, job, message } = fixture({ content: 'I can explain, but cannot click the interface or run saved pipelines from chat.' });
  await runAgent(studio, job, message, [{ role: 'user', content: 'Can you click New pipeline and run it for me?' }], new AbortController().signal);
  assert.match(turns[0].messages[0].content, /Answer this capability question in first person:.*cannot click the interface, create\/run saved pipelines, or download models from this chat/);
  assert.deepEqual(turns[0].tools, []);
});
