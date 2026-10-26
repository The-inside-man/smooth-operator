const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
let service, window, quitting = false;
const portableRoot = process.env.TIM_HOME || (app.isPackaged ? (process.platform === 'darwin' ? path.resolve(path.dirname(app.getPath('exe')), '../../..') : path.dirname(process.env.APPIMAGE || app.getPath('exe'))) : path.resolve(__dirname, '..'));
const dataDir = process.env.TIM_DATA_DIR || path.join(portableRoot, 'TIM-Studio-Data');
app.setPath('userData', path.join(dataDir, 'desktop'));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    const { startServer } = await import(pathToFileURL(path.join(__dirname, '../server/index.mjs')).href);
    service = await startServer({ port: 0, dataDir });
    window = new BrowserWindow({ width: 1500, height: 960, minWidth: 900, minHeight: 640, show: process.env.TIM_HEADLESS !== '1', backgroundColor: '#080b1b', title: 'TIM Studio', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    const valid = event => event.senderFrame?.url?.startsWith(service.url + '/');
    ipcMain.handle('pick-library', async event => { if (!valid(event)) return null; const result = await dialog.showOpenDialog(window, { title: 'Choose the TIM drive or library root', properties: ['openDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
    ipcMain.handle('save-output', async (event, filename) => {
      if (!valid(event) || typeof filename !== 'string' || path.basename(filename) !== filename) return false;
      const result = await dialog.showSaveDialog(window, { defaultPath: filename });
      if (result.canceled || !result.filePath) return false;
      await fs.promises.copyFile(path.join(dataDir, 'outputs', filename), result.filePath); return true;
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(service.url + '/')) event.preventDefault(); });
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    await window.loadURL(service.url);
  }).catch(error => { dialog.showErrorBox('TIM Studio could not start', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (!service || quitting) return;
    event.preventDefault(); quitting = true;
    service.close().finally(() => app.quit());
  });
}
