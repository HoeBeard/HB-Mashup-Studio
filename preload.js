// Safe bridge between the app window and the computer's file system.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hb', {
  saveFile: (defaultName, filters, data) => ipcRenderer.invoke('save-file', { defaultName, filters, data }),
  openProject: () => ipcRenderer.invoke('open-project'),
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),
});
