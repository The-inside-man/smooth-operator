import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { DownloadManager } from '../server/downloads.mjs';
import { catalogModels, defaultOrchestratorId, getCatalogModel } from '../server/catalog.mjs';

const payload = Buffer.from('GGUF a small model fixture');
const revision = 'a'.repeat(40);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fixture = (files = [{ name: 'model.gguf', bytes: payload }]) => ({ id: 'test-model', catalogId: 'test-model', name: 'Test Model', kind: 'chat', description: 'Fixture', bestFor: ['Testing'], downloadBytes: files.reduce((n, f) => n + f.bytes.length, 0), files: files.map(f => ({ repo: 'test/models', revision, path: f.name, size: f.bytes.length, sha256: hash(f.bytes) })) });
async function temp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-download-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
async function eventually(fn) {
  const deadline = Date.now() + 5000;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for download.');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
const done = manager => eventually(() => manager.running === null && !manager.snapshot().some(j => ['queued', 'downloading', 'verifying'].includes(j.status)));
function fetcher(model, { bytes = payload, metadata = {}, onFile, response } = {}) {
  return async (url, options) => {
    if (url.includes('/api/models/')) return Response.json({ sha: revision, siblings: model.files.map(f => ({ rfilename: f.path, size: f.size, lfs: { sha256: f.sha256 }, ...metadata })) });
    onFile?.(url, options);
    if (response) return response(url, options);
    const offset = Number((options.headers.Range || '').match(/bytes=(\d+)-/)?.[1] || 0);
    return new Response(bytes.subarray(offset), { status: offset ? 206 : 200, headers: { 'content-length': String(bytes.length - offset), ...(offset ? { 'content-range': `bytes ${offset}-${bytes.length - 1}/${bytes.length}` } : {}) } });
  };
}

test('offline catalog describes at least 20 loadable models and pins exact bytes', () => {
  assert.ok(catalogModels.length >= 20);
  assert.equal(new Set(catalogModels.map(m => m.id)).size, catalogModels.length);
  assert.equal(catalogModels.filter(m => m.defaultOrchestrator).length, 1);
  const guide = getCatalogModel(defaultOrchestratorId);
  assert.ok(guide.defaultOrchestrator && guide.downloadBytes < 500_000_000 && guide.memoryGB < 2);
  for (const model of catalogModels) {
    assert.ok(model.description && model.bestFor.length && model.license);
    assert.equal(model.catalogId, model.id);
    assert.equal(model.downloadBytes, model.files.reduce((n, f) => n + f.size, 0));
    assert.match(model.sourceUrl, /^https:\/\/huggingface.co\//);
    assert.ok(['chat', 'transcribe', 'image'].includes(model.kind));
    if (model.kind === 'image') {
      assert.equal(model.profile.family, 'checkpoint');
      assert.deepEqual(model.profile.args, {});
      assert.ok(model.files.every(file => file.path.endsWith('.safetensors')));
    }
    for (const file of model.files) {
      assert.match(file.revision, /^[a-f0-9]{40}$/);
      assert.match(file.sha256, /^[a-f0-9]{64}$/);
      assert.ok(file.size > 0);
    }
  }
});

test('verified downloads become local registry models and restore offline', async t => {
  const dir = await temp(t), model = fixture(), changes = [];
  const manager = new DownloadManager(dir, { catalog: [model], fetchImpl: fetcher(model), onChange: jobs => changes.push(jobs[0]?.status) });
  await manager.init();
  await manager.start(model.id);
  await done(manager);
  assert.equal(manager.snapshot()[0].status, 'completed');
  assert.ok(changes.includes('verifying'));
  const installed = await manager.installedModels();
  assert.equal(installed[0].id, 'catalog:test-model');
  assert.equal(installed[0].file, path.join(dir, 'models', model.id, 'model.gguf'));
  assert.deepEqual(await fs.readFile(installed[0].file), payload);
  await assert.rejects(fs.stat(installed[0].file + '.part'), { code: 'ENOENT' });
  await manager.close();
  const offline = new DownloadManager(dir, { catalog: [model], fetchImpl: () => { throw new Error('Network must not be used on startup.'); } });
  await offline.init();
  assert.equal((await offline.installedModels()).length, 1);
  await offline.close();
});

test('installed image checkpoints retain the engine recipe', async t => {
  const dir = await temp(t), model = fixture([{ name: 'image.safetensors', bytes: payload }]);
  model.kind = 'image'; model.profile = { family: 'checkpoint', args: {}, steps: 28, cfg: 7.5 };
  const manager = new DownloadManager(dir, { catalog: [model], fetchImpl: fetcher(model) });
  await manager.start(model.id); await done(manager);
  const installed = await manager.installedModels();
  assert.equal(installed[0].kind, 'image');
  assert.deepEqual(installed[0].profile, model.profile);
  assert.notEqual(installed[0].profile, model.profile);
  await manager.close();
});

test('rejects arbitrary catalog IDs and unsafe manifest paths', async t => {
  const dir = await temp(t);
  let fetched = false;
  const manager = new DownloadManager(dir, { catalog: [fixture()], fetchImpl: () => { fetched = true; } });
  await assert.rejects(manager.start('https://example.com/model.gguf'), /Unknown model catalog ID/);
  await assert.rejects(manager.start('../../escape'), /Unknown model catalog ID/);
  assert.equal(fetched, false);
  const unsafe = fixture(); unsafe.files[0].path = '../escape.gguf';
  assert.throws(() => new DownloadManager(dir, { catalog: [unsafe] }), /Invalid bundled model metadata/);
});

test('refuses upstream metadata changes before requesting model bytes', async t => {
  const dir = await temp(t), model = fixture();
  let fileRequests = 0;
  const manager = new DownloadManager(dir, { catalog: [model], fetchImpl: fetcher(model, { metadata: { lfs: { sha256: 'b'.repeat(64) } }, onFile: () => fileRequests++ }) });
  await manager.start(model.id); await done(manager);
  assert.equal(manager.snapshot()[0].status, 'failed');
  assert.match(manager.snapshot()[0].error, /metadata does not match/);
  assert.equal(fileRequests, 0);
  assert.deepEqual(await manager.installedModels(), []);
  await manager.close();
});

test('rejects corrupt bytes and never promotes an unverified file', async t => {
  const dir = await temp(t), model = fixture();
  const corrupt = Buffer.from(payload); corrupt[3] ^= 1;
  const manager = new DownloadManager(dir, { catalog: [model], fetchImpl: fetcher(model, { bytes: corrupt }) });
  await manager.start(model.id); await done(manager);
  assert.equal(manager.snapshot()[0].status, 'failed');
  assert.match(manager.snapshot()[0].error, /SHA256 verification/);
  assert.deepEqual(await manager.installedModels(), []);
  await assert.rejects(fs.stat(path.join(dir, 'models', model.id, 'model.gguf')), { code: 'ENOENT' });
  await manager.close();
});

test('resumes a partial file with a validated HTTP byte range', async t => {
  const dir = await temp(t), model = fixture();
  const targetDir = path.join(dir, 'models', model.id);
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(path.join(targetDir, 'model.gguf.part'), payload.subarray(0, 7));
  let range;
  const manager = new DownloadManager(dir, { catalog: [model], fetchImpl: fetcher(model, { onFile: (_, opts) => { range = opts.headers.Range; } }) });
  await manager.start(model.id); await done(manager);
  assert.equal(range, 'bytes=7-');
  assert.equal(manager.snapshot()[0].status, 'completed');
  assert.deepEqual(await fs.readFile(path.join(targetDir, 'model.gguf')), payload);
  await manager.close();
});

test('restarts cleanly when a host ignores the resume range', async t => {
  const dir = await temp(t), model = fixture(), targetDir = path.join(dir, 'models', model.id);
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(path.join(targetDir, 'model.gguf.part'), payload.subarray(0, 5));
  const manager = new DownloadManager(dir, { catalog: [model], fetchImpl: fetcher(model, { response: () => new Response(payload, { headers: { 'content-length': String(payload.length) } }) }) });
  await manager.start(model.id); await done(manager);
  assert.equal(manager.snapshot()[0].status, 'completed');
  assert.deepEqual(await fs.readFile(path.join(targetDir, 'model.gguf')), payload);
  await manager.close();
});

test('rejects invalid resume ranges and redirects to unrelated hosts', async t => {
  for (const [label, response, error] of [
    ['range', () => new Response(payload, { status: 206, headers: { 'content-range': `bytes 1-${payload.length - 1}/${payload.length}` } }), /invalid resume range/],
    ['redirect', () => new Response(null, { status: 302, headers: { location: 'https://example.com/model.gguf' } }), /outside Hugging Face/]
  ]) {
    const dir = await temp(t), model = fixture();
    const manager = new DownloadManager(dir, { catalog: [model], fetchImpl: fetcher(model, { response }) });
    await manager.start(model.id); await done(manager);
    assert.equal(manager.snapshot()[0].status, 'failed', label);
    assert.match(manager.snapshot()[0].error, error);
    await manager.close();
  }
});

test('closing pauses an active transfer; startup stays offline and retry resumes', async t => {
  const dir = await temp(t), model = fixture();
  const manager = new DownloadManager(dir, { catalog: [model], fetchImpl: fetcher(model, { response: (_, { signal }) => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(payload.subarray(0, 8));
    signal.addEventListener('abort', () => controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  } })) }) });
  await manager.start(model.id);
  await eventually(() => manager.snapshot()[0]?.downloadedBytes === 8);
  await manager.close();
  assert.equal(manager.snapshot()[0].status, 'paused');
  let fileRequests = 0, range;
  const resumed = new DownloadManager(dir, { catalog: [model], fetchImpl: fetcher(model, { onFile: (_, opts) => { fileRequests++; range = opts.headers.Range; } }) });
  await resumed.init();
  assert.equal(fileRequests, 0);
  assert.equal(resumed.snapshot()[0].status, 'paused');
  await resumed.start(model.id); await done(resumed);
  assert.equal(range, 'bytes=8-');
  assert.equal(resumed.snapshot()[0].status, 'completed');
  await resumed.close();
});

test('cancels active downloads and preserves a resumable partial', async t => {
  const dir = await temp(t), model = fixture();
  const manager = new DownloadManager(dir, { catalog: [model], fetchImpl: fetcher(model, { response: (_, { signal }) => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(payload.subarray(0, 4));
    signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
  } })) }) });
  await manager.start(model.id);
  await eventually(() => manager.snapshot()[0]?.downloadedBytes === 4);
  await manager.cancel(model.id); await done(manager);
  assert.equal(manager.snapshot()[0].status, 'cancelled');
  assert.equal((await fs.stat(path.join(dir, 'models', model.id, 'model.gguf.part'))).size, 4);
  assert.deepEqual(await manager.installedModels(), []);
  await manager.close();
});

test('requires every shard before installing and reuses verified shards on retry', async t => {
  const dir = await temp(t), a = Buffer.from('first shard'), b = Buffer.from('second shard');
  const model = fixture([{ name: 'model-00001-of-00002.gguf', bytes: a }, { name: 'model-00002-of-00002.gguf', bytes: b }]);
  let fail = true, firstRequests = 0;
  const manager = new DownloadManager(dir, { catalog: [model], fetchImpl: fetcher(model, { response: url => {
    const first = url.includes('00001');
    if (first) firstRequests++;
    return first ? new Response(a) : fail ? new Response('failure', { status: 503 }) : new Response(b);
  } }) });
  await manager.start(model.id); await done(manager);
  assert.equal(manager.snapshot()[0].status, 'failed');
  assert.deepEqual(await manager.installedModels(), []);
  fail = false;
  await manager.start(model.id); await done(manager);
  assert.equal(manager.snapshot()[0].status, 'completed');
  assert.equal(firstRequests, 1);
  assert.equal((await manager.installedModels())[0].file, path.join(dir, 'models', model.id, 'model-00001-of-00002.gguf'));
  await manager.close();
});

test('detects modified installed model bytes when reopening', async t => {
  const dir = await temp(t), model = fixture();
  const manager = new DownloadManager(dir, { catalog: [model], fetchImpl: fetcher(model) });
  await manager.start(model.id); await done(manager); await manager.close();
  await fs.writeFile(path.join(dir, 'models', model.id, 'model.gguf'), Buffer.alloc(payload.length));
  const reopened = new DownloadManager(dir, { catalog: [model], fetchImpl: () => { throw new Error('offline'); } });
  await reopened.init();
  assert.equal(reopened.snapshot()[0].status, 'failed');
  assert.deepEqual(await reopened.installedModels(), []);
  await reopened.close();
});

test('refuses model-directory symlinks and reports storage failures', async t => {
  const dir = await temp(t), model = fixture(), outside = path.join(dir, 'outside');
  await fs.mkdir(path.join(dir, 'models')); await fs.mkdir(outside);
  await fs.symlink(outside, path.join(dir, 'models', model.id));
  const manager = new DownloadManager(dir, { catalog: [model], fetchImpl: fetcher(model) });
  await manager.start(model.id); await done(manager);
  assert.equal(manager.snapshot()[0].status, 'failed');
  assert.match(manager.snapshot()[0].error, /unsafe directory/);
  assert.deepEqual(await fs.readdir(outside), []);
  await manager.close();
});
