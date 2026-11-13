import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getModelRecommendations } from '../cli/model-recommendations.mjs';
import { catalogModels } from '../server/catalog.mjs';
import { DownloadManager } from '../server/downloads.mjs';
import { estimateModelBytes, readHostMemory } from '../server/memory.mjs';
import { ensureChatRuntime, runtimeAssets } from '../server/runtime-setup.mjs';
import { Store } from '../server/store.mjs';

const exec = promisify(execFile);
const terminalStatuses = new Set(['completed', 'failed', 'cancelled', 'paused']);
const categories = {
  chat: 'Chat & Code', image: 'Image', video: 'Video', transcribe: 'Speech to Text', upscale: 'Upscale'
};
const mediaEngines = {
  image: 'stable-diffusion.cpp image',
  video: 'stable-diffusion.cpp video',
  transcribe: 'Whisper',
  upscale: 'Real-ESRGAN'
};

async function osVersion(platform) {
  if (platform === 'darwin') {
    try {
      const { stdout } = await exec('/usr/bin/sw_vers', ['-productVersion'], { timeout: 3000 });
      if (stdout.trim()) return stdout.trim();
    } catch { /* Use the kernel release when the product version is unavailable. */ }
  }
  return os.release();
}

export async function getInstallerHardware() {
  const { platform, arch } = process;
  const [memory, version] = await Promise.all([readHostMemory(), osVersion(platform)]);
  return {
    platform,
    arch,
    osVersion: version,
    cpuName: os.cpus()[0]?.model || 'CPU',
    logicalCores: os.availableParallelism(),
    memory,
    runtimeSupported: Object.hasOwn(runtimeAssets, `${platform}-${arch}`)
  };
}

export function getInstallerModels(hardware) {
  const { options, memory } = getModelRecommendations({ catalog: catalogModels, hardware, memory: hardware?.memory });
  const chatOptions = new Map(options.map(option => [option.id, option]));
  const reasons = {
    comfortable: 'Fits the current memory estimate with headroom.',
    tight: 'Fits the current estimate with less room for other apps or longer conversations.',
    'too-large': 'Needs more memory than the current model budget.',
    unknown: memory.notice
  };
  return catalogModels.map(model => {
    const { id, name, description, kind, downloadBytes, memoryGB } = model;
    const chat = chatOptions.get(id);
    const unavailable = kind === 'chat' && hardware?.runtimeSupported === false;
    const fit = chat?.fit ?? mediaFit(model, memory);
    const engine = mediaEngines[kind] || kind;
    const reason = unavailable
      ? `Automatic chat engine setup is unavailable on this system. ${reasons[fit]}`
      : chat?.reason || reasons[fit];
    return {
      id, name, description, kind, category: categories[kind] || kind, downloadBytes, memoryGB, fit, reason,
      suggested: Boolean(chat?.suggested && !unavailable),
      ...(kind === 'chat' ? {} : { engineRequirement: `Requires a separate compatible ${engine} engine. Connect an engine pack in TIM Studio Settings.` })
    };
  });
}

function mediaFit(model, memory) {
  const estimatedBytes = estimateModelBytes(model);
  if (estimatedBytes === null || memory.modelBudgetBytes === null) return 'unknown';
  if (estimatedBytes > memory.modelBudgetBytes) return 'too-large';
  if (memory.comfortableBudgetBytes !== null && estimatedBytes <= memory.comfortableBudgetBytes) return 'comfortable';
  return 'tight';
}

function starterSettings(settings, firstModelId) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('TIM settings must be a JSON object.');
  const previousDefaults = settings.defaultModels ?? {};
  if (typeof previousDefaults !== 'object' || Array.isArray(previousDefaults)) throw new Error('TIM model defaults must be a JSON object.');
  const defaultModels = { ...previousDefaults };
  for (const mode of ['chat', 'code']) {
    if (!Object.hasOwn(defaultModels, mode)) defaultModels[mode] = `catalog:${firstModelId}`;
  }
  const defaultMode = Object.hasOwn(settings, 'defaultMode') ? settings.defaultMode : 'chat';
  const changed = defaultMode !== settings.defaultMode || Object.keys(defaultModels).length !== Object.keys(previousDefaults).length;
  return { next: { ...settings, defaultMode, defaultModels }, changed };
}

// DownloadManager notifies after persisting each state transition. Wait for its
// terminal event instead of assuming that enqueueing or reaching 100% verifies a model.
async function waitForModel(manager, model, subscribe, onJob, signal) {
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const abort = () => finish(null);
  subscribe(jobs => {
    const job = jobs.find(item => item.catalogId === model.id);
    if (!job) return;
    if (terminalStatuses.has(job.status)) finish(job);
    onJob(job);
  });
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    const start = await manager.start(model.id);
    if (start.status === 'completed') {
      onJob(start);
      finish(start);
    }
    const result = await done;
    signal?.throwIfAborted();
    if (result.status !== 'completed') throw new Error(`${model.name}: ${result.error || `Download ${result.status}.`}`);
  } finally {
    signal?.removeEventListener('abort', abort);
    subscribe(() => {});
  }
}

// The installer core owns exclusive access to this app data directory while
// this runs. Desktop and CLI use these same receipts, weights and runtimes.
export async function installStarterModels(dataDir, modelIds = [], {
  signal, onProgress = () => {}, portable = false, catalog = catalogModels, fetchImpl = globalThis.fetch,
  prepareRuntime = ensureChatRuntime
} = {}) {
  if (!Array.isArray(modelIds)) throw new Error('Choose starter models from the TIM catalog.');
  const knownModels = new Map(catalog.map(model => [model.id, model]));
  const selected = [...new Set(modelIds)].map(id => {
    const model = knownModels.get(id);
    if (!model) throw new Error('Choose starter models from the TIM catalog.');
    return model;
  });
  signal?.throwIfAborted();
  if (!selected.length) return { installedModelIds: [], runtimeInstalled: false, defaults: null };

  const report = event => {
    try { Promise.resolve(onProgress(event)).catch(() => {}); }
    catch { /* A progress display cannot interrupt a transfer. */ }
  };
  const store = new Store(dataDir);
  const firstChat = selected.find(model => model.kind === 'chat');
  const settings = firstChat ? starterSettings(await store.read('settings', {}), firstChat.id) : null;
  let downloadChanged = () => {};
  const manager = new DownloadManager(dataDir, { catalog, fetchImpl, onChange: jobs => downloadChanged(jobs) });
  await manager.init();
  try {
    signal?.throwIfAborted();
    if (firstChat) {
      report({ phase: 'runtime', status: 'preparing' });
      await prepareRuntime(dataDir, null, {
        signal, managedOnly: portable,
        onChange: ({ phase: detail, ...event }) => report({ ...event, phase: 'runtime', ...(detail ? { detail } : {}) })
      });
    }
    for (const [index, model] of selected.entries()) {
      await waitForModel(manager, model, listener => { downloadChanged = listener; }, job => {
        report({
          ...job, phase: 'model', modelId: model.id, name: model.name, index: index + 1, count: selected.length,
          progress: Math.floor(job.downloadedBytes / job.totalBytes * 100)
        });
      }, signal);
    }
    signal?.throwIfAborted();
    if (settings?.changed) await store.write('settings', settings.next);
    const defaults = settings?.next;
    return {
      installedModelIds: selected.map(model => model.id),
      runtimeInstalled: Boolean(firstChat),
      defaults: defaults ? { defaultMode: defaults.defaultMode, defaultModels: defaults.defaultModels, mainAgentModelId: defaults.mainAgentModelId || '' } : null
    };
  } finally {
    // On abort the manager closes the current transfer and retains its .part
    // file and paused receipt, which the next installer run can resume.
    await manager.close();
  }
}
