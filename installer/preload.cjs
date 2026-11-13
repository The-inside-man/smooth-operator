const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('timInstaller', {
  getSetup: () => ipcRenderer.invoke('tim-installer:setup'),
  chooseDirectory: options => ipcRenderer.invoke('tim-installer:directory', options),
  plan: selection => ipcRenderer.invoke('tim-installer:plan', selection),
  install: selection => ipcRenderer.invoke('tim-installer:install', selection),
  cancel: () => ipcRenderer.invoke('tim-installer:cancel'),
  open: options => ipcRenderer.invoke('tim-installer:open', options),
  onProgress: callback => {
    if (typeof callback !== 'function') return;
    const receive = (_event, progress) => callback(progress);
    ipcRenderer.on('tim-installer:progress', receive);
    return () => ipcRenderer.removeListener('tim-installer:progress', receive);
  }
});
