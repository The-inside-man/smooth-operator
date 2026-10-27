const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('timDesktop', {
  pickLibrary: () => ipcRenderer.invoke('pick-library'),
  saveOutput: filename => ipcRenderer.invoke('save-output', filename),
  openExternal: url => ipcRenderer.invoke('open-model-link', url)
});
