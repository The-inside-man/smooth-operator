import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Keep UI checks deterministic: no model weights, engines, or external network.
const GB = 1024 ** 3;
const model = (id, name, kind = 'chat') => ({ id, name, kind, size: GB, relativePath: `${id}.gguf`, available: true, issue: '', validation: 'Available' });
const state = {
  platform: 'darwin', arch: 'arm64', hostname: 'Test Mac', memory: { total: 24 * GB, free: 16 * GB }, gpu: null, libraryRoot: null, dataDir: '/local/TIM',
  config: { mainAgentModelId: 'guide', agentMaxSteps: 4, agentTimeoutSeconds: 600, libraryRoot: '', backend: 'auto', systemPrompt: '', temperature: .7, maxTokens: 2048, context: 4096, scanlines: false },
  models: [model('guide', 'Qwen3 0.6B'), model('writer', 'Qwen3 1.7B'), model('reviewer', 'Qwen3 4B'), model('coder', 'Qwen2.5 Coder 3B')], engines: {}, sessions: [], jobs: [], loadedModelId: null,
  catalog: [], downloads: [], orchestrator: { loaded: true, status: 'running', modelId: 'guide', catalogId: 'qwen3-0.6b', memoryGB: 1.6 }, runtimeSetup: { status: 'ready' }, pipelines: [], pipelineRuns: [],
};
const calls = [], errors = [], external = [];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => { try { const requestPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); const target = path.resolve('dist', '.' + (requestPath === '/' ? '/index.html' : requestPath)); if (!target.startsWith(path.resolve('dist') + path.sep)) { res.writeHead(403).end(); return; } const body = await fs.readFile(target); res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream' }).end(body); } catch { res.writeHead(404).end(); } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: process.env.TIM_BROWSER_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => { if (!req.url().startsWith(base) && !req.url().startsWith('data:') && !req.url().startsWith('blob:')) external.push(req.url()); });
  await page.addInitScript(initial => { const sources = []; window.EventSource = class { constructor() { sources.push(this); setTimeout(() => this.onmessage?.({ data: JSON.stringify(initial) }), 20); } close() {} }; window.__pushState = value => sources.forEach(source => source.onmessage?.({ data: JSON.stringify(value) })); }, state);
  const push = () => page.evaluate(value => new Promise(resolve => { window.__pushState(value); requestAnimationFrame(() => requestAnimationFrame(resolve)); }), state);
  await page.route('**/api/**', async route => {
    const endpoint = new URL(route.request().url()).pathname.replace('/api/', ''); const data = route.request().postDataJSON(); calls.push({ endpoint, data }); let body = {};
    if (endpoint === 'state') body = state;
    if (endpoint === 'pipelines/save') { const definition = { ...data.pipeline, updatedAt: Date.now() }; const existing = state.pipelines.findIndex(pipeline => pipeline.id === definition.id); if (existing >= 0) state.pipelines[existing] = definition; else state.pipelines.push(definition); body = definition; }
    if (endpoint === 'pipelines/delete') { state.pipelines = state.pipelines.filter(pipeline => pipeline.id !== data.id); body = { ok: true }; }
    if (endpoint === 'upload') body = { filename: 'uploaded-brief.txt', name: data.name };
    if (endpoint === 'pipelines/run') { const definition = structuredClone(state.pipelines.find(pipeline => pipeline.id === data.pipelineId)); const run = { id: 'run-test-1234', pipelineId: definition.id, pipelineName: definition.name, status: 'running', input: data.input, attachments: data.attachments, definition, createdAt: Date.now(), startedAt: Date.now(), activeNodeId: definition.nodes[1].id, nodeRuns: definition.nodes.map((node, index) => ({ nodeId: node.id, status: index === 0 ? 'completed' : index === 1 ? 'running' : 'pending', phase: index === 0 ? 'Complete' : index === 1 ? 'Generating brief' : 'Waiting', text: index === 0 ? data.input : index === 1 ? 'Audience: independent creators.\nGoal: a helpful product announcement.' : undefined, startedAt: index < 2 ? Date.now() - 3000 : undefined, finishedAt: index === 0 ? Date.now() - 2500 : undefined, progress: index === 1 ? .4 : undefined, modelName: index > 0 ? 'Qwen3 1.7B' : undefined })) }; state.pipelineRuns.unshift(run); state.jobs = [{ id: 'pipeline-job-1234', pipelineRunId: run.id, sessionId: '', modelId: 'pipeline', modelName: 'Pipeline: Brief', kind: 'pipeline', status: 'running', phase: 'Generating brief', progress: 25, createdAt: Date.now(), startedAt: Date.now() }]; body = run; }
    if (endpoint === 'pipelines/pause') { state.pipelineRuns[0].pauseRequested = true; body = state.pipelineRuns[0]; }
    if (endpoint === 'pipelines/resume') { state.pipelineRuns[0].status = 'running'; state.pipelineRuns[0].activeNodeId = state.pipelineRuns[0].definition.nodes[2].id; state.pipelineRuns[0].nodeRuns[2].status = 'running'; body = state.pipelineRuns[0]; }
    if (endpoint === 'pipelines/cancel') { state.pipelineRuns[0].status = 'cancelled'; body = state.pipelineRuns[0]; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }); if (endpoint !== 'state') await push();
  });
  await fs.mkdir('artifacts/ui', { recursive: true });
  await page.goto(base);
  await page.getByRole('button', { name: 'Pipelines', exact: true }).click();
  await page.getByLabel('Pipeline studio', { exact: true }).waitFor();
  assert.equal(await page.locator('.pf-node').count(), 4);
  assert.equal(await page.locator('.pf-edge').count(), 4, 'Review joins both the brief and draft');
  assert.equal(await page.getByLabel('Step model', { exact: true }).inputValue(), 'writer');
  await page.getByLabel('Step name', { exact: true }).fill('Creative strategist');
  await page.getByLabel('Step memory policy', { exact: true }).selectOption('keep');
  await page.getByRole('button', { name: 'Step 4: Review & refine', exact: true }).click();
  assert.equal(await page.getByLabel('Step model', { exact: true }).inputValue(), 'reviewer', 'Template can use different installed models');
  await page.getByLabel('Step system instructions', { exact: true }).count().then(count => assert.equal(count, 1));
  await page.getByRole('button', { name: 'Add step', exact: true }).click();
  await page.locator('.pf-add-menu').getByRole('button', { name: 'Code Generate or review code as text', exact: false }).click();
  assert.equal(await page.locator('.pf-node').count(), 5);
  await page.getByLabel('Step name', { exact: true }).fill('Build landing page');
  assert.equal(await page.getByLabel('Step model', { exact: true }).inputValue(), 'coder');
  await page.getByRole('button', { name: 'Delete selected step', exact: true }).click();
  assert.equal(await page.locator('.pf-node').count(), 4);
  await page.getByRole('button', { name: 'Step 2: Creative strategist', exact: true }).click();
  const node = page.getByRole('button', { name: 'Step 2: Creative strategist', exact: true }); const before = await node.getAttribute('style'); const box = await node.boundingBox();
  await page.mouse.move(box.x + 95, box.y + 32); await page.mouse.down(); await page.mouse.move(box.x + 105, box.y - 24, { steps: 6 }); await page.mouse.up();
  assert.notEqual(await node.getAttribute('style'), before, 'Nodes can be repositioned');
  await page.getByRole('button', { name: 'Fit pipeline to view', exact: true }).click();
  await page.getByLabel('Pipeline run input', { exact: true }).fill('Announce a local-first creative tool for independent makers.');
  await page.getByLabel('Attach pipeline files', { exact: true }).setInputFiles({ name: 'brief.txt', mimeType: 'text/plain', buffer: Buffer.from('Keep the message practical and clear.') });
  await page.locator('.pf-attached-files').getByText('brief.txt', { exact: true }).waitFor();
  const draftPosition = await node.getAttribute('style');
  const draftView = await page.locator('.pf-canvas-world').getAttribute('style');
  const workspaceNav = page.getByRole('navigation', { name: 'Workspace', exact: true });
  await workspaceNav.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByLabel('Pipeline studio', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.pipeline-host .pf-node').count(), 4, 'Pipeline workspace remains mounted while Chat is open');
  await workspaceNav.getByRole('button', { name: 'Pipelines', exact: true }).click();
  await page.getByLabel('Pipeline studio', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Step name', { exact: true }).inputValue(), 'Creative strategist', 'Unsaved step edits survive Chat → Pipelines navigation');
  assert.equal(await page.getByLabel('Step memory policy', { exact: true }).inputValue(), 'keep');
  assert.equal(await node.getAttribute('style'), draftPosition, 'Dragged graph positions survive navigation');
  assert.equal(await page.locator('.pf-canvas-world').getAttribute('style'), draftView, 'Canvas pan and zoom survive navigation');
  assert.equal(await page.getByLabel('Pipeline run input', { exact: true }).inputValue(), 'Announce a local-first creative tool for independent makers.');
  await page.locator('.pf-attached-files').getByText('brief.txt', { exact: true }).waitFor();
  assert.equal(state.pipelines.length, 0, 'Navigation preserves the draft without silently saving it');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Pipeline saved on this machine.', { exact: true }).waitFor();
  assert.equal(state.pipelines[0].nodes[1].name, 'Creative strategist');
  assert.equal(state.pipelines[0].nodes[1].memoryPolicy, 'keep');
  await page.screenshot({ path: 'artifacts/ui/pipelines-builder.png' });
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export', exact: true }).click(); const download = await downloadPromise; assert.equal(download.suggestedFilename(), 'brief-draft-review.json');
  await page.getByRole('button', { name: 'Run pipeline', exact: true }).click();
  await page.getByText('Generating brief', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: 'Step 2: Creative strategist', exact: true }).click();
  await page.locator('.pf-output-text').getByText('Audience: independent creators.', { exact: false }).waitFor();
  assert.equal(await page.locator('.pf-node-progress>span').getAttribute('style'), 'width: 40%;', 'UI uses actual fractional engine progress');
  await page.screenshot({ path: 'artifacts/ui/pipelines-running.png' });
  const decoy = structuredClone(state.pipelineRuns[0]); decoy.id = 'run-different-5678'; decoy.pipelineName = 'Different local run'; decoy.definition.name = 'Another pipeline'; decoy.nodeRuns[1].text = 'Output from a different run'; state.pipelineRuns.push(decoy); await push();
  await page.locator('.pf-run-item').filter({ hasText: 'Different local run' }).click();
  await page.locator('.pf-output-text').getByText('Output from a different run', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Edit pipeline', exact: true }).click();
  await workspaceNav.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.locator('.jobs').getByRole('button', { name: 'Pipeline: Brief', exact: true }).click();
  await page.getByRole('button', { name: 'Edit pipeline', exact: true }).waitFor();
  await page.locator('.pf-output-text').getByText('Audience: independent creators.', { exact: false }).waitFor();
  assert.equal(await page.locator('.pf-recipe.selected').textContent().then(text => text.includes('Brief → draft → review')), true, 'Queue jobs open their exact pipeline run');
  await page.getByRole('button', { name: 'Edit pipeline', exact: true }).click();
  await workspaceNav.getByRole('button', { name: 'Chat', exact: true }).click();
  await workspaceNav.getByRole('button', { name: 'Pipelines', exact: true }).click();
  await page.getByLabel('Pipeline name', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Edit pipeline', exact: true }).count(), 0, 'Ordinary navigation does not reapply a previous run request');
  await workspaceNav.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.locator('.jobs').getByRole('button', { name: 'Pipeline: Brief', exact: true }).click();
  await page.getByRole('button', { name: 'Edit pipeline', exact: true }).waitFor();
  await page.locator('.pf-output-text').getByText('Audience: independent creators.', { exact: false }).waitFor();
  assert.equal(await page.locator('.pf-node-progress>span').getAttribute('style'), 'width: 40%;', 'The same queue job can request its run again after returning to the builder');
  await workspaceNav.getByRole('button', { name: 'Chat', exact: true }).click();
  await workspaceNav.getByRole('button', { name: 'Pipelines', exact: true }).click();
  await page.locator('.pf-output-text').getByText('Audience: independent creators.', { exact: false }).waitFor();
  assert.equal(await page.locator('.pf-node-progress>span').getAttribute('style'), 'width: 40%;', 'Active run selection and progress survive navigation');
  state.pipelineRuns = state.pipelineRuns.filter(run => run.id !== decoy.id); await push();
  await page.getByRole('button', { name: 'Pause after step', exact: true }).click();
  await page.getByRole('button', { name: 'Pausing…', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Pausing…', exact: true }).isDisabled(), true);
  const run = state.pipelineRuns[0]; run.status = 'paused'; delete run.pauseRequested; run.nodeRuns[1].status = 'completed'; run.nodeRuns[1].finishedAt = Date.now(); run.nodeRuns[1].text = 'A complete creative brief.'; delete run.activeNodeId; await push();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  assert.equal(state.pipelineRuns[0].nodeRuns[1].text, 'A complete creative brief.');
  await page.getByRole('button', { name: 'Cancel pipeline run', exact: true }).click();
  await page.getByText('Pipeline cancelled', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Edit pipeline', exact: true }).click();
  await page.getByRole('button', { name: 'Image finishing studio Generate, then upscale', exact: false }).click();
  await page.getByRole('button', { name: '2 to configure', exact: true }).click();
  await page.getByText('Generate image: choose an available local model.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Run pipeline', exact: true }).click();
  assert.equal(calls.filter(call => call.endpoint === 'pipelines/run').length, 1, 'Unavailable models block a run');
  await page.getByRole('button', { name: 'Close validation', exact: true }).click();
  await page.getByRole('button', { name: 'Brief → draft → review A local writing room', exact: false }).click();
  await page.getByRole('button', { name: 'Step 2: Shape the brief', exact: true }).click();
  await page.getByRole('button', { name: 'Connect from Shape the brief', exact: true }).click();
  await page.getByRole('button', { name: 'Connect to Starting idea', exact: true }).click();
  await page.getByRole('button', { name: '1 to configure', exact: true }).click();
  await page.getByText('Connections contain a loop. Each step must flow forward.', { exact: true }).waitFor();
  const imported = structuredClone(state.pipelines[0]); imported.name = 'Imported local recipe';
  await page.getByLabel('Import pipeline file', { exact: true }).setInputFiles({ name: 'recipe.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  await page.getByText('Imported a copy. Check local model choices before running.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Pipeline name', { exact: true }).inputValue(), 'Imported local recipe');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  assert.equal(state.pipelines.length, 2);
  await page.getByRole('button', { name: 'Delete saved pipeline', exact: true }).click();
  await page.getByText('Saved pipeline deleted. Run history is retained.', { exact: true }).waitFor();
  assert.equal(state.pipelines.length, 1); assert.equal(state.pipelineRuns.length, 1);
  await page.getByRole('tab', { name: 'Runs 1', exact: true }).click();
  const interrupted = state.pipelineRuns[0]; interrupted.status = 'interrupted'; interrupted.error = 'Interrupted when the app closed.'; await push();
  await page.locator('.pf-run-item').first().click();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  assert.equal(state.pipelineRuns[0].nodeRuns[1].text, 'A complete creative brief.', 'Interrupted runs preserve completed results');
  await page.getByRole('button', { name: 'Cancel pipeline run', exact: true }).click();
  await page.getByRole('button', { name: 'Edit pipeline', exact: true }).click();
  await page.setViewportSize({ width: 1024, height: 768 }); await page.getByRole('button', { name: 'Fit pipeline to view', exact: true }).click(); await page.screenshot({ path: 'artifacts/ui/pipelines-compact.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 600, height: 800 }); await page.getByRole('button', { name: 'Fit pipeline to view', exact: true }).click(); await page.screenshot({ path: 'artifacts/ui/pipelines-narrow.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, [], 'No client errors'); assert.deepEqual(external, [], 'Pipelines never contact external services');
  assert.ok(calls.some(call => call.endpoint === 'pipelines/run' && call.data.attachments.includes('uploaded-brief.txt')));
  console.log(JSON.stringify({ assertions: 'Graph editing, exact queue-job run navigation, unsaved draft and run persistence across Chat navigation, model selection, memory policies, drag, joining dependencies, save, files, export/import, execution progress, output, pause/resume/cancel, missing-model and cycle validation, responsive layout passed', clientErrors: errors, externalRequests: external }));
} finally { await browser?.close(); server.close(); }
