import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { mediaArgs, generateMedia, validateMediaInput } from '../server/engines.mjs';
import { scanLibrary, imageProfiles } from '../server/registry.mjs';
import { catalogModels } from '../server/catalog.mjs';

const settings = { prompt: 'Keep the same person; change the background.', seed: 42 };
const model = profile => ({ name: 'Editing model', file: '/models/model.gguf', profile });
const arg = (args, flag) => args[args.indexOf(flag) + 1];

test('reference editing requires an image before launching an engine and uses reference conditioning', async () => {
  const editing = model({ family: 'qwen-image-edit', args: { vae: 'vae.safetensors', llm: 'encoder.gguf', llm_vision: 'vision.gguf' }, steps: 40, cfg: 2.5, inputMode: 'reference', requiresReference: true, flowShift: 3, modelArgs: { qwen_image_zero_cond_t: true }, width: 1024, height: 1024 });
  assert.throws(() => mediaArgs('image', editing, settings, null, '/output.png'), /Attach a reference image/);
  await assert.rejects(generateMedia({ kind: 'image', model: editing, runtime: null, settings, input: null }), /Attach a reference image/);
  const args = mediaArgs('image', editing, settings, '/reference with spaces.png', '/output.png');
  assert.equal(arg(args, '-r'), '/reference with spaces.png');
  assert.ok(!args.includes('-i'));
  assert.equal(arg(args, '--llm_vision'), path.join('/models', 'vision.gguf'));
  assert.equal(arg(args, '--flow-shift'), '3');
  assert.equal(arg(args, '--model-args'), 'qwen_image_zero_cond_t=true');
  assert.equal(arg(args, '--steps'), '40');
  assert.equal(arg(args, '--cfg-scale'), '2.5');
  assert.equal(arg(args, '-W'), '1024');
  assert.ok(args.includes('--offload-to-cpu'));
});

test('text-only Qwen rejects a reference rather than silently implying identity support', () => {
  const textOnly = model({ family: 'qwen-image', args: {}, steps: 40, cfg: 2.5, inputMode: 'none', flowShift: 3 });
  assert.throws(() => validateMediaInput('image', textOnly, '/person.png'), /Choose an image editing model/);
  const args = mediaArgs('image', textOnly, settings, null, '/output.png');
  assert.ok(!args.includes('-r') && !args.includes('-i'));
  assert.equal(arg(args, '--flow-shift'), '3');
});

test('unified Qwen and Flux allow generation or one reference; Qwen 2.1 retains its automatic schedule', () => {
  for (const family of ['qwen-image-2.1', 'flux2']) {
    const unified = model({ family, args: { vae: 'own-vae.safetensors' }, steps: 20, cfg: 6, inputMode: 'reference' });
    const textArgs = mediaArgs('image', unified, settings, null, '/output.png');
    assert.ok(!textArgs.includes('-r') && !textArgs.includes('-i'));
    const editArgs = mediaArgs('image', unified, settings, '/person.png', '/output.png');
    assert.equal(arg(editArgs, '-r'), '/person.png');
    assert.ok(!editArgs.includes('--flow-shift'));
    assert.ok(editArgs.includes('--offload-to-cpu'));
  }
});

test('checkpoint img2img and model-specific defaults preserve user overrides', () => {
  const checkpoint = model({ family: 'checkpoint', args: {}, steps: 50, cfg: 5, sampler: 'dpm++2m', scheduler: 'karras', inputMode: 'img2img', width: 1024, height: 1024 });
  const args = mediaArgs('image', checkpoint, { ...settings, width: 768, height: 1024, steps: 12, cfg: 0 }, '/source.png', '/output.png');
  assert.equal(arg(args, '-i'), '/source.png');
  assert.ok(!args.includes('-r'));
  assert.equal(arg(args, '--sampling-method'), 'dpm++2m');
  assert.equal(arg(args, '--scheduler'), 'karras');
  assert.equal(arg(args, '--steps'), '12');
  assert.equal(arg(args, '--cfg-scale'), '0');
  assert.equal(arg(args, '-W'), '768');
});

test('legacy Qwen edit recipe requires the reference and enables 2511 conditioning', () => {
  const profile = imageProfiles['qwen-image-edit-2511-q4_k_m.gguf'];
  assert.equal(profile.inputMode, 'reference');
  assert.equal(profile.requiresReference, true);
  assert.equal(profile.modelArgs.qwen_image_zero_cond_t, true);
  assert.equal(profile.flowShift, 3);
});

test('catalog image recipes include every named companion and keep references explicit', () => {
  for (const entry of catalogModels.filter(entry => entry.kind === 'image')) {
    const names = new Set(entry.files.slice(1).map(file => file.destination || path.posix.basename(file.path)));
    for (const companion of Object.values(entry.profile.args)) assert.ok(names.has(companion), `${entry.name}: ${companion} must be downloaded`);
    if (entry.profile.requiresReference) assert.equal(entry.profile.inputMode, 'reference');
  }
});

test('external catalog bundles discover beside their denoiser, excluding encoder and VAE weights', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-image-bundle-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const bundle = catalogModels.find(entry => entry.kind === 'image' && entry.files.length > 1);
  assert.ok(bundle, 'Catalog includes a complete image bundle');
  const models = path.join(dir, 'Portable-Local-Studio/app/models', 'bundle');
  await fs.mkdir(models, { recursive: true });
  for (const file of bundle.files) await fs.writeFile(path.join(models, file.destination || path.posix.basename(file.path)), 'fixture');
  const binary = path.join(dir, 'runtimes', `${process.platform}-${process.arch}`, 'image/cpu', process.platform === 'win32' ? 'sd-cli.exe' : 'sd-cli');
  await fs.mkdir(path.dirname(binary), { recursive: true }); await fs.writeFile(binary, 'fixture');
  const discovered = await scanLibrary(dir, dir, 'cpu');
  assert.equal(discovered.models.length, 1);
  assert.equal(discovered.models[0].available, true);
  assert.deepEqual(discovered.models[0].profile, bundle.profile);
  await fs.unlink(path.join(models, bundle.files[1].destination || path.posix.basename(bundle.files[1].path)));
  const incomplete = await scanLibrary(dir, dir, 'cpu');
  assert.equal(incomplete.models.length, 1);
  assert.equal(incomplete.models[0].available, false);
  assert.match(incomplete.models[0].issue, /Missing companion/);
});

test('legacy component directories retain their existing editing recipe', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-legacy-image-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const models = path.join(dir, 'Portable-Local-Studio/app/models');
  const name = 'qwen-image-edit-2511-q4_k_m.gguf';
  const profile = imageProfiles[name];
  await fs.mkdir(models, { recursive: true });
  await fs.writeFile(path.join(models, name), 'fixture');
  for (const companion of Object.values(profile.args)) {
    const file = path.join(models, companion);
    await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, 'fixture');
  }
  const result = await scanLibrary(dir, dir, 'cpu');
  assert.equal(result.models.length, 1);
  assert.deepEqual(result.models[0].profile, profile);
  assert.ok(!result.models[0].issue.startsWith('Missing companion'));
  assert.throws(() => mediaArgs('image', result.models[0], settings, null, '/output.png'), /Attach a reference image/);
});
