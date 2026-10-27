import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Store } from './store.mjs';
import { discoverLibrary, findRuntime } from './platform.mjs';
import { scanLibrary } from './registry.mjs';
import { Llama } from './llama.mjs';
import { LlamaPool } from './llama-pool.mjs';
import { generateMedia, mediaInputMode, validateMediaInput } from './engines.mjs';
import { runAgent } from './agent.mjs';
import { catalogModels, defaultOrchestratorId } from './catalog.mjs';
import { DownloadManager } from './downloads.mjs';
import { ensureChatRuntime, findSystemChatRuntime } from './runtime-setup.mjs';
import { PipelineManager, validatePipeline } from './pipelines.mjs';
import { createPipelineExecutor, validatePipelineModel } from './pipeline-executor.mjs';
import { MemoryMonitor, estimateModelBytes } from './memory.mjs';
const exec = promisify(execFile);
const defaultModelKinds = { chat: 'chat', code: 'chat', image: 'image', upscale: 'upscale', video: 'video', transcribe: 'transcribe' };
const defaultModes = ['agent', ...Object.keys(defaultModelKinds)];
const defaults = { mainAgentModelId: '', defaultMode: 'agent', defaultModels: {}, agentMaxSteps: 4, agentTimeoutSeconds: 600, libraryRoot: '', backend: 'auto', systemPrompt: 'You are TIM, a capable local AI assistant. Help users choose suitable local models, explain their strengths and memory needs, and be clear, practical, and accurate.', temperature: 0.7, maxTokens: 1024, context: 4096, scanlines: false };
const numeric = (value, fallback, min, max, integer = true) => { const n = value === undefined ? fallback : Number(value); if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new Error(`Value must be ${integer ? 'an integer ' : ''}between ${min} and ${max}.`); return n; };
const waitForLoad = (promise, signal) => new Promise((resolve, reject) => {
  signal.throwIfAborted();
  const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason || new Error('Cancelled')); };
  signal.addEventListener('abort', abort, { once: true });
  Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
});
export function jobSettings(body, kind, model) {
  const s = body.settings || {};
  const video = kind === 'video';
  const width = numeric(s.width, model?.profile?.width || 512, 64, 2048), height = numeric(s.height, model?.profile?.height || (video ? 288 : 512), 64, 2048);
  if (width % 32 || height % 32) throw new Error('Dimensions must be multiples of 32.');
  const frames = numeric(s.frames, 33, 5, 121);
  if ((frames - 1) % 4) throw new Error('Video frames must be 4n + 1.');
  return { prompt: String(body.prompt || '').trim(), negativePrompt: String(s.negativePrompt || ''), width, height, frames, steps: s.steps === undefined ? undefined : numeric(s.steps, 20, 1, 100), cfg: s.cfg === undefined ? undefined : numeric(s.cfg, 7, 0, 30, false), seed: numeric(s.seed, -1, -1, 2147483647) };
}
export class Studio extends EventEmitter {
  constructor(dataDir) {
    super(); this.dataDir = dataDir; this.store = new Store(dataDir); this.sessions = []; this.jobs = []; this.registry = { models: [], runtimes: {} }; this.active = null; this.closing = false;
    this.workDir = path.join(dataDir, 'work'); this.outputDir = path.join(dataDir, 'outputs'); this.uploadDir = path.join(dataDir, 'uploads'); this.llama = new LlamaPool(this.workDir); this.generateMedia = args => this.runMedia(args); this.gpu = null;
    this.orchestrator = new Llama(this.workDir); this.catalog = catalogModels; this.memoryMonitor = new MemoryMonitor();
    this.lifecycle = new AbortController(); this.runtimeSetup = { status: 'idle' }; this.guideState = {};
    this.downloads = new DownloadManager(dataDir, { onChange: jobs => this.downloadChanged(jobs) });
    this.pipelines = new PipelineManager(dataDir, { executeStep: createPipelineExecutor(this), validateModel: node => validatePipelineModel(this, node), onChange: () => this.pipelineChanged() });
  }
  async init() {
    await Promise.all([this.workDir, this.outputDir, this.uploadDir].map(d => fs.mkdir(d, { recursive: true })));
    this.config = { ...defaults, ...await this.store.read('settings', {}) };
    this.sessions = await this.store.read('sessions', []);
    this.jobs = await this.store.read('jobs', []);
    await this.downloads.init();
    await this.pipelines.init();
    for (const j of this.jobs) if (['queued', 'running'].includes(j.status)) { j.status = 'interrupted'; j.phase = 'Interrupted when the app closed. Submit again to retry.'; const m = this.sessions.find(s => s.id === j.sessionId)?.messages.find(m => m.jobId === j.id); if (m) m.status = 'interrupted'; for (const child of j.children || []) if (['queued', 'running'].includes(child.status)) { child.status = 'interrupted'; child.phase = 'Interrupted when the app closed.'; } if (m && j.children) m.steps = j.children; }
    await this.rescan(); await this.persist();
    await this.telemetry(); this.telemetryTimer = setInterval(() => this.telemetry(), 5000); this.telemetryTimer.unref();
  }
  async rescan() {
    if (this.active || this.loadingModel) throw new Error('Wait for the current job before scanning models.');
    this.libraryRoot = await discoverLibrary(this.config.libraryRoot);
    this.registry = await scanLibrary(this.libraryRoot, this.dataDir, this.config.backend);
    this.registry.runtimes.chat ||= await findSystemChatRuntime(this.config.backend);
    await this.refreshDownloadedModels();
    for (const model of this.registry.models) {
      const job = this.jobs.find(j => j.modelId === model.id && j.platform === process.platform && j.arch === process.arch && ['completed', 'failed'].includes(j.status));
      if (job) model.validation = job.status === 'completed' ? 'Ran successfully' : 'Last run failed';
    }
    this.changed(); return this.registry;
  }
  async refreshDownloadedModels() {
    const downloaded = await this.downloads.installedModels();
    for (const model of downloaded) {
      if (!this.registry.runtimes[model.kind]) { model.available = false; model.issue = `Install a ${{ chat: 'chat', transcribe: 'Whisper speech', image: 'image generation', video: 'video', upscale: 'upscaling' }[model.kind] || model.kind} engine pack for ${process.platform}/${process.arch}.`; }
      const prior = this.registry.models.find(m => m.id === model.id);
      if (prior?.validation === 'Ran successfully' || prior?.validation === 'Last run failed') model.validation = prior.validation;
    }
    this.registry.models = [...this.registry.models.filter(model => !model.catalogId), ...downloaded];
    const guide = this.registry.models.find(model => model.catalogId === defaultOrchestratorId);
    if (!this.config.mainAgentModelId && guide) {
      this.config.mainAgentModelId = guide.id;
      await this.store.write('settings', this.config);
    }
    this.changed();
  }
  downloadChanged(jobs) {
    this.changed();
    const signature = jobs.filter(job => job.status === 'completed').map(job => job.id).sort().join(',');
    if (signature === this.completedDownloads) return;
    this.completedDownloads = signature;
    this.modelSync = (this.modelSync || Promise.resolve()).catch(() => {}).then(() => this.refreshDownloadedModels()).catch(error => { this.guideState = { status: 'error', error: error.message }; this.changed(); });
  }
  guideSnapshot() {
    const configuredId = this.config?.mainAgentModelId;
    const model = this.registry.models.find(m => m.id === configuredId);
    const entry = this.catalog.find(c => c.id === model?.catalogId || c.id === (configuredId?.startsWith('catalog:') ? configuredId.slice(8) : !configuredId ? defaultOrchestratorId : null));
    const catalogId = model?.catalogId || entry?.id || '';
    const loaded = Boolean(this.orchestrator.modelId && this.orchestrator.modelId === model?.id);
    const download = this.downloads.snapshot().find(d => d.catalogId === catalogId);
    const status = loaded ? 'running' : this.guideState.status === 'loading' ? 'loading' : this.guideState.error ? 'error' : !model ? 'not-installed' : !model.available ? 'needs-runtime' : 'ready';
    const estimatedBytes = estimateModelBytes(model, this.catalog);
    return { catalogId, modelId: configuredId || undefined, name: model?.name || entry?.name, loaded, status, error: this.guideState.error || (configuredId && this.guideSelectionError()) || (download?.status === 'failed' ? download.error : undefined), memoryGB: estimatedBytes ? estimatedBytes / 2 ** 30 : entry?.memoryGB };
  }
  guideSelectionError() {
    const model = this.registry.models.find(m => m.id === this.config.mainAgentModelId && m.kind === 'chat');
    if (!model) return 'Your selected default agent is no longer installed. Reconnect its model library or choose another agent in Settings.';
    if (!model.available || !this.registry.runtimes.chat) return `${model.name} is not ready: ${model.issue || 'a compatible chat engine is required'}. Set up this model or choose another agent in Settings.`;
    return null;
  }
  async setupGuide() {
    if (this.setupPromise) return;
    if (this.config.mainAgentModelId) {
      const error = this.guideSelectionError();
      if (error) { this.guideState = { status: 'error', error }; this.changed(); return; }
      await this.warmGuide();
      return;
    }
    this.runtimeSetup = { status: 'downloading', progress: 0 }; this.guideState = {}; this.changed();
    // Setup runs in the background so the catalog and progress remain usable.
    this.setupPromise = (async () => {
      try {
        await ensureChatRuntime(this.dataDir, this.libraryRoot, { signal: this.lifecycle.signal, onChange: state => { this.runtimeSetup = state; this.changed(); } });
        if (!this.registry.runtimes.chat) this.registry.runtimes.chat = await findRuntime(this.libraryRoot, 'chat', this.config.backend, this.dataDir) || await findSystemChatRuntime(this.config.backend);
        await this.downloads.start(defaultOrchestratorId);
        while (!this.closing) {
          this.lifecycle.signal.throwIfAborted();
          const job = this.downloads.snapshot().find(d => d.catalogId === defaultOrchestratorId);
          if (job?.status === 'completed') break;
          if (['failed', 'cancelled', 'paused'].includes(job?.status)) throw new Error(job.error || 'Guide setup paused. Retry to continue.');
          await new Promise(resolve => setTimeout(resolve, 150));
        }
        if (this.closing) return;
        await this.modelSync;
        await this.refreshDownloadedModels();
        await this.warmGuide();
      } catch (error) {
        if (!this.closing) { this.runtimeSetup = { status: 'error', error: error.message }; this.guideState = { status: 'error', error: error.message }; this.changed(); }
      } finally { this.setupPromise = null; }
    })();
  }
  async startDefaultGuide() {
    if (this.config.mainAgentModelId) {
      const error = this.guideSelectionError();
      if (error) { this.guideState = { status: 'error', error }; this.changed(); return; }
      this.warmGuide().catch(error => { this.guideState = { status: 'error', error: error.message }; this.changed(); });
    }
    else {
      const prior = this.downloads.snapshot().find(d => d.catalogId === defaultOrchestratorId);
      if (prior && ['cancelled', 'paused', 'failed'].includes(prior.status)) { this.guideState = { status: 'error', error: prior.error || 'Guide setup paused. Retry to continue.' }; this.changed(); }
      else await this.setupGuide();
    }
  }
  async warmGuide() {
    if (this.closing) return;
    const error = this.guideSelectionError();
    if (error) throw new Error(error);
    const model = this.registry.models.find(m => m.id === this.config.mainAgentModelId);
    await this.loadOrchestrator(model, this.lifecycle.signal, () => this.changed());
  }
  async loadOrchestrator(model, signal, update) {
    this.orchestrator.fixedContext = true;
    if (this.guideLoadPromise) await waitForLoad(this.guideLoadPromise, signal);
    signal.throwIfAborted();
    if (!model?.available || !this.registry.runtimes.chat) throw new Error('The TIM guide needs an installed model and chat engine.');
    this.guideState = { status: 'loading' }; this.changed();
    this.guideLoadPromise = (async () => {
      try {
        const runtime = await findRuntime(this.libraryRoot, 'chat', 'cpu', this.dataDir) || await findSystemChatRuntime('cpu') || this.registry.runtimes.chat;
        await this.sampleMemory(); this.assertModelMemory(model, { role: 'guide' });
        await this.orchestrator.load(model, { ...runtime, backend: 'cpu', threads: Math.min(4, os.availableParallelism()) }, signal, update, 4096, true);
        this.guideState = { status: 'running' };
      } catch (error) { this.guideState = { status: 'error', error: error.message }; throw error; }
      finally { this.guideLoadPromise = null; this.changed(); }
    })();
    await this.guideLoadPromise;
  }
  async loadModel(id) {
    if (this.active || this.loadingModel || this.guideLoadPromise || this.jobs.some(j => j.status === 'queued')) throw new Error('Finish or cancel current work before loading a model.');
    const model = this.registry.models.find(m => m.id === id && m.available);
    if (!model || model.kind !== 'chat') throw new Error('Choose an installed chat or code model. Media models load when used.');
    this.loadingModel = true; this.changed();
    this.manualLoadPromise = (async () => {
      if (id === this.config.mainAgentModelId) await this.loadOrchestrator(model, this.lifecycle.signal, () => this.changed());
      else { await this.loadChat(model, this.lifecycle.signal, () => this.changed()); this.llama.pin?.(id); }
      await this.sampleMemory();
    })();
    try {
      await this.manualLoadPromise;
    } finally {
      this.loadingModel = false; this.manualLoadPromise = null; this.changed();
      if (!this.closing) queueMicrotask(() => this.drain().catch(error => this.emit('error', error)));
    }
  }
  async unloadModel(id) {
    if (this.active || this.loadingModel || this.guideLoadPromise || this.jobs.some(j => j.status === 'queued')) throw new Error('Finish or cancel current work before unloading.');
    if (id && id === this.config.mainAgentModelId) throw new Error('The lightweight TIM guide stays loaded. Other models can be unloaded.');
    this.loadingModel = true; this.changed();
    try {
      if (!id) { await this.unloadSpecialists(); await this.pipelineAgent?.unload(); }
      else {
        if (this.llama.has?.(id) || this.llama.modelId === id) await this.llama.unload(id);
        if (this.pipelineAgent?.modelId === id) await this.pipelineAgent.unload();
      }
      await this.sampleMemory();
    } finally { this.loadingModel = false; this.changed(); }
  }
  async unloadSpecialists() {
    if (this.llama.unloadAll) await this.llama.unloadAll(); else await this.llama.unload();
  }
  async releaseSpecialist() {
    if (this.llama.release) await this.llama.release(); else await this.llama.unload();
  }
  assertModelMemory(model, { role = 'specialist' } = {}) {
    const guideModel = this.registry.models.find(m => m.id === this.config.mainAgentModelId);
    const guide = this.catalog.find(c => c.id === guideModel?.catalogId) || this.catalog.find(c => c.defaultOrchestrator);
    const instances = this.llama.instances?.() || [];
    const residents = [
      { engine: this.orchestrator, role: 'guide' },
      ...(this.llama.instances ? instances : [{ engine: this.llama }]).map(item => ({ ...item, role: 'specialist' })),
      { engine: this.pipelineAgent, role: 'pipeline-agent' },
      { engine: this.mediaEngine, role: 'media' }
    ].filter(item => item.engine?.modelId);
    // Different roles can load the same weights into distinct processes. Only
    // the exact process being reused/replaced is excluded from the total.
    const replacing = item => item.role === role && (role !== 'specialist' || item.engine.modelId === model?.id);
    const otherBytes = residents.filter(item => !replacing(item)).reduce((sum, item) => sum + (estimateModelBytes(this.registry.models.find(m => m.id === item.engine.modelId), this.catalog) || .5 * 2 ** 30), 0);
    const guideReserve = role !== 'guide' && !residents.some(item => item.role === 'guide') ? (estimateModelBytes(guideModel, this.catalog) || (guide?.memoryGB || 1) * 2 ** 30) : 0;
    const required = estimateModelBytes(model, this.catalog) || .5 * 2 ** 30;
    if (required + guideReserve + otherBytes + 2 ** 30 > os.totalmem()) throw new Error(`${model.name} needs more room alongside TIM and the loaded models. Choose a smaller model or unload another model.`);
    const { memory } = this.memoryMonitor.snapshot(this.loadedEngines());
    const alreadyLoaded = residents.some(item => replacing(item) && item.engine.modelId === model?.id);
    if (!alreadyLoaded && memory.sampledAt && !memory.stale && required > memory.modelBudgetBytes) throw new Error(`${model.name} needs about ${(required / 2 ** 30).toFixed(1)} GiB, but only ${(memory.modelBudgetBytes / 2 ** 30).toFixed(1)} GiB is available after the safety buffer. Unload a model or close other apps before loading it.`);
  }
  pipelineChanged() {
    for (const run of this.pipelines.runs) {
      const job = this.jobs.find(item => item.pipelineRunId === run.id);
      if (!job) continue;
      const current = run.nodeRuns.find(node => node.nodeId === run.activeNodeId);
      const completed = run.nodeRuns.filter(node => node.status === 'completed').length;
      job.phase = current ? `${completed + 1}/${run.nodeRuns.length} · ${current.phase}` : run.error || (run.status === 'paused' ? 'Paused between steps' : run.status === 'queued' ? 'Queued' : `${completed}/${run.nodeRuns.length} steps complete`);
      job.progress = Math.round((completed + (current?.progress || 0)) / run.nodeRuns.length * 100);
    }
    this.changed();
  }
  validatePipeline(value) { return validatePipeline(value); }
  async runPipeline({ pipelineId, input = '', attachments = [] }) {
    if (this.closing) throw new Error('TIM Studio is closing.');
    if (this.loadingModel) throw new Error('Wait for the selected model to finish loading.');
    if (!Array.isArray(attachments) || attachments.length > 16) throw new Error('Choose at most 16 uploaded attachments.');
    for (const name of attachments) {
      if (typeof name !== 'string' || path.basename(name) !== name || /[\\/\0]/.test(name) || !/\.(png|jpg|jpeg|webp|wav|txt|md|js|ts|py|json|csv|html|css)$/i.test(name)) throw new Error('Choose an uploaded image, WAV, text or code file.');
      const file = await fs.lstat(path.join(this.uploadDir, name));
      if (!file.isFile() || file.isSymbolicLink()) throw new Error('Choose a valid uploaded attachment.');
    }
    const run = await this.pipelines.createRun({ pipelineId, input, attachments });
    this.jobs.unshift({ id: run.id, pipelineRunId: run.id, kind: 'pipeline', modelName: run.pipelineName, status: 'queued', phase: 'Queued', progress: 0, createdAt: new Date(run.createdAt).toISOString(), platform: process.platform, arch: process.arch });
    await this.persist(); this.changed(); this.drain().catch(error => this.emit('error', error)); return run;
  }
  async pausePipeline(id) {
    const run = await this.pipelines.pause(id);
    const job = this.jobs.find(item => item.pipelineRunId === id);
    if (job?.status === 'queued') { job.status = 'paused'; job.phase = 'Paused between steps'; }
    await this.persist(); this.changed(); return run;
  }
  async resumePipeline(id) {
    if (this.closing) throw new Error('TIM Studio is closing.');
    if (this.loadingModel) throw new Error('Wait for the selected model to finish loading.');
    const run = await this.pipelines.resume(id);
    let job = this.jobs.find(item => item.pipelineRunId === id);
    if (!job) job = { id: run.id, pipelineRunId: run.id, kind: 'pipeline', modelName: run.pipelineName, createdAt: new Date().toISOString(), platform: process.platform, arch: process.arch };
    Object.assign(job, { status: 'queued', phase: 'Queued to resume', progress: run.nodeRuns.filter(node => node.status === 'completed').length / run.nodeRuns.length * 100 });
    delete job.finishedAt;
    this.jobs = [job, ...this.jobs.filter(item => item.id !== job.id)];
    await this.persist(); this.changed(); this.drain().catch(error => this.emit('error', error)); return run;
  }
  async cancelPipeline(id) {
    const run = await this.pipelines.cancel(id);
    if (this.active?.job.pipelineRunId === id) this.active.controller.abort(new Error('Pipeline cancelled.'));
    const job = this.jobs.find(item => item.pipelineRunId === id);
    if (job && !['running', 'completed', 'failed'].includes(job.status)) { job.status = 'cancelled'; job.phase = 'Cancelled'; job.finishedAt = Date.now(); }
    await this.persist(); this.changed(); return run;
  }
  async drainPipeline(job, controller) {
    job.status = 'running'; job.startedAt ||= Date.now(); job.phase = 'Preparing pipeline'; this.changed();
    try {
      const run = await this.pipelines.execute(job.pipelineRunId, controller.signal);
      if (this.closing && controller.signal.aborted && run.status === 'cancelled') {
        run.status = 'interrupted'; run.error = 'Interrupted when the app closed. Resume explicitly to continue unfinished steps.';
        delete run.finishedAt;
        for (const step of run.nodeRuns) if (step.status === 'cancelled') { step.status = 'pending'; step.phase = 'Interrupted before completion'; }
        await this.pipelines.changed();
      }
      job.status = run.status; job.phase = run.error || (run.status === 'paused' ? 'Paused between steps' : run.status === 'completed' ? 'Pipeline complete' : run.status);
      if (run.status === 'completed') job.progress = 100;
      if (run.finishedAt) job.finishedAt = run.finishedAt;
    } catch (error) { job.status = controller.signal.aborted ? 'cancelled' : 'failed'; job.phase = error.message; job.finishedAt = Date.now(); }
    finally {
      this.active = null; await this.persist(); this.changed();
      if (!this.closing) queueMicrotask(() => this.drain().catch(error => this.emit('error', error)));
    }
  }
  loadedEngines() {
    const entries = [
      { engine: this.orchestrator, role: 'guide' },
      ...(this.llama.instances?.() || [{ engine: this.llama }]).map(entry => ({ ...entry, role: 'specialist' })),
      { engine: this.pipelineAgent, role: 'pipeline-agent' },
      { engine: this.mediaEngine, role: 'media' }
    ];
    const seen = new Set();
    return entries.flatMap(entry => {
      const child = entry.engine?.child;
      const model = this.registry.models.find(model => model.id === entry.engine?.modelId);
      if (!model || !child || child.exitCode !== null || child.signalCode !== null || seen.has(child)) return [];
      seen.add(child);
      return [{ ...entry, model }];
    });
  }
  async sampleMemory() {
    this.memoryMonitor.catalog = this.catalog;
    await this.memoryMonitor.sample(this.loadedEngines());
    this.changed();
    // Refresh the live collection in case a child exited while it was measured.
    return this.memoryMonitor.snapshot(this.loadedEngines());
  }
  async runMedia(args) {
    validateMediaInput(args.kind, args.model, args.input);
    await this.sampleMemory(); this.assertModelMemory(args.model, { role: 'media' });
    const engine = { modelId: args.model.id, child: null };
    this.mediaEngine = engine;
    try { return await generateMedia({ ...args, onProcess: child => { engine.child = child; this.changed(); } }); }
    finally { if (this.mediaEngine === engine) this.mediaEngine = null; this.changed(); }
  }
  async telemetry() {
    await Promise.all([this.sampleMemory(), (async () => { try {
      const { stdout } = await exec('nvidia-smi', ['--query-gpu=name,memory.total,memory.used,utilization.gpu', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 2500 });
      const [name, total, used, utilization] = stdout.trim().split('\n')[0].split(',').map(x => x.trim());
      this.gpu = { name, total: Number(total), used: Number(used), utilization: Number(utilization) };
    } catch { this.gpu = null; } })()]);
    this.changed();
  }
  snapshot() {
    const pipelineState = this.pipelines.snapshot();
    this.memoryMonitor.catalog = this.catalog;
    const memoryState = this.memoryMonitor.snapshot(this.loadedEngines());
    return { platform: process.platform, arch: process.arch, hostname: os.hostname(), ...memoryState, gpu: this.gpu, libraryRoot: this.libraryRoot, dataDir: this.dataDir, config: this.config,
      models: this.registry.models.map(({ file, profile, ...rest }) => ({ ...rest, ...(rest.kind === 'image' ? { inputMode: mediaInputMode(rest.kind, { profile }), requiresReference: Boolean(profile?.requiresReference) } : {}), defaults: profile && { steps: profile.steps, cfg: profile.cfg, width: profile.width, height: profile.height } })),
      engines: Object.fromEntries(Object.entries(this.registry.runtimes).map(([kind, r]) => [kind, r ? { available: true, backend: r.backend } : { available: false }])),
      sessions: this.sessions, jobs: this.jobs, loadedModelId: this.llama.modelId, loadingModel: Boolean(this.loadingModel),
      catalog: this.catalog.map(({ files, ...entry }) => { const model = this.registry.models.find(m => m.catalogId === entry.id); return { ...entry, bundleFiles: files?.length || 0, ...(entry.kind === 'image' ? { inputMode: mediaInputMode(entry.kind, entry), requiresReference: Boolean(entry.profile?.requiresReference) } : {}), installed: Boolean(model), modelId: model?.id, issue: model?.issue || '' }; }),
      downloads: this.downloads.snapshot(), orchestrator: this.guideSnapshot(), runtimeSetup: this.runtimeSetup,
      pipelines: pipelineState.definitions, pipelineRuns: pipelineState.runs, pipelineAgentModelId: this.pipelineAgent?.modelId || null };
  }
  changed() { if (this.changeTimer) return; this.changeTimer = setTimeout(() => { this.changeTimer = null; this.emit('state', this.snapshot()); }, 75); }
  async persist() { await this.store.write('sessions', this.sessions); await this.store.write('jobs', this.jobs); }
  validateDefaultModels(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Default models must be a map of modes to installed model IDs.');
    const result = {};
    for (const [mode, modelId] of Object.entries(value)) {
      if (!Object.hasOwn(defaultModelKinds, mode) || typeof modelId !== 'string' || !modelId) throw new Error('Choose a supported mode and an installed default model.');
      const model = this.registry.models.find(m => m.id === modelId && m.kind === defaultModelKinds[mode]);
      // A disconnected drive must not erase or prevent saving an existing preference.
      if (!model?.available && this.config.defaultModels?.[mode] !== modelId) throw new Error(`Choose an installed, available ${defaultModelKinds[mode]} model for ${mode}.`);
      result[mode] = modelId;
    }
    return result;
  }
  async setDefaultModel({ mode, modelId } = {}) {
    if (!defaultModes.includes(mode)) throw new Error('Choose a supported default mode.');
    const kind = mode === 'agent' ? 'chat' : defaultModelKinds[mode];
    if (typeof modelId !== 'string' || !modelId || !this.registry.models.some(m => m.id === modelId && m.kind === kind && m.available)) throw new Error(`Choose an installed, available ${kind} model for ${mode}.`);
    if (mode === 'agent') await this.updateSettings({ mainAgentModelId: modelId, defaultMode: mode });
    else {
      // Preferences may change during inference; queued jobs retain their selected ID.
      this.config = { ...this.config, defaultMode: mode, defaultModels: { ...this.config.defaultModels, [mode]: modelId } };
      await this.store.write('settings', this.config);
      this.changed();
    }
    return { defaultMode: this.config.defaultMode, defaultModels: this.config.defaultModels, mainAgentModelId: this.config.mainAgentModelId };
  }
  async updateSettings(values) {
    if (this.active || this.loadingModel || this.guideLoadPromise || this.jobs.some(j => j.status === 'queued')) throw new Error('Finish or cancel jobs before changing engine settings.');
    const next = { ...this.config };
    if (values.mainAgentModelId !== undefined) {
      if (typeof values.mainAgentModelId !== 'string' || (values.mainAgentModelId && values.mainAgentModelId !== this.config.mainAgentModelId && !this.registry.models.some(m => m.id === values.mainAgentModelId && m.kind === 'chat' && m.available))) throw new Error('Select an available chat model for the main agent.');
      next.mainAgentModelId = values.mainAgentModelId;
    }
    if (values.defaultMode !== undefined) {
      if (!defaultModes.includes(values.defaultMode)) throw new Error('Choose a supported default mode.');
      next.defaultMode = values.defaultMode;
    }
    if (values.defaultModels !== undefined) next.defaultModels = this.validateDefaultModels(values.defaultModels);
    if (values.agentMaxSteps !== undefined) next.agentMaxSteps = numeric(values.agentMaxSteps, 4, 1, 8);
    if (values.agentTimeoutSeconds !== undefined) next.agentTimeoutSeconds = numeric(values.agentTimeoutSeconds, 600, 30, 1800);
    if (values.libraryRoot !== undefined) next.libraryRoot = String(values.libraryRoot);
    if (values.systemPrompt !== undefined) next.systemPrompt = String(values.systemPrompt);
    if (values.backend !== undefined) { if (!['auto', 'cpu', 'cuda', 'vulkan', 'metal'].includes(values.backend)) throw new Error('Unknown backend'); next.backend = values.backend; }
    if (values.temperature !== undefined) next.temperature = numeric(values.temperature, 0.7, 0, 2, false);
    if (values.maxTokens !== undefined) next.maxTokens = numeric(values.maxTokens, 1024, 1, 8192);
    if (values.context !== undefined) next.context = numeric(values.context, 4096, 512, 32768);
    if (values.scanlines !== undefined) next.scanlines = Boolean(values.scanlines);
    if (next.maxTokens >= next.context) throw new Error('Response tokens must be smaller than the context window.');
    if (next.mainAgentModelId !== this.config.mainAgentModelId) { await this.orchestrator.unload(); this.guideState = {}; }
    await this.unloadSpecialists(); await this.pipelineAgent?.unload(); this.config = next; await this.store.write('settings', next); await this.rescan(); this.changed();
    if (this.config.mainAgentModelId) this.warmGuide().catch(error => { this.guideState = { status: 'error', error: error.message }; this.changed(); });
  }
  async newSession() {
    const session = { id: randomUUID(), title: 'New session', createdAt: new Date().toISOString(), messages: [] };
    this.sessions.unshift(session); await this.persist(); this.changed(); return session;
  }
  async enqueue(body) {
    if (this.loadingModel) throw new Error('Wait for the selected model to finish loading.');
    const kind = body.kind === 'code' ? 'chat' : body.kind;
    if (!['agent', 'chat', 'image', 'video', 'transcribe', 'upscale'].includes(kind)) throw new Error('Choose an available mode.');
    const modelId = kind === 'agent' ? this.config.mainAgentModelId : body.modelId === undefined ? this.config.defaultModels?.[body.kind] : body.modelId;
    const model = this.registry.models.find(m => m.id === modelId && m.kind === (kind === 'agent' ? 'chat' : kind));
    if (kind === 'agent' && (!model?.available || !this.registry.runtimes.chat)) throw new Error('Choose an available main agent model in Settings. Native tool-call support must be validated for that model.');
    if (!model?.available) throw new Error(model?.issue || 'Select a compatible model.');
    const settings = jobSettings(body, kind, model);
    if (!settings.prompt && !['transcribe', 'upscale'].includes(kind)) throw new Error('Enter a prompt.');
    if (settings.prompt.length > 100000) throw new Error('Prompt is too large.');
    const attachments = [];
    for (const name of body.attachments || []) {
      if (typeof name !== 'string' || path.basename(name) !== name) throw new Error('Invalid attachment');
      const file = path.join(this.uploadDir, name);
      await fs.access(file);
      const extension = path.extname(name).toLowerCase();
      if (kind === 'agent' && !['.txt', '.md', '.js', '.ts', '.py', '.json', '.csv', '.html', '.css', '.png', '.jpg', '.jpeg', '.webp', '.wav'].includes(extension)) throw new Error('Unsupported agent attachment.');
      if (kind === 'chat' && !['.txt', '.md', '.js', '.ts', '.py', '.json', '.csv', '.html', '.css'].includes(extension)) throw new Error('Chat attachments currently support text and code files. Use Image mode to edit an image.');
      if (['image', 'video', 'upscale'].includes(kind) && !['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) throw new Error('Attach a PNG, JPEG, or WebP image.');
      if (kind === 'transcribe' && extension !== '.wav') throw new Error('Transcription currently accepts WAV audio.');
      attachments.push(name);
    }
    if (['transcribe', 'upscale'].includes(kind) && !attachments.length) throw new Error('This mode needs an attached file.');
    if (!['chat', 'agent'].includes(kind) && attachments.length > 1) throw new Error('This workflow accepts one attachment at a time.');
    validateMediaInput(kind, model, attachments[0]);
    let session = this.sessions.find(s => s.id === body.sessionId);
    if (!session) session = await this.newSession();
    const id = randomUUID();
    if (!session.messages.length) session.title = (settings.prompt || `${kind} recording`).slice(0, 48);
    session.messages.push({ id: randomUUID(), role: 'user', content: settings.prompt || (kind === 'upscale' ? 'Upscale this image 4×.' : 'Transcribe this recording.'), attachments, createdAt: new Date().toISOString() });
    session.messages.push({ id: randomUUID(), role: 'assistant', content: '', jobId: id, model: model.name, kind, status: 'queued', createdAt: new Date().toISOString() });
    const job = { id, sessionId: session.id, modelId: model.id, modelName: model.name, kind, settings, attachments, platform: process.platform, arch: process.arch, status: 'queued', phase: 'Queued', progress: null, createdAt: new Date().toISOString() };
    this.jobs.unshift(job); await this.persist(); this.changed(); this.drain().catch(e => this.emit('error', e)); return job;
  }
  async loadChat(model, signal, update, toolCalling = false) {
    if (!model?.available || !this.registry.runtimes.chat) throw new Error('Chat model or runtime is unavailable.');
    if (this.llama.modelId && this.llama.modelId !== model.id) await this.releaseSpecialist();
    await this.sampleMemory();
    this.assertModelMemory(model);
    try { await this.llama.load(model, this.registry.runtimes.chat, signal, update, this.config.context, toolCalling); }
    catch (error) {
      if (signal.aborted || this.config.backend !== 'auto' || this.registry.runtimes.chat.backend === 'cpu') throw error;
      const cpu = await findRuntime(this.libraryRoot, 'chat', 'cpu', this.dataDir) || await findSystemChatRuntime('cpu');
      if (!cpu) throw error;
      update('GPU initialization failed; trying CPU.');
      await this.llama.load(model, cpu, signal, update, this.config.context, toolCalling);
      this.registry.runtimes.chat = cpu;
    }
  }
  async drain() {
    if (this.active || this.closing || this.loadingModel) return;
    const job = [...this.jobs].reverse().find(j => j.status === 'queued' && (!j.pipelineRunId || this.pipelines.runs.find(run => run.id === j.pipelineRunId)?.status === 'queued'));
    if (!job) return;
    const controller = new AbortController(); this.active = { job, controller };
    if (job.kind === 'pipeline') { await this.drainPipeline(job, controller); return; }
    let timedOut = false;
    const timer = job.kind === 'agent' ? setTimeout(() => { timedOut = true; controller.abort(new Error('Main agent turn timed out.')); }, (this.config.agentTimeoutSeconds ?? 600) * 1000) : null;
    const model = this.registry.models.find(m => m.id === job.modelId);
    const session = this.sessions.find(s => s.id === job.sessionId);
    const message = session.messages.find(m => m.jobId === job.id);
    job.status = message.status = 'running'; job.startedAt = Date.now(); job.phase = 'Preparing engine…'; this.changed();
    try {
      await this.pipelineAgent?.unload();
      if (!model) throw new Error('Model is no longer available.');
      if (['chat', 'agent'].includes(job.kind)) {
        const update = phase => { job.phase = phase; this.changed(); };
        if (job.kind === 'chat') await this.loadChat(model, controller.signal, update);
        const history = [];
        for (const m of session.messages.slice(0, session.messages.indexOf(message))) {
          if (m.role === 'assistant' && m.status !== 'completed') continue;
          let content = m.content;
          for (const name of m.attachments || []) if (/\.(txt|md|js|ts|py|json|csv|html|css)$/i.test(name)) content += '\n\nAttached file:\n' + (await fs.readFile(path.join(this.uploadDir, name), 'utf8')).slice(0, 60000);
          if (content) history.push({ role: m.role, content });
        }
        job.phase = 'Generating response';
        if (job.kind === 'agent') await runAgent(this, job, message, history, controller.signal);
        else await this.llama.generate([{ role: 'system', content: this.config.systemPrompt }, ...history], { ...this.config, enableThinking: false }, controller.signal, token => { message.content += token; this.changed(); }, usage => {
          if (usage.removedMessages > 0) { job.contextUsage = usage; message.contextUsage = usage; this.changed(); }
        });
        if (!message.content.trim()) throw new Error('The model returned no answer. Try again or choose a different model.');
      } else {
        await this.releaseSpecialist(); job.phase = 'Loading engine…'; this.changed();
        const result = await this.generateMedia({ kind: job.kind, model, runtime: this.registry.runtimes[job.kind], settings: job.settings, input: job.attachments[0] && path.join(this.uploadDir, job.attachments[0]), workDir: this.workDir, outputDir: this.outputDir, id: job.id, signal: controller.signal, onOutput: text => {
          const percent = [...text.matchAll(/(\d+(?:\.\d+)?)%/g)].at(-1);
          const steps = [...text.matchAll(/(\d+)\s*\/\s*(\d+)\s*[-|]/g)].at(-1);
          if (percent) job.progress = Math.min(99, Number(percent[1]));
          if (steps && Number(steps[2]) === (job.settings.steps || model.profile?.steps)) job.progress = Math.min(99, Math.round(Number(steps[1]) / Number(steps[2]) * 90));
          job.phase = job.progress === null ? 'Engine working…' : `Processing · ${job.progress}%`; this.changed();
        } });
        message.content = result.text; message.artifact = result.artifact;
        await fs.writeFile(path.join(this.outputDir, job.id + '.json'), JSON.stringify({ model: model.name, settings: job.settings, createdAt: job.createdAt, artifact: result.artifact }, null, 2));
      }
      if (controller.signal.aborted) throw new Error('Cancelled');
      job.status = message.status = 'completed'; job.phase = 'Complete'; job.progress = 100; model.validation = 'Ran successfully';
    } catch (error) {
      job.status = message.status = controller.signal.aborted && !timedOut ? 'cancelled' : 'failed';
      job.phase = timedOut ? 'Main agent turn timed out.' : controller.signal.aborted ? 'Cancelled' : error.message;
      message.error = job.phase;
      if (model && !controller.signal.aborted) model.validation = 'Last run failed';
      if (['chat', 'agent'].includes(job.kind)) await this.releaseSpecialist();
    } finally {
      clearTimeout(timer); job.finishedAt = Date.now(); this.active = null; await this.persist(); this.changed();
      if (!this.closing) queueMicrotask(() => this.drain().catch(e => this.emit('error', e)));
    }
  }
  async cancel(id) {
    const job = this.jobs.find(j => j.id === id);
    if (!job) throw new Error('Job not found.');
    if (job.pipelineRunId) return this.cancelPipeline(job.pipelineRunId);
    if (job.status === 'queued') { job.status = 'cancelled'; job.phase = 'Cancelled'; const m = this.sessions.find(s => s.id === job.sessionId)?.messages.find(m => m.jobId === id); if (m) m.status = 'cancelled'; }
    if (this.active?.job.id === id) this.active.controller.abort(new Error('Cancelled'));
    await this.persist(); this.changed();
  }
  async close() {
    this.closing = true; this.lifecycle.abort(); clearInterval(this.telemetryTimer); this.active?.controller.abort();
    await this.downloads.close(); await this.setupPromise; await this.modelSync; await this.guideLoadPromise?.catch(() => {});
    await this.manualLoadPromise?.catch(() => {});
    await this.unloadSpecialists(); await this.pipelineAgent?.unload(); await this.orchestrator.unload();
    while (this.active) await new Promise(r => setTimeout(r, 50));
    clearTimeout(this.changeTimer); await this.persist();
  }
}
