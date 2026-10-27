import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
const packaged = process.argv.includes('--packaged');
const uiOnly = process.argv.includes('--ui-only');
const desktop = await electron.launch({ ...(packaged ? { executablePath: path.resolve('release/win-unpacked/TIM Studio.exe') } : { args: ['.'] }), env: { ...process.env, TIM_HEADLESS: '1', TIM_AUTO_SETUP: '0', TIM_DATA_DIR: path.resolve('artifacts/desktop-smoke') } });
try {
  const page = await desktop.firstWindow();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.locator('.statusbar').filter({ hasText: 'CONNECTED' }).waitFor({ timeout: 30000 });
  const isolation = await page.evaluate(() => ({ node: typeof window.require, bridge: typeof window.timDesktop?.pickLibrary, modelLinks: typeof window.timDesktop?.openExternal }));
  if (isolation.node !== 'undefined' || isolation.bridge !== 'function' || isolation.modelLinks !== 'function') throw new Error('Preload isolation failed');
  if (await page.evaluate(() => window.timDesktop.openExternal('file:///tmp/not-a-model-link')) !== false) throw new Error('Model links must reject local files');
  if (!uiOnly) {
    await page.getByText('TIM CONNECTED', { exact: true }).waitFor({ timeout: 30000 });
    await page.getByLabel('Message', { exact: true }).fill('Reply with exactly: Neon Terminal online.');
    await page.getByRole('button', { name: /Send/ }).click();
    await page.locator('.message.assistant .message-text').filter({ hasText: 'Neon Terminal online.' }).waitFor({ timeout: 90000 });
    await page.waitForFunction(() => !document.querySelector('.working'), undefined, { timeout: 90000 });
  }
  await fs.mkdir('artifacts/ui', { recursive: true });
  await page.screenshot({ path: 'artifacts/ui/desktop-chat.png' });
  await page.locator('button.new-session').click();
  await page.screenshot({ path: 'artifacts/ui/desktop-workspace.png' });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ packaged, nativeLaunch: true, streamingChat: !uiOnly, preloadIsolation: isolation, consoleErrors: errors }));
} finally { await desktop.close(); }
