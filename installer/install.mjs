import nodeFs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { catalogModels } from '../server/catalog.mjs';
import { findRuntime } from '../server/platform.mjs';
import { runtimeAssets } from '../server/runtime-setup.mjs';
import { installationData, installationMarker, lockInstallationData, readInstallation } from '../server/install-profile.mjs';
import { getInstallerHardware, getInstallerModels, installStarterModels } from './models.mjs';
import { compareVersions } from './version.mjs';
import { detectLegacyInstall, legacyDataBytes, copyLegacyData } from './legacy.mjs';

// An embedded desktop app contains its own app.asar. Copy that archive as a
// regular file instead of traversing Electron's virtual filesystem.
const fs = process.versions.electron ? createRequire(import.meta.url)('original-fs').promises : nodeFs;
const components = ['desktop', 'cli'];
const upgradeDirectory = '.tim-upgrade';
const catalog = new Map(catalogModels.map(model => [model.id, model]));
const exists = async file => {
  try { return await fs.lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};

async function directoryAt(directory) {
  const stat = await exists(directory);
  if (stat && !stat.isDirectory()) throw new Error(`${directory} must be a folder and cannot be a shortcut or symlink.`);
  return stat;
}

async function folderBytes(root) {
  let bytes = 0;
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) bytes += await folderBytes(file);
    else if (entry.isFile()) bytes += (await fs.stat(file)).size;
  }
  return bytes;
}

function entryName(name) {
  return typeof name === 'string' && name.length <= 160 && /^[\w.-][\w. -]*$/.test(name) && !['.', '..'].includes(name);
}

async function remainingModelBytes(dataDir, model) {
  const folder = path.join(dataDir, 'models', model.id);
  await directoryAt(folder);
  let bytes = 0;
  for (const file of model.files) {
    const target = path.join(folder, file.destination || path.posix.basename(file.path));
    const final = await exists(target);
    const partial = await exists(`${target}.part`);
    if ((final && !final.isFile()) || (partial && !partial.isFile())) throw new Error('Model storage contains an unexpected file or link.');
    if (final?.size !== file.size) bytes += file.size - (partial?.size <= file.size ? partial.size : 0);
  }
  return bytes;
}

async function writeMarker(root, value, first = false) {
  const file = path.join(root, installationMarker);
  const temp = `${file}.${randomUUID()}`;
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    if (first) {
      // A new destination is reserved by the caller's exclusive mkdir.
      await fs.copyFile(temp, file, fs.constants.COPYFILE_EXCL);
    } else await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
}

function terminalLauncher(platform) {
  return platform === 'win32'
    ? { name: 'Start TIM Terminal.cmd', text: '@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "TIM_DATA_DIR=%~dp0TIM-Studio-Data"\r\n"%~dp0cli\\node.exe" "%~dp0cli\\cli\\index.mjs" %*\r\nif errorlevel 1 pause\r\n' }
    : { name: platform === 'darwin' ? 'Start TIM Terminal.command' : 'tim', text: '#!/bin/sh\nset -eu\nroot=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)\nexport TIM_DATA_DIR="$root/TIM-Studio-Data"\nexec "$root/cli/node" "$root/cli/cli/index.mjs" "$@"\n' };
}

async function writeLauncher(root, platform) {
  const { name, text } = terminalLauncher(platform);
  const file = path.join(root, name);
  try { await fs.writeFile(file, text, { mode: 0o755, flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!(await exists(file))?.isFile() || await fs.readFile(file, 'utf8') !== text) throw new Error(`${name} already exists with different contents.`);
  }
  if (platform !== 'win32') await fs.access(file, fs.constants.X_OK);
}

async function verifyComponent(root, key, manifest) {
  const component = path.join(root, key);
  if (!await directoryAt(component)) return false;
  const file = path.join(component, key === 'desktop' ? manifest.desktopEntry : manifest.cliNode);
  const entry = await exists(file);
  if (!entry || (key === 'desktop' && manifest.platform === 'darwin' ? !entry.isDirectory() : !entry.isFile())) {
    throw new Error(`The ${key === 'desktop' ? 'desktop' : 'terminal'} files in this folder are incomplete. Choose a fresh destination.`);
  }
  if (key === 'cli' && !(await exists(path.join(component, 'cli', 'index.mjs')))?.isFile()) throw new Error('The terminal package is missing its entry point.');
  if (manifest.platform !== 'win32') await fs.access(file, fs.constants.X_OK);
  return true;
}

async function copyComponent(payload, target, key, signal, manifest) {
  const staging = await fs.mkdtemp(path.join(target, '.tim-copy-'));
  try {
    await fs.cp(path.join(payload, key), path.join(staging, key), {
      recursive: true, verbatimSymlinks: true, force: false, errorOnExist: true,
      filter: () => { signal?.throwIfAborted(); return true; }
    });
    await verifyComponent(staging, key, manifest);
    signal?.throwIfAborted();
    if (await exists(path.join(target, key))) throw new Error('Installation contents changed during setup. Try again.');
    await fs.rename(path.join(staging, key), path.join(target, key));
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}

async function recoverUpgrade(target, marker) {
  const stage = path.join(target, upgradeDirectory);
  if (!await directoryAt(stage)) return;
  const journalFile = path.join(stage, 'journal.json');
  if (!(await exists(journalFile))?.isFile()) throw new Error('An unfinished upgrade could not be verified. Keep this folder and contact TIM support.');
  const journal = JSON.parse(await fs.readFile(journalFile, 'utf8'));
  if (!/^[\da-f-]{36}$/.test(journal.id) || !Array.isArray(journal.components) || journal.components.some(key => !components.includes(key))) throw new Error('Invalid TIM upgrade journal.');
  if (marker.upgradeId !== journal.id) {
    for (const key of journal.components) {
      const backup = path.join(stage, `previous-${key}`);
      const replacement = path.join(stage, key);
      const installed = path.join(target, key);
      if (await directoryAt(backup)) {
        if (await directoryAt(installed)) await fs.rm(installed, { recursive: true });
        await fs.rename(backup, installed);
      } else if (journal.added?.includes(key) && !await exists(replacement) && await directoryAt(installed)) {
        await fs.rename(installed, replacement);
      }
    }
  }
  await fs.rm(stage, { recursive: true });
}

async function replaceComponents(payload, target, keys, marker, manifest, signal, onProgress) {
  const draft = await fs.mkdtemp(path.join(target, '.tim-upgrade-stage-'));
  const stage = path.join(target, upgradeDirectory);
  let staged = false;
  const id = randomUUID();
  try {
    for (const key of keys) {
      onProgress({ phase: 'copy', label: key === 'desktop' ? 'Preparing TIM Desktop upgrade' : 'Preparing TIM Terminal upgrade' });
      await copyComponent(payload, draft, key, signal, manifest);
    }
    const added = [];
    for (const key of keys) if (!await directoryAt(path.join(target, key))) added.push(key);
    await fs.writeFile(path.join(draft, 'journal.json'), JSON.stringify({ id, components: keys, added }), { flag: 'wx' });
    signal?.throwIfAborted();
    await fs.rename(draft, stage);
    staged = true;
    for (const key of keys) {
      const installed = path.join(target, key);
      if (!added.includes(key)) await fs.rename(installed, path.join(stage, `previous-${key}`));
      await fs.rename(path.join(stage, key), installed);
    }
    const next = { ...marker, version: manifest.version, upgradeId: id };
    for (const key of keys) next[key] = true;
    await writeMarker(target, next);
    return next;
  } finally {
    if (staged) await recoverUpgrade(target, await readInstallation(target));
    else await fs.rm(draft, { recursive: true, force: true });
  }
}

export async function createInstaller({ payload, version, defaultDirectory, readHardware = getInstallerHardware, prepareModels = installStarterModels, findLegacy = detectLegacyInstall }) {
  const manifest = JSON.parse(await fs.readFile(path.join(payload, 'payload.json'), 'utf8'));
  if (manifest.platform !== process.platform || manifest.arch !== process.arch || manifest.version !== version ||
      !entryName(manifest.desktopEntry) || manifest.cliNode !== (process.platform === 'win32' ? 'node.exe' : 'node')) {
    throw new Error('This installer package does not match your system or is incomplete. Download the installer for your operating system and processor.');
  }
  const [hardware, ...available] = await Promise.all([readHardware(), ...components.map(key => verifyComponent(payload, key, manifest))]);
  const [desktopAvailable, cliAvailable] = available;
  const bundled = { desktop: desktopAvailable, cli: cliAvailable };
  const sizes = Object.fromEntries(await Promise.all(components.map(async (key, index) => [key, available[index] ? await folderBytes(path.join(payload, key)) : 0])));
  const models = getInstallerModels(hardware);
  const defaultRoot = path.join(defaultDirectory, 'TIM Studio');
  const [existing, legacy] = await Promise.all([
    readInstallation(defaultRoot).catch(() => null), findLegacy({ home: defaultDirectory }).catch(() => ({}))
  ]);
  let result;

  async function plan(selection) {
    const errors = [], warnings = [];
    let requiredBytes = 0, freeBytes = null, directory = '', target = '', marker = null;
    let operation = 'install', installedVersion = null, upgradingComponents = [], importBytes = 0;
    if (!selection || typeof selection.desktop !== 'boolean' || typeof selection.cli !== 'boolean' || typeof selection.portable !== 'boolean' || !Array.isArray(selection.modelIds)) {
      return { directory, target, requiredBytes, freeBytes, warnings, errors: ['Choose what to install.'] };
    }
    if (!selection.desktop && !selection.cli) errors.push('Select TIM Desktop, TIM Terminal, or both.');
    if ((selection.desktop && !desktopAvailable) || (selection.cli && !cliAvailable)) errors.push('A selected app is missing from this installer package.');
    const modelIds = [...new Set(selection.modelIds)];
    const source = selection.importFrom && ['cli', 'desktop'].includes(selection.importFrom) ? legacy[selection.importFrom] : null;
    if (selection.importFrom && !source?.dataDir) errors.push('Choose an available TIM data source.');
    const selectedModels = modelIds.map(id => catalog.get(id));
    if (selectedModels.some(model => !model)) errors.push('Select starter models from the TIM model catalog.');
    const needsChat = selectedModels.some(model => model?.kind === 'chat');
    const runtime = runtimeAssets[`${manifest.platform}-${manifest.arch}`];
    if (needsChat && (!hardware.runtimeSupported || !runtime)) errors.push('Automatic chat engine setup is unavailable on this system. Deselect the chat models to continue.');
    if (selectedModels.some(model => model && model.kind !== 'chat')) warnings.push('Image and speech models need compatible engines configured in TIM after installation.');
    if (models.some(model => modelIds.includes(model.id) && model.fit === 'too-large')) warnings.push('Some selected models exceed the current RAM budget. You can download them now and use them when more memory is available.');
    if (selection.portable) {
      warnings.push('Keep the TIM Studio folder together. Use a drive that supports large files and running apps on this operating system.');
      if (manifest.platform === 'darwin' && selection.desktop) warnings.push('For macOS Desktop, use a Mac-formatted drive such as APFS so the app bundle can keep its symbolic links.');
    }
    const chosen = selection.directory || (!selection.portable && defaultDirectory);
    if (typeof chosen !== 'string' || !path.isAbsolute(chosen) || /[\x00-\x1f]/.test(chosen)) errors.push('Choose an existing destination folder.');
    else try {
      directory = await fs.realpath(chosen);
      await fs.access(directory, fs.constants.W_OK);
      if (!(await fs.stat(directory)).isDirectory()) throw new Error('Choose an existing destination folder.');
      target = await readInstallation(directory) ? directory : path.join(directory, 'TIM Studio');
      if (await directoryAt(target)) {
        marker = await readInstallation(target);
        if (!marker) throw new Error('A folder named TIM Studio already exists here. Choose a different destination.');
        if (marker.platform !== manifest.platform || marker.arch !== manifest.arch) throw new Error('This folder contains TIM for another system. Choose a different destination.');
        if (marker.portable !== selection.portable) throw new Error('Use the original install type for this TIM folder, or choose another destination.');
        installedVersion = marker.version;
        const order = compareVersions(marker.version, version);
        operation = order < 0 ? 'upgrade' : order > 0 ? 'downgrade' : 'current';
        if (order > 0) errors.push('This folder already has a newer version. Use a newer installer or choose another destination.');
        if (order < 0) {
          upgradingComponents = components.filter(key => marker[key]);
          if (upgradingComponents.some(key => !bundled[key])) errors.push('This installer is missing an installed component. Download the full TIM installer.');
        }
      }
      const dataDir = path.join(target, installationData);
      await directoryAt(dataDir);
      await directoryAt(path.join(dataDir, 'models'));
      if (source?.dataDir) {
        if (await exists(dataDir)) errors.push('Data can only be copied into a TIM folder without existing data.');
        else {
          importBytes = await legacyDataBytes(source.dataDir);
          requiredBytes += importBytes;
          if (!marker) operation = 'migrate';
        }
      }
      for (const key of components) {
        if (!selection[key] && !upgradingComponents.includes(key)) continue;
        if (operation === 'upgrade' || !await verifyComponent(target, key, manifest)) requiredBytes += sizes[key];
      }
      for (const model of selectedModels.filter(Boolean)) requiredBytes += await remainingModelBytes(dataDir, model);
      if (runtime && needsChat && !await findRuntime(null, 'chat', 'cpu', dataDir)) requiredBytes += runtime[1] * 4;
      if (requiredBytes > 0) requiredBytes += 64 * 2 ** 20;
      const disk = await fs.statfs(await exists(dataDir) ? dataDir : directory);
      freeBytes = disk.bavail * disk.bsize;
      if (requiredBytes > freeBytes) errors.push('There is not enough free space. Choose another destination or fewer models.');
      if (disk.type === 0x4d44 && selectedModels.some(model => model?.files.some(file => file.size >= 2 ** 32))) errors.push('This FAT drive cannot store one or more selected model files. Choose another drive or smaller models.');
    } catch (error) {
      errors.push(['EACCES', 'EPERM', 'EROFS'].includes(error.code) ? 'This destination is read-only or you do not have permission to write here.' : error.code === 'ENOENT' ? 'The destination is unavailable. Reconnect the drive or choose another folder.' : error.message);
    }
    return { directory, target, requiredBytes, freeBytes, warnings, errors, operation, installedVersion, availableVersion: version, upgradingComponents, importBytes };
  }

  async function install(selection, { signal, onProgress = () => {} } = {}) {
    result = null;
    const review = await plan(selection);
    if (review.errors.length) throw new Error(review.errors.join(' '));
    if ((selection.reviewedVersion ?? null) !== review.installedVersion) throw new Error('The installed version changed. Go back and review the destination again.');
    signal?.throwIfAborted();
    const { target } = review;
    const dataDir = path.join(target, installationData);
    let marker = await readInstallation(target);
    if ((marker?.version ?? null) !== review.installedVersion) throw new Error('The installed version changed. Go back and review the destination again.');
    if (!marker) {
      await fs.mkdir(target);
      marker = { schema: 1, product: 'TIM Studio', version, platform: manifest.platform, arch: manifest.arch, portable: selection.portable, desktop: false, cli: false };
      try { await writeMarker(target, marker, true); }
      catch (error) { await fs.rmdir(target).catch(() => {}); throw error; }
    }
    if (selection.importFrom) {
      try {
        const reportCopy = completedBytes => onProgress({ phase: 'copy-data', label: 'Copying existing TIM data', completedBytes, totalBytes: review.importBytes });
        reportCopy(0);
        await copyLegacyData(legacy[selection.importFrom].dataDir, dataDir, { signal, onProgress: reportCopy });
      }
      catch (error) {
        if (review.installedVersion === null) { await fs.rm(path.join(target, installationMarker), { force: true }); await fs.rmdir(target).catch(() => {}); }
        throw error;
      }
    }
    const release = await lockInstallationData(dataDir);
    try {
      const current = await readInstallation(target);
      if (!current || current.version !== marker.version || current.platform !== manifest.platform || current.arch !== manifest.arch || current.portable !== selection.portable) throw new Error('Installation details changed. Review your destination again.');
      marker = current;
      await recoverUpgrade(target, marker);
      if (review.operation !== 'upgrade') {
        for (const key of components) {
          if (!selection[key]) continue;
          signal?.throwIfAborted();
          onProgress({ phase: 'copy', label: key === 'desktop' ? 'Installing TIM Desktop' : 'Installing TIM Terminal' });
          if (!await verifyComponent(target, key, manifest)) await copyComponent(payload, target, key, signal, manifest);
          if (key === 'cli') await writeLauncher(target, manifest.platform);
          marker[key] = true;
          await writeMarker(target, marker);
        }
      }
      await prepareModels(dataDir, selection.modelIds, { signal, portable: true, onProgress: event => onProgress({
        phase: event.phase,
        label: event.phase === 'runtime' ? 'Setting up the local chat engine' : `${event.status === 'verifying' ? 'Verifying' : 'Downloading'} ${event.name}`,
        detail: event.phase === 'model' ? `Model ${event.index} of ${event.count}` : event.detail || '',
        completedBytes: event.downloadedBytes, totalBytes: event.totalBytes,
        percent: event.status === 'verifying' ? null : event.progress
      }) });
      signal?.throwIfAborted();
      if (review.operation === 'upgrade') {
        const keys = components.filter(key => marker[key] || selection[key]);
        if (keys.includes('cli')) await writeLauncher(target, manifest.platform);
        marker = await replaceComponents(payload, target, keys, marker, manifest, signal, onProgress);
      }
      result = { target, desktop: marker.desktop, cli: marker.cli, portable: marker.portable, version, operation: review.operation };
      return result;
    } finally { await release(); }
  }

  function launchPath(action) {
    if (!result) throw new Error('Finish installing TIM first.');
    if (action === 'folder') return result.target;
    if (action === 'desktop' && result.desktop) return path.join(result.target, 'desktop', manifest.desktopEntry);
    if (action === 'cli' && result.cli) return path.join(result.target, terminalLauncher(manifest.platform).name);
    throw new Error('That app is not installed.');
  }

  return { getSetup: () => ({ version, hardware, models, desktopAvailable, cliAvailable, defaultDirectory, legacy,
    existing: existing && { ...existing, target: defaultRoot, directory: defaultDirectory } }), plan, install, launchPath };
}

export function launcherEnvironment() {
  // AppImage injects its own paths. Child apps need the system environment.
  const env = { ...process.env };
  if (env.APPIMAGE) {
    for (const key of ['APPIMAGE', 'APPDIR', 'ARGV0', 'OWD', 'LD_LIBRARY_PATH', 'LD_PRELOAD']) delete env[key];
  }
  return env;
}

export async function openLinuxTerminal(launcher) {
  const commands = [['x-terminal-emulator', '-e'], ['gnome-terminal', '--'], ['konsole', '-e'], ['xfce4-terminal', '-x'], ['xterm', '-e']];
  for (const [command, flag] of commands) {
    const program = (process.env.PATH || '').split(path.delimiter).filter(folder => path.isAbsolute(folder)).map(folder => path.join(folder, command));
    for (const file of program) {
      try { await fs.access(file, fs.constants.X_OK); }
      catch { continue; }
      await new Promise((resolve, reject) => {
        const child = spawn(file, [flag, launcher], { detached: true, stdio: 'ignore', env: launcherEnvironment() });
        child.once('error', reject);
        child.once('spawn', () => { child.unref(); resolve(); });
      });
      return;
    }
  }
  throw new Error('No supported terminal app was found. Open a terminal and run the tim launcher in the installation folder.');
}
