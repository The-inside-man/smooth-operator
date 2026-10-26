// Offline UI fixture: all requests are intercepted; no app server or model is started.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const state = { platform: 'win32', arch: 'x64', hostname: 'Fixture', memory: { total: 16000000000, free: 8000000000 }, libraryRoot: '', dataDir: 'test fixture', gpu: null,
  config: { mainAgentModelId: '', agentMaxSteps: 4, agentTimeoutSeconds: 600, libraryRoot: '', backend: 'cpu', systemPrompt: 'test', temperature: .7, maxTokens: 1024, context: 4096, scanlines: false },
  models: [{ id: 'main', name: 'Conversational fixture', kind: 'chat', available: true, size: 100, relativePath: 'fixture', validation: 'Mock only' }],
  engines: { chat: { available: true, backend: 'cpu' } }, sessions: [], jobs: [], loadedModelId: null };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage(); const errors = [], posted = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'tim.test') throw Error('Unexpected external request');
    if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify(state)}\n\n` });
    if (url.pathname === '/api/state') return route.fulfill({ json: state });
    if (url.pathname === '/api/settings') { Object.assign(state.config, route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); }
    if (url.pathname === '/api/jobs') { posted.push(route.request().postDataJSON()); return route.fulfill({ json: { sessionId: 'session' } }); }
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve('dist', relative); assert.ok(file.startsWith(path.resolve('dist') + path.sep));
    return route.fulfill({ body: await fs.readFile(file), contentType: ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' })[path.extname(file)] || 'application/octet-stream' });
  });
  await page.goto('http://tim.test');
  await page.getByText('Choose a main agent model in Settings.', { exact: false }).waitFor();
  assert.ok(await page.getByLabel('Select model').isDisabled());
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Main agent model').selectOption('main');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.reload();
  await page.getByLabel('Message', { exact: true }).fill('Make an image');
  await page.getByRole('button', { name: /Send/ }).click();
  assert.equal(posted.at(-1).kind, 'agent');
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  assert.ok(await page.getByLabel('Select model').isEnabled());
  await page.getByLabel('Message', { exact: true }).fill('Manual chat');
  await page.getByRole('button', { name: /Send/ }).click();
  assert.equal(posted.at(-1).kind, 'chat');
  state.sessions = [{ id: 'session', title: 'Fixture', messages: [{ id: 'answer', role: 'assistant', content: 'The specialist failed.', status: 'completed', createdAt: new Date().toISOString(), steps: [{ id: 'child', parentJobId: 'parent', modelName: 'Image fixture', status: 'failed', phase: 'Out of memory', result: { error: 'Out of memory' } }] }] }];
  await page.reload();
  await page.getByText('Specialist steps (1)', { exact: false }).waitFor();
  assert.ok(await page.getByText('Out of memory', { exact: true }).count());
  await page.setViewportSize({ width: 1024, height: 768 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log('Offline UI passed: default agent, model settings, manual Chat, child errors, compact layout; zero page errors.');
} finally { await browser.close(); }
