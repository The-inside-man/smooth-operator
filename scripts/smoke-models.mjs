// Explicit hardware smoke test. Uses weights in place and writes only under artifacts/.
import { startServer } from '../server/index.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
const service = await startServer({ port: 0, dataDir: path.resolve('artifacts/model-smoke') });
const studio = service.studio;
async function complete(body) {
  const job = await studio.enqueue(body);
  let last = '', waited = 0;
  while (['running', 'queued'].includes(job.status)) {
    if (last !== job.phase) { last = job.phase; console.log(`${job.kind}: ${last}`); }
    await new Promise(r => setTimeout(r, 1000));
    if (++waited > 480) { await studio.cancel(job.id); throw new Error('Smoke test timed out.'); }
  }
  const message = studio.sessions.find(s => s.id === job.sessionId).messages.find(m => m.jobId === job.id);
  console.log(JSON.stringify({ kind: job.kind, status: job.status, text: message.content.slice(0, 350), artifact: message.artifact, error: message.error }));
  if (job.status !== 'completed') throw new Error(job.phase);
  return { job, message };
}
try {
  const mode = process.argv[2] || 'chat';
  if (mode === 'chat') {
    const model = studio.registry.models.find(m => m.kind === 'chat' && m.name.includes('1.5b'));
    await complete({ kind: 'chat', modelId: model.id, prompt: 'Reply with exactly: TIM Studio is online.' });
  } else if (mode === 'image') {
    const model = studio.registry.models.find(m => /DreamShaper/.test(m.name));
    const image = await complete({ kind: 'image', modelId: model.id, prompt: 'A cinematic retro neon city at night, cyan and magenta reflections on wet streets, a purple sunset, detailed illustration, no text', settings: { width: 512, height: 512, steps: 12, seed: 1995 } });
    const source = image.message.artifact.filename;
    const upload = 'smoke-upscale.png'; await fs.copyFile(path.join(studio.outputDir, source), path.join(studio.uploadDir, upload));
    await complete({ kind: 'upscale', modelId: 'realesrgan-x4plus', sessionId: image.job.sessionId, attachments: [upload] });
  } else if (mode === 'audio') {
    const model = studio.registry.models.find(m => m.kind === 'transcribe');
    const pcm = Buffer.alloc(16000 * 2); const wav = Buffer.alloc(44 + pcm.length);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40);
    if (process.argv[3]) await fs.copyFile(path.resolve(process.argv[3]), path.join(studio.uploadDir, 'spoken.wav'));
    else await fs.writeFile(path.join(studio.uploadDir, 'spoken.wav'), wav);
    await complete({ kind: 'transcribe', modelId: model.id, attachments: ['spoken.wav'] });
  } else if (mode === 'video') {
    const model = studio.registry.models.find(m => m.kind === 'video');
    await complete({ kind: 'video', modelId: model.id, prompt: 'A neon city street at night, cyan and magenta lights, slow camera movement', settings: { width: 256, height: 256, frames: 9, steps: 4, seed: 1995 } });
  }
} finally { await service.close(); }
