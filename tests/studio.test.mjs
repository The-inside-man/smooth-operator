import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Studio, jobSettings } from '../server/studio.mjs';
import { Store } from '../server/store.mjs';
import { runProcess } from '../server/process.mjs';
import { mediaArgs } from '../server/engines.mjs';

test('parameters reject invalid video shapes and nonfinite values', () => {
  assert.throws(() => jobSettings({ settings: { frames: 32 } }, 'video'), /4n/);
  assert.throws(() => jobSettings({ settings: { width: 513 } }, 'image'), /multiples/);
  assert.throws(() => jobSettings({ settings: { steps: 'bad' } }, 'image'), /between/);
  assert.equal(jobSettings({}, 'video').height, 288);
});
test('engine arguments keep prompts and file names as literal arguments', () => {
  const prompt = 'hello " ; $(touch /tmp/nope)';
  const args = mediaArgs('image', { file: '/models/a b.safetensors', profile: { family: 'checkpoint', args: {}, steps: 20, cfg: 7 } }, { prompt, width: 512, height: 512, seed: 42 }, null, '/out/a b.png');
  assert.equal(args[args.indexOf('-p') + 1], prompt);
  assert.equal(args[args.indexOf('-m') + 1], '/models/a b.safetensors');
});
test('atomic storage survives concurrent writes with the last state intact', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-store-'));
  try { const store = new Store(dir); await Promise.all(Array.from({ length: 30 }, (_, i) => store.write('state', { i }))); assert.deepEqual(await store.read('state', null), { i: 29 }); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('running process is terminated on cancellation', async () => {
  const controller = new AbortController();
  let child;
  const running = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: process.cwd(), signal: controller.signal, onProcess: value => { child = value; } });
  assert.ok(Number.isInteger(child.pid) && child.pid > 0, 'Media memory tracking receives the real engine process');
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(running, /Cancelled/);
  assert.ok(child.signalCode || child.exitCode !== null);
});
test('queue serializes inference, cancels waiting jobs, and saves the result', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-queue-'));
  const studio = new Studio(dir); let running = 0, maxRunning = 0;
  try {
    studio.config = { systemPrompt: 'test', context: 4096, temperature: .7, maxTokens: 100 };
    studio.registry = { models: [{ id: 'chat', name: 'Fixture', kind: 'chat', available: true }], runtimes: { chat: {} } };
    studio.llama = { modelId: null, load: async () => {}, unload: async () => {}, generate: async (_messages, _settings, signal, onToken) => {
      running++; maxRunning = Math.max(maxRunning, running);
      await new Promise(resolve => setTimeout(resolve, 120));
      if (signal.aborted) { running--; throw new Error('Cancelled'); }
      onToken('hello'); running--;
    } };
    const session = await studio.newSession();
    const first = await studio.enqueue({ sessionId: session.id, kind: 'chat', modelId: 'chat', prompt: 'first' });
    const second = await studio.enqueue({ sessionId: session.id, kind: 'chat', modelId: 'chat', prompt: 'second' });
    const third = await studio.enqueue({ sessionId: session.id, kind: 'chat', modelId: 'chat', prompt: 'third' });
    await studio.cancel(second.id);
    while (['running', 'queued'].includes(third.status)) await new Promise(r => setTimeout(r, 20));
    assert.equal(first.status, 'completed'); assert.equal(second.status, 'cancelled'); assert.equal(third.status, 'completed'); assert.equal(maxRunning, 1);
    await studio.persist();
    const saved = await studio.store.read('sessions', []);
    assert.equal(saved[0].messages.at(-1).content, 'hello');
  } finally { await studio.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
test('a restarted studio marks unfinished jobs interrupted without replaying them', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-restart-'));
  const store = new Store(dir);
  await store.write('sessions', [{ id: 's', title: 'Recovery', messages: [{ id: 'm', role: 'assistant', jobId: 'j', content: 'partial', status: 'running' }] }]);
  await store.write('jobs', [{ id: 'j', sessionId: 's', status: 'running' }]);
  const studio = new Studio(dir);
  studio.rescan = async () => {}; studio.telemetry = async () => {};
  try { await studio.init(); assert.equal(studio.jobs[0].status, 'interrupted'); assert.equal(studio.sessions[0].messages[0].content, 'partial'); assert.equal(studio.sessions[0].messages[0].status, 'interrupted'); assert.equal(studio.active, null); }
  finally { await studio.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
test('auto mode retries failed GPU chat initialization on an installed CPU runtime', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-fallback-'));
  const runtimeDir = path.join(dir, 'runtimes', `${process.platform}-${process.arch}`, 'chat', 'cpu');
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.writeFile(path.join(runtimeDir, 'llama-server' + (process.platform === 'win32' ? '.exe' : '')), 'fixture');
  const studio = new Studio(dir); const loads = [];
  try {
    studio.config = { backend: 'auto', systemPrompt: '', context: 4096, maxTokens: 10 };
    studio.registry = { models: [{ id: 'm', name: 'Fixture', kind: 'chat', available: true }], runtimes: { chat: { backend: 'vulkan' } } };
    studio.llama = { modelId: null, unload: async () => {}, load: async (_model, runtime) => { loads.push(runtime.backend); if (runtime.backend !== 'cpu') throw new Error('GPU unavailable'); }, generate: async (_history, _settings, _signal, onToken) => onToken('CPU response') };
    const job = await studio.enqueue({ kind: 'chat', modelId: 'm', prompt: 'hello' });
    while (['running', 'queued'].includes(job.status)) await new Promise(r => setTimeout(r, 10));
    assert.equal(job.status, 'completed'); assert.deepEqual(loads, ['vulkan', 'cpu']); assert.equal(studio.registry.runtimes.chat.backend, 'cpu');
  } finally { await studio.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
