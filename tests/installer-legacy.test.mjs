import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { copyLegacyData, detectLegacyInstall, legacyDataBytes } from '../installer/legacy.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-installer-legacy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const source = path.join(home, '.tim-studio');
  await fs.mkdir(source, { recursive: true });
  return { root, home, source, target: path.join(root, 'TIM-Studio-Data') };
}

async function write(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, value);
}

test('recognizes npm TIM metadata behind an absolute PATH launcher without invoking it', async t => {
  const { root, home, source } = await fixture(t);
  const bin = path.join(root, 'bin');
  const pkg = path.join(bin, 'node_modules', '@tim-studio', 'cli');
  const entry = path.join(pkg, 'cli', 'index.mjs');
  await write(path.join(pkg, 'package.json'), JSON.stringify({ name: '@tim-studio/cli', version: '0.1.0', bin: { tim: 'cli/index.mjs' } }));
  await write(entry, 'throw new Error("Never run legacy executables");');
  const launcher = path.join(bin, process.platform === 'win32' ? 'tim.cmd' : 'tim');
  if (process.platform === 'win32') await write(launcher, '"%~dp0node_modules\\@tim-studio\\cli\\cli\\index.mjs"');
  else await fs.symlink(entry, launcher);
  assert.deepEqual((await detectLegacyInstall({ home, paths: ['relative', bin] })).cli, { version: '0.1.0', path: launcher, dataDir: source });
  await write(path.join(pkg, 'package.json'), JSON.stringify({ name: 'unrelated-tim', version: '1.0.0', bin: { tim: 'cli/index.mjs' } }));
  assert.notEqual((await detectLegacyInstall({ home, paths: [bin] })).cli?.path, launcher);
});

test('migration copies durable files and receipts while preserving the source', async t => {
  const { root, source, target } = await fixture(t);
  const saved = {
    'settings.json': '{"defaultMode":"chat"}',
    'sessions.json': '[]',
    'models/m/model.gguf.part': 'partial download',
    'models/m/installed.json': '{}',
    'outputs/file.txt': 'completed output'
  };
  for (const [name, contents] of Object.entries(saved)) await write(path.join(source, name), contents);
  const omitted = ['settings.json.tmp', 'models/m/installed.json.tmp', 'work/job.log', 'cache/item', 'setup/archive.part', 'runtimes/cpu/llama-server', 'desktop/Cache/file'];
  for (const name of omitted) await write(path.join(source, name), 'transient');
  if (process.platform !== 'win32') {
    await fs.symlink(path.join(source, 'settings.json'), path.join(source, 'linked-settings.json'));
    omitted.push('linked-settings.json');
  }
  assert.equal(await legacyDataBytes(source), Object.values(saved).reduce((n, value) => n + Buffer.byteLength(value), 0));
  const progress = [];
  await copyLegacyData(source, target, { onProgress: bytes => progress.push(bytes) });
  assert.equal(progress.at(-1), await legacyDataBytes(source));
  for (const [name, contents] of Object.entries(saved)) {
    assert.equal(await fs.readFile(path.join(target, name), 'utf8'), contents);
    assert.equal(await fs.readFile(path.join(source, name), 'utf8'), contents);
  }
  for (const name of [...omitted, 'cli-start.lock']) await assert.rejects(fs.lstat(path.join(target, name)), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(path.join(source, 'cli-start.lock')), { code: 'ENOENT' });
  assert.ok(!(await fs.readdir(root)).some(name => name.startsWith('.tim-legacy-')));
  await assert.rejects(copyLegacyData(source, target), /already exists/);
  await assert.rejects(copyLegacyData(source, path.join(source, 'new')), /outside/);
});

test('migration refuses active or unrecognized CLI locks and preserves them', async t => {
  const { source, target } = await fixture(t);
  for (const name of ['cli.lock', 'cli-start.lock']) {
    const file = path.join(source, name);
    const record = JSON.stringify({ pid: process.pid });
    await write(file, record);
    await assert.rejects(legacyDataBytes(source), /in use/);
    await assert.rejects(copyLegacyData(source, target), /in use/);
    assert.equal(await fs.readFile(file, 'utf8'), record);
    await fs.unlink(file);
  }
  await write(path.join(source, 'cli.lock'), 'incomplete lock');
  await assert.rejects(copyLegacyData(source, target), /unreadable startup lock/);
  await assert.rejects(fs.lstat(target), { code: 'ENOENT' });
});

test('cancelled migration neither creates a destination nor claims a source lock', async t => {
  const { source, target } = await fixture(t);
  const signal = AbortSignal.abort();
  await assert.rejects(copyLegacyData(source, target, { signal }), { name: 'AbortError' });
  await assert.rejects(fs.lstat(target), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(path.join(source, 'cli-start.lock')), { code: 'ENOENT' });
});
