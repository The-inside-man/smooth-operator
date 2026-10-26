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
];
let state = {
  platform: 'darwin', arch: 'arm64', hostname: 'Test Mac', memory: { total: 16 * GB, free: 10 * GB }, gpu: null, libraryRoot: null, dataDir: '/local/TIM',
  config: { mainAgentModelId: '', agentMaxSteps: 4, agentTimeoutSeconds: 600, libraryRoot: '', backend: 'auto', systemPrompt: '', temperature: .7, maxTokens: 2048, context: 4096, scanlines: false },
  models: [], engines: {}, sessions: [], jobs: [], loadedModelId: null, catalog,
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
    if (endpoint === 'models/load') state.loadedModelId = data.id;
    if (endpoint === 'models/unload') state.loadedModelId = null;
    if (endpoint === 'setup') { state.runtimeSetup = { status: 'downloading' }; state.downloads = [{ id: 'guide-download', catalogId: 'qwen3-0.6b', status: 'queued', downloadedBytes: 0, totalBytes: .5 * GB }]; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(endpoint === 'state' ? state : {}) });
    if (endpoint !== 'state') await push();
  });
  await fs.mkdir('artifacts/ui', { recursive: true });
  await page.goto(base);
  await page.getByRole('button', { name: 'Set up TIM guide', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Browse model library', exact: true }).click();
  assert.equal(await page.locator('.catalog-card').count(), 3, 'Catalog should be available without a connected drive');
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
  await page.getByRole('dialog').getByRole('button', { name: 'Set up TIM guide', exact: true }).click();
  await page.getByRole('dialog').getByText('Setting up your local guide').waitFor();
  state.models = [
    { id: 'local-guide', name: 'Qwen3 0.6B', kind: 'chat', size: .5 * GB, relativePath: 'models/qwen.gguf', available: true, issue: '', validation: 'Available' },
    { id: 'local-coder', name: 'Qwen Coder', kind: 'chat', size: 2 * GB, relativePath: 'models/coder.gguf', available: true, issue: '', validation: 'Available' },
  ];
  state.catalog = state.catalog.map(entry => ['qwen3-0.6b', 'coder'].includes(entry.id) ? { ...entry, installed: true, modelId: entry.id === 'coder' ? 'local-coder' : 'local-guide' } : entry);
  state.orchestrator = { ...state.orchestrator, loaded: true, status: 'running', modelId: 'local-guide' };
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
  await page.getByRole('dialog').getByText('Resident · CPU').waitFor();
  assert.equal(await page.locator('.catalog-card').filter({ has: page.getByRole('heading', { name: 'Qwen3 0.6B', exact: true }) }).getByRole('button', { name: 'Unload', exact: true }).count(), 0, 'The resident guide must not expose an unload action');
  await page.waitForTimeout(180);
  await page.screenshot({ path: 'artifacts/ui/catalog-installed.png' });
  await coder.getByRole('button', { name: 'Unload', exact: true }).click();
  await coder.getByRole('button', { name: 'Load into memory', exact: true }).waitFor();
  await coder.getByRole('button', { name: 'Use model', exact: true }).click();
  assert.equal(await page.getByLabel('Select model', { exact: true }).inputValue(), 'local-coder');
  await page.getByRole('button', { name: 'Browse model library', exact: true }).click();
  await page.locator('.catalog-card').filter({ has: page.getByRole('heading', { name: 'Qwen3 0.6B', exact: true }) }).getByRole('button', { name: 'Use model', exact: true }).click();
  assert.equal(await page.getByLabel('Select model', { exact: true }).inputValue(), 'local-guide');
  assert.equal(await page.getByLabel('Select model', { exact: true }).isDisabled(), true, 'Choosing the guide should open Agent mode');
  await page.getByRole('button', { name: 'Browse model library', exact: true }).click();
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(180);
  await page.screenshot({ path: 'artifacts/ui/catalog-compact.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 600, height: 800 });
  await page.waitForTimeout(180);
  await page.screenshot({ path: 'artifacts/ui/catalog-narrow.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, [], 'No client errors'); assert.deepEqual(external, [], 'Catalog should not contact external sites from the browser');
  assert.ok(calls.some(call => call.endpoint === 'models/load' && call.data.id === 'local-coder'));
  assert.ok(calls.some(call => call.endpoint === 'models/cancel' && call.data.id === 'coder'));
  console.log(JSON.stringify({ catalog: 3, assertions: 'First run, search, filters, download progress, cancellation, retry, guide setup, resident guide, load/unload, selection, and responsive layout passed', clientErrors: errors, externalRequests: external }));
} finally { await browser?.close(); server.close(); }
