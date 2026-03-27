const { contextBridge, ipcRenderer } = require('electron');

// Безопасный мост между основным процессом и рендерером
contextBridge.exposeInMainWorld('electronAPI', {
  // Отправка уведомлений
  sendNotification: (data) => ipcRenderer.send('show-notification', data),

  // Получение версии приложения
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Пути к данным
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),
  getUploadsPath: () => ipcRenderer.invoke('get-uploads-path'),

  // Автообновления
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', callback),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', callback),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', callback),
  startUpdate: () => ipcRenderer.send('start-update'),
  quitAndInstall: () => ipcRenderer.send('quit-and-install'),

  // Платформа
  platform: process.platform
});
