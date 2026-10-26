import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ensureChatRuntime, findSystemChatRuntime, validateArchiveEntries, runtimeAssets } from '../server/runtime-setup.mjs';
const exec = promisify(execFile);

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-runtime-setup-'));
  const previousPath = process.env.PATH;
  // A fixture directory prevents these tests from discovering a real system engine.
  process.env.PATH = dir;
  t.after(async () => { process.env.PATH = previousPath; await fs.rm(dir, { recursive: true, force: true }); });
  return dir;
}

test('runtime archive paths reject traversal and absolute paths before extraction', () => {
  validateArchiveEntries('bin/llama-server\nbin/libggml.dylib\n./bin/\n');
  for (const entry of ['../outside', 'bin/../../outside', '/absolute', '\\absolute', 'C:\\absolute', 'C:/absolute', 'safe\\..\\outside']) {
    assert.throws(() => validateArchiveEntries(entry), /Unsafe runtime archive path/);
  }
});

test('runtime discovery accepts executable absolute PATH entries and ignores relative entries', async t => {
  const dir = await fixture(t);
  const name = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  const binary = path.join(dir, name);
  await fs.writeFile(binary, 'fixture'); await fs.chmod(binary, 0o755);
  process.env.PATH = '.' + path.delimiter + dir;
  assert.deepEqual(await findSystemChatRuntime('cpu'), { binary, backend: 'cpu' });
  process.env.PATH = '.';
  assert.equal(await findSystemChatRuntime('cpu'), null);
});

test('an existing managed runtime is reused without downloading an archive', async t => {
  const dir = await fixture(t), phases = [];
  const runtimeDir = path.join(dir, 'runtimes', `${process.platform}-${process.arch}`, 'chat', 'cpu');
  const binary = path.join(runtimeDir, 'llama-server' + (process.platform === 'win32' ? '.exe' : ''));
  await fs.mkdir(runtimeDir, { recursive: true }); await fs.writeFile(binary, 'fixture');
  const result = await ensureChatRuntime(dir, null, {
    fetchImpl: async () => { assert.fail('An installed runtime must not trigger a network request'); },
    onChange: phase => phases.push(phase)
  });
  assert.deepEqual(result, { binary, backend: 'cpu' });
  assert.deepEqual(phases, [{ status: 'ready', progress: 100 }]);
});

test('invalid runtime bytes are removed and never installed', async t => {
  const dir = await fixture(t), phases = [];
  await assert.rejects(ensureChatRuntime(dir, null, {
    fetchImpl: async url => {
      assert.match(url, /^https:\/\/github\.com\/ggml-org\/llama\.cpp\/releases\/download\/b11896\//);
      return { ok: true, body: (async function* () { yield Buffer.from('invalid archive'); })() };
    }, onChange: phase => phases.push(phase)
  }), /checksum verification failed/);
  assert.ok(phases.some(phase => phase.status === 'downloading'));
  assert.ok(!phases.some(phase => phase.status === 'ready'));
  assert.deepEqual(await fs.readdir(path.join(dir, 'setup')), []);
  await assert.rejects(fs.access(path.join(dir, 'runtimes')), { code: 'ENOENT' });
});

test('cancelling runtime setup removes the partial archive without reporting readiness', async t => {
  const dir = await fixture(t), controller = new AbortController(), phases = [];
  await assert.rejects(ensureChatRuntime(dir, null, {
    signal: controller.signal,
    fetchImpl: async () => ({ ok: true, body: (async function* () {
      yield Buffer.from('first chunk');
      controller.abort(new Error('Cancelled setup'));
      yield Buffer.from('second chunk');
    })() }), onChange: phase => phases.push(phase)
  }), /Cancelled setup/);
  assert.ok(!phases.some(phase => phase.status === 'ready'));
  assert.deepEqual(await fs.readdir(path.join(dir, 'setup')), []);
});

test('verified runtime install preserves relative library symlinks after extraction cleanup', { skip: process.platform === 'win32' }, async t => {
  const dir = await fixture(t), phases = [];
  const packageDir = path.join(dir, 'fixture-package'), source = path.join(packageDir, 'bin');
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, 'libfixture.0.1.dylib'), 'fixture library');
  await fs.symlink('libfixture.0.1.dylib', path.join(source, 'libfixture.0.dylib'));
  await fs.symlink('libfixture.0.dylib', path.join(source, 'libfixture.dylib'));
  await fs.writeFile(path.join(source, 'llama-server'), '#!/bin/sh\n[ -f "${0%/*}/libfixture.dylib" ] || exit 9\nprintf "fixture llama-server version\\n"\n');
  await fs.chmod(path.join(source, 'llama-server'), 0o755);
  const archiveFile = path.join(dir, 'fixture.tar');
  await exec('/usr/bin/tar', ['-cf', archiveFile, '-C', packageDir, '.']);
  // Keep PATH isolated from real llama-server installations while making archive extraction available.
  await fs.symlink('/usr/bin/tar', path.join(dir, 'tar'));
  const bytes = await fs.readFile(archiveFile), key = `${process.platform}-${process.arch}`, originalAsset = runtimeAssets[key];
  runtimeAssets[key] = ['fixture.tar', bytes.length, createHash('sha256').update(bytes).digest('hex')];
  t.after(() => { runtimeAssets[key] = originalAsset; });
  const target = path.join(dir, 'runtimes', key, 'chat', 'cpu');
  await fs.mkdir(target, { recursive: true }); await fs.writeFile(path.join(target, 'stale.txt'), 'interrupted installation');
  const result = await ensureChatRuntime(dir, null, {
    fetchImpl: async () => ({ ok: true, body: (async function* () { yield bytes; })() }),
    onChange: phase => phases.push(phase)
  });
  assert.equal(result.binary, path.join(target, 'llama-server'));
  assert.equal(await fs.readlink(path.join(target, 'libfixture.dylib')), 'libfixture.0.dylib');
  assert.equal(await fs.readlink(path.join(target, 'libfixture.0.dylib')), 'libfixture.0.1.dylib');
  assert.equal(await fs.realpath(path.join(target, 'libfixture.dylib')), await fs.realpath(path.join(target, 'libfixture.0.1.dylib')));
  assert.deepEqual(await fs.readdir(path.join(dir, 'setup')), []);
  await assert.rejects(fs.access(path.join(target, 'stale.txt')), { code: 'ENOENT' });
  const { stdout } = await exec(result.binary, ['--version']);
  assert.match(stdout, /fixture llama-server version/);
  assert.equal(phases.at(-1).status, 'ready');
});
