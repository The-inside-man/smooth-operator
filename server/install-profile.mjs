import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const installationMarker = 'tim-installation.json';
export const installationData = 'TIM-Studio-Data';

export async function readInstallation(root) {
  const file = path.join(root, installationMarker);
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > 8192) throw new Error('Invalid TIM installation marker.');
    const marker = JSON.parse(await fs.readFile(file, 'utf8'));
    if (marker.schema !== 1 || marker.product !== 'TIM Studio' || typeof marker.version !== 'string' ||
        typeof marker.desktop !== 'boolean' || typeof marker.cli !== 'boolean' || typeof marker.portable !== 'boolean') {
      throw new Error('Invalid TIM installation marker.');
    }
    return marker;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

const busy = () => new Error('This installation is in use. Close TIM Desktop, TIM terminal windows, or the other installer, then try again.');

function processIsGone(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { return error.code === 'ESRCH'; }
}

// One writer owns a wizard installation's data at a time. Multiple terminal
// windows still join their existing CLI backend, which holds one ownership lock.
export async function lockInstallationData(dataDir) {
  await fs.mkdir(dataDir, { recursive: true });
  const lock = path.join(dataDir, '.tim-in-use');
  const name = `${process.pid}-${randomUUID()}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { await fs.mkdir(lock, { mode: 0o700 }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (attempt) throw busy();
      const stat = await fs.lstat(lock).catch(() => null);
      if (!stat?.isDirectory() || stat.isSymbolicLink()) throw busy();
      const entries = await fs.readdir(lock).catch(() => []);
      const pid = Number(entries.length === 1 && /^([1-9]\d*)-[\da-f-]{36}$/.exec(entries[0])?.[1]);
      if (!Number.isSafeInteger(pid) || pid < 1 || !processIsGone(pid)) throw busy();
      // Only the remover of this unique, dead owner's file may remove its directory.
      try { await fs.unlink(path.join(lock, entries[0])); await fs.rmdir(lock); }
      catch { throw busy(); }
      continue;
    }
    const owner = path.join(lock, name);
    try { await fs.writeFile(owner, '', { flag: 'wx', mode: 0o600 }); }
    catch (error) { await fs.rmdir(lock).catch(() => {}); throw error; }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await fs.unlink(owner);
      await fs.rmdir(lock);
    };
  }
  throw busy();
}
