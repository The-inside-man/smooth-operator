import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { exists, findRuntime } from './platform.mjs';

export const imageProfiles = {
  'flux-2-klein-4b-q4_0.gguf': { family: 'flux2', args: { llm: 'components/flux-klein-4b/Qwen3-4B-Q4_K_M.gguf', vae: 'components/flux-klein-4b/flux2-vae.safetensors' }, steps: 4, cfg: 1 },
  'flux-2-klein-9b-q4_0.gguf': { family: 'flux2', args: { llm: 'components/flux-klein-9b/Qwen3-8B-Q4_K_M.gguf', vae: 'components/flux-klein-4b/flux2-vae.safetensors' }, steps: 4, cfg: 1 },
  'qwen-image-edit-2511-q4_k_m.gguf': { family: 'qwen-image', args: { llm: 'components/qwen-image-edit-2511/Qwen2.5-VL-7B-Instruct.Q4_K_M.gguf', llm_vision: 'components/qwen-image-edit-2511/Qwen2.5-VL-7B-Instruct.mmproj-f16.gguf', vae: 'components/qwen-image-edit-2511/qwen_image_vae.safetensors' }, steps: 20, cfg: 2.5 },
  'wan2.2-ti2v-5b-q4_k_m.gguf': { family: 'wan', args: { t5xxl: 'components/wan-2.2-5b/umt5-xxl-encoder-Q4_K_M.gguf', taesd: 'components/wan-2.2-5b/taew2_2.safetensors' }, steps: 20, cfg: 6 }
};
async function walk(root, depth = 3) {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const result = [];
    for (const e of entries) {
      if (e.name.startsWith('.') || ['components', 'metadata', 'node_modules', 'cache'].includes(e.name)) continue;
      const full = path.join(root, e.name);
      if (e.isDirectory() && depth > 0) result.push(...await walk(full, depth - 1));
      else if (e.isFile() && /\.(gguf|safetensors|bin|onnx)$/i.test(e.name)) result.push(full);
    }
    return result;
  } catch { return []; }
}
export async function scanLibrary(root, dataDir, backend = 'auto') {
  const kinds = ['chat', 'image', 'video', 'upscale', 'transcribe'];
  const runtimes = Object.fromEntries(await Promise.all(kinds.map(async kind => [kind, await findRuntime(root, kind, backend, dataDir)])));
  if (!root) return { models: [], runtimes };
  const app = path.join(root, 'Portable-Local-Studio', 'app');
  const sources = [[path.join(root, 'Coding-Models', 'models'), 'chat'], [path.join(app, 'llm-models'), 'chat'], [path.join(app, 'models'), 'image'], [path.join(app, 'speech-models'), 'transcribe']];
  const models = [];
  for (const [directory, initialKind] of sources) for (const file of await walk(directory)) {
    const filename = path.basename(file), lower = filename.toLowerCase();
    if (/mmproj|projector/.test(lower)) continue;
    let kind = initialKind, profile = null, issue = '';
    if (initialKind === 'image') {
      profile = imageProfiles[lower] || null;
      if (profile?.family === 'wan') kind = 'video';
      else if (!profile && /dreamshaper|cyberrealistic|juggernaut/.test(lower)) profile = { family: 'checkpoint', args: {}, steps: /lightning/.test(lower) ? 4 : 20, cfg: /lightning/.test(lower) ? 1 : 7 };
      if (!profile) issue = 'Model discovered; an engine recipe is needed.';
    }
    if (kind === 'chat' && !lower.endsWith('.gguf')) issue = 'This chat adapter currently loads GGUF files.';
    if (kind === 'transcribe' && !lower.startsWith('ggml-')) issue = 'This speech adapter requires Whisper GGML weights.';
    if (profile) for (const companion of Object.values(profile.args)) if (!await exists(path.join(directory, companion))) issue = `Missing companion: ${companion}`;
    if (!runtimes[kind]) issue ||= `No ${kind} runtime for ${process.platform}/${process.arch}.`;
    const relativePath = path.relative(root, file).split(path.sep).join('/');
    models.push({ id: createHash('sha256').update(relativePath).digest('hex').slice(0, 16), name: filename.replace(/\.(gguf|safetensors|bin|onnx)$/i, '').replace(/[_]/g, ' '), kind, relativePath, size: (await fs.stat(file)).size, profile, issue, available: !issue, validation: 'Not tested', file });
  }
  const up = runtimes.upscale;
  if (up) {
    const modelDir = path.join(path.dirname(up.binary), 'models');
    if (await exists(path.join(modelDir, 'realesrgan-x4plus.bin')) && await exists(path.join(modelDir, 'realesrgan-x4plus.param'))) models.push({ id: 'realesrgan-x4plus', name: 'Real-ESRGAN x4plus', kind: 'upscale', size: 0, relativePath: path.relative(root, modelDir), file: modelDir, available: true, issue: '', validation: 'Not tested' });
  }
  return { models, runtimes };
}
