import { Llama } from './llama.mjs';

const liveChild = child => Boolean(child && child.exitCode == null && child.signalCode == null);

// Inference stays on Studio's serial queue. Each model keeps its own process so
// selecting another specialist does not evict models the user chose to retain.
export class LlamaPool {
  constructor(workDir, createEngine = () => new Llama(workDir)) {
    this.workDir = workDir;
    this.createEngine = createEngine;
    this.models = new Map();
    this.activeId = null;
  }

  isLive(id, record) { return record.engine.modelId === id && liveChild(record.engine.child); }

  prune() {
    for (const [id, record] of this.models) {
      if (!record.loading && !this.isLive(id, record)) this.models.delete(id);
    }
    if (!this.models.has(this.activeId)) this.activeId = null;
  }

  get activeEngine() {
    this.prune();
    const record = this.models.get(this.activeId);
    return record && !record.loading && this.isLive(this.activeId, record) ? record.engine : null;
  }

  get modelId() { return this.activeEngine?.modelId ?? null; }
  get child() { return this.activeEngine?.child ?? null; }
  get toolCalling() { return this.activeEngine?.toolCalling ?? false; }
  get runtimeKey() { return this.activeEngine?.runtimeKey ?? null; }
  get port() { return this.activeEngine?.port; }

  instances() {
    this.prune();
    return [...this.models].filter(([id, record]) => !record.loading && this.isLive(id, record))
      .map(([modelId, { engine, pinned }]) => ({ engine, modelId, pinned }));
  }

  has(id) { return this.instances().some(instance => instance.modelId === id); }
  isPinned(id) { return this.has(id) && this.models.get(id).pinned; }
  pin(id) {
    if (!this.has(id)) return false;
    this.models.get(id).pinned = true;
    return true;
  }

  async load(model, runtime, signal, update, context, toolCalling = false) {
    this.prune();
    const previousId = this.activeId;
    const record = this.models.get(model.id) || { engine: this.createEngine(), pinned: false };
    record.loading = true;
    this.models.set(model.id, record);
    try {
      await record.engine.load(model, runtime, signal, update, context, toolCalling);
      record.loading = false;
      this.activeId = model.id;
    } catch (error) {
      this.models.delete(model.id);
      this.activeId = previousId !== model.id && this.models.has(previousId) ? previousId : null;
      // A partially started process belongs only to this failed load. Other
      // specialists (and the independent guide) remain untouched.
      try { await record.engine.unload(); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], error.message); }
      throw error;
    } finally {
      record.loading = false;
    }
  }

  async generate(...args) {
    const engine = this.activeEngine;
    if (!engine) throw new Error('No specialist model is loaded.');
    return engine.generate(...args);
  }

  async turn(...args) {
    const engine = this.activeEngine;
    if (!engine) throw new Error('No specialist model is loaded.');
    return engine.turn(...args);
  }

  async unload(id = this.activeId) {
    const record = this.models.get(id);
    if (!record) return;
    this.models.delete(id);
    if (this.activeId === id) this.activeId = null;
    await record.engine.unload();
  }

  async release(id = this.activeId) {
    if (!this.isPinned(id)) await this.unload(id);
  }

  async unloadAll() {
    const records = [...this.models.values()];
    this.models.clear();
    this.activeId = null;
    const outcomes = await Promise.allSettled(records.map(({ engine }) => Promise.resolve().then(() => engine.unload())));
    const failures = outcomes.filter(outcome => outcome.status === 'rejected').map(outcome => outcome.reason);
    if (failures.length) throw new AggregateError(failures, 'Some specialist models could not be unloaded.');
  }
}
