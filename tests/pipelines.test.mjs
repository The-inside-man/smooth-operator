import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PipelineManager, PIPELINE_LIMITS, validatePipeline } from '../server/pipelines.mjs';

const node = (id, options = {}) => ({ id, name: id, type: 'chat', modelId: 'local-model', prompt: `Task ${id}`, dependsOn: [], position: { x: 100, y: 200 }, settings: {}, memoryPolicy: 'auto', ...options });
const definition = (nodes, options = {}) => ({ schemaVersion: 1, name: 'Local research', description: 'A local test pipeline', nodes, ...options });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-pipeline-test-'));
  const manager = new PipelineManager(directory, { executeStep: async step => ({ text: `Result ${step.id}` }), ...options });
  await manager.init();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { manager, directory };
}

test('pipeline DAG passes ancestor text and artifacts in topological order without exposing sibling output', async t => {
  const calls = [];
  const { manager } = await fixture(t, { executeStep: async (step, context) => {
    calls.push({ step, context });
    if (step.id === 'draft') return { text: 'A draft', artifact: { filename: 'draft.txt', kind: 'text', size: 7 } };
    return { text: step.id === 'review' ? 'A review' : 'A sibling' };
  } });
  const saved = await manager.save(definition([
    node('review', { prompt: 'Review {{steps.draft.output}} for {{input}}', systemPrompt: 'Consider {{steps.start.output}}', dependsOn: ['draft'] }),
    node('sibling'), node('draft', { dependsOn: ['start'] }), node('start', { type: 'input', modelId: '', prompt: '{{input}}' })
  ]));
  const run = await manager.createRun({ pipelineId: saved.id, input: 'Research note', attachments: ['upload.txt'] });
  await manager.execute(run.id);
  assert.equal(run.status, 'completed');
  assert.deepEqual(calls.map(call => call.step.id), ['draft', 'review', 'sibling']);
  assert.match(calls[0].step.prompt, /Task draft\n\nInput from previous steps:\n\[start\]\nResearch note/);
  const review = calls[1];
  assert.equal(review.step.prompt, 'Review A draft for Research note');
  assert.equal(review.step.systemPrompt, 'Consider Research note');
  assert.deepEqual(Object.keys(review.context.results).sort(), ['draft', 'start']);
  assert.equal(review.context.results.sibling, undefined);
  assert.deepEqual(review.context.attachments, ['upload.txt']);
  assert.deepEqual(review.context.artifacts, [{ nodeId: 'draft', filename: 'draft.txt', kind: 'text', size: 7 }]);
  assert.ok(run.nodeRuns.every(step => step.status === 'completed' && step.progress === 1));
});

test('pipeline validation rejects cycles, unknown references, unsupported capabilities and invalid settings', () => {
  const invalid = [
    [definition([node('a', { dependsOn: ['b'] }), node('b', { dependsOn: ['a'] })]), /cycle/],
    [definition([node('a', { dependsOn: ['missing'] })]), /unknown step/],
    [definition([node('a'), node('a')]), /Duplicate/],
    [definition([node('a', { type: 'shell' })]), /Unsupported step type/],
    [definition([node('a', { command: 'arbitrary command' })]), /unsupported fields/],
    [definition([node('a', { settings: { url: 'https://example.com' } })]), /unsupported fields/],
    [definition([node('a', { settings: { temperature: 10 } })]), /temperature/],
    [definition([node('a', { settings: { width: 65 } })]), /multiples of 32/],
    [definition([node('a', { settings: { frames: 6 } })]), /4n/],
    [definition([node('a', { prompt: '{{environment.secret}}' })]), /Unknown pipeline variable/],
    [definition([node('a', { prompt: '{{steps.missing.output}}' })]), /unknown step/],
    [definition([node('a', { prompt: '{{steps.b.output}}' }), node('b')]), /ancestor/],
    [definition([node('a', { systemPrompt: '{{steps.b.output}}' }), node('b')]), /ancestor/],
    [definition([node('a', { inputRef: 'b' }), node('b')]), /ancestor/],
    [definition([node('a', { inputRef: '../secret' })]), /input reference/],
    [definition([node('a', { prompt: '{{input}' })]), /Malformed/],
    [definition([node('__proto__')]), /safe identifier/],
    [definition(Array.from({ length: 33 }, (_item, index) => node(`n${index}`))), /between 1 and 32/],
    [definition([node('a')], { schemaVersion: 2 }), /schema version/]
  ];
  for (const [value, expected] of invalid) assert.throws(() => validatePipeline(value), expected);
});

test('definitions round trip with positions and draft model choices, then preflight occurs before queueing', async t => {
  const checked = [];
  const { manager, directory } = await fixture(t, { validateModel: async step => { checked.push(step.id); if (step.modelId === 'unavailable') throw new Error('Model unavailable'); } });
  const saved = await manager.save(definition([node('draft', { modelId: '', position: { x: -48.5, y: 720 }, memoryPolicy: 'keep' })]));
  await assert.rejects(manager.createRun({ pipelineId: saved.id }), /Choose a model/);
  assert.equal(manager.runs.length, 0);
  saved.nodes[0].modelId = 'unavailable'; await manager.save(saved);
  await assert.rejects(manager.createRun({ pipelineId: saved.id }), /Model unavailable/);
  assert.deepEqual(checked, ['draft']); assert.equal(manager.runs.length, 0);
  const reopened = new PipelineManager(directory); await reopened.init();
  assert.deepEqual(reopened.get(saved.id).nodes[0].position, { x: -48.5, y: 720 });
  assert.equal(reopened.get(saved.id).nodes[0].memoryPolicy, 'keep');
});

test('run definition snapshots remain unchanged when a saved pipeline is edited or deleted', async t => {
  const { manager } = await fixture(t);
  const saved = await manager.save(definition([node('a', { prompt: 'Original' })]));
  const run = await manager.createRun({ pipelineId: saved.id });
  saved.nodes[0].prompt = 'Changed'; await manager.save(saved);
  assert.equal(run.definition.nodes[0].prompt, 'Original');
  assert.throws(() => { run.definition.nodes[0].prompt = 'Mutate run'; }, TypeError);
  await assert.rejects(manager.remove(saved.id), /Cancel/);
  await manager.execute(run.id); await manager.remove(saved.id);
  assert.throws(() => manager.get(saved.id), /not found/);
  assert.equal(manager.getRun(run.id).definition.nodes[0].prompt, 'Original');
});

test('pause waits for the active step and resume preserves completed results', async t => {
  const started = deferred(), release = deferred(), executed = [];
  const { manager } = await fixture(t, { executeStep: async step => { executed.push(step.id); if (step.id === 'a') { started.resolve(); await release.promise; } return { text: `Result ${step.id}` }; } });
  const saved = await manager.save(definition([node('a'), node('b', { dependsOn: ['a'] })]));
  const run = await manager.createRun({ pipelineId: saved.id });
  const execution = manager.execute(run.id); await started.promise;
  await manager.pause(run.id); assert.equal(run.status, 'running'); assert.equal(run.pauseRequested, true);
  release.resolve(); await execution;
  assert.equal(run.status, 'paused');
  assert.deepEqual(run.nodeRuns.map(step => step.status), ['completed', 'pending']);
  const completedAt = run.nodeRuns[0].finishedAt;
  await manager.resume(run.id); assert.equal(run.status, 'queued');
  await manager.execute(run.id);
  assert.equal(run.status, 'completed'); assert.deepEqual(executed, ['a', 'b']); assert.equal(run.nodeRuns[0].finishedAt, completedAt);
});

test('queued pause and cancellation never execute a step', async t => {
  let executed = 0;
  const { manager } = await fixture(t, { executeStep: async () => { executed++; return { text: 'done' }; } });
  const saved = await manager.save(definition([node('a')]));
  const run = await manager.createRun({ pipelineId: saved.id });
  await manager.pause(run.id); assert.equal(run.status, 'paused');
  await assert.rejects(manager.execute(run.id), /must be queued/);
  await manager.cancel(run.id); assert.equal(run.status, 'cancelled'); assert.equal(run.nodeRuns[0].status, 'skipped'); assert.equal(executed, 0);
  await assert.rejects(manager.resume(run.id), /Only paused or interrupted/);
});

test('cancel during asynchronous resume preflight cannot requeue a cancelled run', async t => {
  const checking = deferred(), release = deferred(); let calls = 0;
  const { manager } = await fixture(t, { validateModel: async () => { if (++calls > 1) { checking.resolve(); await release.promise; } } });
  const saved = await manager.save(definition([node('a')]));
  const run = await manager.createRun({ pipelineId: saved.id }); await manager.pause(run.id);
  const resuming = manager.resume(run.id); await checking.promise;
  await manager.cancel(run.id); release.resolve();
  await assert.rejects(resuming, /changed while preparing/); assert.equal(run.status, 'cancelled');
});

test('cancel aborts an active step and skips every later step', async t => {
  const started = deferred(), executed = [];
  const { manager } = await fixture(t, { executeStep: async (step, context) => {
    executed.push(step.id); started.resolve();
    await new Promise((_resolve, reject) => context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true }));
    return { text: 'Should not complete' };
  } });
  const saved = await manager.save(definition([node('a'), node('b', { dependsOn: ['a'] })]));
  const run = await manager.createRun({ pipelineId: saved.id });
  const execution = manager.execute(run.id); await started.promise; await manager.cancel(run.id); await execution;
  assert.equal(run.status, 'cancelled'); assert.deepEqual(executed, ['a']);
  assert.deepEqual(run.nodeRuns.map(step => step.status), ['cancelled', 'skipped']); assert.match(run.error, /cancelled/i);
});

test('external queue cancellation propagates into the pipeline and marks it cancelled', async t => {
  const controller = new AbortController();
  const { manager } = await fixture(t, { executeStep: async (_step, context) => { controller.abort(new Error('Application closed')); context.signal.throwIfAborted(); } });
  const saved = await manager.save(definition([node('a')]));
  const run = await manager.createRun({ pipelineId: saved.id });
  await manager.execute(run.id, controller.signal);
  assert.equal(run.status, 'cancelled'); assert.equal(run.error, 'Application closed');
});

test('step failure keeps completed output, marks blocked nodes, and requires a new run to retry', async t => {
  const executed = [];
  const { manager } = await fixture(t, { executeStep: async step => { executed.push(step.id); if (step.id === 'b') throw new Error('Local engine ran out of memory'); return { text: 'Useful completed result' }; } });
  const saved = await manager.save(definition([node('a'), node('b', { dependsOn: ['a'] }), node('c', { dependsOn: ['b'] })]));
  const run = await manager.createRun({ pipelineId: saved.id }); await manager.execute(run.id);
  assert.equal(run.status, 'failed'); assert.match(run.error, /out of memory/); assert.deepEqual(executed, ['a', 'b']);
  assert.deepEqual(run.nodeRuns.map(step => step.status), ['completed', 'failed', 'skipped']);
  assert.equal(run.nodeRuns[0].text, 'Useful completed result'); await assert.rejects(manager.resume(run.id), /new run/);
});

test('restart marks queued and active runs interrupted and never replays models automatically', async t => {
  const { manager, directory } = await fixture(t);
  const saved = await manager.save(definition([node('a'), node('b', { dependsOn: ['a'] })]));
  const active = await manager.createRun({ pipelineId: saved.id });
  active.status = 'running'; active.startedAt = Date.now(); active.activeNodeId = 'b';
  Object.assign(active.nodeRuns[0], { status: 'completed', text: 'Saved result', phase: 'Complete', finishedAt: Date.now() });
  Object.assign(active.nodeRuns[1], { status: 'running', text: 'Partial output', startedAt: Date.now() });
  const queued = await manager.createRun({ pipelineId: saved.id });
  const calls = []; const reopened = new PipelineManager(directory, { executeStep: async (step, context) => { calls.push(step.id); assert.equal(context.results.a.text, 'Saved result'); return { text: 'Recovered' }; } });
  await reopened.init(); assert.deepEqual(calls, []);
  assert.equal(reopened.getRun(active.id).status, 'interrupted'); assert.equal(reopened.getRun(queued.id).status, 'interrupted');
  await assert.rejects(reopened.execute(active.id), /must be queued/);
  await reopened.resume(active.id); await reopened.execute(active.id);
  assert.deepEqual(calls, ['b']); assert.equal(reopened.getRun(active.id).status, 'completed');
});

test('result text and ancestor context are bounded while artifacts stay available', async t => {
  let received;
  const { manager } = await fixture(t, { executeStep: async (step, context) => {
    if (step.id === 'join') { received = context; return { text: 'combined' }; }
    return { text: 'x'.repeat(200000), artifact: { filename: `${step.id}.txt`, kind: 'text' } };
  } });
  const saved = await manager.save(definition([node('a'), node('b'), node('c'), node('join', { dependsOn: ['a', 'b', 'c'] })]));
  const run = await manager.createRun({ pipelineId: saved.id }); await manager.execute(run.id);
  assert.equal(run.status, 'completed'); assert.equal(run.nodeRuns[0].text.length, PIPELINE_LIMITS.result);
  assert.ok(Object.values(received.results).reduce((sum, result) => sum + result.text.length, 0) <= PIPELINE_LIMITS.context);
  assert.equal(received.artifacts.length, 3);
});

test('completed agent child artifacts remain accessible to descendants without copying child prompt or text', async t => {
  let context;
  const { manager } = await fixture(t, { executeStep: async (step, value) => {
    if (step.id === 'agent') return { text: 'Two pictures created', artifact: { filename: 'last.png', kind: 'image' }, steps: [
      { id: 'first-child', kind: 'image', status: 'completed', settings: { prompt: 'Private generation request' }, result: { text: 'Detailed child output', artifact: { filename: 'first.png', kind: 'image' } } },
      { id: 'failed-child', kind: 'image', status: 'failed', result: { artifact: { filename: 'failed.png', kind: 'image' } } },
      { id: 'last-child', kind: 'image', status: 'completed', result: { artifact: { filename: 'last.png', kind: 'image' } } }
    ] };
    context = value; return { text: 'Done' };
  } });
  const saved = await manager.save(definition([node('agent', { type: 'agent' }), node('review', { dependsOn: ['agent'] })]));
  const run = await manager.createRun({ pipelineId: saved.id }); await manager.execute(run.id);
  assert.equal(run.status, 'completed');
  assert.deepEqual(context.results.agent.steps.map(step => step.id), ['first-child', 'last-child']);
  assert.equal(context.results.agent.steps[0].settings, undefined); assert.equal(context.results.agent.steps[0].result.text, undefined);
  assert.deepEqual(context.artifacts.map(artifact => artifact.filename).sort(), ['first.png', 'last.png']);
});

test('streaming progress is visible, clamps invalid ranges and persists final agent details', async t => {
  const observed = [];
  const { manager, directory } = await fixture(t, { onChange: snapshot => observed.push(snapshot.runs[0]?.nodeRuns[0]), executeStep: async (_step, context) => {
    context.onUpdate({ phase: 'Generating', progress: 2, text: 'Partial', modelName: 'Tiny local model', steps: [{ status: 'running', toolName: 'run_chat' }] });
    return { text: 'Final', modelName: 'Tiny local model', steps: [{ status: 'completed', toolName: 'run_chat' }] };
  } });
  const saved = await manager.save(definition([node('a', { type: 'agent' })]));
  const run = await manager.createRun({ pipelineId: saved.id }); await manager.execute(run.id);
  assert.ok(observed.some(step => step?.phase === 'Generating' && step.progress === 1 && step.text === 'Partial' && step.modelName === 'Tiny local model' && step.steps?.[0]?.status === 'running'));
  const reopened = new PipelineManager(directory); await reopened.init();
  assert.equal(reopened.getRun(run.id).nodeRuns[0].text, 'Final'); assert.equal(reopened.getRun(run.id).nodeRuns[0].modelName, 'Tiny local model');
  assert.deepEqual(reopened.getRun(run.id).nodeRuns[0].steps, [{ status: 'completed', toolName: 'run_chat' }]);
});

test('run inputs, artifact paths, and expanded prompts cannot escape bounded literal data', async t => {
  let calls = 0;
  const { manager } = await fixture(t, { executeStep: async () => { calls++; return { text: 'Done', artifact: { filename: '../secret.txt' } }; } });
  const saved = await manager.save(definition([node('a')]));
  await assert.rejects(manager.createRun({ pipelineId: saved.id, attachments: ['../secret'] }), /uploaded filenames/);
  await assert.rejects(manager.createRun({ pipelineId: saved.id, input: 'x'.repeat(PIPELINE_LIMITS.input + 1) }), /at most/);
  const badArtifact = await manager.createRun({ pipelineId: saved.id }); await manager.execute(badArtifact.id);
  assert.equal(badArtifact.status, 'failed'); assert.match(badArtifact.error, /artifact filename/);
  const expanded = await manager.save(definition([node('a', { prompt: '{{input}}'.repeat(6) })]));
  const tooLong = await manager.createRun({ pipelineId: expanded.id, input: 'x'.repeat(12000) }); await manager.execute(tooLong.id);
  assert.equal(tooLong.status, 'failed'); assert.match(tooLong.error, /context limit/); assert.equal(calls, 1);
});

test('execution is inline and refuses overlapping pipeline runs without creating another scheduler', async t => {
  const started = deferred(), release = deferred(); let calls = 0;
  const { manager } = await fixture(t, { executeStep: async () => { calls++; started.resolve(); await release.promise; return { text: 'Done' }; } });
  const saved = await manager.save(definition([node('a')]));
  const first = await manager.createRun({ pipelineId: saved.id }), second = await manager.createRun({ pipelineId: saved.id });
  assert.equal(calls, 0);
  const running = manager.execute(first.id); await started.promise;
  await assert.rejects(manager.execute(second.id), /already executing/); assert.equal(second.status, 'queued');
  release.resolve(); await running; await manager.execute(second.id);
  assert.equal(calls, 2); assert.equal(second.status, 'completed');
});
