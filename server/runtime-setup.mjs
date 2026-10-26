import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findRuntime, runtimeEnv } from './platform.mjs';

const exec = promisify(execFile);
const release = 'b11896';
// Official ggml-org/llama.cpp release assets, pinned with GitHub's SHA-256 digests.
export const runtimeAssets = {
  'darwin-arm64': ['macos-arm64.tar.gz', 16297217, 'f7fdf25367d2a403a91ec91729322a3c6a3a80e95da15844aa2c7be9dab3e11b'],
  'darwin-x64': ['macos-x64.tar.gz', 12038557, '2ff5c5f3b5ba8a12a4a868c290510799416ad78c61528e9d7754404aa6fd6fb5'],
  'linux-x64': ['ubuntu-x64.tar.gz', 22497065, 'b02ed815efe497c0e818aadaae1b2538309f25424034555dcc1b7211c783e25c'],
  'linux-arm64': ['ubuntu-arm64.tar.gz', 18221582, '68942cd6067dd632831f12e0bcdb4f8edbd91882e633a4e8593e0690f0624261'],
  'win32-x64': ['win-cpu-x64.zip', 24228471, 'fda51a52f95ea90d4e4e2604de1d50474f34bd94112bf0693ce13165b5211b81'],
  'win32-arm64': ['win-cpu-arm64.zip', 12846399, '817f4e27205c707b7a3030450098bb7a5cb6fb23b0f9ac7ba54ec2e482f51e45']
};

export async function findSystemChatRuntime(preference = 'auto') {
  const name = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    const binary = path.join(directory, name);
    try {
      await fs.access(binary, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
      if ((await fs.stat(binary)).isFile()) return { binary, backend: preference === 'auto' && process.platform === 'darwin' ? 'metal' : 'cpu' };
    } catch {}
  }
  return null;
}

export function validateArchiveEntries(entries) {
  for (const entry of entries.split(/\r?\n/).filter(Boolean)) {
    if (/^[\\/]|^[a-z]:/i.test(entry) || entry.split(/[\\/]/).includes('..')) throw new Error('Unsafe runtime archive path.');
  }
}

async function findBinary(directory, filename, depth = 4) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === filename) return file;
    if (entry.isDirectory() && depth > 0) { const found = await findBinary(file, filename, depth - 1); if (found) return found; }
  }
  return null;
}

export async function ensureChatRuntime(dataDir, libraryRoot, { signal, onChange = () => {}, fetchImpl = fetch } = {}) {
  const existing = await findRuntime(libraryRoot, 'chat', 'cpu', dataDir) || await findSystemChatRuntime('cpu');
  if (existing) { onChange({ status: 'ready', progress: 100 }); return existing; }
  const asset = runtimeAssets[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error(`Automatic chat engine setup is unavailable for ${process.platform}/${process.arch}. Install an engine pack in Settings.`);
  const [suffix, totalBytes, expectedHash] = asset;
  const name = `llama-${release}-bin-${suffix}`;
  const directory = path.join(dataDir, 'setup');
  const stage = path.join(directory, 'runtime-extract');
  const archive = path.join(directory, name + '.part');
  await fs.mkdir(directory, { recursive: true });
  const disk = await fs.statfs(directory);
  if (disk.bavail * disk.bsize < totalBytes * 4) throw new Error('Not enough free disk space to install the chat engine.');
  try {
    onChange({ status: 'downloading', progress: 0, downloadedBytes: 0, totalBytes });
    const response = await fetchImpl(`https://github.com/ggml-org/llama.cpp/releases/download/${release}/${name}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(300000)]) : AbortSignal.timeout(300000) });
    if (!response.ok || !response.body) throw new Error(`Chat engine download failed (${response.status}).`);
    const hash = createHash('sha256'); let received = 0;
    const handle = await fs.open(archive, 'w');
    try {
      for await (const chunk of response.body) {
        signal?.throwIfAborted(); received += chunk.length;
        if (received > totalBytes) throw new Error('Chat engine download size does not match the pinned release.');
        hash.update(chunk); await handle.writeFile(chunk);
        onChange({ status: 'downloading', downloadedBytes: received, totalBytes, progress: Math.round(received / totalBytes * 100) });
      }
    } finally { await handle.close(); }
    if (received !== totalBytes || hash.digest('hex') !== expectedHash) throw new Error('Chat engine checksum verification failed. Retry setup.');
    onChange({ status: 'downloading', progress: 100, phase: 'Installing verified engine' });
    const { stdout } = await exec('tar', ['-tf', archive], { timeout: 30000, maxBuffer: 1024 * 1024, signal });
    validateArchiveEntries(stdout);
    await fs.rm(stage, { recursive: true, force: true }); await fs.mkdir(stage, { recursive: true });
    await exec('tar', ['-xf', archive, '-C', stage], { timeout: 60000, signal });
    const filename = 'llama-server' + (process.platform === 'win32' ? '.exe' : '');
    const binary = await findBinary(stage, filename);
    if (!binary) throw new Error('The verified runtime archive does not contain llama-server.');
    const target = path.join(dataDir, 'runtimes', `${process.platform}-${process.arch}`, 'chat', 'cpu');
    await fs.mkdir(path.dirname(target), { recursive: true });
    const stagedTarget = target + '.installing';
    await fs.rm(stagedTarget, { recursive: true, force: true });
    await fs.cp(path.dirname(binary), stagedTarget, { recursive: true, verbatimSymlinks: true });
    signal?.throwIfAborted();
    // The fixed install directory may remain from an interrupted older setup.
    // Only replace it once the pinned archive has been fully staged and checked.
    await fs.rm(target, { recursive: true, force: true });
    await fs.rename(stagedTarget, target);
    if (process.platform !== 'win32') await fs.chmod(path.join(target, filename), 0o755);
    try { await exec(path.join(target, filename), ['--version'], { timeout: 15000, signal, env: runtimeEnv(path.join(target, filename), directory) }); }
    catch (error) { await fs.rm(target, { recursive: true, force: true }); throw new Error(`The downloaded chat engine could not start: ${error.message}`); }
    onChange({ status: 'ready', progress: 100 });
    return { binary: path.join(target, filename), backend: 'cpu' };
  } finally {
    await fs.rm(archive, { force: true }); await fs.rm(stage, { recursive: true, force: true });
  }
}
