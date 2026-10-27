import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Llama } from '../server/llama.mjs';
import { contextLimitError, parseContextError, removeOldestHistory } from '../server/context.mjs';

const signal = () => new AbortController().signal;
const user = content => ({ role: 'user', content });
const assistant = content => ({ role: 'assistant', content });
const system = { role: 'system', content: 'Keep the application instructions.' };
const toolCall = { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'run_chat', arguments: '{}' } }] };
const toolResult = { role: 'tool', tool_call_id: 'call-1', content: 'Important code result' };
const overflow = (promptTokens = 4130, contextTokens = 4096) => ({ error: { code: 400, type: 'exceed_context_size_error', message: `request (${promptTokens} tokens) exceeds the available context size (${contextTokens} tokens), try increasing it`, n_prompt_tokens: promptTokens, n_ctx: contextTokens } });
const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const complete = () => jsonResponse({ choices: [{ finish_reason: 'stop', message: assistant('Done') }] });
const stream = (...data) => new Response(data.map(value => `data: ${JSON.stringify(value)}\n\n`).join('') + 'data: [DONE]\n\n');
const token = content => ({ choices: [{ delta: { content } }] });

function exactFixture(t, count, completion = () => stream(token('Generated code'))) {
  const llama = new Llama('/unused'); llama.port = 123; llama.contextTokens = 4096;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, body });
    if (url.endsWith('/apply-template')) return jsonResponse({ prompt: JSON.stringify(body) });
    if (url.endsWith('/tokenize')) return jsonResponse({ tokens: Array(count(JSON.parse(body.content))).fill(1) });
    return completion(body);
  });
  return { llama, requests };
}

test('history pruning keeps instructions and removes a complete oldest tool conversation together', () => {
  const current = user('Current source\n<script>literal</script>');
  const messages = [system, user('Old task'), toolCall, toolResult, assistant('Old answer'), { role: 'developer', content: 'Keep this too' }, current, toolCall, toolResult];
  const result = removeOldestHistory(messages);
  assert.equal(result.removedMessages, 4);
  assert.deepEqual(result.messages, [system, messages[5], current, toolCall, toolResult]);
  assert.equal(messages.length, 9);
});

test('historical user-only failed requests are removable but pending tool groups stay intact', () => {
  assert.deepEqual(removeOldestHistory([system, user('Failed enormous task'), user('Try a small task')]).messages, [system, user('Try a small task')]);
  const messages = [system, user('Interrupted tool task'), toolCall, user('Later complete task'), assistant('Done'), user('Current')];
  assert.deepEqual(removeOldestHistory(messages).messages, [system, messages[1], toolCall, user('Current')]);
  assert.equal(removeOldestHistory([system, user('Unanswered tool call'), toolCall, user('Current')]).removedMessages, 0);
});

test('the active user request and its entire tool chain cannot be shortened', () => {
  const messages = [system, user('Keep complete code'), toolCall, toolResult];
  assert.deepEqual(removeOldestHistory(messages), { messages, removedMessages: 0 });
});

test('context failures are recognized by structured type or precise engine text only', () => {
  assert.deepEqual(parseContextError(overflow()), { promptTokens: 4130, contextTokens: 4096 });
  assert.deepEqual(parseContextError(JSON.stringify(overflow())), { promptTokens: 4130, contextTokens: 4096 });
  assert.deepEqual(parseContextError(overflow().error.message), { promptTokens: 4130, contextTokens: 4096 });
  assert.equal(parseContextError('Invalid tool context'), null);
  assert.equal(parseContextError({ error: { message: 'The server is unavailable', type: 'server_error' } }), null);
  assert.match(contextLimitError({ promptTokens: 4130, contextTokens: 4096, responseTokens: 1024 }).message, /4,096.+4,130.+1,024.+8,192.+kept intact/);
  assert.match(contextLimitError({ promptTokens: 12034, contextTokens: 4096, responseTokens: 128 }).message, /16,384/);
  const fixed = contextLimitError({ promptTokens: 4130, contextTokens: 4096, responseTokens: 1024, fixedContext: true }).message;
  assert.match(fixed, /fixed context.+Chat\/Code/); assert.doesNotMatch(fixed, /8,192/);
});

test('token budgeting reserves output tokens and counts the exact tool/template payload', async t => {
  const offered = [{ type: 'function', function: { name: 'run_chat', parameters: { type: 'object' } } }];
  const forced = { type: 'function', function: { name: 'run_chat' } };
  const current = user('Current code stays literal 🔒');
  const { llama, requests } = exactFixture(t, body => body.messages.length > 2 ? 3300 : 800, () => jsonResponse({ choices: [{ finish_reason: 'tool_calls', message: toolCall }] }));
  const messages = [system, user('Earlier code'), assistant('Earlier answer'), current];
  let usage;
  await llama.turn(messages, { maxTokens: 1024, context: 32768, enableThinking: false, toolChoice: forced }, signal(), offered, value => { usage = value; });
  const template = requests.find(request => request.url.endsWith('/apply-template')).body;
  assert.deepEqual(template.tools, offered);
  assert.equal(template.tool_choice, 'required'); assert.equal(template.parallel_tool_calls, false);
  assert.deepEqual(template.chat_template_kwargs, { enable_thinking: false });
  const tokenizer = requests.find(request => request.url.endsWith('/tokenize')).body;
  assert.equal(tokenizer.add_special, true); assert.equal(tokenizer.parse_special, true);
  const completion = requests.find(request => request.url.endsWith('/v1/chat/completions')).body;
  assert.deepEqual(completion.messages, [system, current]); assert.equal(completion.max_tokens, 1024);
  assert.deepEqual(usage, { removedMessages: 2, promptTokens: 800, contextTokens: 4096, responseTokens: 1024, method: 'tokenizer' });
  assert.equal(messages.length, 4);
});

test('oversized single source errors before generation and never cuts the latest request', async t => {
  const { llama, requests } = exactFixture(t, () => 4130);
  await assert.rejects(llama.generate([system, user('literal '.repeat(5000))], { maxTokens: 1024 }, signal(), () => {}), /Context tokens.+8,192.+source.+kept intact/);
  assert.ok(!requests.some(request => request.url.endsWith('/v1/chat/completions')));
});

test('a nearly full window removes history even when the input alone fits', async t => {
  const { llama, requests } = exactFixture(t, body => body.messages.length > 2 ? 3900 : 3000);
  let output = '';
  await llama.generate([system, user('Old'), assistant('Answer'), user('Current')], { maxTokens: 1024 }, signal(), text => { output += text; });
  assert.equal(output, 'Generated code');
  assert.equal(requests.find(request => request.url.endsWith('/v1/chat/completions')).body.messages.length, 2);
});

test('unsupported template APIs fall back to bounded context-only history retries', async t => {
  const llama = new Llama('/unused'); llama.port = 123; llama.contextTokens = 4096;
  const bodies = []; let templates = 0, usage;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/apply-template')) { templates++; return jsonResponse({}, 404); }
    const body = JSON.parse(options.body); bodies.push(body);
    return bodies.length === 1 ? jsonResponse(overflow(), 400) : stream(token('Recovered'));
  });
  let output = '';
  const current = user('Latest task/source unchanged');
  await llama.generate([system, user('Old'), toolCall, toolResult, assistant('Old answer'), current], { maxTokens: 1024 }, signal(), text => { output += text; }, value => { usage = value; });
  assert.equal(templates, 1); assert.equal(bodies.length, 2); assert.equal(output, 'Recovered');
  assert.deepEqual(bodies[1].messages, [system, current]);
  assert.deepEqual(usage, { removedMessages: 4, promptTokens: null, contextTokens: 4096, responseTokens: 1024, method: 'engine' });
});

test('unavailable tokenizer with no safe history produces an actionable overflow error', async t => {
  const llama = new Llama('/unused'); llama.port = 123; llama.contextTokens = 4096;
  let completions = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.endsWith('/apply-template')) return jsonResponse({ prompt: 'Prompt' });
    if (url.endsWith('/tokenize')) return jsonResponse({}, 501);
    completions++; return jsonResponse(overflow(), 400);
  });
  await assert.rejects(llama.generate([system, user('Source')], { maxTokens: 1024 }, signal(), () => {}), /loaded model.+4,096.+4,130.+8,192/);
  assert.equal(completions, 1);
});

test('fallback does not retry unrelated engine or template failures', async t => {
  const llama = new Llama('/unused'); llama.port = 123; llama.contextTokens = 4096;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return jsonResponse({ error: { message: 'Invalid schema' } }, 400); });
  await assert.rejects(llama.generate([system, user('Old'), assistant('Old'), user('Current')], { maxTokens: 1024 }, signal(), () => {}), /Invalid schema/);
  assert.equal(calls, 1);
  llama.tokenizerAvailable = false; calls = 0;
  await assert.rejects(llama.turn([system, user('Old'), assistant('Old'), user('Current')], { maxTokens: 1024 }, signal()), /Invalid schema/);
  assert.equal(calls, 1);
});

test('stream context errors may retry before tokens, never after a token was emitted', async t => {
  const llama = new Llama('/unused'); llama.port = 123; llama.contextTokens = 4096; llama.tokenizerAvailable = false;
  let calls = 0, output = '';
  t.mock.method(globalThis, 'fetch', async () => { calls++; return calls === 1 ? stream(overflow()) : stream(token('Retried')); });
  await llama.generate([system, user('Old'), assistant('Old'), user('Current')], { maxTokens: 1024 }, signal(), text => { output += text; });
  assert.equal(calls, 2); assert.equal(output, 'Retried');
  calls = 0; output = '';
  globalThis.fetch.mock.mockImplementation(async () => { calls++; return stream(token('Already emitted'), overflow()); });
  await assert.rejects(llama.generate([system, user('Old'), assistant('Old'), user('Current')], { maxTokens: 1024 }, signal(), text => { output += text; }), /exceeds the available context/);
  assert.equal(calls, 1); assert.equal(output, 'Already emitted');
});

test('fallback retry count is capped even with a very long history', async t => {
  const llama = new Llama('/unused'); llama.port = 123; llama.contextTokens = 4096; llama.tokenizerAvailable = false;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return jsonResponse(overflow(), 400); });
  const messages = [system, ...Array.from({ length: 30 }, (_, index) => [user(`Task ${index}`), assistant('Answer')]).flat(), user('Current')];
  await assert.rejects(llama.generate(messages, { maxTokens: 1024 }, signal(), () => {}), /Context tokens/);
  assert.equal(calls, 9); assert.equal(messages.length, 62);
});

test('abort prevents context recovery from starting any retry', async t => {
  const llama = new Llama('/unused'); llama.port = 123; llama.contextTokens = 4096; llama.tokenizerAvailable = false;
  const controller = new AbortController(); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; controller.abort(); return jsonResponse(overflow(), 400); });
  await assert.rejects(llama.generate([system, user('Old'), assistant('Old'), user('Current')], { maxTokens: 1024 }, controller.signal, () => {}), /exceeds the available context/);
  assert.equal(calls, 1);
});

test('loading records the actual process context and unload clears it', async t => {
  const makeChild = () => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.exitCode = null; child.signalCode = null;
    child.kill = () => { child.signalCode = 'SIGKILL'; queueMicrotask(() => child.emit('close', 0)); };
    return child;
  };
  const llama = new Llama('/unused', makeChild);
  t.mock.method(globalThis, 'fetch', async url => url.endsWith('/props') ? jsonResponse({ default_generation_settings: { n_ctx: 4096 } }) : jsonResponse({ status: 'ok' }));
  try {
    await llama.load({ id: 'guide', name: 'Guide', file: '/guide.gguf' }, { binary: '/llama-server', backend: 'cpu' }, signal(), () => {}, 8192);
    assert.equal(llama.contextTokens, 4096);
  } finally { await llama.unload(); }
  assert.equal(llama.contextTokens, null); assert.equal(llama.tokenizerAvailable, null);
});
