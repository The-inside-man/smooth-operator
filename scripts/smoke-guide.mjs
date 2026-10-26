// Explicit real-model check. Downloads the small guide; --specialist also downloads
// the small coding model. Ordinary npm test never downloads or runs model weights.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Studio } from '../server/studio.mjs';

const studio = new Studio(process.env.TIM_DATA_DIR || path.resolve('artifacts/guide-smoke'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function settled(job) {
  const deadline = Date.now() + 120000;
  while (['running', 'queued'].includes(job.status) || studio.active?.job.id === job.id) {
    if (Date.now() > deadline) throw new Error('Real guide check timed out.');
    await wait(100);
  }
  assert.equal(job.status, 'completed', job.phase);
  return studio.sessions.find(s => s.id === job.sessionId).messages.find(m => m.jobId === job.id);
}
try {
  await studio.init();
  let lastProgress = '';
  studio.on('state', state => {
    const download = state.downloads.find(item => ['downloading', 'verifying'].includes(item.status));
    if (!download) return;
    const progress = `${download.catalogId}: ${Math.floor(download.downloadedBytes / download.totalBytes * 10) * 10}%`;
    if (progress !== lastProgress) { lastProgress = progress; console.log(progress); }
  });
  await studio.setupGuide(); await studio.setupPromise;
  assert.equal(studio.guideSnapshot().loaded, true, studio.guideSnapshot().error);
  const guidePid = studio.orchestrator.child.pid;
  const question = await studio.enqueue({ kind: 'agent', prompt: 'Which small local model in the catalog should I download for writing Python code? Give one model name and explain briefly.' });
  const recommendation = await settled(question);
  assert.match(recommendation.content, /Coder/i, 'The guide should recommend a coding specialist for a programming request.');
  const result = { guidePid, recommendation: recommendation.content, specialist: null };
  if (process.argv.includes('--specialist')) {
    const id = 'qwen2.5-coder-0.5b';
    await studio.downloads.start(id);
    while (true) {
      const download = studio.downloads.snapshot().find(item => item.id === id);
      if (download.status === 'completed') break;
      if (['failed', 'cancelled', 'paused'].includes(download.status)) throw new Error(download.error);
      await wait(100);
    }
    await studio.modelSync; await studio.refreshDownloadedModels();
    await studio.loadModel(`catalog:${id}`);
    assert.equal(studio.orchestrator.child.pid, guidePid, 'Guide was replaced while loading a specialist.');
    assert.notEqual(studio.llama.child.pid, guidePid);
    const delegated = await studio.enqueue({ kind: 'agent', prompt: 'Use the coding specialist to write a Python function add(a, b) that returns their sum. Return the code.' });
    const answer = await settled(delegated);
    assert.ok(delegated.children?.some(child => child.kind === 'chat' && child.status === 'completed'), 'The real guide did not delegate to the installed specialist.');
    assert.match(answer.content, /def add|add\(/, 'The guide should return the actual requested code.');
    assert.equal(studio.orchestrator.child.pid, guidePid, 'Guide was replaced during specialist work.');
    let residentMemory;
    if (process.platform !== 'win32') {
      const { stdout } = await promisify(execFile)('ps', ['-o', 'pid=,rss=,command=', '-p', `${guidePid},${studio.llama.child.pid}`]);
      residentMemory = stdout.trim();
    }
    result.specialist = { pid: studio.llama.child.pid, content: answer.content, steps: delegated.children.map(child => ({ kind: child.kind, status: child.status })), residentMemory };
  }
  await fs.mkdir('artifacts', { recursive: true });
  await fs.writeFile('artifacts/guide-real-check.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await studio.close(); }
