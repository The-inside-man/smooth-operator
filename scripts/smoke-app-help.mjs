// Explicit local-model check. Uses installed weights and isolated conversations;
// does not download models, change their weights, or modify the user's sessions.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Studio } from '../server/studio.mjs';
import { catalogModels, defaultOrchestratorId } from '../server/catalog.mjs';
import { findSystemChatRuntime } from '../server/runtime-setup.mjs';
import { findRuntime } from '../server/platform.mjs';
import { APP_GUIDE_VERSION } from '../server/app-guide.mjs';

const modelRoot = path.resolve(process.env.TIM_MODEL_DATA_DIR || 'TIM-Studio-Data');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-app-help-'));
const studio = new Studio(temporary);
const results = [];
async function ask(prompt) {
  const job = await studio.enqueue({ kind: 'agent', prompt });
  const deadline = Date.now() + 90000;
  while (['running', 'queued'].includes(job.status) || studio.active?.job.id === job.id) {
    if (Date.now() > deadline) { await studio.cancel(job.id); throw new Error('Application-help check timed out.'); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(job.status, 'completed', job.phase);
  assert.equal(job.children?.length, 0, 'Application help must not run a specialist.');
  const answer = studio.sessions.find(session => session.id === job.sessionId).messages.find(message => message.jobId === job.id).content;
  console.log(JSON.stringify({ prompt, answer }));
  results.push({ prompt, answer, specialistCalls: 0 });
  return answer;
}
try {
  await studio.init();
  studio.config = { ...studio.config, mainAgentModelId: `catalog:${defaultOrchestratorId}`, backend: 'cpu', temperature: .1, maxTokens: 768 };
  studio.registry.runtimes.chat = await findRuntime('', 'chat', 'cpu', modelRoot) || await findSystemChatRuntime('cpu');
  if (!studio.registry.runtimes.chat) throw new Error('Install a chat engine before running this check.');
  studio.registry.models = [];
  for (const id of [defaultOrchestratorId, 'qwen2.5-coder-0.5b']) {
    const entry = catalogModels.find(model => model.id === id);
    const file = path.join(modelRoot, 'models', id, path.basename(entry.files[0].path));
    await fs.access(file);
    studio.registry.models.push({ ...entry, id: `catalog:${id}`, catalogId: id, file, size: entry.downloadBytes, available: true });
  }
  await studio.warmGuide();
  const guidePid = studio.orchestrator.child.pid;
  const pipeline = await ask('Hey, how can i guild a pipeline using this application?');
  assert.match(pipeline, /Pipelines/); assert.match(pipeline, /New pipeline|recipe|Add step/i); assert.match(pipeline, /Run pipeline|Run input/i);
  assert.match(pipeline, /Instructions/); assert.match(pipeline, /connect|output port|Runs after/i); assert.match(pipeline, /Save/); assert.match(pipeline, /Output/);
  assert.doesNotMatch(pipeline, /["“]Start["”]/);
  assert.doesNotMatch(pipeline, /not sure|could you clarify|clarify what specific task/i);
  const downloads = await ask('How do I download a model and load it into memory in this application?');
  assert.match(downloads, /model library/i); assert.match(downloads, /download/i); assert.match(downloads, /Load into memory|load.*memory/i);
  const boundaries = await ask('Can you click New pipeline and run a saved pipeline for me in this application?');
  assert.match(boundaries, /I (?:cannot|can't|am unable|do not have)/i);
  assert.doesNotMatch(boundaries, /I (?:have |successfully )?(?:created|clicked|started|ran|executed) (?:your |the |a |New )?pipeline/i);
  assert.equal(studio.orchestrator.child.pid, guidePid, 'Help must reuse the resident guide.');
  assert.equal(studio.llama.modelId, null, 'No specialist should be loaded for instructions.');
  await fs.mkdir('artifacts', { recursive: true });
  await fs.writeFile('artifacts/app-help-real-check.json', JSON.stringify({ guideVersion: APP_GUIDE_VERSION, guideStayedResident: true, specialistLoaded: false, results }, null, 2));
  console.log(JSON.stringify({ passed: true, guideVersion: APP_GUIDE_VERSION, questions: results.length, guideStayedResident: true }));
} finally { await studio.close(); await fs.rm(temporary, { recursive: true, force: true }); }
