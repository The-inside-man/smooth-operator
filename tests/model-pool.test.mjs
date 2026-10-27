import test from 'node:test';
import assert from 'node:assert/strict';
import { LlamaPool } from '../server/llama-pool.mjs';

const runtime = { binary: '/fixture/llama-server', backend: 'cpu' };
const signal = () => new AbortController().signal;
const model = id => ({ id, name: id, file: `/fixture/${id}.gguf` });

function fixture() {
  const engines = [];
  let nextPid = 100;
  const pool = new LlamaPool('/fixture', () => {
    const engine = {
      modelId: null, child: null, loads: [], unloads: 0,
      async load(selected, selectedRuntime, abortSignal, update, context, toolCalling) {
        this.loads.push({ modelId: selected.id, runtime: selectedRuntime, context, toolCalling });
        abortSignal.throwIfAborted();
        this.child = { pid: ++nextPid, exitCode: null, signalCode: null };
        if (selected.id === 'broken') throw new Error('Fixture load failed');
        this.modelId = selected.id;
        this.toolCalling = toolCalling;
        this.runtimeKey = JSON.stringify({ ...selectedRuntime, context, toolCalling });
        this.port = engines.indexOf(this) + 4000;
        update?.(`Loaded ${selected.name}`);
      },
      async unload() { this.unloads++; this.child = null; this.modelId = null; this.runtimeKey = null; },
      async generate(messages, _settings, _signal, onToken) { this.messages = messages; onToken(`${this.modelId} reply`); return this.modelId; },
      async turn(messages) { this.messages = messages; return { role: 'assistant', content: `${this.modelId} turn` }; }
    };
    engines.push(engine);
    return engine;
  });
  const load = (id, context = 4096, toolCalling = false) => pool.load(model(id), runtime, signal(), () => {}, context, toolCalling);
  return { pool, engines, load };
}

test('three loaded specialists retain separate processes and selecting one reuses its engine', async () => {
  const { pool, engines, load } = fixture();
  await load('coder'); await load('writer'); await load('reasoner');
  assert.deepEqual(pool.instances().map(instance => instance.modelId), ['coder', 'writer', 'reasoner']);
  assert.equal(engines.length, 3);
  assert.ok(engines.every(engine => engine.unloads === 0));
  assert.equal(pool.modelId, 'reasoner');
  await load('coder', 2048, true);
  assert.equal(engines.length, 3);
  assert.equal(pool.child, engines[0].child);
  assert.equal(pool.runtimeKey, engines[0].runtimeKey);
  assert.equal(pool.port, engines[0].port);
  assert.equal(pool.toolCalling, true);
  assert.equal(engines[0].loads.at(-1).context, 2048);
  let output = '';
  await pool.generate([{ role: 'user', content: 'Hi' }], {}, signal(), token => { output += token; });
  assert.equal(output, 'coder reply');
  assert.deepEqual(await pool.turn([]), { role: 'assistant', content: 'coder turn' });
  await pool.unloadAll();
});

test('targeted unload leaves the active model and other specialists intact', async () => {
  const { pool, engines, load } = fixture();
  await load('coder'); await load('writer'); await load('reasoner');
  await pool.unload('writer');
  assert.equal(pool.modelId, 'reasoner');
  assert.equal(engines[1].unloads, 1);
  assert.equal(engines[0].unloads, 0);
  assert.equal(engines[2].unloads, 0);
  assert.deepEqual(pool.instances().map(instance => instance.modelId), ['coder', 'reasoner']);
  await pool.unload();
  assert.equal(pool.modelId, null);
  assert.equal(pool.has('coder'), true);
  await pool.unloadAll();
});

test('automatic cleanup preserves pinned models while explicit unload removes them', async () => {
  const { pool, engines, load } = fixture();
  await load('coder');
  assert.equal(pool.pin('coder'), true);
  assert.equal(pool.pin('missing'), false);
  await load('writer');
  await pool.release();
  assert.equal(pool.has('writer'), false);
  assert.equal(pool.isPinned('coder'), true);
  await pool.release('coder');
  assert.equal(engines[0].unloads, 0);
  await load('coder', 8192, true);
  assert.equal(pool.isPinned('coder'), true);
  await pool.release();
  assert.equal(pool.modelId, 'coder');
  await pool.unload('coder');
  assert.equal(pool.has('coder'), false);
  assert.equal(pool.isPinned('coder'), false);
});

test('shutdown unloads all resident models, including pinned instances', async () => {
  const { pool, engines, load } = fixture();
  await load('coder'); pool.pin('coder'); await load('writer');
  await pool.unloadAll();
  assert.deepEqual(engines.map(engine => engine.unloads), [1, 1]);
  assert.equal(pool.modelId, null);
  assert.equal(pool.child, null);
  assert.deepEqual(pool.instances(), []);
  await pool.unloadAll();
  assert.deepEqual(engines.map(engine => engine.unloads), [1, 1]);
  await assert.rejects(pool.generate([], {}, signal(), () => {}), /No specialist/);
  await assert.rejects(pool.turn([]), /No specialist/);
});

test('failed and cancelled loads clean up only their own process', async () => {
  const { pool, engines, load } = fixture();
  await load('coder'); pool.pin('coder'); await load('writer');
  await assert.rejects(load('broken'), /Fixture load failed/);
  assert.equal(engines[2].unloads, 1);
  assert.equal(pool.modelId, 'writer');
  assert.deepEqual(pool.instances().map(instance => instance.modelId), ['coder', 'writer']);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(pool.load(model('cancelled'), runtime, controller.signal, () => {}, 4096), /abort/i);
  assert.equal(engines[3].unloads, 1);
  assert.ok(engines.slice(0, 2).every(engine => engine.unloads === 0));
  assert.equal(pool.isPinned('coder'), true);
  await pool.unloadAll();
});

test('enumeration removes crashed processes and their stale pins', async () => {
  const { pool, engines, load } = fixture();
  await load('coder'); pool.pin('coder'); await load('writer');
  engines[0].child.exitCode = 1;
  assert.deepEqual(pool.instances().map(instance => instance.modelId), ['writer']);
  assert.equal(pool.isPinned('coder'), false);
  engines[1].child.signalCode = 'SIGKILL';
  assert.equal(pool.modelId, null);
  assert.deepEqual(pool.instances(), []);
  await load('coder');
  assert.equal(engines.length, 3);
  assert.equal(pool.isPinned('coder'), false);
  await pool.unloadAll();
});

test('snapshots during a reload do not discard a model or its pin', async () => {
  const { pool, engines, load } = fixture();
  await load('coder'); pool.pin('coder'); await load('writer');
  const originalLoad = engines[0].load.bind(engines[0]);
  let resume;
  engines[0].load = async (...args) => {
    engines[0].modelId = null; engines[0].child = null;
    await new Promise(resolve => { resume = resolve; });
    return originalLoad(...args);
  };
  const reloading = load('coder', 8192);
  assert.deepEqual(pool.instances().map(instance => instance.modelId), ['writer']);
  assert.equal(pool.modelId, 'writer');
  resume(); await reloading;
  assert.equal(pool.isPinned('coder'), true);
  assert.equal(pool.modelId, 'coder');
  await pool.unloadAll();
});

test('a failed reload removes that model while other pinned specialists remain usable', async () => {
  const { pool, engines, load } = fixture();
  await load('coder'); pool.pin('coder'); await load('writer'); pool.pin('writer');
  engines[0].load = async () => { throw new Error('New context is too large'); };
  await assert.rejects(load('coder', 65536), /context is too large/);
  assert.equal(pool.modelId, 'writer');
  assert.equal(pool.has('coder'), false);
  assert.equal(pool.isPinned('writer'), true);
  assert.equal(engines[0].unloads, 1);
  assert.equal(engines[1].unloads, 0);
  assert.equal((await pool.turn([])).content, 'writer turn');
  await pool.unloadAll();
});

test('shutdown attempts every process even when one unload fails', async () => {
  const { pool, engines, load } = fixture();
  await load('coder'); await load('writer');
  engines[0].unload = () => { engines[0].unloads++; throw new Error('Could not stop fixture'); };
  await assert.rejects(pool.unloadAll(), error => error instanceof AggregateError && error.errors[0].message === 'Could not stop fixture');
  assert.deepEqual(engines.map(engine => engine.unloads), [1, 1]);
  assert.equal(pool.modelId, null);
});
