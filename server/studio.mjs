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
import { generateMedia } from './engines.mjs';
import { runAgent } from './agent.mjs';
const exec = promisify(execFile);
const defaults = { mainAgentModelId: '', agentMaxSteps: 4, agentTimeoutSeconds: 600, libraryRoot: '', backend: 'auto', systemPrompt: 'You are TIM, a capable local AI assistant. Be clear, practical, and accurate.', temperature: 0.7, maxTokens: 1024, context: 4096, scanlines: false };
const numeric = (value, fallback, min, max, integer = true) => { const n = value === undefined ? fallback : Number(value); if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new Error(`Value must be ${integer ? 'an integer ' : ''}between ${min} and ${max}.`); return n; };
export function jobSettings(body, kind) {
  const s = body.settings || {};
  const video = kind === 'video';
  const width = numeric(s.width, 512, 64, 2048), height = numeric(s.height, video ? 288 : 512, 64, 2048);
  if (width % 32 || height % 32) throw new Error('Dimensions must be multiples of 32.');
  const frames = numeric(s.frames, 33, 5, 121);
  if ((frames - 1) % 4) throw new Error('Video frames must be 4n + 1.');
  return { prompt: String(body.prompt || '').trim(), negativePrompt: String(s.negativePrompt || ''), width, height, frames, steps: s.steps === undefined ? undefined : numeric(s.steps, 20, 1, 100), cfg: s.cfg === undefined ? undefined : numeric(s.cfg, 7, 0, 30, false), seed: numeric(s.seed, -1, -1, 2147483647) };
}
export class Studio extends EventEmitter {
  constructor(dataDir) {
    super(); this.dataDir = dataDir; this.store = new Store(dataDir); this.sessions = []; this.jobs = []; this.registry = { models: [], runtimes: {} }; this.active = null; this.closing = false;
    this.workDir = path.join(dataDir, 'work'); this.outputDir = path.join(dataDir, 'outputs'); this.uploadDir = path.join(dataDir, 'uploads'); this.llama = new Llama(this.workDir); this.generateMedia = generateMedia; this.gpu = null;
  }
  async init() {
    await Promise.all([this.workDir, this.outputDir, this.uploadDir].map(d => fs.mkdir(d, { recursive: true })));
    this.config = { ...defaults, ...await this.store.read('settings', {}) };
    this.sessions = await this.store.read('sessions', []);
    this.jobs = await this.store.read('jobs', []);
    for (const j of this.jobs) if (['queued', 'running'].includes(j.status)) { j.status = 'interrupted'; j.phase = 'Interrupted when the app closed. Submit again to retry.'; const m = this.sessions.find(s => s.id === j.sessionId)?.messages.find(m => m.jobId === j.id); if (m) m.status = 'interrupted'; for (const child of j.children || []) if (['queued', 'running'].includes(child.status)) { child.status = 'interrupted'; child.phase = 'Interrupted when the app closed.'; } if (m && j.children) m.steps = j.children; }
    await this.rescan(); await this.persist();
    await this.telemetry(); this.telemetryTimer = setInterval(() => this.telemetry(), 5000); this.telemetryTimer.unref();
  }
  async rescan() {
    if (this.active) throw new Error('Wait for the current job before scanning models.');
    this.libraryRoot = await discoverLibrary(this.config.libraryRoot);
    this.registry = await scanLibrary(this.libraryRoot, this.dataDir, this.config.backend);
    for (const model of this.registry.models) {
      const job = this.jobs.find(j => j.modelId === model.id && j.platform === process.platform && j.arch === process.arch && ['completed', 'failed'].includes(j.status));
      if (job) model.validation = job.status === 'completed' ? 'Ran successfully' : 'Last run failed';
    }
    this.changed(); return this.registry;
  }
  async telemetry() {
    try {
      const { stdout } = await exec('nvidia-smi', ['--query-gpu=name,memory.total,memory.used,utilization.gpu', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 2500 });
      const [name, total, used, utilization] = stdout.trim().split('\n')[0].split(',').map(x => x.trim());
      this.gpu = { name, total: Number(total), used: Number(used), utilization: Number(utilization) };
    } catch { this.gpu = null; }
    this.changed();
  }
  snapshot() {
    return { platform: process.platform, arch: process.arch, hostname: os.hostname(), memory: { total: os.totalmem(), free: os.freemem() }, gpu: this.gpu, libraryRoot: this.libraryRoot, dataDir: this.dataDir, config: this.config,
      models: this.registry.models.map(({ file, profile, ...rest }) => ({ ...rest, defaults: profile && { steps: profile.steps, cfg: profile.cfg } })),
      engines: Object.fromEntries(Object.entries(this.registry.runtimes).map(([kind, r]) => [kind, r ? { available: true, backend: r.backend } : { available: false }])),
      sessions: this.sessions, jobs: this.jobs, loadedModelId: this.llama.modelId };
  }
  changed() { if (this.changeTimer) return; this.changeTimer = setTimeout(() => { this.changeTimer = null; this.emit('state', this.snapshot()); }, 75); }
  async persist() { await this.store.write('sessions', this.sessions); await this.store.write('jobs', this.jobs); }
  async updateSettings(values) {
    if (this.active || this.jobs.some(j => j.status === 'queued')) throw new Error('Finish or cancel jobs before changing engine settings.');
    const next = { ...this.config };
    if (values.mainAgentModelId !== undefined) {
      if (typeof values.mainAgentModelId !== 'string' || (values.mainAgentModelId && !this.registry.models.some(m => m.id === values.mainAgentModelId && m.kind === 'chat' && m.available))) throw new Error('Select an available chat model for the main agent.');
      next.mainAgentModelId = values.mainAgentModelId;
    }
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
    await this.llama.unload(); this.config = next; await this.store.write('settings', next); await this.rescan(); this.changed();
  }
  async newSession() {
    const session = { id: randomUUID(), title: 'New session', createdAt: new Date().toISOString(), messages: [] };
    this.sessions.unshift(session); await this.persist(); this.changed(); return session;
  }
  async enqueue(body) {
    const kind = body.kind === 'code' ? 'chat' : body.kind;
    if (!['agent', 'chat', 'image', 'video', 'transcribe', 'upscale'].includes(kind)) throw new Error('Choose an available mode.');
    const model = this.registry.models.find(m => m.id === (kind === 'agent' ? this.config.mainAgentModelId : body.modelId) && m.kind === (kind === 'agent' ? 'chat' : kind));
    if (kind === 'agent' && (!model?.available || !this.registry.runtimes.chat)) throw new Error('Choose an available main agent model in Settings. Native tool-call support must be validated for that model.');
    if (!model?.available) throw new Error(model?.issue || 'Select a compatible model.');
    const settings = jobSettings(body, kind);
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
    try { await this.llama.load(model, this.registry.runtimes.chat, signal, update, this.config.context, toolCalling); }
    catch (error) {
      if (signal.aborted || this.config.backend !== 'auto' || this.registry.runtimes.chat.backend === 'cpu') throw error;
      const cpu = await findRuntime(this.libraryRoot, 'chat', 'cpu', this.dataDir);
      if (!cpu) throw error;
      update('GPU initialization failed; trying CPU.');
      await this.llama.load(model, cpu, signal, update, this.config.context, toolCalling);
      this.registry.runtimes.chat = cpu;
    }
  }
  async drain() {
    if (this.active || this.closing) return;
    const job = [...this.jobs].reverse().find(j => j.status === 'queued');
    if (!job) return;
    const controller = new AbortController(); this.active = { job, controller };
    let timedOut = false;
    const timer = job.kind === 'agent' ? setTimeout(() => { timedOut = true; controller.abort(new Error('Main agent turn timed out.')); }, (this.config.agentTimeoutSeconds ?? 600) * 1000) : null;
    const model = this.registry.models.find(m => m.id === job.modelId);
    const session = this.sessions.find(s => s.id === job.sessionId);
    const message = session.messages.find(m => m.jobId === job.id);
    job.status = message.status = 'running'; job.startedAt = Date.now(); job.phase = 'Preparing engine…'; this.changed();
    try {
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
        else await this.llama.generate([{ role: 'system', content: this.config.systemPrompt }, ...history], this.config, controller.signal, token => { message.content += token; this.changed(); });
      } else {
        await this.llama.unload(); job.phase = 'Loading engine…'; this.changed();
        const result = await generateMedia({ kind: job.kind, model, runtime: this.registry.runtimes[job.kind], settings: job.settings, input: job.attachments[0] && path.join(this.uploadDir, job.attachments[0]), workDir: this.workDir, outputDir: this.outputDir, id: job.id, signal: controller.signal, onOutput: text => {
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
      if (['chat', 'agent'].includes(job.kind)) await this.llama.unload();
    } finally {
      clearTimeout(timer); job.finishedAt = Date.now(); this.active = null; await this.persist(); this.changed();
      if (!this.closing) queueMicrotask(() => this.drain().catch(e => this.emit('error', e)));
    }
  }
  async cancel(id) {
    const job = this.jobs.find(j => j.id === id);
    if (!job) throw new Error('Job not found.');
    if (job.status === 'queued') { job.status = 'cancelled'; job.phase = 'Cancelled'; const m = this.sessions.find(s => s.id === job.sessionId)?.messages.find(m => m.jobId === id); if (m) m.status = 'cancelled'; }
    if (this.active?.job.id === id) this.active.controller.abort(new Error('Cancelled'));
    await this.persist(); this.changed();
  }
  async close() {
    this.closing = true; clearInterval(this.telemetryTimer); this.active?.controller.abort(); await this.llama.unload();
    while (this.active) await new Promise(r => setTimeout(r, 50));
    clearTimeout(this.changeTimer); await this.persist();
  }
}
