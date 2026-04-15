const { contextBridge, ipcRenderer } = require('electron');

// Preload специально для offscreen окна создания бейджа
contextBridge.exposeInMainWorld('badgeAPI', {
  sendResult: (dataURL) => ipcRenderer.send('badge-result', dataURL)
});
