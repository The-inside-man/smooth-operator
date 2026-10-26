import { spawn } from 'node:child_process';
import net from 'node:net';
import { runtimeEnv } from './platform.mjs';
export async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export class Llama {
  constructor(workDir, spawnProcess = spawn) { this.workDir = workDir; this.spawnProcess = spawnProcess; this.toolCalling = false; this.child = null; this.modelId = null; this.tail = ''; }
  async unload() {
    const child = this.child;
    this.child = null; this.modelId = null;
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise(resolve => { child.once('close', resolve); child.kill('SIGKILL'); });
    }
  }
  async load(model, runtime, signal, update, context, toolCalling = false) {
    if (this.child && this.modelId === model.id && this.toolCalling === toolCalling) return;
    await this.unload();
    if (signal.aborted) throw new Error('Cancelled');
    const port = await freePort();
    const args = ['-m', model.file, '--host', '127.0.0.1', '--port', String(port), '-c', String(context), '-ngl', runtime.backend === 'cpu' ? '0' : '99', '--parallel', '1'];
    if (toolCalling) args.push('--jinja');
    this.toolCalling = toolCalling;
    this.tail = '';
    const child = this.spawnProcess(runtime.binary, args, { cwd: this.workDir, env: runtimeEnv(runtime.binary, this.workDir), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    let failure;
    child.on('error', e => { failure = e; });
    child.on('close', code => { failure ||= new Error(`Chat engine exited (${code}). ${this.tail.slice(-1800)}`); if (this.child === child) { this.child = null; this.modelId = null; } });
    const log = chunk => { this.tail = (this.tail + chunk.toString()).slice(-6000); };
    child.stdout.on('data', log); child.stderr.on('data', log);
    const abort = () => child.kill('SIGKILL');
    signal.addEventListener('abort', abort, { once: true });
    update(`Loading ${model.name}…`);
    try {
      for (let i = 0; i < 360; i++) {
        if (signal.aborted) throw new Error('Cancelled');
        if (failure) throw failure;
        try { const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) }); if (response.ok) { this.port = port; this.modelId = model.id; return; } } catch {}
        await delay(500);
      }
      throw new Error(`Model loading timed out. ${this.tail.slice(-1200)}`);
    } catch (error) { await this.unload(); throw error; }
    finally { signal.removeEventListener('abort', abort); }
  }
  async turn(messages, settings, signal, tools) {
    const response = await fetch(`http://127.0.0.1:${this.port}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ messages, stream: false, temperature: settings.temperature, max_tokens: settings.maxTokens,
        ...(tools.length ? { tools, tool_choice: 'auto', parallel_tool_calls: false } : { tool_choice: 'none' }) })
    });
    if (!response.ok) throw new Error(`Main agent request failed (${response.status}). Check local engine and model tool-call support: ${(await response.text()).slice(0, 500)}`);
    const data = await response.json();
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'length') throw new Error('Main agent response was truncated. Increase response tokens or shorten the request.');
    if (!choice?.message || data.error) throw new Error('Main agent returned an invalid response.');
    return choice.message;
  }
  async generate(messages, settings, signal, onToken) {
    const response = await fetch(`http://127.0.0.1:${this.port}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ messages, stream: true, temperature: settings.temperature, max_tokens: settings.maxTokens })
    });
    if (!response.ok) throw new Error(`Chat engine: ${(await response.text()).slice(0, 1500)}`);
    let pending = '';
    const decoder = new TextDecoder();
    const consume = line => {
      if (!line.startsWith('data:')) return;
      const text = line.slice(5).trim();
      if (!text || text === '[DONE]') return;
      const data = JSON.parse(text);
      if (data.error) throw new Error(data.error.message || 'Chat generation failed');
      const token = data.choices?.[0]?.delta?.content;
      if (token) onToken(token);
    };
    for await (const chunk of response.body) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) consume(line);
    }
    pending += decoder.decode();
    if (pending.trim()) consume(pending);
  }
}
