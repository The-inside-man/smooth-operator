import test from 'node:test';
import assert from 'node:assert/strict';
import { Llama } from '../server/llama.mjs';

const tools = ['run_chat', 'run_image'].map(name => ({ type: 'function', function: { name, parameters: { type: 'object', properties: {}, additionalProperties: false } } }));
const named = { type: 'function', function: { name: 'run_chat' } };
const call = name => ({ id: 'call-1', type: 'function', function: { name, arguments: '{}' } });
function fixture(t, message, finishReason = 'stop') {
  const llama = new Llama('/unused'); llama.port = 1234;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ choices: [{ message, finish_reason: finishReason }] }) };
  });
  return { llama, requests, signal: new AbortController().signal };
}

for (const toolChoice of [named, 'required']) {
  const mode = typeof toolChoice === 'string' ? toolChoice : 'named';
  for (const [shape, message] of Object.entries({ missing: { content: 'I reviewed it myself.' }, empty: { content: 'Done.', tool_calls: [] } })) {
    test(`${mode} tool selection refuses ${shape} tool-call lists instead of silently accepting prose`, async t => {
      const { llama, signal } = fixture(t, message);
      await assert.rejects(llama.turn([{ role: 'user', content: 'Delegate this work.' }], { maxTokens: 1024, toolChoice }, signal, tools), /tool|function|specialist/i);
    });
  }
  test(`${mode} tool selection accepts an actual structured call`, async t => {
    const message = { content: null, tool_calls: [call('run_chat')] };
    const { llama, signal, requests } = fixture(t, message, 'tool_calls');
    const result = await llama.turn([], { maxTokens: 1024, toolChoice }, signal, tools);
    assert.deepEqual(result, message);
    assert.equal(requests[0].tool_choice, 'required');
    assert.deepEqual(requests[0].tools.map(tool => tool.function.name), mode === 'named' ? ['run_chat'] : ['run_chat', 'run_image']);
  });
}

test('named tool selection refuses a different function even when that function is registered', async t => {
  const { llama, signal } = fixture(t, { content: null, tool_calls: [call('run_image')] }, 'tool_calls');
  await assert.rejects(llama.turn([], { maxTokens: 1024, toolChoice: named }, signal, tools), /tool|function|specialist/i);
});

test('automatic selection still permits a conversational answer', async t => {
  const message = { content: 'A small coding model suits this task.' };
  const { llama, signal, requests } = fixture(t, message);
  assert.deepEqual(await llama.turn([], { maxTokens: 1024 }, signal, tools), message);
  assert.equal(requests[0].tool_choice, 'auto');
});

test('no-tool synthesis permits prose even if earlier settings selected a function', async t => {
  const message = { content: 'The specialist completed the task.' };
  const { llama, signal, requests } = fixture(t, message);
  assert.deepEqual(await llama.turn([], { maxTokens: 1024, toolChoice: named }, signal, []), message);
  assert.equal(requests[0].tool_choice, 'none'); assert.equal(requests[0].tools, undefined);
});

test('a truncated forced-tool response fails instead of exposing an incomplete action', async t => {
  const { llama, signal } = fixture(t, { content: null, tool_calls: [call('run_chat')] }, 'length');
  await assert.rejects(llama.turn([], { maxTokens: 1024, toolChoice: named }, signal, tools), /truncated/i);
});
