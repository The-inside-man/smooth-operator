import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Studio } from '../server/studio.mjs';
import { catalogModels, defaultOrchestratorId } from '../server/catalog.mjs';
import { startServer } from '../server/index.mjs';

const guide = () => ({ id: `catalog:${defaultOrchestratorId}`, catalogId: defaultOrchestratorId, name: 'Small guide', kind: 'chat', file: '/models/guide.gguf', available: true, issue: '' });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-setup-'));
  const studio = new Studio(dir), installed = [], downloads = [], calls = [];
  studio.downloads = { async init() {}, async close() {}, snapshot: () => structuredClone(downloads), installedModels: async () => structuredClone(installed) };
  studio.rescan = async () => {}; studio.telemetry = async () => {};
  await studio.init();
  const runtimeDir = path.join(dir, 'runtimes', `${process.platform}-${process.arch}`, 'chat', 'cpu');
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.writeFile(path.join(runtimeDir, 'llama-server' + (process.platform === 'win32' ? '.exe' : '')), 'fixture');
  studio.orchestrator = {
    modelId: null,
    async load(model, runtime, signal, _update, context, tools) { signal.throwIfAborted(); calls.push({ id: model.id, runtime, context, tools }); this.modelId = model.id; },
    async unload() { calls.push('guide-unloaded'); this.modelId = null; }
  };
  studio.llama = {
    modelId: null,
    async load(model) { calls.push({ specialist: model.id }); this.modelId = model.id; },
    async unload() { calls.push('specialist-unloaded'); this.modelId = null; }
  };
  t.after(async () => { await studio.close(); await fs.rm(dir, { recursive: true, force: true }); });
  return { studio, dir, installed, downloads, calls };
}

test('downloaded default becomes the configured guide and catalog distinguishes files from runtime readiness', async t => {
  const { studio, installed, downloads } = await fixture(t);
  assert.equal(studio.guideSnapshot().status, 'not-installed');
  installed.push(guide());
  downloads.push({ id: defaultOrchestratorId, catalogId: defaultOrchestratorId, status: 'completed' });
  await studio.refreshDownloadedModels();
  assert.equal(studio.config.mainAgentModelId, guide().id);
  assert.equal((await studio.store.read('settings', {})).mainAgentModelId, guide().id);
  let state = studio.snapshot();
  assert.equal(state.catalog.find(model => model.id === defaultOrchestratorId).installed, true);
  assert.equal(state.orchestrator.status, 'needs-runtime');
  assert.match(state.models.find(model => model.catalogId === defaultOrchestratorId).issue, /Install a chat engine/);
  assert.ok(state.catalog.every(model => !Object.hasOwn(model, 'files')));
  assert.ok(state.models.every(model => !Object.hasOwn(model, 'file')));
  studio.registry.runtimes.chat = { binary: '/fixture/llama-server', backend: 'metal' };
  await studio.refreshDownloadedModels(); state = studio.snapshot();
  assert.equal(state.orchestrator.status, 'ready'); assert.equal(state.models[0].available, true);
});

test('installing the default guide preserves an existing explicit main model choice', async t => {
  const { studio, installed } = await fixture(t);
  studio.config.mainAgentModelId = 'chosen-main';
  studio.registry = { models: [{ id: 'chosen-main', name: 'Chosen', kind: 'chat', available: true }], runtimes: { chat: { backend: 'cpu' } } };
  installed.push(guide()); await studio.refreshDownloadedModels();
  assert.equal(studio.config.mainAgentModelId, 'chosen-main');
  assert.equal(studio.guideSnapshot().modelId, 'chosen-main');
});

test('warming the guide uses bounded CPU settings and specialists can load and unload beside it', async t => {
  const { studio, installed, calls } = await fixture(t);
  installed.push(guide()); studio.registry.runtimes.chat = { backend: 'metal' };
  await studio.refreshDownloadedModels(); await studio.warmGuide();
  assert.equal(calls[0].runtime.backend, 'cpu'); assert.ok(calls[0].runtime.threads <= 4);
  assert.equal(calls[0].context, 4096); assert.equal(calls[0].tools, true);
  assert.equal(studio.guideSnapshot().status, 'running');
  studio.registry.models.push({ id: 'coder', kind: 'chat', name: 'Coder', available: true });
  await studio.loadModel('coder');
  assert.equal(studio.snapshot().loadedModelId, 'coder'); assert.equal(studio.orchestrator.modelId, guide().id);
  await studio.unloadModel('coder');
  assert.equal(studio.llama.modelId, null); assert.equal(studio.orchestrator.modelId, guide().id);
  await assert.rejects(studio.unloadModel(guide().id), /guide stays loaded/);
});

test('cancelling a request waiting for background guide warmup releases the wait promptly', async t => {
  const { studio, installed } = await fixture(t), started = deferred(), finish = deferred();
  installed.push(guide()); studio.registry.runtimes.chat = { backend: 'cpu' }; await studio.refreshDownloadedModels();
  studio.orchestrator.load = async model => { started.resolve(); await finish.promise; studio.orchestrator.modelId = model.id; };
  const warmup = studio.warmGuide(); await started.promise;
  const controller = new AbortController();
  const waiting = studio.loadOrchestrator(studio.registry.models[0], controller.signal, () => {});
  const observed = waiting.then(() => ({ completed: true }), error => ({ error }));
  controller.abort(new Error('Cancelled pending request'));
  let timer;
  try {
    const result = await Promise.race([observed, new Promise(resolve => { timer = setTimeout(() => resolve({ timeout: true }), 150); })]);
    assert.equal(result.timeout, undefined, 'A cancelled request must not wait for the separate warmup to complete');
    assert.match(result.error?.message || '', /Cancelled pending request/);
  } finally { clearTimeout(timer); finish.resolve(); await warmup; await observed; }
  assert.equal(studio.orchestrator.modelId, guide().id);
});

test('download completion refreshes the installed model list without resetting its guide selection', async t => {
  const { studio, installed, downloads } = await fixture(t);
  studio.registry.runtimes.chat = { backend: 'cpu' };
  installed.push(guide()); downloads.push({ id: defaultOrchestratorId, catalogId: defaultOrchestratorId, status: 'completed' });
  studio.downloadChanged(downloads); await studio.modelSync;
  assert.equal(studio.config.mainAgentModelId, guide().id);
  assert.equal(studio.registry.models.filter(model => model.catalogId === defaultOrchestratorId).length, 1);
  studio.downloadChanged(downloads); await studio.modelSync;
  assert.equal(studio.registry.models.filter(model => model.catalogId === defaultOrchestratorId).length, 1);
});

test('memory admission reserves the configured guide rather than the default guide size', async t => {
  const { studio } = await fixture(t);
  t.mock.method(os, 'totalmem', () => 16 * 1024 ** 3);
  const main = { id: 'large-main', catalogId: 'qwen3-14b', name: 'Large main', kind: 'chat', available: true };
  const specialist = { id: 'specialist', catalogId: 'qwen3-8b', name: 'Specialist', kind: 'chat', available: true };
  studio.registry.models = [main, specialist]; studio.config.mainAgentModelId = main.id;
  assert.throws(() => studio.assertModelMemory(specialist), /Choose a smaller model/);
  studio.registry.models.push(guide()); studio.config.mainAgentModelId = guide().id;
  assert.doesNotThrow(() => studio.assertModelMemory(specialist));
});

test('closing waits for a cancelled manual model load to finish its cleanup', async t => {
  const { studio } = await fixture(t), started = deferred();
  studio.registry = { models: [{ id: 'coder', name: 'Coder', kind: 'chat', available: true }], runtimes: { chat: { backend: 'cpu' } } };
  studio.llama.load = async (_model, _runtime, signal) => {
    started.resolve();
    await new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
  };
  const loading = studio.loadModel('coder');
  const observed = loading.then(() => ({ completed: true }), error => ({ error }));
  await started.promise; await studio.close();
  assert.ok((await observed).error); assert.equal(studio.loadingModel, false); assert.equal(studio.manualLoadPromise, null);
});

test('model API rejects unknown catalog IDs, uninstalled loads and cross-origin model mutations', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-setup-api-'));
  t.mock.method(Studio.prototype, 'rescan', async function () {});
  t.mock.method(Studio.prototype, 'telemetry', async function () {});
  const service = await startServer({ port: 0, dataDir: dir, autoSetup: false });
  t.after(async () => { await service.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const post = (endpoint, payload, extraHeaders = {}) => fetch(service.url + endpoint, {
    method: 'POST', headers: { 'x-tim-request': '1', 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(payload)
  });
  let response = await post('/api/models/download', { id: '../../outside', url: 'https://unrelated.example/model' });
  assert.equal(response.status, 400); assert.match((await response.json()).error, /Unknown model catalog ID/);
  response = await post('/api/models/load', { id: 'catalog:not-installed' });
  assert.equal(response.status, 400); assert.match((await response.json()).error, /installed chat/);
  response = await post('/api/models/download', { id: defaultOrchestratorId }, { origin: 'https://unrelated.example' });
  assert.equal(response.status, 403); assert.equal(service.studio.downloads.snapshot().length, 0);
  response = await fetch(service.url + '/api/state');
  const state = await response.json();
  assert.equal(state.catalog.length, catalogModels.length); assert.equal(state.orchestrator.status, 'not-installed');
});
