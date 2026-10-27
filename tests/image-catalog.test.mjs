import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { catalogModels, getCatalogModel } from '../server/catalog.mjs';
import { mediaArgs } from '../server/engines.mjs';

const bundleIds = ['flux2-klein-4b', 'qwen-image-2.1', 'qwen-image-2512', 'qwen-image-edit-2511', 'realvisxl-5', 'flux2-klein-base-4b'];

test('image catalog bundles contain pinned primary and complete companion weights', () => {
  for (const id of bundleIds) {
    const model = getCatalogModel(id);
    assert.equal(model.kind, 'image');
    assert.ok(model.imageUseCases.length);
    assert.ok(model.requirements.some(note => note.includes('engine')));
    assert.match(model.publisherUrl, /^https:\/\/huggingface.co\//);
    assert.match(model.licenseUrl, /^https:\/\/huggingface\.co\//);
    assert.equal(model.downloadBytes, model.files.reduce((sum, file) => sum + file.size, 0));
    assert.ok(model.memoryGB * 1024 ** 3 > model.downloadBytes);
    assert.equal(model.profile.width, 1024);
    assert.equal(model.profile.height, 1024);
    const names = model.files.map(file => path.basename(file.path));
    assert.equal(new Set(names).size, names.length, `${id} must not overwrite a companion at installation`);
    for (const companion of Object.values(model.profile.args)) {
      assert.equal(path.basename(companion), companion);
      assert.ok(names.slice(1).includes(companion), `${id}: missing companion ${companion}`);
    }
    assert.equal(model.files.length, Object.keys(model.profile.args).length + 1);
    assert.ok(Object.isFrozen(model.profile) && Object.isFrozen(model.profile.args));
    for (const file of model.files) {
      assert.match(file.revision, /^[0-9a-f]{40}$/);
      assert.match(file.sha256, /^[0-9a-f]{64}$/);
      assert.ok(Number.isSafeInteger(file.size) && file.size > 0);
    }
  }
});

test('identity cards distinguish required references from text-only photographic models', () => {
  const edit = getCatalogModel('qwen-image-edit-2511');
  assert.equal(edit.profile.inputMode, 'reference');
  assert.equal(edit.profile.requiresReference, true);
  assert.equal(edit.profile.modelArgs.qwen_image_zero_cond_t, true);
  assert.ok(edit.imageUseCases.includes('identity'));
  for (const id of ['qwen-image-2.1', 'flux2-klein-4b', 'flux2-klein-base-4b']) {
    const model = getCatalogModel(id);
    assert.equal(model.profile.inputMode, 'reference');
    assert.equal(model.profile.requiresReference, false);
    assert.ok(model.imageUseCases.includes('identity'));
  }
  for (const id of ['qwen-image-2512', 'realvisxl-5', 'cyberrealistic-8', 'juggernaut-xl-9']) {
    const model = getCatalogModel(id);
    assert.ok(model.imageUseCases.includes('photorealism'));
    assert.ok(!model.imageUseCases.includes('identity'));
  }
  assert.equal(getCatalogModel('qwen-image-2512').profile.inputMode, 'none');
});

test('Qwen 2.1 research license and architecture-specific companions are explicit', () => {
  const model = getCatalogModel('qwen-image-2.1');
  assert.match(model.license, /research.*non-commercial/i);
  assert.ok(model.requirements.some(note => /commercial use requires/i.test(note)));
  assert.match(model.licenseUrl, /Qwen\/Qwen-Image-2\.1\/blob\/[0-9a-f]{40}\/LICENSE$/);
  assert.equal(model.profile.args.vae, 'qwen_image_2.1_vae_bf16.safetensors');
  assert.match(model.profile.args.llm, /Qwen3-VL-8B/);
  assert.ok(model.profile.args.llm_vision);
  assert.notEqual(model.profile.args.vae, getCatalogModel('qwen-image-edit-2511').profile.args.vae);
});

test('every image bundle builds a recipe that resolves its downloaded companions', () => {
  for (const id of bundleIds) {
    const entry = getCatalogModel(id), dir = path.join(path.sep, 'models', id);
    const file = path.join(dir, path.basename(entry.files[0].path));
    const input = entry.profile.inputMode === 'reference' ? path.join(path.sep, 'input.png') : null;
    const args = mediaArgs('image', { ...entry, file }, {
      prompt: 'A natural portrait photograph', width: 1024, height: 1024, seed: 42
    }, input, path.join(path.sep, 'out.png'));
    assert.equal(args[1], file);
    for (const [flag, companion] of Object.entries(entry.profile.args)) {
      assert.equal(args[args.indexOf(`--${flag}`) + 1], path.join(dir, companion));
    }
    assert.equal(args[args.indexOf('--cfg-scale') + 1], String(entry.profile.cfg));
    assert.equal(args[args.indexOf('--steps') + 1], String(entry.profile.steps));
  }
  assert.equal(catalogModels.filter(model => model.kind === 'image').length, 9);
});
