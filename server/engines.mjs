import fs from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from './process.mjs';

export function mediaInputMode(kind, model) {
  if (model.profile?.inputMode) return model.profile.inputMode;
  if (kind === 'video' || model.profile?.family === 'checkpoint') return 'img2img';
  return 'reference';
}
export function validateMediaInput(kind, model, input) {
  if ((kind === 'upscale' || kind === 'transcribe') && !input) throw new Error(kind === 'upscale' ? 'Attach an image to upscale.' : 'Attach a WAV recording to transcribe.');
  if (!['image', 'video'].includes(kind)) return;
  if (model.profile?.requiresReference && !input) throw new Error(`Attach a reference image to use ${model.name || 'this editing model'}.`);
  if (input && mediaInputMode(kind, model) === 'none') throw new Error('This model generates images from text. Choose an image editing model to use a reference image.');
}
export function mediaArgs(kind, model, settings, input, output) {
  validateMediaInput(kind, model, input);
  if (kind === 'upscale') return ['-i', input, '-o', output, '-m', model.file, '-n', 'realesrgan-x4plus', '-s', '4', '-t', '128', '-j', '1:1:1', '-f', 'png'];
  if (kind === 'transcribe') return ['-m', model.file, '-f', input, '-otxt', '-of', output, '-l', 'auto', '-t', '4'];
  const p = model.profile;
  if (!p) throw new Error('This model needs a generation recipe.');
  const args = [p.family === 'checkpoint' ? '-m' : '--diffusion-model', model.file];
  for (const [flag, relative] of Object.entries(p.args || {})) args.push(`--${flag}`, path.join(path.dirname(model.file), relative));
  args.push('-p', settings.prompt, '-n', settings.negativePrompt || '', '-W', String(settings.width ?? p.width ?? 512), '-H', String(settings.height ?? p.height ?? 512), '--steps', String(settings.steps ?? p.steps), '--cfg-scale', String(settings.cfg ?? p.cfg), '-s', String(settings.seed ?? -1), '-t', '4', '-o', output);
  args.push('--sampling-method', p.sampler || (p.family === 'checkpoint' ? 'euler_a' : 'euler'), '--vae-tiling');
  if (p.scheduler) args.push('--scheduler', p.scheduler);
  if (kind === 'video') args.push('-M', 'vid_gen', '--video-frames', String(settings.frames), '--fps', '24', '--diffusion-fa');
  const flowShift = p.flowShift ?? (kind === 'video' ? 3 : undefined);
  if (flowShift !== undefined) args.push('--flow-shift', String(flowShift));
  if (p.guidance !== undefined) args.push('--guidance', String(p.guidance));
  if (p.modelArgs && Object.keys(p.modelArgs).length) args.push('--model-args', Object.entries(p.modelArgs).map(([key, value]) => `${key}=${value}`).join(','));
  // An editing reference is a conditioning image, unlike an img2img starting latent.
  if (input) args.push(mediaInputMode(kind, model) === 'img2img' ? '-i' : '-r', input);
  if (p.family === 'flux2' || p.family?.startsWith('qwen-image')) args.push('--offload-to-cpu', '--diffusion-fa');
  return args;
}
export async function generateMedia({ kind, model, runtime, settings, input, workDir, outputDir, id, signal, onOutput, onProcess }) {
  validateMediaInput(kind, model, input);
  const ext = kind === 'video' ? 'webm' : kind === 'transcribe' ? 'txt' : 'png';
  const output = path.join(outputDir, `${id}.${ext}`);
  const args = mediaArgs(kind, model, settings, input, kind === 'transcribe' ? output.slice(0, -4) : output);
  if (runtime.backend === 'cpu' && ['image', 'video'].includes(kind)) args.push('--backend', 'cpu');
  let log = '';
  try {
    await runProcess(runtime.binary, args, { signal, cwd: workDir, onProcess, onOutput: chunk => { log = (log + chunk).slice(-100000); onOutput(chunk); } });
    let actual = output;
    try { await fs.access(actual); } catch { const alternate = output.replace(/\.png$/, '_1.png'); await fs.rename(alternate, output); }
    const stat = await fs.stat(actual);
    if (!stat.size) throw new Error('Engine returned an empty output.');
    if (kind === 'transcribe') return { text: await fs.readFile(actual, 'utf8'), artifact: { filename: path.basename(actual), kind: 'text', size: stat.size } };
    return { text: kind === 'upscale' ? 'Your 4× upscale is ready.' : kind === 'video' ? 'Your video is ready.' : 'Your image is ready.', artifact: { filename: path.basename(actual), kind: kind === 'video' ? 'video' : 'image', size: stat.size } };
  } finally { await fs.writeFile(path.join(workDir, `${id}.log`), log); }
}
