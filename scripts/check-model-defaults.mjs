import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Saved preferences are served by an isolated fixture. No real settings,
// model files, engines, or user conversations are read or changed.
const GB = 1024 ** 3;
const fixtureModel = (id, name, kind, gb) => ({ id, name, kind, size: gb * GB, relativePath: `models/${id}.gguf`, available: true, issue: '', validation: 'Available' });
let state = {
  platform: 'darwin', arch: 'arm64', hostname: 'Model preference test',
  memory: { total: 24 * GB, free: 16 * GB, totalBytes: 24 * GB, availableBytes: 16 * GB, usedBytes: 8 * GB, reserveBytes: 2.4 * GB, modelBudgetBytes: 13.6 * GB, status: 'ok' },
  gpu: null, libraryRoot: null, dataDir: '/local/fixture/TIM',
  config: { mainAgentModelId: 'small-chat', defaultMode: 'chat', defaultModels: { chat: 'large-chat', code: 'coding-model', image: 'image-one', upscale: 'upscale-model', video: 'video-model', transcribe: 'audio-model' }, agentMaxSteps: 4, agentTimeoutSeconds: 600, libraryRoot: '', backend: 'auto', systemPrompt: '', temperature: .7, maxTokens: 2048, context: 4096, scanlines: false },
  models: [fixtureModel('small-chat', 'Qwen3 0.6B', 'chat', .5), fixtureModel('large-chat', 'Qwen3 4B', 'chat', 2.5), fixtureModel('coding-model', 'Qwen Coding 3B', 'chat', 2), fixtureModel('image-one', 'Local Photo', 'image', 4), fixtureModel('image-two', 'Local Image Editor', 'image', 7), fixtureModel('upscale-model', 'Local Upscaler', 'upscale', .1), fixtureModel('video-model', 'Local Video', 'video', 5), fixtureModel('audio-model', 'Local Audio', 'transcribe', .5)],
  engines: { chat: { available: true, backend: 'cpu' } }, sessions: [], jobs: [], loadedModelId: null, loadedModels: [], catalog: [], downloads: [],
  orchestrator: { modelId: 'small-chat', loaded: true, status: 'running', catalogId: 'qwen3-0.6b', memoryGB: 1 }, runtimeSetup: { status: 'ready' },
};
const calls = [];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    const requestPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const target = path.resolve('dist', '.' + (requestPath === '/' ? '/index.html' : requestPath));
    if (!target.startsWith(path.resolve('dist') + path.sep)) { res.writeHead(403).end(); return; }
    const body = await fs.readFile(target);
    res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: process.env.TIM_BROWSER_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1040 } });
  page.setDefaultTimeout(7000);
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith(base) && !request.url().startsWith('data:')) external.push(request.url()); });
  await page.addInitScript(() => {
    const sources = [];
    window.EventSource = class {
      constructor() {
        sources.push(this);
        setTimeout(() => fetch('/api/state').then(response => response.json()).then(value => this.onmessage?.({ data: JSON.stringify(value) })), 10);
      }
      close() {}
    };
    window.__pushState = value => sources.forEach(source => source.onmessage?.({ data: JSON.stringify(value) }));
  });
  const push = () => page.evaluate(value => new Promise(resolve => { window.__pushState(value); requestAnimationFrame(() => requestAnimationFrame(resolve)); }), state);
  await page.route('**/api/**', async route => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.replace('/api/', '');
    const data = request.postDataJSON();
    calls.push({ endpoint, method: request.method(), data });
    if (endpoint === 'models/default') {
      assert.ok(['agent', 'chat', 'code', 'image', 'upscale', 'video', 'transcribe'].includes(data.mode));
      assert.ok(state.models.some(model => model.id === data.modelId && model.available));
      state.config.defaultMode = data.mode;
      if (data.mode === 'agent') state.config.mainAgentModelId = data.modelId;
      else state.config.defaultModels = { ...state.config.defaultModels, [data.mode]: data.modelId };
    } else if (endpoint === 'settings') {
      state.config = structuredClone(data);
      state.orchestrator = { ...state.orchestrator, modelId: state.config.mainAgentModelId };
    } else if (endpoint !== 'state') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: `Unexpected fixture request: ${endpoint}` }) });
      return;
    }
    if (endpoint !== 'state') await push();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(endpoint === 'state' ? state : state.config) });
  });
  const selector = page.getByLabel('Select model', { exact: true });
  const selectMode = name => page.locator('.mode-row').getByRole('button', { name, exact: true }).click();
  const selectedIs = async (id, message) => {
    await page.waitForFunction(value => document.querySelector('[aria-label="Select model"]')?.value === value, id);
    assert.equal(await selector.inputValue(), id, message);
  };
  const activeModeIs = async name => {
    await page.locator('.mode-row').getByRole('button', { name, exact: true }).locator('xpath=self::*[contains(@class, "active")]').waitFor();
  };
  const savedCalls = () => calls.filter(call => ['models/default', 'settings'].includes(call.endpoint));
  const saveCurrentDefault = async () => {
    const [response] = await Promise.all([
      page.waitForResponse(response => response.url() === `${base}/api/models/default` && response.request().method() === 'POST'),
      page.getByRole('button', { name: 'Set as default', exact: true }).click(),
    ]);
    await response.finished();
  };
  await fs.mkdir('artifacts/ui', { recursive: true });
  await page.goto(base);
  await activeModeIs('Chat');
  await selectedIs('large-chat', 'A larger saved Chat model must win over a smaller available model');
  await page.getByLabel('Message', { exact: true }).fill('Explain the selected model.');
  assert.equal(await page.getByRole('button', { name: /^Send/ }).isEnabled(), true);
  await page.getByText('Default for Chat', { exact: true }).waitFor();
  await page.waitForTimeout(180);
  await page.screenshot({ path: 'artifacts/ui/model-defaults-chat.png' });

  // Choosing a model for this conversation does not silently change defaults,
  // and Chat and Code each retain their own selection.
  await selector.selectOption('small-chat');
  await selectedIs('small-chat');
  assert.equal(savedCalls().length, 0, 'Temporary selection must not save a preference');
  await selectMode('Code');
  await selectedIs('coding-model', 'Code must use its own saved model');
  await selectMode('Chat');
  await selectedIs('small-chat', 'The temporary Chat selection should remain within this page');
  await page.reload();
  await activeModeIs('Chat');
  await selectedIs('large-chat', 'Reload must return to the saved Chat default');
  assert.equal(savedCalls().length, 0);

  await selector.selectOption('coding-model');
  await saveCurrentDefault();
  await page.getByText('Default for Chat', { exact: true }).waitFor();
  assert.deepEqual(savedCalls().at(-1), { endpoint: 'models/default', method: 'POST', data: { mode: 'chat', modelId: 'coding-model' } });
  assert.equal(state.config.defaultModels.code, 'coding-model');
  await page.reload();
  await activeModeIs('Chat');
  await selectedIs('coding-model', 'Set as default must survive a new page');

  await selectMode('Code');
  await selector.selectOption('large-chat');
  await saveCurrentDefault();
  await page.getByText('Default for Code', { exact: true }).waitFor();
  assert.equal(state.config.defaultMode, 'code', 'Saving a default should also save the startup mode');
  assert.equal(state.config.defaultModels.chat, 'coding-model', 'Saving Code must preserve the Chat preference');
  assert.equal(state.config.defaultModels.code, 'large-chat');
  await page.reload();
  await activeModeIs('Code');
  await selectedIs('large-chat');
  await selectMode('Chat');
  await selectedIs('coding-model');

  // Settings provide a full preference editor, including a stronger main agent.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByLabel('Default mode', { exact: true }).selectOption('agent');
  await dialog.getByLabel('Main agent model', { exact: true }).selectOption('large-chat');
  await dialog.getByLabel('Default Chat model', { exact: true }).selectOption('large-chat');
  await dialog.getByLabel('Default Code model', { exact: true }).selectOption('coding-model');
  await dialog.getByText('Image, video and audio defaults', { exact: true }).click();
  await dialog.getByLabel('Default Image model', { exact: true }).selectOption('image-two');
  await dialog.getByLabel('Default Upscale model', { exact: true }).selectOption('upscale-model');
  await dialog.getByLabel('Default Video model', { exact: true }).selectOption('video-model');
  await dialog.getByLabel('Default Audio model', { exact: true }).selectOption('audio-model');
  await page.waitForTimeout(180);
  await page.screenshot({ path: 'artifacts/ui/model-defaults-settings.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Settings must fit a narrow screen');
  assert.equal(await dialog.getByRole('region', { name: 'Default models', exact: true }).evaluate(element => element.scrollWidth > element.clientWidth), false, 'Default controls must wrap within the Settings panel');
  await page.screenshot({ path: 'artifacts/ui/model-defaults-settings-narrow.png' });
  await page.setViewportSize({ width: 1500, height: 1040 });
  await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(savedCalls().at(-1).endpoint, 'settings');
  assert.equal(state.config.mainAgentModelId, 'large-chat');
  assert.equal(state.config.defaultMode, 'agent');
  assert.deepEqual(state.config.defaultModels, { chat: 'large-chat', code: 'coding-model', image: 'image-two', upscale: 'upscale-model', video: 'video-model', transcribe: 'audio-model' });
  await page.reload();
  await activeModeIs('Agent');
  await selectedIs('large-chat', 'A larger selected main agent must persist on startup');
  assert.equal(await selector.isDisabled(), true, 'Main agent changes should use the explicit Settings control');
  await selectMode('Chat'); await selectedIs('large-chat');
  await selectMode('Code'); await selectedIs('coding-model');
  await selectMode('Image'); await selectedIs('image-two');
  await selectMode('Upscale'); await selectedIs('upscale-model');
  await selectMode('Video'); await selectedIs('video-model');
  await selectMode('Audio'); await selectedIs('audio-model');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  assert.equal(await dialog.getByLabel('Default mode', { exact: true }).inputValue(), 'agent');
  assert.equal(await dialog.getByLabel('Main agent model', { exact: true }).inputValue(), 'large-chat');
  assert.equal(await dialog.getByLabel('Default Chat model', { exact: true }).inputValue(), 'large-chat');
  assert.equal(await dialog.getByLabel('Default Code model', { exact: true }).inputValue(), 'coding-model');
  assert.equal(await dialog.getByLabel('Default Image model', { exact: true }).inputValue(), 'image-two');
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();

  const unavailableMessage = 'Your saved default for Chat is unavailable. Choose another model or update your defaults in Settings.';
  state.config.defaultMode = 'chat';
  state.config.defaultModels.chat = 'missing-model';
  await page.reload();
  await activeModeIs('Chat');
  await page.getByText(unavailableMessage, { exact: true }).waitFor();
  assert.equal(await selector.inputValue(), '', 'A missing preference must not silently pick the smallest model');
  await page.getByLabel('Message', { exact: true }).fill('This should need a model first.');
  assert.equal(await page.getByRole('button', { name: /^Send/ }).isDisabled(), true);
  const savedBeforeRecovery = savedCalls().length;
  await selector.selectOption('small-chat');
  await selectedIs('small-chat');
  assert.equal(await page.getByRole('button', { name: /^Send/ }).isEnabled(), true, 'Users can temporarily recover by choosing an available model');
  assert.equal(state.config.defaultModels.chat, 'missing-model');
  assert.equal(savedCalls().length, savedBeforeRecovery);

  state.config.defaultModels.chat = 'large-chat';
  state.models = state.models.map(model => model.id === 'large-chat' ? { ...model, available: false, issue: 'Model file is missing' } : model);
  await page.reload();
  await page.getByText(unavailableMessage, { exact: true }).waitFor();
  assert.equal(await selector.inputValue(), '', 'An installed but unavailable default must not silently fall back either');
  await page.getByLabel('Message', { exact: true }).fill('Another unavailable model check.');
  assert.equal(await page.getByRole('button', { name: /^Send/ }).isDisabled(), true);
  assert.deepEqual(errors, [], 'No client errors');
  assert.deepEqual(external, [], 'Selecting preferences must not contact model publishers');
  assert.deepEqual(calls.filter(call => call.method === 'POST').map(call => call.endpoint), ['models/default', 'models/default', 'settings'], 'Only explicit preference saves may write; selecting defaults must not load, unload, download, or run models');
  console.log(JSON.stringify({ assertions: 'Larger saved default, temporary selection, Chat/Code independence, Set as default persistence and startup mode, full Settings preferences including the main agent, all media defaults, missing/unavailable defaults, disabled submission, and no model actions passed', clientErrors: errors, externalRequests: external }));
} finally {
  await browser?.contexts()[0]?.pages()[0]?.unrouteAll({ behavior: 'ignoreErrors' });
  await browser?.close();
  server.close();
}
