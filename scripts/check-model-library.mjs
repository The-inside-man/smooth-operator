import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Exercise first-run catalog/setup, then download and memory controls without
// downloading model weights or depending on a particular developer's library.
const GB = 1024 ** 3;
const catalog = [
  { id: 'qwen3-0.6b', name: 'Qwen3 0.6B', kind: 'chat', description: 'A compact guide for everyday questions and choosing the right specialist.', bestFor: ['Model guidance', 'Everyday questions'], parameterSize: '0.6B', quantization: 'Q4_K_M', downloadBytes: .5 * GB, memoryGB: 1, license: 'Apache 2.0', sourceUrl: 'https://huggingface.co/Qwen/Qwen3-0.6B-GGUF', defaultOrchestrator: true },
  { id: 'coder', name: 'Qwen Coder', kind: 'chat', description: 'A specialist for writing, explaining, and debugging code.', bestFor: ['Coding', 'Debugging'], parameterSize: '3B', quantization: 'Q4_K_M', downloadBytes: 2 * GB, memoryGB: 3.5, license: 'Apache 2.0', sourceUrl: 'https://huggingface.co/Qwen' },
  { id: 'whisper', name: 'Whisper Small', kind: 'transcribe', description: 'Turn local audio recordings into written text.', bestFor: ['Transcription', 'Interviews'], downloadBytes: .5 * GB, memoryGB: 1, license: 'MIT', sourceUrl: 'https://huggingface.co/ggerganov' },
  { id: 'qwen-image', name: 'Qwen Image', kind: 'image', description: 'A large image model for photographic scenes and detailed text rendering.', bestFor: ['Photorealism', 'Text in images'], parameterSize: '20B', quantization: 'Q4_K_M', downloadBytes: 17 * GB, memoryGB: 24, license: 'Apache 2.0', sourceUrl: 'https://huggingface.co/unsloth/Qwen-Image-GGUF', publisherUrl: 'https://huggingface.co/Qwen/Qwen-Image', licenseUrl: 'https://huggingface.co/Qwen/Qwen-Image/blob/main/LICENSE', imageUseCases: ['photorealism'], inputMode: 'none', bundleFiles: 3, requirements: ['Includes text encoder and VAE companion weights.', 'Requires a compatible stable-diffusion.cpp image engine.'] },
  { id: 'qwen-edit', name: 'Qwen Image Edit', kind: 'image', description: 'Reference-guided edits that aim to keep a consistent subject while changing the scene.', bestFor: ['Subject consistency', 'Reference editing'], parameterSize: '20B', quantization: 'Q4_K_M', downloadBytes: 18 * GB, memoryGB: 28, license: 'Apache 2.0', sourceUrl: 'https://huggingface.co/unsloth/Qwen-Image-Edit-GGUF', publisherUrl: 'https://huggingface.co/Qwen/Qwen-Image-Edit', imageUseCases: ['photorealism', 'reference-editing', 'identity'], requiresReference: true, inputMode: 'reference', bundleFiles: 3, requirements: ['Attach one reference photo before running.', 'Includes text encoder and VAE companion weights.', 'Identity retention varies with the reference and edit.'] },
  { id: 'realvis', name: 'RealVis XL', kind: 'image', description: 'An SDXL checkpoint for realistic portraits and photographic lighting.', bestFor: ['Portraits', 'Photography'], parameterSize: 'SDXL', quantization: 'FP16', downloadBytes: 6.5 * GB, memoryGB: 12, license: 'Creator terms', sourceUrl: 'https://huggingface.co/SG161222/RealVisXL_V5.0', imageUseCases: ['photorealism'], inputMode: 'img2img', bundleFiles: 1, requirements: ['Image-to-image changes an image; it is not a dedicated identity adapter.'] },
];
let state = {
  platform: 'darwin', arch: 'arm64', hostname: 'Test Mac', memory: { total: 16 * GB, free: 10 * GB, totalBytes: 16 * GB, availableBytes: 10 * GB, usedBytes: 6 * GB, reserveBytes: 1.6 * GB, modelBudgetBytes: 8.4 * GB, modelRssBytes: null, sampledAt: Date.now(), availableSource: 'os', status: 'ok' }, gpu: null, libraryRoot: null, dataDir: '/local/TIM',
  config: { mainAgentModelId: '', agentMaxSteps: 4, agentTimeoutSeconds: 600, libraryRoot: '', backend: 'auto', systemPrompt: '', temperature: .7, maxTokens: 2048, context: 4096, scanlines: false },
  models: [], engines: {}, sessions: [], jobs: [], loadedModelId: null, loadedModels: [], catalog,
  downloads: [], orchestrator: { loaded: false, status: 'not-installed', catalogId: 'qwen3-0.6b', memoryGB: 1 }, runtimeSetup: { status: 'idle' },
};
const calls = [];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    const requestPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const target = path.resolve('dist', '.' + (requestPath === '/' ? '/index.html' : requestPath));
    if (!target.startsWith(path.resolve('dist') + path.sep)) { res.writeHead(403).end(); return; }
    const body = await fs.readFile(target); res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: process.env.TIM_BROWSER_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 960 } });
  const errors = []; const external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith(base) && !request.url().startsWith('data:')) external.push(request.url()); });
  await page.addInitScript(initial => {
    const sources = [];
    window.EventSource = class { constructor() { sources.push(this); setTimeout(() => this.onmessage?.({ data: JSON.stringify(initial) }), 20); } close() {} };
    window.__pushState = value => sources.forEach(source => source.onmessage?.({ data: JSON.stringify(value) }));
  }, state);
  const push = () => page.evaluate(value => new Promise(resolve => { window.__pushState(value); requestAnimationFrame(() => requestAnimationFrame(resolve)); }), state);
  await page.route('**/api/**', async route => {
    const endpoint = new URL(route.request().url()).pathname.replace('/api/', '');
    const data = route.request().postDataJSON(); calls.push({ endpoint, data });
    if (endpoint === 'models/download') state.downloads = [{ id: 'download-1', catalogId: data.id, status: 'downloading', downloadedBytes: .5 * GB, totalBytes: 2 * GB }];
    if (endpoint === 'models/cancel') state.downloads = state.downloads.map(item => item.catalogId === data.id ? { ...item, status: 'cancelled' } : item);
    if (endpoint === 'models/load') {
      const model = state.models.find(model => model.id === data.id);
      state.loadedModelId = data.id;
      if (!state.loadedModels.some(model => model.modelId === data.id)) state.loadedModels.push({ modelId: data.id, name: model.name, role: 'specialist', rssBytes: data.id === 'local-coder' ? 3.2 * GB : null, estimatedBytes: data.id === 'local-coder' ? 3.5 * GB : 1.5 * GB, memorySource: data.id === 'local-coder' ? 'measured' : 'estimate' });
    }
    if (endpoint === 'models/unload') {
      state.loadedModels = state.loadedModels.filter(model => model.modelId !== data.id);
      if (state.loadedModelId === data.id) state.loadedModelId = null;
    }
    if (endpoint === 'setup') { state.runtimeSetup = { status: 'downloading' }; state.downloads = [{ id: 'guide-download', catalogId: 'qwen3-0.6b', status: 'queued', downloadedBytes: 0, totalBytes: .5 * GB }]; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(endpoint === 'state' ? state : {}) });
    if (endpoint !== 'state') await push();
  });
  await fs.mkdir('artifacts/ui', { recursive: true });
  await page.goto(base);
  await page.getByRole('button', { name: 'Set up TIM guide', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Browse model library', exact: true }).click();
  assert.equal(await page.locator('.catalog-card').count(), 6, 'Catalog should be available without a connected drive');
  const memory = page.getByRole('region', { name: 'Memory on this machine' });
  assert.equal(await memory.getByTestId('memory-available').innerText(), '10.0 GiB');
  assert.equal(await memory.getByTestId('memory-budget').innerText(), '8.4 GiB');
  await memory.getByText('No models loaded yet.', { exact: false }).waitFor();
  await page.waitForTimeout(180);
  await page.screenshot({ path: 'artifacts/ui/catalog-first-run.png' });
  await page.getByRole('tab', { name: 'Installed' }).click();
  await page.getByText('Your local collection starts here.').waitFor();
  await page.getByRole('button', { name: 'Explore the catalog' }).click();
  await page.getByLabel('Search models', { exact: true }).fill('debugging');
  assert.equal(await page.locator('.catalog-card').count(), 1, 'Search should include tasks');
  const coder = page.locator('.catalog-card').filter({ has: page.getByRole('heading', { name: 'Qwen Coder', exact: true }) });
  await coder.getByRole('button', { name: 'Download model', exact: true }).click();
  await coder.getByRole('progressbar').waitFor();
  assert.equal(await coder.getByRole('progressbar').getAttribute('aria-valuenow'), '25');
  await coder.getByRole('button', { name: 'Cancel download', exact: true }).click();
  await coder.getByRole('button', { name: 'Resume download', exact: true }).waitFor();
  state.downloads = [{ id: 'download-1', catalogId: 'coder', status: 'failed', downloadedBytes: .5 * GB, totalBytes: 2 * GB, error: 'Connection interrupted' }];
  await push();
  await coder.getByText('Download failed: Connection interrupted').waitFor();
  await coder.getByRole('button', { name: 'Retry download', exact: true }).click();
  await coder.getByRole('progressbar').waitFor();
  await page.getByLabel('Search models', { exact: true }).fill('');
  await page.getByLabel('Model category', { exact: true }).selectOption('transcribe');
  assert.equal(await page.locator('.catalog-card').count(), 1);
  await page.getByLabel('Model category', { exact: true }).selectOption('all');
  await page.getByRole('tab', { name: 'Installed' }).click();
  await page.getByLabel('Search models', { exact: true }).fill('old query');
  await page.getByRole('button', { name: 'Identity & editing', exact: true }).click();
  assert.equal(await page.getByRole('tab', { name: 'All models', exact: true }).getAttribute('aria-selected'), 'true', 'Task presets must show downloadable models even when starting from Installed');
  assert.equal(await page.getByLabel('Search models', { exact: true }).inputValue(), '', 'Task presets must clear conflicting searches');
  assert.equal(await page.locator('.catalog-card').count(), 1, 'General image-to-image checkpoints must not be labeled as identity editing models');
  const imageEdit = page.locator('.catalog-card').filter({ has: page.getByRole('heading', { name: 'Qwen Image Edit', exact: true }) });
  await imageEdit.getByText('Reference image required', { exact: true }).waitFor();
  await imageEdit.getByText('18.0 GiB', { exact: true }).waitFor();
  await imageEdit.getByText('· 3 files', { exact: false }).waitFor();
  await imageEdit.getByText('Image inference not yet tested here', { exact: true }).waitFor();
  await imageEdit.getByText('Identity retention varies with the reference and edit.', { exact: true }).waitFor();
  assert.equal(await imageEdit.getByRole('link', { name: 'Model card', exact: true }).getAttribute('href'), 'https://huggingface.co/Qwen/Qwen-Image-Edit');
  assert.equal(await imageEdit.getByRole('link', { name: 'Model card', exact: true }).getAttribute('rel'), 'noopener noreferrer');
  await page.evaluate(() => { window.__openedSources = []; window.timDesktop = { openExternal: async url => { window.__openedSources.push(url); return true; } }; });
  await imageEdit.getByRole('link', { name: 'Model card', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__openedSources), ['https://huggingface.co/Qwen/Qwen-Image-Edit'], 'Desktop model cards must use the explicit external-link bridge');
  await page.evaluate(() => { delete window.timDesktop; });
  await page.getByRole('button', { name: 'Photorealism', exact: true }).click();
  assert.equal(await page.locator('.catalog-card').count(), 3);
  const realvis = page.locator('.catalog-card').filter({ has: page.getByRole('heading', { name: 'RealVis XL', exact: true }) });
  await realvis.getByText('Text or image-to-image', { exact: true }).waitFor();
  assert.equal(await realvis.getByText('Reference image required', { exact: true }).count(), 0, 'Optional input images must not be shown as required');
  await page.locator('.library-modal').evaluate(element => { element.scrollTop += element.querySelector('.library-tabs').getBoundingClientRect().top - element.getBoundingClientRect().top - 75; });
  await page.waitForTimeout(180);
  await page.screenshot({ path: 'artifacts/ui/catalog-image-options.png' });
  await page.getByLabel('Search models', { exact: true }).fill('companion weights');
  assert.equal(await page.locator('.catalog-card').count(), 2, 'Search should include practical model requirements');
  await page.getByRole('button', { name: 'All tasks', exact: true }).click();
  assert.equal(await page.locator('.catalog-card').count(), 6);
  await page.getByRole('dialog').getByRole('button', { name: 'Set up TIM guide', exact: true }).click();
  await page.getByRole('dialog').getByText('Setting up your local guide').waitFor();
  state.models = [
    { id: 'local-guide', name: 'Qwen3 0.6B', kind: 'chat', size: .5 * GB, relativePath: 'models/qwen.gguf', available: true, issue: '', validation: 'Available' },
    { id: 'local-coder', name: 'Qwen Coder', kind: 'chat', size: 2 * GB, relativePath: 'models/coder.gguf', available: true, issue: '', validation: 'Available' },
    { id: 'local-reviewer', name: 'Local Reviewer', kind: 'chat', size: GB, relativePath: 'models/reviewer.gguf', available: true, issue: '', validation: 'Available' },
  ];
  state.catalog = state.catalog.map(entry => ['qwen3-0.6b', 'coder'].includes(entry.id) ? { ...entry, installed: true, modelId: entry.id === 'coder' ? 'local-coder' : 'local-guide' } : entry);
  state.orchestrator = { ...state.orchestrator, loaded: true, status: 'running', modelId: 'local-guide' };
  state.loadedModels = [{ modelId: 'local-guide', name: 'Qwen3 0.6B', role: 'guide', rssBytes: .8 * GB, estimatedBytes: GB, memorySource: 'measured' }];
  state.config.mainAgentModelId = 'local-guide'; state.runtimeSetup = { status: 'ready' }; state.downloads = [];
  await push();
  await page.getByRole('dialog').getByText('Your guide is in memory').waitFor();
  await page.getByRole('tab', { name: 'Installed' }).click();
  assert.equal(await page.locator('.catalog-card').count(), 2);
  state.loadingModel = true; await push();
  await coder.getByRole('button', { name: 'Load into memory', exact: true }).isDisabled().then(disabled => assert.equal(disabled, true, 'Competing model loads should be disabled'));
  state.loadingModel = false; await push();
  await coder.getByRole('button', { name: 'Load into memory', exact: true }).click();
  await coder.getByText('IN MEMORY', { exact: true }).waitFor();
  assert.equal(await memory.locator('.memory-model').count(), 2, 'The guide and specialist should both remain loaded');
  await memory.locator('[data-model-id="local-coder"]').getByText('3.2 GiB', { exact: true }).waitFor();
  await memory.locator('[data-model-id="local-coder"]').getByText('Process RAM · RSS', { exact: true }).waitFor();
  await page.getByRole('dialog').getByText('Resident · CPU').waitFor();
  assert.equal(await page.locator('.catalog-card').filter({ has: page.getByRole('heading', { name: 'Qwen3 0.6B', exact: true }) }).getByRole('button', { name: 'Unload', exact: true }).count(), 0, 'The resident guide must not expose an unload action');
  assert.equal(await memory.locator('[data-model-id="local-guide"]').getByRole('button').count(), 0, 'The persistent guide must not expose a row unload action');
  const reviewer = page.locator('.model-card').filter({ has: page.getByRole('heading', { name: 'Local Reviewer', exact: true }) });
  await reviewer.getByRole('button', { name: 'Load into memory', exact: true }).click();
  await memory.locator('[data-model-id="local-reviewer"]').waitFor();
  assert.equal(await memory.locator('.memory-model').count(), 3, 'Loading another model must keep existing models in memory');
  await memory.locator('[data-model-id="local-reviewer"]').getByText('Memory estimate', { exact: true }).waitFor();
  await coder.getByText('IN MEMORY', { exact: true }).waitFor();
  state.memory = { ...state.memory, availableBytes: 4 * GB, usedBytes: 12 * GB, modelBudgetBytes: 2.4 * GB, modelRssBytes: 4 * GB };
  await push();
  assert.equal(await memory.getByTestId('memory-available').innerText(), '4.0 GiB', 'Host usage should refresh from live state');
  assert.equal(await memory.getByRole('meter').getAttribute('aria-valuenow'), '75');
  state.loadedModels.push({ modelId: 'local-media', name: 'Local Image Model', role: 'media', rssBytes: null, estimatedBytes: null, memorySource: 'unavailable' });
  await push();
  const media = memory.locator('[data-model-id="local-media"]');
  await media.getByText('Running task · Unloads when finished', { exact: true }).waitFor();
  assert.equal(await media.getByRole('button').count(), 0, 'An active media process is released by its job, not the preload control');
  await media.getByText('Unavailable', { exact: true }).waitFor();
  state.loadedModels = state.loadedModels.filter(model => model.modelId !== 'local-media'); await push();
  await page.waitForTimeout(180);
  await page.locator('.library-modal').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: 'artifacts/ui/catalog-installed.png' });
  await memory.getByRole('button', { name: 'Unload Qwen Coder', exact: true }).click();
  await coder.getByRole('button', { name: 'Load into memory', exact: true }).waitFor();
  assert.equal(await memory.locator('.memory-model').count(), 2, 'Targeted unload should retain other models');
  await memory.locator('[data-model-id="local-reviewer"]').waitFor();
  assert.equal(calls.at(-1).data.id, 'local-coder');
  state.memory = { ...state.memory, availableBytes: 2 * GB, usedBytes: 14 * GB, modelBudgetBytes: .4 * GB };
  await push();
  await memory.getByText('Limited room for another model', { exact: true }).waitFor();
  await coder.getByText('Above current 410 MiB planning room', { exact: false }).waitFor();
  assert.equal(await coder.getByRole('button', { name: 'Load into memory', exact: true }).isEnabled(), true, 'The server must recheck current capacity rather than locking on an old reading');
  assert.equal(await coder.getByRole('button', { name: 'Use model', exact: true }).isEnabled(), true, 'Pressure must not disable selecting a model');
  await page.getByRole('tab', { name: 'All models', exact: true }).click();
  assert.equal(await page.locator('.catalog-card').filter({ has: page.getByRole('heading', { name: 'Whisper Small', exact: true }) }).getByRole('button', { name: 'Download model', exact: true }).isEnabled(), true, 'Pressure must not disable downloading a model to disk');
  await page.getByRole('tab', { name: 'Installed', exact: false }).click();
  state.memory = { ...state.memory, availableBytes: null, modelBudgetBytes: null, status: 'stale', stale: true };
  await push();
  await memory.getByText('Updating reading…', { exact: true }).waitFor();
  assert.equal(await memory.getByTestId('memory-available').innerText(), 'Unavailable', 'Missing telemetry must not become a zero reading');
  await coder.getByText('Live memory headroom unavailable', { exact: true }).waitFor();
  state.memory = { ...state.memory, availableBytes: 8 * GB, usedBytes: 8 * GB, modelBudgetBytes: 6.4 * GB, status: 'ok', stale: false, availableSource: 'reclaimable-estimate' };
  await push();
  await memory.getByText('AVAILABLE RAM · ESTIMATE', { exact: true }).waitFor();
  await coder.getByRole('button', { name: 'Use model', exact: true }).click();
  assert.equal(await page.getByLabel('Select model', { exact: true }).inputValue(), 'local-coder');
  await page.getByRole('button', { name: 'Browse model library', exact: true }).click();
  await page.locator('.catalog-card').filter({ has: page.getByRole('heading', { name: 'Qwen3 0.6B', exact: true }) }).getByRole('button', { name: 'Use model', exact: true }).click();
  assert.equal(await page.getByLabel('Select model', { exact: true }).inputValue(), 'local-guide');
  assert.equal(await page.getByLabel('Select model', { exact: true }).isDisabled(), true, 'Choosing the guide should open Agent mode');
  await page.getByRole('button', { name: 'Browse model library', exact: true }).click();
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.locator('.library-modal').evaluate(element => { element.scrollTop = 0; });
  await page.waitForTimeout(180);
  await page.screenshot({ path: 'artifacts/ui/catalog-compact.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 600, height: 800 });
  await page.locator('.library-modal').evaluate(element => { element.scrollTop = 0; });
  await page.waitForTimeout(180);
  await page.screenshot({ path: 'artifacts/ui/catalog-narrow.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.library-modal').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: 'artifacts/ui/catalog-phone.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await memory.evaluate(element => element.scrollWidth > element.clientWidth), false, 'Memory panel must not overflow on a narrow screen');
  state.loadedModelId = 'local-coder'; delete state.loadedModels;
  await push();
  assert.equal(await memory.locator('.memory-model').count(), 2, 'Older state should still show the guide and active model');
  state.loadedModels = []; state.loadedModelId = null; state.orchestrator.loaded = false;
  await push();
  await memory.getByText('No models loaded yet.', { exact: false }).waitFor();
  // Render the actual curated image metadata as well as the focused fixture.
  // No weights are fetched and this does not claim inference was run.
  const { catalogModels } = await import('../server/catalog.mjs');
  const imageCatalog = catalogModels.filter(entry => entry.kind === 'image').map(({ files, profile, ...entry }) => ({ ...entry, bundleFiles: files.length, inputMode: profile.inputMode, requiresReference: !!profile.requiresReference }));
  state.catalog = imageCatalog; state.models = []; state.downloads = [];
  state.memory = { ...state.memory, total: 64 * GB, free: 40 * GB, totalBytes: 64 * GB, availableBytes: 40 * GB, usedBytes: 24 * GB, reserveBytes: 6.4 * GB, modelBudgetBytes: 33.6 * GB, availableSource: 'os' };
  await push();
  await page.setViewportSize({ width: 1500, height: 1200 });
  await page.getByRole('button', { name: 'Identity & editing', exact: true }).click();
  assert.ok(await page.locator('.catalog-card').count() >= 3, 'The actual curated catalog should offer several reference-aware choices');
  await page.locator('.library-modal').evaluate(element => { element.scrollTop += element.querySelector('.library-tabs').getBoundingClientRect().top - element.getBoundingClientRect().top - 75; });
  await page.waitForTimeout(180);
  await page.screenshot({ path: 'artifacts/ui/catalog-image-catalog.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Image requirements and discovery controls must fit a narrow viewport');
  assert.equal(await page.locator('.library-task-filters').evaluate(element => element.scrollWidth > element.clientWidth), false, 'Image task filters must wrap on a narrow viewport');
  // Selecting an installed editing bundle should explain the input and use its
  // actual starting resolution, without submitting a generation or loading weights.
  await page.setViewportSize({ width: 1500, height: 960 });
  state.models = [{ id: 'installed-edit', name: 'Qwen Image Edit 2511', kind: 'image', size: 17 * GB, relativePath: 'models/edit.gguf', available: true, issue: '', validation: 'Download verified', inputMode: 'reference', requiresReference: true, defaults: { width: 1024, height: 1024, steps: 40, cfg: 2.5 } }];
  state.catalog = state.catalog.map(entry => entry.id === 'qwen-image-edit-2511' ? { ...entry, installed: true, modelId: 'installed-edit' } : entry);
  await push();
  await page.locator('.catalog-card').filter({ has: page.getByRole('heading', { name: 'Qwen Image Edit 2511', exact: true }) }).getByRole('button', { name: 'Use model', exact: true }).click();
  await page.getByText('Reference image required. Attach a photo, then describe what to change and what to keep.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Generation controls', exact: true }).click();
  assert.equal(await page.getByLabel('width', { exact: true }).inputValue(), '1024');
  assert.equal(await page.getByLabel('height', { exact: true }).inputValue(), '1024');
  state.sessions = [{ id: 'context-notice', title: 'Code context check', messages: [
    { id: 'context-user', role: 'user', content: 'Write an add function.', createdAt: new Date().toISOString() },
    { id: 'context-answer', role: 'assistant', content: '```python\ndef add(a, b):\n    return a + b\n```', status: 'completed', createdAt: new Date().toISOString(), contextUsage: { removedMessages: 8, promptTokens: 1100, contextTokens: 4096, responseTokens: 1024, method: 'tokenizer' } }
  ] }];
  await push();
  await page.getByText('Earlier conversation messages were left out to fit this model. Your latest request was kept in full.', { exact: true }).waitFor();
  const generatedCode = await page.locator('.message.assistant .code-block pre').innerText();
  assert.match(generatedCode, /def add\(a, b\)/);
  assert.ok(!generatedCode.includes('Earlier conversation'), 'Context notices must stay outside generated code');
  state.sessions[0].messages[1].content = '';
  await push();
  await page.getByText('No answer was returned for this completed job. Please send the request again.', { exact: true }).waitFor();
  await page.getByText('Earlier conversation messages were left out to fit this model. Your latest request was kept in full.', { exact: true }).waitFor();
  assert.equal(await page.locator('.message.assistant .code-block').count(), 0, 'A legacy blank completion must show an explanation rather than an empty answer');
  assert.deepEqual(errors, [], 'No client errors'); assert.deepEqual(external, [], 'Catalog should not contact external sites from the browser');
  assert.ok(calls.some(call => call.endpoint === 'models/load' && call.data.id === 'local-coder'));
  assert.ok(calls.some(call => call.endpoint === 'models/cancel' && call.data.id === 'coder'));
  console.log(JSON.stringify({ catalog: 6, actualImageOptions: imageCatalog.length, assertions: 'First run, task discovery from Installed, reference editing versus image-to-image, bundle requirements and model-card links, download versus inference validation, actual image catalog, search, filters, downloads, guide setup, live memory and headroom, measured versus estimated usage, multiple loaded models, targeted unload, telemetry unavailable/stale, legacy state, selection, responsive layout, context notices outside code, and legacy blank completion feedback passed', clientErrors: errors, externalRequests: external }));
} finally { await browser?.contexts()[0]?.pages()[0]?.unrouteAll({ behavior: 'ignoreErrors' }); await browser?.close(); server.close(); }
