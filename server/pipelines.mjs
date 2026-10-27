import { randomUUID } from 'node:crypto';
import { Store } from './store.mjs';

export const PIPELINE_NODE_TYPES = ['input', 'agent', 'chat', 'code', 'image', 'video', 'upscale', 'transcribe', 'load', 'unload'];
export const PIPELINE_LIMITS = Object.freeze({ nodes: 32, input: 12000, prompt: 12000, result: 64000, context: 32000, expandedPrompt: 64000 });
const terminal = new Set(['completed', 'failed', 'cancelled']);
const modelTypes = new Set(['chat', 'code', 'image', 'video', 'upscale', 'transcribe', 'load']);
const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const unsafeIds = new Set(['__proto__', 'prototype', 'constructor']);
const copy = value => structuredClone(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const only = (value, keys, label) => { if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error(`${label} contains unsupported fields.`); };
const bounded = (value, max, label, fallback = '') => { if (value === undefined) return fallback; if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw new Error(`${label} must be text of at most ${max} characters.`); return value; };
const idValue = (value, label) => { if (typeof value !== 'string' || !identifier.test(value) || unsafeIds.has(value)) throw new Error(`${label} must be a safe identifier of at most 80 characters.`); return value; };
const frozen = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(frozen); Object.freeze(value); } return value; };

const settingRanges = {
  width: [64, 2048, true], height: [64, 2048, true], steps: [1, 100, true], cfg: [0, 30], frames: [5, 121, true], seed: [-1, 2147483647, true],
  temperature: [0, 2], maxTokens: [1, 8192, true], context: [512, 32768, true], agentMaxSteps: [1, 8, true], agentTimeoutSeconds: [1, 1800]
};
function settingsValue(value = {}) {
  only(value, [...Object.keys(settingRanges), 'negativePrompt'], 'Step settings');
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'negativePrompt') { result[key] = bounded(item, 4000, 'Negative prompt'); continue; }
    const [min, max, integer] = settingRanges[key];
    if (typeof item !== 'number' || !Number.isFinite(item) || item < min || item > max || (integer && !Number.isInteger(item))) throw new Error(`Setting ${key} must be ${integer ? 'an integer ' : ''}between ${min} and ${max}.`);
    if (['width', 'height'].includes(key) && item % 32) throw new Error('Dimensions must be multiples of 32.');
    if (key === 'frames' && (item - 1) % 4) throw new Error('Video frames must be 4n + 1.');
    result[key] = item;
  }
  if (result.context && result.maxTokens && result.maxTokens >= result.context) throw new Error('Response tokens must be smaller than the context window.');
  return result;
}

function variables(text) {
  const names = [];
  const remainder = text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, name) => { names.push(name.trim()); return ''; });
  if (remainder.includes('{{') || remainder.includes('}}')) throw new Error('Malformed pipeline variable. Use {{input}} or {{steps.step-id.output}}.');
  return names;
}

export function pipelineOrder(nodes) {
  const byId = new Map(nodes.map(node => [node.id, node])), visited = new Set(), visiting = new Set(), order = [];
  const visit = node => {
    if (visited.has(node.id)) return;
    if (visiting.has(node.id)) throw new Error('Pipeline contains a dependency cycle.');
    visiting.add(node.id);
    for (const dependency of node.dependsOn) {
      if (!byId.has(dependency)) throw new Error(`Step ${node.id} depends on unknown step ${dependency}.`);
      visit(byId.get(dependency));
    }
    visiting.delete(node.id); visited.add(node.id); order.push(node);
  };
  nodes.forEach(visit);
  return order;
}

function ancestorIds(node, nodes) {
  const byId = new Map(nodes.map(item => [item.id, item])), ancestors = new Set();
  const visit = id => { if (ancestors.has(id)) return; ancestors.add(id); byId.get(id).dependsOn.forEach(visit); };
  node.dependsOn.forEach(visit);
  return ancestors;
}

// A pipeline is literal, bounded data. It cannot introduce new executable capabilities.
export function validatePipeline(value, { existing } = {}) {
  only(value, ['id', 'schemaVersion', 'name', 'description', 'nodes', 'createdAt', 'updatedAt'], 'Pipeline');
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) throw new Error('Unsupported pipeline schema version.');
  const name = bounded(value.name, 120, 'Pipeline name').trim();
  if (!name) throw new Error('Pipeline name is required.');
  if (!Array.isArray(value.nodes) || !value.nodes.length || value.nodes.length > PIPELINE_LIMITS.nodes) throw new Error(`A pipeline needs between 1 and ${PIPELINE_LIMITS.nodes} steps.`);
  const ids = new Set();
  const nodes = value.nodes.map((node, index) => {
    only(node, ['id', 'name', 'type', 'modelId', 'prompt', 'systemPrompt', 'inputRef', 'dependsOn', 'position', 'settings', 'memoryPolicy'], 'Pipeline step');
    const id = idValue(node.id, 'Step ID');
    if (ids.has(id)) throw new Error(`Duplicate step ID: ${id}.`);
    ids.add(id);
    if (!PIPELINE_NODE_TYPES.includes(node.type)) throw new Error(`Unsupported step type: ${node.type}.`);
    if (!Array.isArray(node.dependsOn ?? []) || (node.dependsOn || []).length > PIPELINE_LIMITS.nodes) throw new Error(`Step ${id} dependencies must be an array.`);
    const dependsOn = (node.dependsOn || []).map(item => idValue(item, 'Dependency'));
    if (new Set(dependsOn).size !== dependsOn.length) throw new Error(`Step ${id} has duplicate dependencies.`);
    if (dependsOn.includes(id)) throw new Error(`Step ${id} cannot depend on itself.`);
    const position = node.position ?? { x: index * 280, y: 160 };
    only(position, ['x', 'y'], 'Step position');
    if (['x', 'y'].some(key => typeof position[key] !== 'number' || !Number.isFinite(position[key]) || Math.abs(position[key]) > 100000)) throw new Error('Step positions must be finite coordinates within 100000.');
    const memoryPolicy = node.memoryPolicy || 'auto';
    if (!['auto', 'keep', 'unload'].includes(memoryPolicy)) throw new Error('Unsupported step memory policy.');
    const result = { id, name: bounded(node.name, 120, 'Step name', node.type).trim() || node.type, type: node.type, modelId: bounded(node.modelId, 500, 'Step model'), prompt: bounded(node.prompt, PIPELINE_LIMITS.prompt, 'Step prompt'), dependsOn, position: { ...position }, settings: settingsValue(node.settings), memoryPolicy };
    if (node.systemPrompt !== undefined) result.systemPrompt = bounded(node.systemPrompt, PIPELINE_LIMITS.prompt, 'Step system prompt');
    if (node.inputRef !== undefined) { result.inputRef = bounded(node.inputRef, 255, 'Step input reference'); if (/[\\/\r\n]/.test(result.inputRef) || ['.', '..'].includes(result.inputRef)) throw new Error('Step input reference must identify an uploaded attachment or ancestor result.'); }
    return result;
  });
  pipelineOrder(nodes);
  for (const node of nodes) {
    const ancestors = ancestorIds(node, nodes);
    if (node.inputRef && ids.has(node.inputRef) && !ancestors.has(node.inputRef)) throw new Error(`Step ${node.id} may only reference input from an ancestor step (${node.inputRef}).`);
    for (const variable of [...variables(node.prompt), ...variables(node.systemPrompt || '')]) {
      if (variable === 'input') continue;
      const match = /^steps\.([A-Za-z0-9][A-Za-z0-9_-]{0,79})\.output$/.exec(variable);
      if (!match) throw new Error(`Unknown pipeline variable: ${variable}.`);
      if (!ids.has(match[1])) throw new Error(`Variable references unknown step ${match[1]}.`);
      if (!ancestors.has(match[1])) throw new Error(`Step ${node.id} may only reference output from an ancestor step (${match[1]}).`);
    }
  }
  const now = Date.now();
  return { id: value.id === undefined ? randomUUID() : idValue(value.id, 'Pipeline ID'), schemaVersion: 1, name, description: bounded(value.description, 4000, 'Pipeline description'), nodes, createdAt: existing?.createdAt || now, updatedAt: now };
}

function attachmentNames(value = []) {
  if (!Array.isArray(value) || value.length > 16 || value.some(name => typeof name !== 'string' || !name || name.length > 255 || /[\\/\0\r\n]/.test(name) || name === '.' || name === '..')) throw new Error('Pipeline attachments must be uploaded filenames (at most 16).');
  return [...new Set(value)];
}

function resultValue(value) {
  if (!plain(value)) throw new Error('Step returned an invalid result.');
  const result = { text: typeof value.text === 'string' ? value.text.slice(0, PIPELINE_LIMITS.result) : '' };
  if (value.artifact !== undefined) {
    if (!plain(value.artifact) || typeof value.artifact.filename !== 'string' || /[\\/\0\r\n]/.test(value.artifact.filename) || ['.', '..', ''].includes(value.artifact.filename) || value.artifact.filename.length > 255) throw new Error('Step returned an invalid artifact filename.');
    const artifact = { filename: value.artifact.filename, kind: bounded(value.artifact.kind, 32, 'Artifact kind', 'file') };
    if (Number.isFinite(value.artifact.size) && value.artifact.size >= 0) artifact.size = value.artifact.size;
    result.artifact = artifact;
  }
  if (value.modelName !== undefined) result.modelName = bounded(value.modelName, 200, 'Model name');
  if (value.steps !== undefined) {
    const serialized = JSON.stringify(value.steps);
    if (!Array.isArray(value.steps) || value.steps.length > 32 || serialized.length > 256000) throw new Error('Step returned excessive agent details.');
    result.steps = JSON.parse(serialized);
  }
  return result;
}

export class PipelineManager {
  constructor(dataDir, { executeStep, onChange = () => {}, validateModel } = {}) {
    this.store = new Store(dataDir); this.executeStep = executeStep; this.onChange = onChange; this.validateModel = validateModel;
    this.definitions = []; this.runs = []; this.executing = new Set(); this.controllers = new Map();
  }

  async init() {
    this.definitions = (await this.store.read('pipelines', [])).map(value => ({ ...validatePipeline(value, { existing: value }), updatedAt: value.updatedAt || Date.now() }));
    this.runs = await this.store.read('pipeline-runs', []);
    for (const run of this.runs) {
      frozen(run.definition);
      if (['queued', 'running'].includes(run.status)) {
        run.status = 'interrupted'; run.error = 'Interrupted when the app closed. Resume explicitly to continue unfinished steps.';
        delete run.activeNodeId; delete run.pauseRequested; delete run.cancelRequested;
        for (const step of run.nodeRuns) if (step.status === 'running') { step.status = 'pending'; step.phase = 'Interrupted before completion'; }
      }
    }
    await this.persist(); return this.snapshot();
  }

  snapshot() { return { definitions: copy(this.definitions), runs: copy(this.runs) }; }
  get(id) { const definition = this.definitions.find(item => item.id === id); if (!definition) throw new Error('Pipeline not found.'); return copy(definition); }
  getRun(id) { const run = this.runs.find(item => item.id === id); if (!run) throw new Error('Pipeline run not found.'); return run; }
  async persist() { await Promise.all([this.store.write('pipelines', this.definitions), this.store.write('pipeline-runs', this.runs)]); }
  async changed() { await this.persist(); this.onChange(this.snapshot()); }

  async save(value) {
    const existing = this.definitions.find(item => item.id === value?.id);
    const definition = validatePipeline(value, { existing });
    if (existing) this.definitions[this.definitions.indexOf(existing)] = definition;
    else this.definitions.push(definition);
    await this.changed(); return copy(definition);
  }

  async remove(id) {
    this.get(id);
    if (this.runs.some(run => run.pipelineId === id && ['queued', 'running', 'paused'].includes(run.status))) throw new Error('Cancel active or paused runs before deleting this pipeline.');
    this.definitions = this.definitions.filter(item => item.id !== id);
    await this.changed();
  }

  async createRun({ pipelineId, input = '', attachments = [] }) {
    const definition = this.get(pipelineId);
    const runInput = bounded(input, PIPELINE_LIMITS.input, 'Pipeline input');
    const names = attachmentNames(attachments);
    for (const node of definition.nodes) {
      if (modelTypes.has(node.type) && !node.modelId) throw new Error(`Choose a model for step ${node.name}.`);
      if (this.validateModel && node.type !== 'input') await this.validateModel(copy(node));
    }
    const run = { id: randomUUID(), pipelineId, pipelineName: definition.name, status: 'queued', input: runInput, attachments: names, definition: frozen(copy(definition)), nodeRuns: definition.nodes.map(node => ({ nodeId: node.id, status: 'pending', phase: 'Waiting' })), createdAt: Date.now() };
    this.runs.unshift(run); await this.changed(); return run;
  }

  async pause(id) {
    const run = this.getRun(id);
    if (run.status === 'running') run.pauseRequested = true;
    else if (run.status === 'queued') run.status = 'paused';
    else if (run.status !== 'paused') throw new Error('Only queued or running pipelines can be paused.');
    await this.changed(); return run;
  }

  async resume(id) {
    const run = this.getRun(id);
    if (this.executing.has(id)) throw new Error('Wait for the current step to finish pausing before resuming.');
    if (!['paused', 'interrupted'].includes(run.status)) throw new Error('Only paused or interrupted pipelines can resume. Start a new run to retry a failed pipeline.');
    const originalStatus = run.status;
    for (const node of run.definition.nodes) if (this.validateModel && node.type !== 'input' && run.nodeRuns.find(step => step.nodeId === node.id)?.status !== 'completed') await this.validateModel(copy(node));
    if (run.status !== originalStatus || this.executing.has(id)) throw new Error('Pipeline changed while preparing to resume.');
    run.status = 'queued'; delete run.error; delete run.pauseRequested; delete run.cancelRequested; delete run.finishedAt;
    for (const step of run.nodeRuns) if (step.status !== 'completed') { step.status = 'pending'; step.phase = 'Waiting'; delete step.error; delete step.text; delete step.artifact; delete step.steps; delete step.startedAt; delete step.finishedAt; delete step.progress; delete step.contextUsage; }
    await this.changed(); return run;
  }

  async cancel(id) {
    const run = this.getRun(id);
    if (terminal.has(run.status)) return run;
    run.cancelRequested = true;
    if (this.executing.has(id)) this.controllers.get(id)?.abort(new Error('Pipeline cancelled.'));
    else {
      run.status = 'cancelled'; run.error = 'Pipeline cancelled.'; run.finishedAt = Date.now(); delete run.pauseRequested;
      for (const step of run.nodeRuns) if (step.status === 'pending') { step.status = 'skipped'; step.phase = 'Cancelled'; }
    }
    await this.changed(); return run;
  }

  contextFor(run, node, signal, onUpdate) {
    const ancestors = ancestorIds(node, run.definition.nodes);
    const priority = [...node.dependsOn, ...ancestors].filter((id, index, list) => list.indexOf(id) === index);
    let remaining = PIPELINE_LIMITS.context;
    const entries = priority.map(id => {
      const source = run.nodeRuns.find(step => step.nodeId === id);
      const text = (source?.text || '').slice(0, Math.min(12000, remaining)); remaining -= text.length;
      const value = { text };
      if (source?.artifact) value.artifact = copy(source.artifact);
      if (source?.modelName) value.modelName = source.modelName;
      const childArtifacts = (source?.steps || []).filter(step => plain(step) && step.status === 'completed' && plain(step.result) && step.result.artifact).map(step => {
        const item = { status: 'completed', result: { artifact: resultValue({ text: '', artifact: step.result.artifact }).artifact } };
        if (typeof step.id === 'string') item.id = step.id.slice(0, 200);
        if (typeof step.kind === 'string') item.kind = step.kind.slice(0, 32);
        return item;
      });
      if (childArtifacts.length) value.steps = childArtifacts;
      return [id, value];
    });
    const results = Object.fromEntries(entries);
    const predecessorText = node.dependsOn.map(id => results[id]?.text ? `[${id}]\n${results[id].text}` : '').filter(Boolean).join('\n\n').slice(0, PIPELINE_LIMITS.context);
    const artifacts = entries.flatMap(([nodeId, value]) => [value.artifact, ...(value.steps || []).map(step => step.result.artifact)].filter(Boolean).map(artifact => ({ nodeId, ...artifact })));
    return { input: run.input, attachments: [...run.attachments], results, predecessorText, artifacts: artifacts.filter((artifact, index, list) => list.findIndex(item => item.nodeId === artifact.nodeId && item.filename === artifact.filename) === index), signal, onUpdate, runId: run.id };
  }

  renderNode(node, context) {
    const render = text => text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, raw) => {
      const name = raw.trim();
      if (name === 'input') return context.input;
      return context.results[name.split('.')[1]]?.text || '';
    });
    let prompt = render(node.prompt);
    if (!['input', 'load', 'unload'].includes(node.type)) {
      const references = variables(node.prompt);
      if (context.predecessorText && !references.some(name => name.startsWith('steps.'))) prompt += `${prompt ? '\n\n' : ''}Input from previous steps:\n${context.predecessorText}`;
      else if (!node.dependsOn.length && context.input && !references.includes('input')) prompt += `${prompt ? '\n\n' : ''}Run input:\n${context.input}`;
    }
    if (prompt.length > PIPELINE_LIMITS.expandedPrompt) throw new Error('Expanded step prompt exceeds the context limit. Reduce input or predecessor output.');
    const result = { ...copy(node), prompt };
    if (node.systemPrompt !== undefined) { result.systemPrompt = render(node.systemPrompt); if (result.systemPrompt.length > PIPELINE_LIMITS.expandedPrompt) throw new Error('Expanded system prompt exceeds the context limit.'); }
    return result;
  }

  // Called by Studio while it owns its global inference queue slot. There is no
  // second scheduler here: a run executes one ready node at a time, in DAG order.
  async execute(id, externalSignal) {
    const run = this.getRun(id);
    if (this.executing.size) throw new Error('Another pipeline is already executing.');
    if (run.status !== 'queued') throw new Error('Pipeline must be queued before execution.');
    const controller = new AbortController();
    const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
    this.executing.add(id); this.controllers.set(id, controller);
    run.status = 'running'; run.startedAt ||= Date.now(); delete run.error;
    let current;
    try {
      await this.changed();
      for (const node of pipelineOrder(run.definition.nodes)) {
        signal.throwIfAborted();
        if (run.cancelRequested) throw new Error('Pipeline cancelled.');
        if (run.pauseRequested) { run.status = 'paused'; delete run.pauseRequested; break; }
        const step = run.nodeRuns.find(item => item.nodeId === node.id);
        if (step.status === 'completed') continue;
        if (node.dependsOn.some(dependency => run.nodeRuns.find(item => item.nodeId === dependency)?.status !== 'completed')) throw new Error(`Step ${node.name} has unfinished dependencies.`);
        current = step; step.status = 'running'; step.phase = node.type === 'input' ? 'Reading input' : 'Preparing'; step.startedAt = Date.now(); step.progress = 0; run.activeNodeId = node.id;
        await this.changed();
        const onUpdate = update => {
          if (step.status !== 'running' || signal.aborted || !plain(update)) return;
          if (typeof update.phase === 'string') step.phase = update.phase.slice(0, 300);
          if (typeof update.text === 'string') step.text = update.text.slice(0, PIPELINE_LIMITS.result);
          if (Number.isFinite(update.progress)) step.progress = Math.max(0, Math.min(1, update.progress));
          if (plain(update.contextUsage)) {
            const usage = update.contextUsage;
            if (['removedMessages', 'contextTokens', 'responseTokens'].every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0)) step.contextUsage = {
              removedMessages: usage.removedMessages, contextTokens: usage.contextTokens, responseTokens: usage.responseTokens,
              promptTokens: Number.isSafeInteger(usage.promptTokens) && usage.promptTokens >= 0 ? usage.promptTokens : null,
              method: String(usage.method || '').slice(0, 40)
            };
          }
          if (update.steps !== undefined || update.modelName !== undefined) {
            const details = resultValue({ text: '', steps: update.steps, modelName: update.modelName });
            if (details.steps !== undefined) step.steps = details.steps;
            if (details.modelName !== undefined) step.modelName = details.modelName;
          }
          // Streaming updates remain transient until the next durable transition.
          this.onChange(this.snapshot());
        };
        const context = this.contextFor(run, node, signal, onUpdate);
        const resolved = this.renderNode(node, context);
        const value = node.type === 'input' ? { text: resolved.prompt || run.input } : await this.executeStep?.(resolved, context);
        signal.throwIfAborted();
        if (run.cancelRequested) throw new Error('Pipeline cancelled.');
        Object.assign(step, resultValue(value), { status: 'completed', phase: 'Complete', progress: 1, finishedAt: Date.now() });
        current = undefined; delete run.activeNodeId; await this.changed();
      }
      if (run.status === 'running') { run.status = 'completed'; run.finishedAt = Date.now(); delete run.pauseRequested; }
    } catch (error) {
      const cancelled = signal.aborted || run.cancelRequested;
      run.status = cancelled ? 'cancelled' : 'failed'; run.error = cancelled ? String(signal.reason?.message || 'Pipeline cancelled.') : String(error.message || error); run.finishedAt = Date.now();
      if (current) Object.assign(current, { status: cancelled ? 'cancelled' : 'failed', phase: cancelled ? 'Cancelled' : 'Failed', error: run.error, finishedAt: Date.now() });
      for (const step of run.nodeRuns) if (step.status === 'pending') { step.status = 'skipped'; step.phase = cancelled ? 'Cancelled' : 'Blocked by failed step'; }
    } finally {
      delete run.activeNodeId; this.executing.delete(id); this.controllers.delete(id);
      await this.changed();
    }
    return run;
  }
}
