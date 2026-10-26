// Explicit real-model pipeline check. Uses already installed models; no downloads.
import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Studio } from '../server/studio.mjs';

const studio = new Studio(process.env.TIM_DATA_DIR || path.resolve('TIM-Studio-Data'));
const coderId = 'catalog:qwen2.5-coder-0.5b';
const node = (id, name, type, dependsOn, x, y, extra = {}) => ({ id, name, type, modelId: '', prompt: '', dependsOn, position: { x, y }, memoryPolicy: 'auto', settings: {}, ...extra });
try {
  await studio.init();
  if (!studio.registry.models.find(model => model.id === coderId && model.available)) throw new Error('Install Qwen2.5 Coder 0.5B in Model Library before running this explicit check.');
  await studio.warmGuide(); const guidePid = studio.orchestrator.child.pid;
  if (process.argv.includes('--verbose')) {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      const response = await realFetch(...args);
      if (String(args[0]).endsWith('/v1/chat/completions') && args[1]?.body && JSON.parse(args[1].body).stream === false) {
        const data = await response.clone().json();
        if (data.choices?.[0]?.finish_reason === 'length') console.log(JSON.stringify({ truncated: data.choices[0].message }));
      }
      return response;
    };
  }
  if (process.argv.includes('--verbose')) {
    const turn = studio.orchestrator.turn.bind(studio.orchestrator);
    studio.orchestrator.turn = async (messages, settings, signal, tools) => {
      console.log(JSON.stringify({ toolChoice: settings.toolChoice, tools: tools.map(tool => tool.function.name) }));
      const reply = await turn(messages, settings, signal, tools);
      console.log(JSON.stringify({ calls: reply.tool_calls?.map(call => call.function.name), content: reply.content?.slice(0, 240) }));
      return reply;
    };
  }
  const specialistPrompts = [];
  const generate = studio.llama.generate.bind(studio.llama);
  studio.llama.generate = async (messages, ...args) => { specialistPrompts.push(messages.at(-1).content); return generate(messages, ...args); };
  const definition = await studio.pipelines.save({
    id: 'local-code-review-demo', schemaVersion: 1, name: 'Build & review locally',
    description: 'A local coding experiment: input → load → generate → agent review → release memory. Uses two small models and keeps the TIM guide resident.',
    nodes: [
      node('brief', 'Project brief', 'input', [], 70, 220, { prompt: '{{input}}' }),
      node('prepare', 'Load coding model', 'load', ['brief'], 390, 220, { modelId: coderId, memoryPolicy: 'keep' }),
      node('build', 'Write the function', 'code', ['brief', 'prepare'], 710, 220, { modelId: coderId, prompt: 'Write only the requested Python function.\n{{steps.brief.output}}', memoryPolicy: 'keep', settings: { temperature: .1, maxTokens: 256 } }),
      node('review', 'Agent review', 'agent', ['build'], 1030, 220, { prompt: 'Use the coding specialist to review the correctness of this function. Return a one-sentence review that names the function.\n{{steps.build.output}}', settings: { temperature: .1, maxTokens: 1024, agentMaxSteps: 1, agentTimeoutSeconds: 120 } }),
      node('release', 'Release model memory', 'unload', ['review'], 1350, 220)
    ]
  });
  const run = await studio.runPipeline({ pipelineId: definition.id, input: 'Define add(a, b) to return the sum of its two arguments.' });
  let prior = ''; const deadline = Date.now() + 180000;
  while (['queued', 'running'].includes(run.status) || studio.active?.job.pipelineRunId === run.id) {
    if (Date.now() > deadline) { await studio.cancelPipeline(run.id); throw new Error('Real pipeline check timed out.'); }
    const active = run.nodeRuns.find(step => step.nodeId === run.activeNodeId);
    const label = `${run.status}: ${active?.nodeId || 'waiting'} · ${active?.phase || ''}`;
    if (label !== prior) { console.log(label); prior = label; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(run.status, 'completed', run.error);
  assert.equal(run.nodeRuns.length, 5); assert.ok(run.nodeRuns.every(step => step.status === 'completed'));
  const build = run.nodeRuns.find(step => step.nodeId === 'build'), review = run.nodeRuns.find(step => step.nodeId === 'review');
  assert.match(build.text, /def add\(a, b\)/); assert.match(build.text, /return a \+ b/);
  assert.match(review.text, /\badd\b/); assert.match(review.text, /correct|sum|addition|return/i);
  assert.match(specialistPrompts[1] || '', /def add\(a, b\)/, 'The review specialist must receive the generated function as actual source context.');
  assert.ok(review.steps.some(step => step.kind === 'chat' && step.status === 'completed'), 'Agent review must invoke the real coding specialist.');
  assert.equal(studio.orchestrator.child.pid, guidePid, 'The guide must persist across the whole pipeline.');
  assert.equal(studio.llama.modelId, null, 'Release step must unload specialist memory.');
  const result = { runId: run.id, pipeline: run.pipelineName, status: run.status, guideStayedResident: true, specialistUnloaded: true, steps: run.nodeRuns.map(step => ({ nodeId: step.nodeId, status: step.status, modelName: step.modelName, text: step.text, agentSteps: step.steps?.map(child => ({ kind: child.kind, status: child.status })) })) };
  await fs.mkdir('artifacts', { recursive: true }); await fs.writeFile('artifacts/pipeline-real-check.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await studio.close(); }
