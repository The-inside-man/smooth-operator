import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Studio } from '../server/studio.mjs';
import { startServer } from '../server/index.mjs';
import { defaultOrchestratorId } from '../server/catalog.mjs';

const model = (id, kind = 'chat', extra = {}) => ({ id, name: id, kind, available: true, ...extra });
const guide = () => model(`catalog:${defaultOrchestratorId}`, 'chat', { catalogId: defaultOrchestratorId });

async function fixture(t, saved) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-default-models-'));
  if (saved) await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify(saved));
  const studio = new Studio(directory), calls = [], installed = [];
  studio.rescan = async () => {};
  studio.telemetry = async () => {};
  studio.downloads = { async init() {}, async close() {}, snapshot: () => [], installedModels: async () => structuredClone(installed), async start(id) { calls.push(['download', id]); throw new Error('Unexpected download'); } };
  await studio.init();
  studio.registry = { models: [model('large-chat'), model('coder'), model('image', 'image'), model('unavailable', 'chat', { available: false, issue: 'Missing engine' })], runtimes: { chat: { backend: 'cpu' }, image: { backend: 'cpu' } } };
  studio.loadOrchestrator = async selected => { calls.push(['warm', selected.id]); studio.orchestrator.modelId = selected.id; };
  t.mock.method(studio.orchestrator, 'unload', async () => { calls.push(['unload-guide']); studio.orchestrator.modelId = null; });
  t.mock.method(studio.llama, 'unloadAll', async () => { calls.push(['unload-specialists']); });
  t.after(async () => { studio.active = null; await studio.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { studio, directory, calls, installed };
}

test('fresh settings default to Agent without assuming any direct model preference', async t => {
  const { studio } = await fixture(t);
  assert.equal(studio.config.defaultMode, 'agent');
  assert.deepEqual(studio.config.defaultModels, {});
});

test('Chat and Code defaults are distinct, survive restart, and do not unload or warm engines', async t => {
  const { studio, directory, calls } = await fixture(t);
  studio.active = { job: { status: 'running' } };
  assert.deepEqual(await studio.setDefaultModel({ mode: 'chat', modelId: 'large-chat' }), { defaultMode: 'chat', defaultModels: { chat: 'large-chat' }, mainAgentModelId: '' });
  await studio.setDefaultModel({ mode: 'code', modelId: 'coder' });
  assert.deepEqual(calls, []);
  const saved = await studio.store.read('settings', {});
  assert.equal(saved.defaultMode, 'code');
  assert.deepEqual(saved.defaultModels, { chat: 'large-chat', code: 'coder' });
  const restarted = new Studio(directory);
  restarted.rescan = async () => {}; restarted.telemetry = async () => {};
  await restarted.init();
  assert.equal(restarted.config.defaultMode, 'code');
  assert.deepEqual(restarted.config.defaultModels, saved.defaultModels);
  await restarted.close();
  studio.active = null;
});

test('setting a default validates mode, model kind, availability and ID atomically', async t => {
  const { studio, calls } = await fixture(t);
  const previous = structuredClone(studio.config);
  for (const value of [undefined, {}, { mode: 'unsupported', modelId: 'large-chat' }, { mode: 'code', modelId: 'image' }, { mode: 'image', modelId: 'large-chat' }, { mode: 'chat', modelId: 'missing' }, { mode: 'chat', modelId: 'unavailable' }, { mode: 'chat', modelId: '' }, { mode: 'agent', modelId: 'image' }]) {
    await assert.rejects(studio.setDefaultModel(value));
    assert.deepEqual(studio.config, previous);
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(await studio.store.read('settings', {}), {});
});

test('settings rejects an invalid preference map before changing any saved settings or engines', async t => {
  const { studio, calls } = await fixture(t);
  const previous = structuredClone(studio.config);
  for (const defaultModels of [null, [], 'chat', { agent: 'large-chat' }, { chat: 5 }, { code: 'image' }, { chat: 'large-chat', image: 'coder' }, { chat: 'missing' }]) {
    await assert.rejects(studio.updateSettings({ defaultModels, defaultMode: 'code', temperature: .2 }));
    assert.deepEqual(studio.config, previous);
  }
  await assert.rejects(studio.updateSettings({ defaultMode: 'unsupported' }));
  assert.deepEqual(calls, []);
  assert.deepEqual(await studio.store.read('settings', {}), {});
});

test('full settings persist defaults and preserve unchanged disconnected selections', async t => {
  const { studio } = await fixture(t, { mainAgentModelId: 'disconnected-agent', defaultMode: 'code', defaultModels: { chat: 'disconnected-chat' } });
  await studio.updateSettings({ mainAgentModelId: 'disconnected-agent', defaultModels: { chat: 'disconnected-chat', code: 'coder' }, defaultMode: 'chat' });
  const saved = await studio.store.read('settings', {});
  assert.equal(saved.mainAgentModelId, 'disconnected-agent');
  assert.equal(saved.defaultMode, 'chat');
  assert.deepEqual(saved.defaultModels, { chat: 'disconnected-chat', code: 'coder' });
});

test('selecting an Agent default uses normal engine guards and warms the chosen model', async t => {
  const { studio, calls } = await fixture(t);
  studio.active = { job: { status: 'running' } };
  await assert.rejects(studio.setDefaultModel({ mode: 'agent', modelId: 'large-chat' }), /Finish or cancel/);
  assert.equal(studio.config.mainAgentModelId, '');
  studio.active = null;
  await studio.setDefaultModel({ mode: 'agent', modelId: 'large-chat' });
  assert.equal(studio.config.defaultMode, 'agent');
  assert.equal(studio.config.mainAgentModelId, 'large-chat');
  assert.deepEqual(calls, [['unload-guide'], ['unload-specialists'], ['warm', 'large-chat']]);
  assert.equal((await studio.store.read('settings', {})).mainAgentModelId, 'large-chat');
});

for (const selected of ['missing-agent', 'unavailable']) test(`rescan and downloaded bootstrap guide preserve selected ${selected}`, async t => {
  const { studio, installed } = await fixture(t, { mainAgentModelId: selected, defaultModels: { chat: 'missing-chat' } });
  installed.push(guide());
  await studio.refreshDownloadedModels();
  assert.equal(studio.config.mainAgentModelId, selected);
  assert.deepEqual(studio.config.defaultModels, { chat: 'missing-chat' });
  assert.equal((await studio.store.read('settings', {})).mainAgentModelId, selected);
});

test('the bundled guide is selected automatically only when no main agent is configured', async t => {
  const { studio, installed } = await fixture(t);
  installed.push(guide());
  await studio.refreshDownloadedModels();
  assert.equal(studio.config.mainAgentModelId, guide().id);
  assert.equal((await studio.store.read('settings', {})).mainAgentModelId, guide().id);
});

test('guide snapshots describe the selected catalog model and local model memory', async t => {
  const { studio } = await fixture(t);
  studio.registry.models.push(model('chosen-qwen', 'chat', { catalogId: 'qwen3-4b' }));
  studio.config.mainAgentModelId = 'chosen-qwen';
  assert.equal(studio.guideSnapshot().catalogId, 'qwen3-4b');
  assert.equal(studio.guideSnapshot().memoryGB, studio.catalog.find(item => item.id === 'qwen3-4b').memoryGB);
  studio.registry.models[0].size = 2 ** 30;
  studio.config.mainAgentModelId = 'large-chat';
  assert.equal(studio.guideSnapshot().catalogId, '');
  assert.ok(studio.guideSnapshot().memoryGB > 1);
  studio.config.mainAgentModelId = 'missing-agent';
  assert.equal(studio.guideSnapshot().modelId, 'missing-agent');
  assert.equal(studio.guideSnapshot().catalogId, '');
  assert.equal(studio.guideSnapshot().memoryGB, undefined);
  assert.match(studio.guideSnapshot().error, /no longer installed/);
});

for (const selected of ['missing-agent', 'unavailable']) test(`startup and setup never download a replacement for selected ${selected}`, async t => {
  const { studio, calls } = await fixture(t, { mainAgentModelId: selected });
  await studio.startDefaultGuide();
  assert.equal(studio.guideSnapshot().status, 'error');
  assert.match(studio.guideSnapshot().error, /selected default agent|not ready/);
  await studio.setupGuide();
  assert.equal(studio.config.mainAgentModelId, selected);
  assert.deepEqual(calls, []);
});

test('setup warms an available custom default instead of downloading the lightweight guide', async t => {
  const { studio, calls } = await fixture(t, { mainAgentModelId: 'large-chat' });
  await studio.setupGuide();
  assert.deepEqual(calls, [['warm', 'large-chat']]);
  assert.equal(studio.guideSnapshot().modelId, 'large-chat');
  assert.equal(studio.guideSnapshot().status, 'running');
});

test('omitted Chat/Code model IDs use saved defaults but explicit invalid IDs never fall back', async t => {
  const { studio } = await fixture(t, { defaultModels: { chat: 'large-chat', code: 'coder' } });
  studio.drain = async () => {};
  const chat = await studio.enqueue({ kind: 'chat', prompt: 'Hello' });
  const code = await studio.enqueue({ kind: 'code', prompt: 'Write a function' });
  assert.equal(chat.modelId, 'large-chat');
  assert.equal(code.modelId, 'coder');
  for (const modelId of ['missing', '', null, 'image']) await assert.rejects(studio.enqueue({ kind: 'code', modelId, prompt: 'Write a function' }), /compatible model/);
  studio.config.defaultModels.code = 'missing';
  await assert.rejects(studio.enqueue({ kind: 'code', prompt: 'Write a function' }), /compatible model/);
  assert.equal(studio.jobs.length, 2);
});

test('default-model API persists choices and enforces local mutation protections', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-default-api-'));
  t.mock.method(Studio.prototype, 'rescan', async function () {});
  t.mock.method(Studio.prototype, 'telemetry', async function () {});
  const service = await startServer({ port: 0, dataDir: directory, autoSetup: false });
  service.studio.registry.models = [model('large-chat'), model('image', 'image')];
  t.after(async () => { await service.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const post = (data, headers = { 'x-tim-request': '1' }) => fetch(service.url + '/api/models/default', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
  let response = await post({ mode: 'chat', modelId: 'large-chat' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { defaultMode: 'chat', defaultModels: { chat: 'large-chat' }, mainAgentModelId: '' });
  response = await post({ mode: 'code', modelId: 'image' });
  assert.equal(response.status, 400);
  response = await post({ mode: 'image', modelId: 'image' }, { 'x-tim-request': '1', origin: 'https://untrusted.example' });
  assert.equal(response.status, 403);
  response = await post({ mode: 'image', modelId: 'image' }, {});
  assert.equal(response.status, 403);
  assert.deepEqual((await service.studio.store.read('settings', {})).defaultModels, { chat: 'large-chat' });
});
