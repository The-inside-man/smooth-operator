import { spawn } from 'node:child_process';
import net from 'node:net';
import { runtimeEnv } from './platform.mjs';
import { contextLimitError, parseContextError, removeOldestHistory } from './context.mjs';
export async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export class Llama {
  constructor(workDir, spawnProcess = spawn) { this.workDir = workDir; this.spawnProcess = spawnProcess; this.toolCalling = false; this.child = null; this.modelId = null; this.runtimeKey = null; this.contextTokens = null; this.tokenizerAvailable = null; this.tail = ''; }
  async unload() {
    const child = this.child;
    this.child = null; this.modelId = null; this.runtimeKey = null; this.contextTokens = null; this.tokenizerAvailable = null;
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise(resolve => { child.once('close', resolve); child.kill('SIGKILL'); });
    }
  }
  async load(model, runtime, signal, update, context, toolCalling = false) {
    const threads = Number.isInteger(runtime.threads) && runtime.threads > 0 ? runtime.threads : undefined;
    const runtimeKey = JSON.stringify({ binary: runtime.binary, backend: runtime.backend, context, threads, toolCalling });
    if (this.child && this.modelId === model.id && this.runtimeKey === runtimeKey) return;
    await this.unload();
    if (signal.aborted) throw new Error('Cancelled');
    const port = await freePort();
    const args = ['-m', model.file, '--host', '127.0.0.1', '--port', String(port), '-c', String(context), '-ngl', runtime.backend === 'cpu' ? '0' : '99', '--parallel', '1'];
    if (runtime.backend === 'cpu' && toolCalling) args.push('--device', 'none', '--no-kv-offload', '--batch-size', '128', '--ubatch-size', '128');
    if (threads) args.push('--threads', String(threads));
    if (toolCalling) args.push('--jinja');
    this.toolCalling = toolCalling;
    this.tail = '';
    const child = this.spawnProcess(runtime.binary, args, { cwd: this.workDir, env: runtimeEnv(runtime.binary, this.workDir), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    let failure;
    child.on('error', e => { failure = e; });
    child.on('close', code => { failure ||= new Error(`Chat engine exited (${code}). ${this.tail.slice(-1800)}`); if (this.child === child) { this.child = null; this.modelId = null; this.runtimeKey = null; this.contextTokens = null; this.tokenizerAvailable = null; } });
    const log = chunk => { this.tail = (this.tail + chunk.toString()).slice(-6000); };
    child.stdout.on('data', log); child.stderr.on('data', log);
    const abort = () => child.kill('SIGKILL');
    signal.addEventListener('abort', abort, { once: true });
    update(`Loading ${model.name}…`);
    try {
      for (let i = 0; i < 360; i++) {
        if (signal.aborted) throw new Error('Cancelled');
        if (failure) throw failure;
        let ready = false;
        try { const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) }); ready = response.ok; } catch {}
        if (ready) {
          this.port = port; this.modelId = model.id; this.runtimeKey = runtimeKey; this.contextTokens = context;
          const props = await this.optionalJson('/props', undefined, signal);
          const actual = props?.default_generation_settings?.n_ctx;
          if (Number.isInteger(actual) && actual > 0) this.contextTokens = actual;
          return;
        }
        await delay(500);
      }
      throw new Error(`Model loading timed out. ${this.tail.slice(-1200)}`);
    } catch (error) { await this.unload(); throw error; }
    finally { signal.removeEventListener('abort', abort); }
  }
  async optionalJson(endpoint, body, signal) {
    const response = await fetch(`http://127.0.0.1:${this.port}${endpoint}`, {
      ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal
    });
    if ([404, 405, 501].includes(response.status)) return null;
    if (!response.ok) throw new Error(`Chat engine ${endpoint}: ${(await response.text()).slice(0, 1500)}`);
    // Older engines and embedders can omit these optional APIs entirely.
    return typeof response.json === 'function' ? response.json() : null;
  }
  async countPrompt(body, signal) {
    if (this.tokenizerAvailable === false) return null;
    // /apply-template uses the same chat parser as completions, including tool
    // schemas, tool_choice, generation prefix and thinking-template options.
    const rendered = await this.optionalJson('/apply-template', body, signal);
    if (typeof rendered?.prompt !== 'string') { this.tokenizerAvailable = false; return null; }
    const tokenized = await this.optionalJson('/tokenize', { content: rendered.prompt, add_special: true, parse_special: true }, signal);
    if (!Array.isArray(tokenized?.tokens) || !tokenized.tokens.every(token => Number.isInteger(token))) { this.tokenizerAvailable = false; return null; }
    this.tokenizerAvailable = true;
    return tokenized.tokens.length;
  }
  async prepareContext(body, signal) {
    const responseTokens = Number.isInteger(body.max_tokens) && body.max_tokens > 0 ? body.max_tokens : 1024;
    body = { ...body, max_tokens: responseTokens };
    let messages = body.messages, removedMessages = 0;
    // The loaded process, rather than global Settings, determines the limit.
    // In particular the persistent lightweight guide always loads at 4096.
    if (!Number.isInteger(this.contextTokens) || this.contextTokens <= 0) return { body, removedMessages, promptTokens: null, responseTokens, method: 'engine' };
    let promptTokens = await this.countPrompt(body, signal);
    while (promptTokens !== null && promptTokens + responseTokens + 16 > this.contextTokens) {
      const reduced = removeOldestHistory(messages);
      if (!reduced.removedMessages) throw contextLimitError({ promptTokens, responseTokens, contextTokens: this.contextTokens, fixedContext: this.fixedContext });
      messages = reduced.messages; removedMessages += reduced.removedMessages;
      promptTokens = await this.countPrompt({ ...body, messages }, signal);
    }
    return { body: { ...body, messages }, removedMessages, promptTokens, responseTokens, method: promptTokens === null ? 'engine' : 'tokenizer' };
  }
  async requestWithContext(body, signal, receive, onContext) {
    let removedMessages = 0;
    // Compatibility fallback is deliberately bounded and only reacts to an
    // explicit context error. Never estimate token counts from characters.
    for (let attempt = 0; attempt <= 8; attempt++) {
      const prepared = await this.prepareContext(body, signal);
      body = prepared.body; removedMessages += prepared.removedMessages;
      const notifyContext = () => onContext?.({ removedMessages, promptTokens: prepared.promptTokens, contextTokens: this.contextTokens, responseTokens: prepared.responseTokens, method: prepared.method });
      let emitted = false;
      try {
        const response = await fetch(`http://127.0.0.1:${this.port}/v1/chat/completions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify(body)
        });
        if (!response.ok) {
          const text = (await response.text()).slice(0, 1500);
          const error = new Error(body.stream ? `Chat engine: ${text}` : `Main agent request failed (${response.status}). Check local engine and model tool-call support: ${text}`);
          error.context = parseContextError(text);
          throw error;
        }
        const result = await receive(response, () => { emitted = true; });
        notifyContext();
        return result;
      } catch (error) {
        const overflow = error.context || parseContextError(error.message);
        if (!overflow || emitted || signal?.aborted) { notifyContext(); throw error; }
        if (overflow.contextTokens) this.contextTokens = overflow.contextTokens;
        const reduced = removeOldestHistory(body.messages);
        if (!reduced.removedMessages || attempt === 8) { notifyContext(); throw contextLimitError({ promptTokens: overflow.promptTokens, contextTokens: this.contextTokens, responseTokens: prepared.responseTokens, fixedContext: this.fixedContext }); }
        body = { ...body, messages: reduced.messages }; removedMessages += reduced.removedMessages;
      }
    }
  }
  async turn(messages, settings, signal, tools = [], onContext) {
    const forcedName = tools.length && settings.toolChoice?.type === 'function' ? settings.toolChoice.function?.name : undefined;
    const requiresTool = Boolean(tools.length && (forcedName || settings.toolChoice === 'required'));
    if (forcedName && !tools.some(tool => tool.function?.name === forcedName)) throw new Error('The requested specialist is not registered.');
    // Some local templates treat named tool_choice as advisory. Offering one
    // function with required selection preserves the explicit request reliably.
    const offeredTools = forcedName ? tools.filter(tool => tool.function?.name === forcedName) : tools;
    return this.requestWithContext({ messages, stream: false, temperature: settings.temperature, max_tokens: settings.maxTokens,
      ...(settings.enableThinking === false ? { chat_template_kwargs: { enable_thinking: false } } : {}),
      ...(offeredTools.length ? { tools: offeredTools, tool_choice: forcedName ? 'required' : settings.toolChoice || 'auto', parallel_tool_calls: false } : { tool_choice: 'none' }) }, signal, async response => {
      const data = await response.json();
      const choice = data.choices?.[0];
      if (choice?.finish_reason === 'length') throw new Error('Main agent response was truncated. Increase response tokens or shorten the request.');
      if (data.error) { const error = new Error(data.error.message || 'Main agent returned an invalid response.'); error.context = parseContextError(data); throw error; }
      if (!choice?.message) throw new Error('Main agent returned an invalid response.');
      if (requiresTool && (!Array.isArray(choice.message.tool_calls) || !choice.message.tool_calls.length)) throw new Error('The local model did not call the requested specialist. Check engine/model tool-call compatibility or choose another agent model.');
      if (forcedName && choice.message.tool_calls.some(call => call.function?.name !== forcedName)) throw new Error('The local model selected a different specialist than requested.');
      return choice.message;
    }, onContext);
  }
  async generate(messages, settings, signal, onToken, onContext) {
    return this.requestWithContext({ messages, stream: true, temperature: settings.temperature, max_tokens: settings.maxTokens,
      ...(settings.enableThinking === false ? { chat_template_kwargs: { enable_thinking: false } } : {}) }, signal, async (response, markEmitted) => {
      let pending = '', hasAnswer = false, hasReasoning = false, done = false, finishReason = null;
      const decoder = new TextDecoder();
      const consume = line => {
        if (!line.startsWith('data:')) return;
        const text = line.slice(5).trim();
        if (!text) return;
        if (text === '[DONE]') { done = true; return; }
        const data = JSON.parse(text);
        if (data.error) { const error = new Error(data.error.message || 'Chat generation failed'); error.context = parseContextError(data); throw error; }
        const choice = data.choices?.[0];
        if (typeof choice?.finish_reason === 'string' && choice.finish_reason) finishReason = choice.finish_reason;
        // Reasoning uses the same response budget as the visible answer. Never
        // display it, or mistake a reasoning-only response for a completed job.
        const reasoning = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning;
        if (typeof reasoning === 'string' && reasoning.length) { markEmitted(); hasReasoning ||= Boolean(reasoning.trim()); }
        const token = choice?.delta?.content;
        if (typeof token === 'string' && token.length) { markEmitted(); hasAnswer ||= Boolean(token.trim()); onToken(token); }
      };
      if (!response.body) throw new Error('The model returned no answer. Try again or choose a different model.');
      for await (const chunk of response.body) {
        pending += decoder.decode(chunk, { stream: true });
        const lines = pending.split('\n'); pending = lines.pop();
        for (const line of lines) consume(line);
      }
      pending += decoder.decode();
      if (pending.trim()) consume(pending);
      if (finishReason === 'length') {
        if (!hasAnswer && hasReasoning) throw new Error('The model used its response budget on reasoning before producing an answer. Try again, choose a different model, or increase Response tokens if Context tokens has room.');
        throw new Error(hasAnswer
          ? 'The model reached its response token limit before finishing. The partial answer was kept. Increase response tokens or shorten the request, then retry.'
          : 'The model reached its response token limit without producing an answer. Increase response tokens or choose a different model, then retry.');
      }
      if (finishReason && finishReason !== 'stop') throw new Error(`The model stopped without completing the answer (${finishReason}). Any partial answer was kept. Try again or choose a different model.`);
      if (!done && finishReason !== 'stop') throw new Error('The model connection ended before the answer was complete. Any partial answer was kept. Try again.');
      if (!hasAnswer) throw new Error(hasReasoning
        ? 'The model returned reasoning without an answer. Try again, choose a different model, or increase Response tokens if Context tokens has room.'
        : 'The model returned no answer. Try again or choose a different model.');
    }, onContext);
  }
}
