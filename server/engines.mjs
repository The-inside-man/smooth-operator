import fs from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from './process.mjs';
export function mediaArgs(kind, model, settings, input, output) {
  if (kind === 'upscale') return ['-i', input, '-o', output, '-m', model.file, '-n', 'realesrgan-x4plus', '-s', '4', '-t', '128', '-j', '1:1:1', '-f', 'png'];
  if (kind === 'transcribe') return ['-m', model.file, '-f', input, '-otxt', '-of', output, '-l', 'auto', '-t', '4'];
  const p = model.profile;
  if (!p) throw new Error('This model needs a generation recipe.');
  const args = [p.family === 'checkpoint' ? '-m' : '--diffusion-model', model.file];
  for (const [flag, relative] of Object.entries(p.args)) args.push(`--${flag}`, path.join(path.dirname(model.file), relative));
  args.push('-p', settings.prompt, '-n', settings.negativePrompt || '', '-W', String(settings.width), '-H', String(settings.height), '--steps', String(settings.steps || p.steps), '--cfg-scale', String(settings.cfg ?? p.cfg), '-s', String(settings.seed), '-t', '4', '-o', output);
  if (kind === 'video') args.push('-M', 'vid_gen', '--video-frames', String(settings.frames), '--fps', '24', '--sampling-method', 'euler', '--flow-shift', '3', '--diffusion-fa', '--vae-tiling');
  else args.push('--sampling-method', p.family === 'checkpoint' ? 'euler_a' : 'euler', '--vae-tiling');
  if (input) args.push(p.family === 'checkpoint' || kind === 'video' ? '-i' : '-r', input);
  if (p.family === 'flux2' || p.family === 'qwen-image') args.push('--offload-to-cpu', '--diffusion-fa');
  return args;
}
export async function generateMedia({ kind, model, runtime, settings, input, workDir, outputDir, id, signal, onOutput }) {
  if ((kind === 'upscale' || kind === 'transcribe') && !input) throw new Error(kind === 'upscale' ? 'Attach an image to upscale.' : 'Attach a WAV recording to transcribe.');
  const ext = kind === 'video' ? 'webm' : kind === 'transcribe' ? 'txt' : 'png';
  const output = path.join(outputDir, `${id}.${ext}`);
  const args = mediaArgs(kind, model, settings, input, kind === 'transcribe' ? output.slice(0, -4) : output);
  if (runtime.backend === 'cpu' && ['image', 'video'].includes(kind)) args.push('--backend', 'cpu');
  let log = '';
  try {
    await runProcess(runtime.binary, args, { signal, cwd: workDir, onOutput: chunk => { log = (log + chunk).slice(-100000); onOutput(chunk); } });
    let actual = output;
    try { await fs.access(actual); } catch { const alternate = output.replace(/\.png$/, '_1.png'); await fs.rename(alternate, output); }
    const stat = await fs.stat(actual);
    if (!stat.size) throw new Error('Engine returned an empty output.');
    if (kind === 'transcribe') return { text: await fs.readFile(actual, 'utf8'), artifact: { filename: path.basename(actual), kind: 'text', size: stat.size } };
    return { text: kind === 'upscale' ? 'Your 4× upscale is ready.' : kind === 'video' ? 'Your video is ready.' : 'Your image is ready.', artifact: { filename: path.basename(actual), kind: kind === 'video' ? 'video' : 'image', size: stat.size } };
  } finally { await fs.writeFile(path.join(workDir, `${id}.log`), log); }
}
