import os from 'node:os';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const GiB = 2 ** 30;
const finiteBytes = value => Number.isSafeInteger(value) && value >= 0;
const safePid = value => Number.isSafeInteger(value) && value > 0;
const bounded = (value, total) => Math.min(total, Math.max(0, Math.round(value)));
const commandOptions = { windowsHide: true, timeout: 3000, maxBuffer: 128 * 1024, env: { ...process.env, LC_ALL: 'C' } };

export function estimateModelBytes(model, catalog = []) {
  const entry = catalog.find(item => item.id === model?.catalogId);
  const gb = entry?.memoryGB ?? model?.memoryGB;
  if (Number.isFinite(gb) && gb > 0) return Math.round(gb * GiB);
  // Imported models have no catalog estimate. Include working space above weights.
  return Number.isFinite(model?.size) && model.size > 0 ? Math.round(model.size * 1.2 + .5 * GiB) : null;
}

export function parseLinuxMemory(text) {
  const match = String(text).match(/^MemAvailable:\s+(\d+)\s+kB\s*$/m);
  if (!match || !finiteBytes(Number(match[1]) * 1024)) throw new Error('Available memory was not reported.');
  return Number(match[1]) * 1024;
}

export function parseMacMemory(text) {
  const pageSize = Number(String(text).match(/page size of (\d+) bytes/)?.[1]);
  const fields = ['Pages free', 'Pages inactive', 'Pages speculative'].map(name => Number(String(text).match(new RegExp(`^${name}:\\s+(\\d+)\\.\\s*$`, 'm'))?.[1]));
  if (!pageSize || !finiteBytes(pageSize) || fields.some(value => !finiteBytes(value))) throw new Error('Available memory was not reported.');
  // vm_stat prints free *excluding* speculative pages. Do not add purgeable pages:
  // they overlap other page lists. Inactive pages are only potentially reclaimable.
  const available = fields.reduce((sum, count) => sum + count, 0) * pageSize;
  if (!finiteBytes(available)) throw new Error('Invalid memory statistics.');
  return available;
}

export function parseWindowsMemory(text) {
  const value = String(text).replace(/^\uFEFF/, '').trim();
  if (!/^\d+$/.test(value) || !finiteBytes(Number(value) * 1024)) throw new Error('Available memory was not reported.');
  return Number(value) * 1024;
}

export function parsePsMemory(text, pids) {
  const wanted = new Set(pids.filter(safePid));
  const result = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s*$/);
    if (!match) continue;
    const pid = Number(match[1]), bytes = Number(match[2]) * 1024;
    if (wanted.has(pid) && finiteBytes(bytes)) result.set(pid, bytes);
  }
  return result;
}

export function parseWindowsProcesses(text, pids) {
  const wanted = new Set(pids.filter(safePid));
  const result = new Map();
  if (!String(text).trim()) return result;
  const parsed = JSON.parse(String(text).replace(/^\uFEFF/, ''));
  for (const row of Array.isArray(parsed) ? parsed : [parsed]) {
    if (row && wanted.has(row.Id) && finiteBytes(row.WorkingSet64)) result.set(row.Id, row.WorkingSet64);
  }
  return result;
}

export async function readHostMemory({ platform = process.platform, readFile = fs.readFile, run = exec, total = os.totalmem(), free = os.freemem() } = {}) {
  let available = free, availableSource = 'free-fallback';
  try {
    if (platform === 'linux') {
      available = parseLinuxMemory(await readFile('/proc/meminfo', 'utf8'));
      availableSource = 'os';
    } else if (platform === 'darwin') {
      available = parseMacMemory((await run('/usr/bin/vm_stat', [], commandOptions)).stdout);
      availableSource = 'reclaimable-estimate';
    } else if (platform === 'win32') {
      available = parseWindowsMemory((await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory'], commandOptions)).stdout);
      availableSource = 'os';
    }
  } catch { /* Sandboxed hosts and missing utilities still have conservative free RAM. */ }
  const totalBytes = finiteBytes(total) ? total : 0;
  const freeBytes = bounded(finiteBytes(free) ? free : 0, totalBytes);
  const availableBytes = bounded(finiteBytes(available) ? available : freeBytes, totalBytes);
  const reserveBytes = Math.min(totalBytes, Math.max(GiB, Math.round(totalBytes * .1)));
  return { total: totalBytes, free: freeBytes, totalBytes, availableBytes, usedBytes: totalBytes - availableBytes, reserveBytes, modelBudgetBytes: Math.max(0, availableBytes - reserveBytes), availableSource };
}

export async function readProcessMemory(pids, { platform = process.platform, readFile = fs.readFile, run = exec } = {}) {
  const ids = [...new Set(pids.filter(safePid))];
  if (!ids.length) return new Map();
  try {
    if (platform === 'linux') {
      const rows = await Promise.all(ids.map(async pid => {
        try {
          const match = String(await readFile(`/proc/${pid}/status`, 'utf8')).match(/^VmRSS:\s+(\d+)\s+kB\s*$/m);
          const bytes = match ? Number(match[1]) * 1024 : NaN;
          return finiteBytes(bytes) ? [pid, bytes] : null;
        } catch { return null; } // A process may exit during a sample.
      }));
      return new Map(rows.filter(Boolean));
    }
    if (platform === 'darwin') return parsePsMemory((await run('/bin/ps', ['-o', 'pid=,rss=', '-p', ids.join(',')], commandOptions)).stdout, ids);
    if (platform === 'win32') {
      // Every interpolated value is a validated positive integer, never user text.
      const script = `Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64 | ConvertTo-Json -Compress`;
      return parseWindowsProcesses((await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], commandOptions)).stdout, ids);
    }
  } catch { /* Measurements are optional; callers label estimates explicitly. */ }
  return new Map();
}

/** Samples are cached between state events; child identity prevents stale PID reuse. */
export class MemoryMonitor {
  constructor({ host = readHostMemory, processes = readProcessMemory, now = Date.now, total = os.totalmem, free = os.freemem } = {}) {
    this.host = host; this.processes = processes; this.now = now; this.total = total; this.free = free;
    this.measurements = new Map(); this.sampledAt = 0; this.lastHost = null; this.sampling = null;
  }
  async sample(entries = []) {
    if (this.sampling) return this.sampling;
    this.sampling = (async () => {
      const live = entries.filter(entry => safePid(entry.engine?.child?.pid)).map(entry => ({ child: entry.engine.child, pid: entry.engine.child.pid }));
      const [hostResult, processResult] = await Promise.allSettled([this.host({ total: this.total(), free: this.free() }), this.processes(live.map(entry => entry.pid))]);
      // Rejected custom probes must not prevent UI updates or leave stale capacity.
      this.lastHost = hostResult.status === 'fulfilled' ? hostResult.value : await readHostMemory({ platform: 'unsupported', total: this.total(), free: this.free() });
      const values = processResult.status === 'fulfilled' ? processResult.value : new Map();
      this.measurements = new Map(live.map(entry => [entry.pid, { child: entry.child, bytes: values.get(entry.pid) } ]));
      this.sampledAt = this.now();
      return this.snapshot(entries);
    })();
    try { return await this.sampling; } finally { this.sampling = null; }
  }
  snapshot(entries = []) {
    const totalBytes = this.total(), freeBytes = Math.min(totalBytes, Math.max(0, this.free()));
    const reserveBytes = Math.min(totalBytes, Math.max(GiB, Math.round(totalBytes * .1)));
    const initial = { total: totalBytes, free: freeBytes, totalBytes, availableBytes: freeBytes, usedBytes: totalBytes - freeBytes, reserveBytes, modelBudgetBytes: Math.max(0, freeBytes - reserveBytes), availableSource: 'free-fallback' };
    const stale = !this.sampledAt || this.now() - this.sampledAt > 15_000;
    // An old optimistic capacity estimate must not authorize a new load.
    const memory = { ...(stale ? initial : this.lastHost || initial), sampledAt: this.sampledAt, stale };
    memory.status = stale ? 'stale' : memory.availableSource === 'free-fallback' ? 'fallback' : 'ok';
    const loadedModels = entries.map(({ engine, model, role, pinned }) => {
      const child = engine?.child, pid = child?.pid;
      const measurement = this.measurements.get(pid);
      const rssBytes = !stale && measurement?.child === child && finiteBytes(measurement.bytes) ? measurement.bytes : null;
      const estimatedBytes = estimateModelBytes(model, this.catalog || []);
      return { modelId: model.id, name: model.name, role, ...(safePid(pid) ? { pid } : {}), ...(typeof pinned === 'boolean' ? { pinned } : {}), rssBytes, estimatedBytes, memorySource: rssBytes !== null ? 'measured' : estimatedBytes !== null ? 'estimate' : 'unavailable' };
    });
    memory.modelRssBytes = loadedModels.every(model => model.rssBytes !== null) ? loadedModels.reduce((sum, model) => sum + model.rssBytes, 0) : null;
    return { memory, loadedModels };
  }
}
