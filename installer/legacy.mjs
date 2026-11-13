import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { constants, createWriteStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const versionPattern = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;
const uuidPattern = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const cliEntry = path.join('cli', 'index.mjs');
const sourceLocks = ['cli.lock', 'cli-start.lock'];
// Managed runtimes can depend on relative symlinks. Import the verified model
// files and application state, and let TIM set up a fresh compatible engine.
const transientRoots = new Set(['work', 'setup', 'cache', 'desktop', 'runtimes', '.tim-in-use']);

async function lstat(file) {
  try { return await fs.lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function readSmall(file, limit = 64 * 1024) {
  const stat = await lstat(file);
  if (!stat?.isFile() || stat.size > limit) return null;
  return fs.readFile(file, 'utf8');
}

async function npmCliVersion(packageDir, expectedEntry) {
  const root = await fs.realpath(packageDir);
  const value = await readSmall(path.join(root, 'package.json'));
  if (!value) return null;
  const manifest = JSON.parse(value);
  if (manifest.name !== '@tim-studio/cli' || manifest.bin?.tim !== 'cli/index.mjs' || !versionPattern.test(manifest.version)) return null;
  const entry = path.join(root, cliEntry);
  if (expectedEntry && path.relative(entry, expectedEntry) !== '') return null;
  if (!(await lstat(entry))?.isFile()) return null;
  return manifest.version;
}

async function pathCli(folder) {
  if (process.platform === 'win32') {
    const launcher = path.join(folder, 'tim.cmd');
    const shim = await readSmall(launcher, 16384);
    if (!shim?.toLowerCase().includes('node_modules\\@tim-studio\\cli\\cli\\index.mjs')) return null;
    const version = await npmCliVersion(path.join(folder, 'node_modules', '@tim-studio', 'cli'));
    return version && { version, path: launcher };
  }
  const launcher = path.join(folder, 'tim');
  const entry = await fs.realpath(launcher);
  if (path.basename(entry) !== 'index.mjs' || path.basename(path.dirname(entry)) !== 'cli') return null;
  const version = await npmCliVersion(path.dirname(path.dirname(entry)), entry);
  return version && { version, path: launcher };
}

async function standaloneCli(home) {
  const win = process.platform === 'win32';
  const root = win
    ? path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'TIMStudio', 'cli')
    : path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'tim-studio', 'cli');
  if (!path.isAbsolute(root) || !(await lstat(root))?.isDirectory()) return null;
  const state = JSON.parse(await readSmall(path.join(root, 'install-state.json')) || 'null');
  if (state?.schema !== 1 || state.owner !== 'TIM Studio user installer' || state.root !== root || !uuidPattern.test(state.current) || !state.releases?.includes(state.current)) return null;
  const launcher = win ? 'bin/tim.cmd' : 'bin/tim';
  for (const name of [launcher, 'launcher.mjs']) {
    const contents = await readSmall(path.join(root, name));
    if (contents === null || state.ownedFiles?.[name] !== createHash('sha256').update(contents).digest('hex')) return null;
  }
  const version = await npmCliVersion(path.join(root, 'releases', state.current, 'node_modules', '@tim-studio', 'cli'));
  return version && { version, path: path.join(root, launcher) };
}

async function macDesktop(appPath) {
  if (!(await lstat(appPath))?.isDirectory()) return null;
  const info = path.join(appPath, 'Contents', 'Info.plist');
  const stat = await lstat(info);
  if (!stat?.isFile() || stat.size > 1024 * 1024) return null;
  const { stdout } = await exec('/usr/bin/plutil', ['-convert', 'json', '-o', '-', info], { timeout: 3000, maxBuffer: 1024 * 1024 });
  const manifest = JSON.parse(stdout);
  if (manifest.CFBundleIdentifier !== 'studio.tim.desktop' || manifest.CFBundleExecutable !== 'TIM Studio' || !versionPattern.test(manifest.CFBundleShortVersionString)) return null;
  if (!(await lstat(path.join(appPath, 'Contents', 'MacOS', 'TIM Studio')))?.isFile()) return null;
  const dataDir = path.join(path.dirname(appPath), 'TIM-Studio-Data');
  return { version: manifest.CFBundleShortVersionString, path: appPath, dataDir: (await lstat(dataDir))?.isDirectory() ? dataDir : null };
}

// Detection recognizes the product's package metadata or standalone receipt.
// Installed launchers are read as files and are never invoked.
export async function detectLegacyInstall({
  home = os.homedir(), paths = [
    ...(process.env.PATH || process.env.Path || '').split(path.delimiter),
    ...(process.platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin'] : [])
  ]
} = {}) {
  const [cli, desktop] = await Promise.all([
    (async () => {
      for (const folder of new Set(paths)) {
        if (typeof folder !== 'string' || !path.isAbsolute(folder)) continue;
        const candidate = await pathCli(folder).catch(() => null);
        if (candidate) return candidate;
      }
      return standaloneCli(home).catch(() => null);
    })(),
    (async () => {
      if (process.platform !== 'darwin') return null;
      for (const applications of [path.join(home, 'Applications'), '/Applications']) {
        const candidate = await macDesktop(path.join(applications, 'TIM Studio.app')).catch(() => null);
        if (candidate) return candidate;
      }
      return null;
    })()
  ]);
  const dataDir = path.join(home, '.tim-studio');
  return {
    ...(cli ? { cli: { ...cli, dataDir: (await lstat(dataDir))?.isDirectory() ? dataDir : null } } : {}),
    ...(desktop ? { desktop } : {})
  };
}

const busy = () => new Error('The existing TIM data is in use or has an unreadable startup lock. Close TIM before copying its data.');

async function checkLock(source, name) {
  const file = path.join(source, name);
  const stat = await lstat(file);
  if (!stat) return;
  if (!stat.isFile() || stat.size > 8192 || stat.nlink !== 1) throw busy();
  let pid;
  try { pid = JSON.parse(await fs.readFile(file, 'utf8')).pid; }
  catch { throw busy(); }
  if (!Number.isSafeInteger(pid) || pid <= 0) throw busy();
  try { process.kill(pid, 0); }
  catch (error) { if (error.code === 'ESRCH') return; }
  throw busy();
}

async function checkIdle(source, ownGate = false) {
  await checkLock(source, 'cli.lock');
  if (!ownGate) await checkLock(source, 'cli-start.lock');
  // Wizard-owned data may have an additional cross-application lock.
  if (await lstat(path.join(source, '.tim-in-use'))) throw busy();
}

async function sourceRoot(dataDir) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir) || !(await lstat(dataDir))?.isDirectory()) {
    throw new Error('Choose an existing TIM data folder that is a real directory.');
  }
  return fs.realpath(dataDir);
}

function ignored(name, topLevel) {
  if (name.endsWith('.tmp')) return true;
  if (!topLevel) return false;
  return transientRoots.has(name) || sourceLocks.some(lock => name === lock || name.startsWith(`${lock}.`)) || /^cli-selection\.json\.[\da-f-]{36}$/i.test(name);
}

async function* entries(root, relative = '', signal) {
  const directory = path.join(root, relative);
  for (const name of await fs.readdir(directory)) {
    signal?.throwIfAborted();
    if (ignored(name, !relative)) continue;
    const child = path.join(relative, name);
    const full = path.join(root, child);
    const stat = await lstat(full);
    if (!stat || (!stat.isFile() && !stat.isDirectory())) continue;
    if (path.relative(full, await fs.realpath(full)) !== '') continue;
    yield { relative: child, full, stat };
    if (stat.isDirectory()) yield* entries(root, child, signal);
  }
}

export async function legacyDataBytes(dataDir) {
  const source = await sourceRoot(dataDir);
  await checkIdle(source);
  let bytes = 0;
  for await (const { stat } of entries(source)) if (stat.isFile()) bytes += stat.size;
  return bytes;
}

async function claimLegacyGate(source) {
  const gate = path.join(source, 'cli-start.lock');
  const id = randomUUID();
  let handle;
  try { handle = await fs.open(gate, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw busy(); throw error; }
  try { await handle.writeFile(JSON.stringify({ id, pid: process.pid })); }
  catch (error) { await fs.unlink(gate).catch(() => {}); throw error; }
  finally { await handle.close(); }
  return async () => {
    const value = await readSmall(gate, 8192);
    if (value && JSON.parse(value).id === id) await fs.unlink(gate);
  };
}

async function copyDataFile(entry, target, signal, countBytes) {
  const handle = await fs.open(entry.full, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.dev !== entry.stat.dev || before.ino !== entry.stat.ino) throw new Error('Existing TIM data changed during copying. Close TIM and retry.');
    const progress = new Transform({ transform(chunk, _encoding, callback) { countBytes(chunk.length); callback(null, chunk); } });
    await pipeline(handle.createReadStream({ autoClose: false }), progress, createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal });
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error('Existing TIM data changed during copying. Close TIM and retry.');
    await fs.utimes(target, before.atime, before.mtime);
  } finally { await handle.close(); }
}

export async function copyLegacyData(dataDir, targetDataDir, { signal, onProgress = () => {} } = {}) {
  const source = await sourceRoot(dataDir);
  if (typeof targetDataDir !== 'string' || !path.isAbsolute(targetDataDir)) throw new Error('Choose a new TIM data folder.');
  const parent = await fs.realpath(path.dirname(targetDataDir));
  const target = path.join(parent, path.basename(targetDataDir));
  const relative = path.relative(source, target);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('The new TIM data folder must be outside the existing data folder.');
  if (await lstat(target)) throw new Error('The new TIM data folder already exists. Existing files cannot be merged during setup.');
  signal?.throwIfAborted();
  await checkIdle(source);
  const release = await claimLegacyGate(source);
  let staging;
  let completedBytes = 0;
  let lastReport = 0;
  const report = () => {
    lastReport = Date.now();
    try { onProgress(completedBytes); }
    catch { /* Progress display errors do not affect the copy. */ }
  };
  const countBytes = bytes => {
    completedBytes += bytes;
    if (Date.now() - lastReport >= 250) report();
  };
  try {
    await checkIdle(source, true);
    staging = await fs.mkdtemp(path.join(parent, '.tim-legacy-'));
    for await (const entry of entries(source, '', signal)) {
      const destination = path.join(staging, entry.relative);
      if (entry.stat.isDirectory()) await fs.mkdir(destination, { mode: 0o700 });
      else await copyDataFile(entry, destination, signal, countBytes);
    }
    signal?.throwIfAborted();
    await checkIdle(source, true);
    if (await lstat(target)) throw new Error('The new TIM data folder appeared during setup. Choose another destination.');
    await fs.rename(staging, target);
    staging = null;
    report();
  } finally {
    try { if (staging) await fs.rm(staging, { recursive: true, force: true }); }
    finally { await release(); }
  }
}
