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
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  onCheckingForUpdate: (callback) => ipcRenderer.on('checking-for-update', callback),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', callback),
  onUpdateNotAvailable: (callback) => ipcRenderer.on('update-not-available', callback),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', callback),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', callback),
  onUpdateError: (callback) => ipcRenderer.on('update-error', callback),
  startUpdate: () => ipcRenderer.send('start-update'),
  quitAndInstall: () => ipcRenderer.send('quit-and-install'),

  // Платформа
  platform: process.platform
});
