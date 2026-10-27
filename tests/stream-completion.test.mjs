import test from 'node:test';
import assert from 'node:assert/strict';
import { Llama } from '../server/llama.mjs';

const signal = () => new AbortController().signal;
const messages = [{ role: 'user', content: 'Write a short Mac system report script.' }];
const event = value => `data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`;
const delta = value => ({ choices: [{ index: 0, delta: value, finish_reason: null }] });
const finish = reason => ({ choices: [{ index: 0, delta: {}, finish_reason: reason }] });

function fixture(t, events) {
  const llama = new Llama('/unused');
  llama.port = 123; llama.contextTokens = 4096; llama.tokenizerAvailable = false;
  const requests = [], output = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(events.map(event).join(''));
  });
  return { llama, requests, output, generate: onContext => llama.generate(messages, { maxTokens: 1024 }, signal(), token => output.push(token), onContext) };
}

test('reasoning-only token exhaustion fails with an explanation and never displays reasoning', async t => {
  const { generate, output, requests } = fixture(t, [delta({ reasoning_content: 'Private model reasoning.' }), finish('length'), '[DONE]']);
  await assert.rejects(generate(), /response budget on reasoning.+choose a different model.+increase Response tokens/);
  assert.deepEqual(output, []);
  assert.equal(requests.length, 1);
});

test('partial visible output at the token limit is preserved but never accepted as completed', async t => {
  const { generate, output } = fixture(t, [delta({ content: '```python\nprint(' }), finish('length'), '[DONE]']);
  await assert.rejects(generate(), /token limit before finishing.+partial answer was kept.+Increase response tokens/);
  assert.equal(output.join(''), '```python\nprint(');
});

test('empty token-limited responses have an actionable error', async t => {
  const { generate } = fixture(t, [finish('length'), '[DONE]']);
  await assert.rejects(generate(), /token limit without producing an answer/);
});

test('whitespace content and a normal stop cannot count as an answer', async t => {
  const { generate, output } = fixture(t, [delta({ content: ' \n\t' }), finish('stop'), '[DONE]']);
  await assert.rejects(generate(), /returned no answer/);
  assert.equal(output.join('').trim(), '');
});

test('a completed stream with no choices cannot count as an answer', async t => {
  const { generate } = fixture(t, [{ choices: [], usage: { completion_tokens: 0 } }, '[DONE]']);
  await assert.rejects(generate(), /returned no answer/);
});

test('reasoning without an answer fails even when the model reports a normal stop', async t => {
  const { generate, output } = fixture(t, [delta({ reasoning: 'Private thoughts.' }), finish('stop'), '[DONE]']);
  await assert.rejects(generate(), /reasoning without an answer.+choose a different model/);
  assert.deepEqual(output, []);
});

test('a model can reason and then produce a complete answer without exposing reasoning', async t => {
  const { generate, output } = fixture(t, [delta({ reasoning_content: 'Private thoughts.' }), delta({ content: 'Here is your script.' }), finish('stop'), '[DONE]']);
  await generate();
  assert.equal(output.join(''), 'Here is your script.');
});

test('a normal answer accepts the final usage-only chunk', async t => {
  const { generate, output } = fixture(t, [delta({ role: 'assistant', content: '' }), delta({ content: 'Answer' }), finish('stop'), { choices: [], usage: { prompt_tokens: 2678, completion_tokens: 10 } }, '[DONE]']);
  await generate();
  assert.equal(output.join(''), 'Answer');
});

test('older engines may terminate with DONE without a finish reason', async t => {
  const { generate, output } = fixture(t, [delta({ content: 'Compatible answer' }), '[DONE]']);
  await generate();
  assert.equal(output.join(''), 'Compatible answer');
});

test('a stop finish reason is sufficient when the engine omits DONE', async t => {
  const { generate, output } = fixture(t, [delta({ content: 'Complete answer' }), finish('stop')]);
  await generate();
  assert.equal(output.join(''), 'Complete answer');
});

test('a connection ending before a completion marker fails and retains partial text', async t => {
  const { generate, output } = fixture(t, [delta({ content: 'Incomplete answer' })]);
  await assert.rejects(generate(), /connection ended before the answer was complete.+partial answer was kept/);
  assert.equal(output.join(''), 'Incomplete answer');
});

test('an empty disconnected stream fails', async t => {
  const { generate } = fixture(t, []);
  await assert.rejects(generate(), /connection ended before the answer was complete/);
});

test('interrupted and filtered generations cannot look like success', async t => {
  const { generate, output } = fixture(t, [delta({ content: 'Partial' }), finish('content_filter'), '[DONE]']);
  await assert.rejects(generate(), /without completing the answer \(content_filter\)/);
  assert.equal(output.join(''), 'Partial');
});

test('non-context errors are not retried or hidden behind empty-response validation', async t => {
  const { generate, requests } = fixture(t, [{ error: { message: 'Engine failed during generation' } }, '[DONE]']);
  await assert.rejects(generate(), /Engine failed during generation/);
  assert.equal(requests.length, 1);
});

test('context failures after reasoning are not retried', async t => {
  const overflow = { error: { type: 'exceed_context_size_error', message: 'request (4130 tokens) exceeds the available context size (4096 tokens), try increasing it', n_prompt_tokens: 4130, n_ctx: 4096 } };
  const { generate, requests, output } = fixture(t, [delta({ reasoning_content: 'Already generating' }), overflow, '[DONE]']);
  await assert.rejects(generate(), /exceeds the available context/);
  assert.equal(requests.length, 1);
  assert.deepEqual(output, []);
});

test('failed completions still report the context actually sent after history was omitted', async t => {
  const llama = new Llama('/unused'); llama.port = 123; llama.contextTokens = 4096;
  const current = messages[0]; let context, sent;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/apply-template')) return Response.json({ prompt: JSON.stringify(body) });
    if (url.endsWith('/tokenize')) return Response.json({ tokens: Array(JSON.parse(body.content).messages.length > 1 ? 4000 : 2678).fill(1) });
    sent = body;
    return new Response([delta({ reasoning_content: 'Private thoughts.' }), finish('length'), '[DONE]'].map(event).join(''));
  });
  await assert.rejects(llama.generate([{ role: 'user', content: 'Old question' }, { role: 'assistant', content: 'Old answer' }, current], { maxTokens: 1024 }, signal(), () => {}, value => { context = value; }), /response budget on reasoning/);
  assert.deepEqual(sent.messages, [current]);
  assert.deepEqual(context, { removedMessages: 2, promptTokens: 2678, contextTokens: 4096, responseTokens: 1024, method: 'tokenizer' });
});

test('stream parsing preserves fragmented UTF-8 and a final event without a newline', async t => {
  const llama = new Llama('/unused'); llama.port = 123; llama.tokenizerAvailable = false;
  const text = event(delta({ content: 'Complete 🧠 answer' })) + 'data: [DONE]';
  const bytes = new TextEncoder().encode(text);
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) { for (let index = 0; index < bytes.length; index++) controller.enqueue(bytes.subarray(index, index + 1)); controller.close(); }
  })));
  let output = '';
  await llama.generate(messages, { maxTokens: 1024 }, signal(), token => { output += token; });
  assert.equal(output, 'Complete 🧠 answer');
});
