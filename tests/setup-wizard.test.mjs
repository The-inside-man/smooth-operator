import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInstaller } from '../installer/install.mjs';
import { compareVersions } from '../installer/version.mjs';
import { installationData, installationMarker, lockInstallationData, readInstallation } from '../server/install-profile.mjs';

const version = '0.0.1-fixture';

async function fixture(t, prepareModels = async () => {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-wizard-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const payload = path.join(root, 'payload');
  const desktopEntry = process.platform === 'darwin' ? 'TIM Studio.app' : process.platform === 'win32' ? 'TIM Studio.exe' : 'TIM-Studio.AppImage';
  const cliNode = process.platform === 'win32' ? 'node.exe' : 'node';
  await fs.mkdir(path.join(payload, 'desktop'), { recursive: true });
  await fs.mkdir(path.join(payload, 'cli', 'cli'), { recursive: true });
  const desktop = path.join(payload, 'desktop', desktopEntry);
  if (process.platform === 'darwin') await fs.mkdir(desktop);
  else await fs.writeFile(desktop, 'desktop fixture', { mode: 0o755 });
  await fs.writeFile(path.join(payload, 'cli', cliNode), 'node fixture', { mode: 0o755 });
  await fs.writeFile(path.join(payload, 'cli', 'cli', 'index.mjs'), 'terminal fixture');
  await fs.writeFile(path.join(payload, 'payload.json'), JSON.stringify({ version, platform: process.platform, arch: process.arch, desktopEntry, cliNode }));
  const create = (appVersion = version) => createInstaller({ payload, version: appVersion, defaultDirectory: root, prepareModels, findLegacy: async () => ({}) });
  const installer = await create();
  const target = path.join(await fs.realpath(root), 'TIM Studio');
  return { installer, create, payload, cliNode, target, root, desktopEntry, dataDir: path.join(target, installationData) };
}

const selection = options => ({ desktop: true, cli: true, modelIds: [], portable: false, ...options });

test('wizard reviews a destination without writing and installs only the selected components', async t => {
  const { installer, target, root, dataDir } = await fixture(t);
  const review = await installer.plan(selection({ desktop: false }));
  assert.equal(review.target, target);
  assert.deepEqual(review.errors, []);
  assert.ok(review.requiredBytes > 0);
  assert.equal(await readInstallation(target), null);
  assert.match((await installer.plan(selection({ portable: true }))).errors[0], /destination/);
  assert.throws(() => installer.launchPath('folder'), /Finish installing/);

  const result = await installer.install(selection({ desktop: false, portable: true, directory: root }));
  assert.deepEqual(result, { target, desktop: false, cli: true, portable: true, version, operation: 'install' });
  await assert.rejects(fs.stat(path.join(target, 'desktop')), { code: 'ENOENT' });
  const launcher = await fs.readFile(installer.launchPath('cli'), 'utf8');
  assert.match(launcher, /TIM-Studio-Data/);
  assert.ok(!launcher.includes(root), 'portable launchers must resolve their location at runtime');
  assert.throws(() => installer.launchPath('desktop'), /not installed/);
  assert.equal(await fs.stat(dataDir).then(stat => stat.isDirectory()), true);
});

test('cancelled setup retains completed components, retries, and refuses an active TIM writer', async t => {
  let retry = false;
  const controller = new AbortController();
  const { installer, target, dataDir, desktopEntry } = await fixture(t, async (dir, models, { signal, portable }) => {
    assert.deepEqual(models, ['gemma-4-e2b']);
    assert.equal(dir, dataDir);
    assert.equal(portable, true, 'wizard runtimes are managed in both install modes');
    if (!retry) controller.abort(new Error('Setup paused.'));
    signal?.throwIfAborted();
  });
  // Use a temporary fixture of an already downloaded weight for the space calculation.
  const install = selection({ modelIds: ['gemma-4-e2b'] });
  await assert.rejects(installer.install(install, { signal: controller.signal }), /Setup paused/);
  const marker = await readInstallation(target);
  assert.ok(marker.desktop && marker.cli);
  assert.throws(() => installer.launchPath('folder'), /Finish installing/);
  const release = await lockInstallationData(dataDir);
  try { await assert.rejects(installer.install({ ...install, reviewedVersion: version }), /in use/); }
  finally { await release(); }
  retry = true;
  const result = await installer.install({ ...install, reviewedVersion: version });
  assert.equal(result.target, target);
  assert.equal(installer.launchPath('desktop'), path.join(target, 'desktop', desktopEntry));
  assert.equal((await readInstallation(target)).version, version);
});

test('wizard rejects unrelated folders and incompatible installations', async t => {
  const { installer, target } = await fixture(t);
  await fs.mkdir(target);
  const other = path.join(target, 'keep.txt');
  await fs.writeFile(other, 'keep');
  await assert.rejects(installer.install(selection()), /already exists/);
  assert.equal(await fs.readFile(other, 'utf8'), 'keep');
  await fs.writeFile(path.join(target, installationMarker), JSON.stringify({ schema: 1, product: 'TIM Studio', version: 'other', desktop: false, cli: false, portable: false }));
  assert.match((await installer.plan(selection())).errors.join(' '), /another system/);
});

test('wizard upgrades both installed components in place and preserves shared data', async t => {
  const { installer, create, payload, cliNode, target, desktopEntry, dataDir } = await fixture(t);
  await installer.install(selection());
  await fs.writeFile(path.join(dataDir, 'settings.json'), '{"preserve":true}');
  const next = '0.0.1-fixture.2';
  const payloadFile = path.join(payload, 'payload.json');
  const original = await fs.readFile(payloadFile, 'utf8');
  await fs.writeFile(payloadFile, JSON.stringify({ ...JSON.parse(original), version: next }));
  await fs.writeFile(path.join(payload, 'cli', cliNode), 'updated node fixture');
  const update = await create(next);
  const pick = selection({ desktop: false, directory: target });
  const plan = await update.plan(pick);
  assert.equal(plan.operation, 'upgrade');
  assert.equal(plan.installedVersion, version);
  assert.deepEqual(plan.upgradingComponents, ['desktop', 'cli']);
  await assert.rejects(update.install(pick), /review/);
  const approved = { ...pick, reviewedVersion: version };
  const controller = new AbortController();
  await assert.rejects(update.install(approved, {
    signal: controller.signal, onProgress: () => controller.abort(new Error('Test cancellation'))
  }), /Test cancellation/);
  assert.equal((await readInstallation(target)).version, version);
  assert.equal(await fs.readFile(path.join(target, 'cli', cliNode), 'utf8'), 'node fixture');
  const result = await update.install(approved);
  assert.deepEqual(result, { target, desktop: true, cli: true, portable: false, version: next, operation: 'upgrade' });
  assert.equal(await fs.readFile(path.join(dataDir, 'settings.json'), 'utf8'), '{"preserve":true}');
  assert.equal(await fs.readFile(path.join(target, 'cli', cliNode), 'utf8'), 'updated node fixture');
  assert.equal(update.launchPath('desktop'), path.join(target, 'desktop', desktopEntry));
  assert.equal((await update.plan(pick)).operation, 'current');
  assert.equal((await installer.plan(pick)).operation, 'downgrade');
  await assert.rejects(installer.install({ ...pick, reviewedVersion: next }), /newer version/);
});

test('version comparison orders releases and numeric prereleases correctly', () => {
  assert.equal(compareVersions('0.1.1-alpha.2', '0.1.1-alpha.10'), -1);
  assert.equal(compareVersions('0.1.1', '0.1.1-alpha.10'), 1);
  assert.equal(compareVersions('1.2.3+first', '1.2.3+second'), 0);
  assert.throws(() => compareVersions('unknown', '1.2.3'), /version/);
});
