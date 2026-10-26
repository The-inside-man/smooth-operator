import fs from 'node:fs/promises';
import { createReadStream, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { catalogModels } from './catalog.mjs';
import { Store } from './store.mjs';

const activeStatuses = new Set(['queued', 'downloading', 'verifying']);
const savedStatuses = new Set([...activeStatuses, 'paused', 'cancelled', 'failed', 'completed']);
const abortError = () => Object.assign(new Error('Download cancelled. Partial files are kept for retry.'), { name: 'AbortError' });
const checkAbort = signal => { if (signal?.aborted) throw abortError(); };
const copy = value => JSON.parse(JSON.stringify(value));
const safeName = name => typeof name === 'string' && name && !name.includes('\\') && name === path.basename(name) && name !== '.' && name !== '..';
const fileName = file => file.destination || path.posix.basename(file.path);
const fileUrl = file => `https://huggingface.co/${file.repo}/resolve/${file.revision}/${file.path.split('/').map(encodeURIComponent).join('/')}?download=true`;

function trustedUrl(value) {
  const url = new URL(value);
  // Hugging Face redirects large blobs to its Xet/CDN hosts. Never accept arbitrary destinations.
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
    !(url.hostname === 'huggingface.co' || url.hostname.endsWith('.huggingface.co') || url.hostname === 'hf.co' || url.hostname.endsWith('.hf.co'))) {
    throw new Error('The model host redirected outside Hugging Face.');
  }
  return url.href;
}

async function regularStat(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Model storage contains an unsafe file.');
    return stat;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function sha256(file, signal) {
  const hash = createHash('sha256');
  const stream = createReadStream(file, { flags: constants.O_RDONLY | (constants.O_NOFOLLOW || 0) });
  const abort = () => stream.destroy(abortError());
  signal?.addEventListener('abort', abort, { once: true });
  try {
    checkAbort(signal);
    for await (const chunk of stream) { checkAbort(signal); hash.update(chunk); }
    return hash.digest('hex');
  } finally { signal?.removeEventListener('abort', abort); }
}

/**
 * Downloads only bundled catalog IDs. Files stay below dataDir/models/<id> and are
 * promoted from .part only after pinned size + SHA256 verification. init() never
 * resumes a network transfer: interrupted work becomes paused until start(id).
 * snapshot() is synchronous; start()/cancel() return the current job quickly.
 * installedModels() returns registry-compatible models without checking runtimes.
 */
export class DownloadManager {
  constructor(dataDir, { onChange = () => {}, fetchImpl = globalThis.fetch, catalog = catalogModels } = {}) {
    this.dataDir = path.resolve(dataDir);
    this.root = path.join(this.dataDir, 'models');
    this.store = new Store(this.dataDir);
    this.onChange = onChange;
    this.fetch = fetchImpl;
    // Catalog injection supports small deterministic tests. HTTP callers supply only IDs.
    this.catalog = new Map(catalog.map(model => {
      if (!safeName(model.id) || !model.files?.length || model.files.some(file => !/^[\w.-]+\/[\w.-]+$/.test(file.repo) || !/^[a-f0-9]{40}$/.test(file.revision) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 1 || file.path.split('/').some(part => !safeName(part)) || !safeName(fileName(file)))) throw new Error('Invalid bundled model metadata.');
      return [model.id, model];
    }));
    this.jobs = new Map();
    this.installed = new Map();
    this.running = null;
    this.closed = false;
    this.initialized = null;
  }

  async init() {
    if (!this.initialized) this.initialized = this._init();
    return this.initialized;
  }

  async _init() {
    await fs.mkdir(this.root, { recursive: true });
    const rootStat = await fs.lstat(this.root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Model storage must be a real directory.');
    this.realRoot = await fs.realpath(this.root);
    const saved = await this.store.read('downloads', []);
    for (const item of Array.isArray(saved) ? saved : []) {
      const model = this.catalog.get(item.catalogId);
      if (!model || !savedStatuses.has(item.status)) continue;
      const interrupted = activeStatuses.has(item.status);
      this.jobs.set(model.id, { id: model.id, catalogId: model.id,
        status: interrupted ? 'paused' : item.status,
        downloadedBytes: Math.max(0, Math.min(Number(item.downloadedBytes) || 0, model.downloadBytes)),
        totalBytes: model.downloadBytes, error: interrupted ? 'Download interrupted when the app closed. Retry to resume.' : String(item.error || ''),
        startedAt: item.startedAt || null, updatedAt: new Date().toISOString() });
    }
    // Our receipt records a verified hash plus file metadata. Unchanged files need only
    // a stat on startup; old receipts and changed files are hashed again. No network is used.
    for (const model of this.catalog.values()) {
      try {
        const dir = await this._directory(model, false);
        const receiptFile = path.join(dir, 'installed.json');
        if (!await regularStat(receiptFile)) continue;
        const receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
        if (receipt.catalogId !== model.id || receipt.files?.length !== model.files.length) continue;
        const stats = [];
        for (const [index, file] of model.files.entries()) {
          const local = path.join(dir, fileName(file));
          const stat = await regularStat(local);
          const recorded = receipt.files[index];
          if (recorded.sha256 !== file.sha256 || recorded.revision !== file.revision || recorded.size !== file.size || !stat || stat.size !== file.size) throw new Error('Installed model verification failed.');
          if (recorded.mtimeMs !== stat.mtimeMs && await sha256(local) !== file.sha256) throw new Error('Installed model verification failed.');
          stats.push({ size: stat.size, mtimeMs: stat.mtimeMs });
        }
        this.installed.set(model.id, stats);
        this.jobs.set(model.id, { id: model.id, catalogId: model.id, status: 'completed', downloadedBytes: model.downloadBytes, totalBytes: model.downloadBytes, error: '', startedAt: this.jobs.get(model.id)?.startedAt || null, updatedAt: new Date().toISOString() });
      } catch (error) {
        if (error.code !== 'ENOENT' && this.jobs.get(model.id)?.status === 'completed') {
          Object.assign(this.jobs.get(model.id), { status: 'failed', error: 'Installed files are missing or failed verification. Retry the download.' });
        }
      }
    }
    for (const job of this.jobs.values()) if (job.status === 'completed' && !this.installed.has(job.catalogId)) Object.assign(job, { status: 'failed', error: 'Installed files are missing or failed verification. Retry the download.' });
    await this._save();
    return this.snapshot();
  }

  snapshot() { return [...this.jobs.values()].map(copy); }

  async start(catalogId) {
    const model = this.catalog.get(catalogId);
    if (!model) throw new Error('Unknown model catalog ID.');
    await this.init();
    if (this.closed) throw new Error('The download manager is closed.');
    const prior = this.jobs.get(catalogId);
    if (prior && (activeStatuses.has(prior.status) || this.installed.has(catalogId))) return copy(prior);
    const now = new Date().toISOString();
    const job = { id: catalogId, catalogId, status: 'queued', downloadedBytes: prior?.downloadedBytes || 0, totalBytes: model.downloadBytes, error: '', startedAt: now, updatedAt: now };
    this.jobs.set(catalogId, job);
    await this._changed();
    // The transfer runs independently of the HTTP request that enqueued it.
    this._pump();
    return copy(job);
  }

  async cancel(id) {
    await this.init();
    const job = this.jobs.get(id);
    if (!job) throw new Error('Unknown download.');
    if (this.running?.id === id) this.running.controller.abort();
    if (activeStatuses.has(job.status) || job.status === 'paused') {
      Object.assign(job, { status: 'cancelled', error: 'Download cancelled. Partial files are kept for retry.', updatedAt: new Date().toISOString() });
      await this._changed();
    }
    return copy(job);
  }

  async close() {
    this.closed = true;
    if (this.running) {
      this.running.paused = true;
      this.running.controller.abort();
      await this.running.promise;
    }
    for (const job of this.jobs.values()) if (activeStatuses.has(job.status)) Object.assign(job, { status: 'paused', error: 'Download interrupted when the app closed. Retry to resume.' });
    await this._save();
  }

  async installedModels() {
    await this.init();
    const models = [];
    for (const [id, cached] of this.installed) {
      const model = this.catalog.get(id);
      try {
        const dir = await this._directory(model, false);
        for (const [i, file] of model.files.entries()) {
          const full = path.join(dir, fileName(file));
          const stat = await regularStat(full);
          if (!stat || stat.size !== file.size) throw new Error('Installed model file is missing.');
          if (stat.mtimeMs !== cached[i].mtimeMs) {
            if (await sha256(full) !== file.sha256) throw new Error('Installed model file failed verification.');
            cached[i] = { size: stat.size, mtimeMs: stat.mtimeMs };
          }
        }
        models.push({ id: `catalog:${id}`, catalogId: id, name: model.name, kind: model.kind,
          file: path.join(dir, fileName(model.files[0])), relativePath: `models/${id}/${fileName(model.files[0])}`, size: model.downloadBytes,
          description: model.description, bestFor: [...model.bestFor], profile: model.profile ? copy(model.profile) : null, issue: '', available: true, validation: 'Download verified' });
      } catch (error) {
        this.installed.delete(id);
        const job = this.jobs.get(id);
        if (job) Object.assign(job, { status: 'failed', error: error.message });
      }
    }
    return models;
  }

  async _directory(model, create = true) {
    if (!safeName(model.id)) throw new Error('Unsafe model ID.');
    const dir = path.join(this.root, model.id);
    if (create) await fs.mkdir(dir, { recursive: true });
    const stat = await fs.lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || path.dirname(await fs.realpath(dir)) !== this.realRoot) throw new Error('Model storage contains an unsafe directory.');
    for (const file of model.files) if (!safeName(fileName(file))) throw new Error('Unsafe model filename.');
    return dir;
  }

  _save() { return this.store.write('downloads', this.snapshot()); }
  async _changed() {
    await this._save();
    try { await this.onChange(this.snapshot()); } catch { /* UI subscribers cannot fail a transfer. */ }
  }

  _pump() {
    if (this.closed || this.running) return;
    const job = [...this.jobs.values()].find(item => item.status === 'queued');
    if (!job) return;
    const running = { id: job.id, controller: new AbortController(), paused: false, promise: null };
    this.running = running;
    running.promise = this._run(job, running).catch(() => {}).finally(() => {
      this.running = null;
      this._pump();
    });
  }

  async _request(url, { signal, headers = {} } = {}) {
    let current = trustedUrl(url);
    for (let i = 0; i < 7; i++) {
      checkAbort(signal);
      const response = await this.fetch(current, { signal, headers, redirect: 'manual' });
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        // An injected/custom fetch implementation must not silently follow unsafe redirects either.
        if (response.url) trustedUrl(response.url);
        return response;
      }
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('The model host returned an invalid redirect.');
      current = trustedUrl(new URL(location, current).href);
    }
    throw new Error('The model host returned too many redirects.');
  }

  async _metadata(model, signal) {
    const checked = new Map();
    for (const file of model.files) {
      const key = `${file.repo}/${file.revision}`;
      if (!checked.has(key)) {
        const response = await this._request(`https://huggingface.co/api/models/${file.repo}/revision/${file.revision}?blobs=true`, { signal });
        if (!response.ok) throw new Error(`Cannot verify model metadata (HTTP ${response.status}).`);
        checked.set(key, await response.json());
      }
      const info = checked.get(key);
      const upstream = info.siblings?.find(item => item.rfilename === file.path);
      if (info.sha !== file.revision || upstream?.size !== file.size || upstream?.lfs?.sha256 !== file.sha256) throw new Error('Upstream model metadata does not match the pinned catalog. Download stopped.');
    }
  }

  async _run(job, running) {
    const model = this.catalog.get(job.catalogId), signal = running.controller.signal;
    try {
      const dir = await this._directory(model);
      Object.assign(job, { status: 'downloading', error: '', downloadedBytes: 0 });
      await this._changed();
      await this._metadata(model, signal);
      let completedBytes = 0;
      for (const file of model.files) {
        checkAbort(signal);
        const target = path.join(dir, fileName(file)), partial = target + '.part';
        const existing = await regularStat(target);
        if (existing && existing.size === file.size && await sha256(target, signal) === file.sha256) {
          completedBytes += file.size; job.downloadedBytes = completedBytes; continue;
        }
        // Invalid final files are never reused as partials.
        if (existing) await fs.unlink(target);
        let offset = (await regularStat(partial))?.size || 0;
        if (offset > file.size) { await fs.unlink(partial); offset = 0; }
        job.downloadedBytes = completedBytes + offset;
        await this._changed();
        if (offset < file.size) {
          const response = await this._request(fileUrl(file), { signal, headers: offset ? { Range: `bytes=${offset}-` } : {} });
          if (response.status !== 200 && response.status !== 206) throw new Error(`Model download failed (HTTP ${response.status}). Retry to resume.`);
          if (!response.body) throw new Error('The model host returned no file data.');
          if (response.status === 206) {
            const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
            if (!range || Number(range[1]) !== offset || Number(range[2]) !== file.size - 1 || Number(range[3]) !== file.size) throw new Error('The model host returned an invalid resume range.');
          } else if (offset) {
            await fs.truncate(partial, 0); offset = 0;
          }
          const length = response.headers.get('content-length');
          if (length !== null && Number(length) !== file.size - offset) throw new Error('Model download size does not match the pinned catalog.');
          const handle = await fs.open(partial, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | (constants.O_NOFOLLOW || 0), 0o600);
          let lastUpdate = 0;
          try {
            for await (const chunk of response.body) {
              checkAbort(signal);
              if (offset + chunk.length > file.size) throw new Error('Model download exceeded its expected size.');
              // FileHandle.write can write fewer bytes than requested, particularly on a full disk.
              let written = 0;
              while (written < chunk.length) {
                const result = await handle.write(chunk, written, chunk.length - written);
                if (!result.bytesWritten) throw new Error('Cannot write model data to disk.');
                written += result.bytesWritten;
              }
              offset += chunk.length;
              job.downloadedBytes = completedBytes + offset;
              if (Date.now() - lastUpdate > 250) { lastUpdate = Date.now(); await this._changed(); }
            }
            await handle.sync();
          } finally { await handle.close(); }
        }
        checkAbort(signal);
        job.status = 'verifying'; await this._changed();
        if (offset !== file.size || await sha256(partial, signal) !== file.sha256) {
          await fs.unlink(partial).catch(() => {});
          job.downloadedBytes = completedBytes;
          throw new Error('Model file failed size or SHA256 verification. Retry to download it again.');
        }
        await fs.rename(partial, target);
        completedBytes += file.size;
        job.downloadedBytes = completedBytes; job.status = 'downloading';
      }
      checkAbort(signal);
      const verifiedStats = await Promise.all(model.files.map(async file => { const stat = await regularStat(path.join(dir, fileName(file))); return { size: stat.size, mtimeMs: stat.mtimeMs }; }));
      const receipt = { catalogId: model.id, verifiedAt: new Date().toISOString(), files: model.files.map((file, index) => ({ name: fileName(file), size: file.size, sha256: file.sha256, revision: file.revision, mtimeMs: verifiedStats[index].mtimeMs })) };
      const receiptTmp = path.join(dir, 'installed.json.tmp'), receiptTarget = path.join(dir, 'installed.json');
      await regularStat(receiptTmp); await regularStat(receiptTarget);
      const receiptHandle = await fs.open(receiptTmp, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW || 0), 0o600);
      try { await receiptHandle.writeFile(JSON.stringify(receipt)); await receiptHandle.sync(); } finally { await receiptHandle.close(); }
      await fs.rename(receiptTmp, receiptTarget);
      this.installed.set(model.id, verifiedStats);
      Object.assign(job, { status: 'completed', downloadedBytes: model.downloadBytes, error: '' });
    } catch (error) {
      Object.assign(job, { status: signal.aborted ? (running.paused ? 'paused' : 'cancelled') : 'failed',
        error: signal.aborted ? (running.paused ? 'Download interrupted when the app closed. Retry to resume.' : abortError().message) : error.code === 'ENOSPC' ? 'Not enough disk space. Free space and retry to resume.' : error.message });
    }
    job.updatedAt = new Date().toISOString();
    try { await this._changed(); } catch (error) {
      job.status = 'failed'; job.error = `Cannot save download state: ${error.message}`;
      try { await this.onChange(this.snapshot()); } catch {}
    }
  }
}
