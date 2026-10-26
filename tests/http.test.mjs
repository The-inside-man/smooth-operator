import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Studio } from '../server/studio.mjs';
Studio.prototype.rescan = async function () {};
Studio.prototype.telemetry = async function () {};
import { startServer } from '../server/index.mjs';
test('HTTP API serves output ranges and rejects cross-origin mutations and traversal', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-api-'));
  const service = await startServer({ port: 0, dataDir: dir, autoSetup: false });
  try {
    let r = await fetch(service.url + '/api/sessions', { method: 'POST' }); assert.equal(r.status, 403);
    r = await fetch(service.url + '/api/sessions', { method: 'POST', headers: { 'x-tim-request': '1', origin: 'https://unrelated.example' } }); assert.equal(r.status, 403);
    r = await fetch(service.url + '/api/sessions', { method: 'POST', headers: { 'x-tim-request': '1' } }); assert.equal(r.status, 200);
    const session = await r.json(); assert.ok(session.id);
    await fs.writeFile(path.join(dir, 'outputs/sample.webm'), '0123456789');
    r = await fetch(service.url + '/api/files/sample.webm', { headers: { range: 'bytes=3-6' } }); assert.equal(r.status, 206); assert.equal(await r.text(), '3456');
    r = await fetch(service.url + '/api/files/sample.webm', { headers: { range: 'bytes=50-60' } }); assert.equal(r.status, 416);
    r = await fetch(service.url + '/api/files/..%2Fsettings.json'); assert.equal(r.status, 400);
  } finally { await service.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
