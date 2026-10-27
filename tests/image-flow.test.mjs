import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Studio, jobSettings } from '../server/studio.mjs';
import { agentTools, validateCall, runAgent } from '../server/agent.mjs';
import { createPipelineExecutor, validatePipelineModel } from '../server/pipeline-executor.mjs';
import { getCatalogModel } from '../server/catalog.mjs';

const toolCall = (id, extra = {}) => ({ id: 'image-call', type: 'function', function: { name: 'run_image', arguments: JSON.stringify({ modelId: id, prompt: 'Keep the same person and change the background.', ...extra }) } });
const catalogIds = ['qwen-image-edit-2511', 'qwen-image-2512', 'qwen-image-2.1'];

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-image-flow-'));
  const studio = new Studio(dir), events = [], media = [];
  for (const folder of ['work', 'uploads', 'outputs']) await fs.mkdir(path.join(dir, folder));
  studio.config = { mainAgentModelId: 'guide', agentMaxSteps: 2, agentTimeoutSeconds: 10, systemPrompt: 'Local assistant', backend: 'cpu', context: 4096, maxTokens: 128, temperature: .1 };
  // Real catalog recipes, with tiny fixture estimates so tests do not depend on host RAM.
  studio.catalog = catalogIds.map(id => ({ ...getCatalogModel(id), memoryGB: .1 }));
  studio.registry = {
    models: [
      { id: 'guide', name: 'Guide', kind: 'chat', available: true, memoryGB: .1 },
      ...studio.catalog.map(card => ({ id: card.id, catalogId: card.id, name: card.name, kind: 'image', available: true, file: path.join(dir, card.id + '.gguf'), profile: card.profile }))
    ],
    runtimes: { chat: { binary: 'fixture', backend: 'cpu' }, image: { binary: 'fixture', backend: 'cpu' } }
  };
  const engine = { modelId: null, child: null, async load(model) { events.push(`load:${model.id}`); }, async unload() { events.push('unload'); }, async release() { events.push('release'); } };
  studio.llama = engine; studio.orchestrator = { ...engine };
  studio.changed = () => {};
  studio.persist = async () => {};
  studio.drain = async () => {};
  studio.sampleMemory = async () => { events.push('sample-memory'); };
  studio.assertModelMemory = () => { events.push('admit-memory'); };
  studio.loadOrchestrator = async model => { events.push(`load:${model.id}`); };
  studio.generateMedia = async args => {
    media.push(args); const filename = `${args.id}.png`;
    await fs.writeFile(path.join(studio.outputDir, filename), 'fixture image');
    return { text: 'Fixture result', artifact: { filename, kind: 'image', size: 13 } };
  };
  const context = { runId: 'image-run', attachments: [], results: {}, artifacts: [], signal: new AbortController().signal, onUpdate() {} };
  t.after(async () => { await studio.close(); await fs.rm(dir, { recursive: true, force: true }); });
  return { studio, events, media, context, execute: createPipelineExecutor(studio) };
}

test('manual editing without a reference is rejected before any session or queued job is created', async t => {
  const { studio, media, events } = await fixture(t);
  await assert.rejects(studio.enqueue({ kind: 'image', modelId: 'qwen-image-edit-2511', prompt: 'Change the background' }), /Attach a reference image/);
  assert.equal(studio.sessions.length, 0); assert.equal(studio.jobs.length, 0);
  assert.equal(media.length, 0); assert.deepEqual(events, []);
});

test('manual text-only generation rejects attached images before changing the conversation', async t => {
  const { studio } = await fixture(t);
  await fs.writeFile(path.join(studio.uploadDir, 'portrait.png'), 'fixture');
  const session = await studio.newSession();
  await assert.rejects(studio.enqueue({ sessionId: session.id, kind: 'image', modelId: 'qwen-image-2512', prompt: 'Keep this person', attachments: ['portrait.png'] }), /Choose an image editing model/);
  assert.equal(session.messages.length, 0); assert.equal(studio.sessions.length, 1); assert.equal(studio.jobs.length, 0);
});

test('manual editing queues one reference with the selected model resolution and honors overrides', async t => {
  const { studio, media } = await fixture(t);
  await fs.writeFile(path.join(studio.uploadDir, 'portrait.png'), 'fixture');
  const first = await studio.enqueue({ kind: 'image', modelId: 'qwen-image-edit-2511', prompt: 'Change the background', attachments: ['portrait.png'] });
  assert.deepEqual(first.attachments, ['portrait.png']);
  assert.equal(first.settings.width, 1024); assert.equal(first.settings.height, 1024);
  const second = await studio.enqueue({ kind: 'image', modelId: 'qwen-image-2.1', prompt: 'Change the lighting', attachments: ['portrait.png'], settings: { width: 768, height: 1280, steps: 12, cfg: 4 } });
  assert.equal(second.settings.width, 768); assert.equal(second.settings.height, 1280);
  assert.equal(second.settings.steps, 12); assert.equal(second.settings.cfg, 4);
  assert.equal(media.length, 0, 'The fixture keeps queued work from invoking an engine');
});

test('reference support does not advertise a second reference the current workflow cannot pass', async t => {
  const { studio } = await fixture(t);
  for (const name of ['one.png', 'two.png']) await fs.writeFile(path.join(studio.uploadDir, name), 'fixture');
  await assert.rejects(studio.enqueue({ kind: 'image', modelId: 'qwen-image-edit-2511', prompt: 'Combine photos', attachments: ['one.png', 'two.png'] }), /one attachment at a time/);
  assert.equal(studio.jobs.length, 0); assert.equal(studio.sessions.length, 0);
});

test('image settings use model dimensions while old call sites retain their existing defaults', () => {
  const image = { profile: getCatalogModel('qwen-image-2.1').profile };
  assert.equal(jobSettings({}, 'image', image).width, 1024);
  assert.equal(jobSettings({}, 'image').width, 512);
  assert.equal(jobSettings({}, 'video').height, 288);
  assert.equal(jobSettings({ settings: { width: 768 } }, 'image', image).width, 768);
  assert.throws(() => jobSettings({ settings: { width: 1000 } }, 'image', image), /multiples of 32/);
});

test('agent tool validation enforces model reference requirements before returning executable work', async t => {
  const { studio } = await fixture(t), tools = agentTools(studio.registry, 'guide');
  assert.match(tools.find(tool => tool.function.name === 'run_image').function.description, /reference image required/);
  const inputs = new Map([['attachment-1', { filename: 'portrait.png', file: '/fixture/portrait.png' }]]);
  assert.throws(() => validateCall(toolCall('qwen-image-edit-2511'), tools, studio.registry, inputs), /Attach a reference image/);
  assert.throws(() => validateCall(toolCall('qwen-image-2512', { inputRef: 'attachment-1' }), tools, studio.registry, inputs), /Choose an image editing model/);
  const result = validateCall(toolCall('qwen-image-edit-2511', { inputRef: 'attachment-1' }), tools, studio.registry, inputs);
  assert.equal(result.input.file, '/fixture/portrait.png');
  assert.equal(result.settings.width, 1024); assert.equal(result.settings.height, 1024);
  assert.equal(validateCall(toolCall('qwen-image-2.1'), tools, studio.registry, inputs).input, null);
});

test('a missing agent reference never creates a child job or invokes media memory admission', async t => {
  const { studio, events, media } = await fixture(t);
  studio.orchestrator.turn = async () => ({ content: null, tool_calls: [toolCall('qwen-image-edit-2511')] });
  const job = { id: 'agent-job', modelId: 'guide', attachments: [] }, message = { content: '' };
  await assert.rejects(runAgent(studio, job, message, [{ role: 'user', content: 'Use the image specialist to change the background.' }], new AbortController().signal), /Attach a reference image/);
  assert.deepEqual(job.children, []); assert.equal(media.length, 0);
  assert.deepEqual(events, ['load:guide']);
});

test('pipeline model preflight accepts future references while execution rejects missing ones before loading', async t => {
  const { studio, execute, context, media, events } = await fixture(t);
  const node = { type: 'image', modelId: 'qwen-image-edit-2511', prompt: 'Keep the same character' };
  assert.equal(validatePipelineModel(studio, node).id, 'qwen-image-edit-2511');
  await assert.rejects(execute(node, context), /Attach a reference image/);
  assert.equal(media.length, 0); assert.ok(!events.some(event => event.startsWith('load:') || event === 'admit-memory'));
});

test('pipeline editing accepts a successful ancestor image and passes its path with model defaults', async t => {
  const { studio, execute, context, media } = await fixture(t);
  await fs.writeFile(path.join(studio.outputDir, 'ancestor.png'), 'fixture');
  context.results.previous = { text: 'Previous output', artifact: { filename: 'ancestor.png', kind: 'image', size: 7 } };
  await execute({ type: 'image', modelId: 'qwen-image-edit-2511', inputRef: 'previous', prompt: 'Keep the same face' }, context);
  assert.equal(media.length, 1);
  assert.equal(media[0].input, await fs.realpath(path.join(studio.outputDir, 'ancestor.png')));
  assert.equal(media[0].settings.width, 1024); assert.equal(media[0].settings.height, 1024);
});

test('pipeline text-only model rejects explicitly selected references before media execution', async t => {
  const { studio, execute, context, media } = await fixture(t);
  await fs.writeFile(path.join(studio.uploadDir, 'portrait.png'), 'fixture');
  context.attachments = ['portrait.png'];
  await assert.rejects(execute({ type: 'image', modelId: 'qwen-image-2512', inputRef: 'attachment-1', prompt: 'Keep this person' }, context), /Choose an image editing model/);
  assert.equal(media.length, 0);
});

test('a text-to-image pipeline step ignores implicit photos while producing a fresh image', async t => {
  const { studio, execute, context, media } = await fixture(t);
  await fs.writeFile(path.join(studio.uploadDir, 'portrait.png'), 'fixture');
  context.attachments = ['portrait.png'];
  await execute({ type: 'image', modelId: 'qwen-image-2512', prompt: 'A new landscape from text' }, context);
  assert.equal(media.length, 1);
  assert.equal(media[0].input, undefined);
});

test('direct media entry validates references before sampling or admitting model memory', async t => {
  const { studio, events } = await fixture(t);
  const model = studio.registry.models.find(model => model.id === 'qwen-image-edit-2511');
  await assert.rejects(Studio.prototype.runMedia.call(studio, { kind: 'image', model, input: null }), /Attach a reference image/);
  assert.deepEqual(events, []);
});

test('public state exposes reference requirements, default dimensions and total bundle file counts', async t => {
  const { studio } = await fixture(t);
  const state = studio.snapshot();
  const edit = state.models.find(model => model.id === 'qwen-image-edit-2511');
  assert.equal(edit.inputMode, 'reference'); assert.equal(edit.requiresReference, true);
  assert.equal(edit.defaults.width, 1024); assert.equal(edit.defaults.height, 1024);
  assert.equal(edit.file, undefined); assert.equal(edit.profile, undefined);
  const card = state.catalog.find(card => card.id === 'qwen-image-edit-2511');
  assert.equal(card.requiresReference, true); assert.equal(card.inputMode, 'reference');
  assert.equal(card.bundleFiles, 4); assert.equal(card.files, undefined);
  assert.equal(state.catalog.find(card => card.id === 'qwen-image-2512').inputMode, 'none');
  assert.equal(state.models.find(model => model.id === 'qwen-image-2.1').requiresReference, false);
});
