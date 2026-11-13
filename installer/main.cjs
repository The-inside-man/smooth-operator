const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const page = path.join(__dirname, 'index.html');
const pageUrl = pathToFileURL(page).href;
let window, active;

async function openApp(file, env) {
  if (!(await fs.lstat(file)).isFile()) throw new Error('TIM Desktop could not be found in the installation folder.');
  await new Promise((resolve, reject) => {
    const child = spawn(file, [], { cwd: path.dirname(file), env, stdio: 'ignore', detached: true });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

async function start() {
  const { createInstaller, launcherEnvironment, openLinuxTerminal } = await import('./install.mjs');
  const { version } = require('../package.json');
  const payload = (!app.isPackaged && process.env.TIM_INSTALLER_PAYLOAD) || path.join(process.resourcesPath, 'tim-install-payload');
  const defaultDirectory = app.getPath('home');
  const installer = await createInstaller({ payload, version, defaultDirectory });
  const selectedDirectories = new Set([defaultDirectory]);
  window = new BrowserWindow({
    width: 1000, height: 750, minWidth: 680, minHeight: 580, autoHideMenuBar: true,
    title: 'TIM Studio Installer', backgroundColor: '#0b1016',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.on('close', event => {
    if (!active) return;
    event.preventDefault();
    if (active.confirming || active.controller.signal.aborted) return;
    const operation = active;
    operation.confirming = true;
    void dialog.showMessageBox(window, {
      type: 'question', title: 'Pause setup?', message: 'Pause setup and close the installer?',
      detail: 'Completed downloads and partial model files are kept in the chosen folder.',
      buttons: ['Keep installing', 'Pause and close'], defaultId: 0, cancelId: 0
    }).then(({ response }) => {
      operation.confirming = false;
      if (response === 1) {
        operation.controller.abort(new Error('Setup paused.'));
        void operation.promise.catch(() => {}).finally(() => window?.close());
      }
    }).catch(() => { operation.confirming = false; });
  });

  function handle(name, action) {
    ipcMain.handle(`tim-installer:${name}`, async (event, value) => {
      if (event.sender !== window?.webContents || event.senderFrame?.url !== pageUrl || event.senderFrame?.parent) throw new Error('Installer action unavailable.');
      return action(value);
    });
  }
  function authorizedSelection(selection) {
    if (selection?.directory && !selectedDirectories.has(selection.directory)) throw new Error('Use Browse to choose a destination folder.');
    return selection;
  }
  handle('setup', () => installer.getSetup());
  handle('directory', async ({ portable } = {}) => {
    if (active) throw new Error('Pause setup before choosing a new folder.');
    const result = await dialog.showOpenDialog(window, {
      title: portable ? 'Choose a folder on your external drive' : 'Choose the TIM Studio installation location',
      properties: ['openDirectory', 'createDirectory']
    });
    const directory = result.canceled ? null : result.filePaths[0];
    if (directory) selectedDirectories.add(directory);
    return directory;
  });
  handle('plan', selection => installer.plan(authorizedSelection(selection)));
  handle('install', async selection => {
    if (active) throw new Error('Setup is already running.');
    const controller = new AbortController();
    const promise = installer.install(authorizedSelection(selection), {
      signal: controller.signal,
      onProgress: progress => {
        if (!window?.isDestroyed() && !window?.webContents.isDestroyed()) window.webContents.send('tim-installer:progress', progress);
      }
    });
    active = { controller, promise };
    try { return await promise; }
    finally { active = null; }
  });
  handle('cancel', () => { active?.controller.abort(new Error('Setup paused. Choose Retry to continue.')); });
  handle('open', async ({ action } = {}) => {
    if (active) throw new Error('Finish setup before opening TIM.');
    const file = installer.launchPath(action);
    if (process.platform === 'linux' && action === 'cli') return openLinuxTerminal(file);
    if (process.platform === 'linux' && action === 'desktop') return openApp(file, launcherEnvironment());
    const error = await shell.openPath(file);
    if (error) throw new Error(error);
  });
  await window.loadFile(page);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(start).catch(error => {
    dialog.showErrorBox('TIM Studio Installer could not start', error.code === 'ENOENT' ? 'The installer package is incomplete. Extract the full download and open the installer from that folder.' : error.message);
    app.quit();
  });
}
