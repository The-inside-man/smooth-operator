import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getInstallerModels, installStarterModels } from '../installer/models.mjs';
import { catalogModels } from '../server/catalog.mjs';
import { Store } from '../server/store.mjs';

const GiB = 2 ** 30;
const revision = 'a'.repeat(40);
const payload = Buffer.from('GGUF installer fixture');

function model(id, kind = 'chat') {
  return {
    id, name: id, kind, bestFor: ['Testing'], downloadBytes: payload.length,
    files: [{
      repo: `test/${id}`, revision, path: `${id}.gguf`, size: payload.length,
      sha256: createHash('sha256').update(payload).digest('hex')
    }]
  };
}

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-installer-models-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

function catalogFetch(catalog, transfer) {
  return async (url, options) => {
    const entry = catalog.find(model => url.includes(`/${model.files[0].repo}/`));
    assert.ok(entry, url);
    const [file] = entry.files;
    if (url.includes('/api/models/')) {
      return Response.json({ sha: file.revision, siblings: [{ rfilename: file.path, size: file.size, lfs: { sha256: file.sha256 } }] });
    }
    return transfer(entry, options);
  };
}

const prepareRuntime = async (_dir, _library, { onChange }) => {
  onChange({ status: 'ready', progress: 100 });
};

test('installer offers the full catalog and recommends only chat models with memory headroom', () => {
  const memory = { totalBytes: 24 * GiB, availableBytes: 10 * GiB, reserveBytes: 2 * GiB, modelBudgetBytes: 8 * GiB };
  const models = getInstallerModels({ runtimeSupported: true, memory });
  assert.deepEqual(models.map(model => model.id), catalogModels.map(model => model.id));
  assert.ok(models.some(model => model.suggested));
  assert.ok(models.every(model => !model.suggested || model.kind === 'chat' && model.fit === 'comfortable'));
  const image = models.find(model => model.id === 'qwen-image-2512');
  assert.equal(image.fit, 'too-large');
  assert.equal(image.category, 'Image');
  assert.match(image.engineRequirement, /separate compatible stable-diffusion\.cpp image engine/);
  const noChatRuntime = getInstallerModels({ runtimeSupported: false, memory });
  assert.ok(noChatRuntime.every(model => !model.suggested));
  assert.match(noChatRuntime.find(model => model.kind === 'chat').reason, /chat engine setup is unavailable/);
  assert.equal(noChatRuntime.find(model => model.id === image.id).reason, image.reason);
});

test('empty and unknown selections perform no runtime, download or settings work', async t => {
  const dir = await tempDir(t);
  const noCalls = () => assert.fail('No download or engine action expected');
  const options = { prepareRuntime: noCalls, fetchImpl: noCalls };
  assert.deepEqual(await installStarterModels(dir, [], options), { installedModelIds: [], runtimeInstalled: false, defaults: null });
  await assert.rejects(installStarterModels(dir, ['qwen3-0.6b', 'unknown-model'], options), /choose starter models/i);
  assert.deepEqual(await fs.readdir(dir), []);
});

test('starter models verify in selection order and fill only missing preferences', async t => {
  const dir = await tempDir(t);
  const catalog = [model('other'), model('first'), model('art', 'image')];
  const store = new Store(dir);
  const previous = { defaultMode: 'code', defaultModels: { chat: 'existing-chat', image: 'existing-image' }, mainAgentModelId: 'existing-guide', maxTokens: 400 };
  await store.write('settings', previous);
  const events = [];
  const transfers = [];
  const fetchImpl = catalogFetch(catalog, entry => {
    if (entry.id === 'other') assert.ok(events.some(event => event.modelId === 'first' && event.status === 'completed'));
    transfers.push(entry.id);
    return new Response(payload);
  });
  const result = await installStarterModels(dir, ['art', 'first', 'other', 'first'], {
    catalog, fetchImpl, portable: true, onProgress: event => events.push(event),
    prepareRuntime: (dataDir, library, options) => {
      assert.equal(options.managedOnly, true);
      return prepareRuntime(dataDir, library, options);
    }
  });
  assert.deepEqual(transfers, ['art', 'first', 'other']);
  assert.deepEqual(result.installedModelIds, ['art', 'first', 'other']);
  assert.equal(result.runtimeInstalled, true);
  assert.deepEqual(await store.read('settings'), { ...previous, defaultModels: { ...previous.defaultModels, code: 'catalog:first' } });
  assert.ok(events.some(event => event.phase === 'runtime' && event.status === 'ready'));
  assert.ok(events.some(event => event.modelId === 'other' && event.status === 'verifying'));
});

test('media-only setup downloads verified weights and leaves engine and settings untouched', async t => {
  const dir = await tempDir(t);
  const catalog = [model('speech', 'transcribe')];
  const events = [];
  const result = await installStarterModels(dir, ['speech'], {
    catalog, portable: true,
    fetchImpl: catalogFetch(catalog, () => new Response(payload)),
    prepareRuntime: () => assert.fail('No chat engine requested'),
    onProgress: event => events.push(event)
  });
  assert.deepEqual(result, { installedModelIds: ['speech'], runtimeInstalled: false, defaults: null });
  assert.deepEqual(await fs.readFile(path.join(dir, 'models', 'speech', 'speech.gguf')), payload);
  assert.ok(events.some(event => event.phase === 'model' && event.status === 'completed'));
  assert.ok(events.every(event => event.phase !== 'runtime'));
  assert.equal(await new Store(dir).read('settings', null), null);
});

test('cancellation retains partial bytes and retry resumes before writing fresh defaults', async t => {
  const dir = await tempDir(t);
  const catalog = [model('starter')];
  const controller = new AbortController();
  const partialSize = 4;
  const options = {
    catalog, prepareRuntime, signal: controller.signal,
    onProgress: event => {
      if (event.phase === 'model' && event.downloadedBytes === partialSize) controller.abort();
    },
    fetchImpl: catalogFetch(catalog, (_entry, { signal }) => new Response(new ReadableStream({
      start(stream) {
        stream.enqueue(payload.subarray(0, partialSize));
        signal.addEventListener('abort', () => stream.error(signal.reason), { once: true });
      }
    })))
  };
  await assert.rejects(installStarterModels(dir, ['starter'], options), { name: 'AbortError' });
  const store = new Store(dir);
  assert.equal((await store.read('downloads'))[0].status, 'paused');
  assert.equal(await store.read('settings', null), null);
  assert.equal((await fs.stat(path.join(dir, 'models', 'starter', 'starter.gguf.part'))).size, partialSize);

  const fetchImpl = catalogFetch(catalog, (_entry, { headers }) => {
    assert.equal(headers.Range, `bytes=${partialSize}-`);
    return new Response(payload.subarray(partialSize), {
      status: 206, headers: { 'content-range': `bytes ${partialSize}-${payload.length - 1}/${payload.length}` }
    });
  });
  await installStarterModels(dir, ['starter'], { catalog, prepareRuntime, fetchImpl });
  assert.deepEqual(await fs.readFile(path.join(dir, 'models', 'starter', 'starter.gguf')), payload);
  assert.deepEqual(await store.read('settings'), { defaultMode: 'chat', defaultModels: { chat: 'catalog:starter', code: 'catalog:starter' } });
});
