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
  downloadUpdate: () => ipcRenderer.send('start-update'),
  quitAndInstall: () => ipcRenderer.send('quit-and-install'),
  onUpdateChecking: (callback) => {
    const handler = (_, info) => callback(info);
    ipcRenderer.on('checking-for-update', handler);
    return () => ipcRenderer.removeListener('checking-for-update', handler);
  },
  onUpdateAvailable: (callback) => {
    const handler = (_, info) => callback(info);
    ipcRenderer.on('update-available', handler);
    return () => ipcRenderer.removeListener('update-available', handler);
  },
  onUpdateNotAvailable: (callback) => {
    const handler = (_, info) => callback(info);
    ipcRenderer.on('update-not-available', handler);
    return () => ipcRenderer.removeListener('update-not-available', handler);
  },
  onUpdateDownloaded: (callback) => {
    const handler = (_, info) => callback(info);
    ipcRenderer.on('update-downloaded', handler);
    return () => ipcRenderer.removeListener('update-downloaded', handler);
  },
  onDownloadProgress: (callback) => {
    const handler = (_, progressObj) => callback(progressObj);
    ipcRenderer.on('download-progress', handler);
    return () => ipcRenderer.removeListener('download-progress', handler);
  },
  onUpdateError: (callback) => {
    const handler = (_, err) => callback(err);
    ipcRenderer.on('update-error', handler);
    return () => ipcRenderer.removeListener('update-error', handler);
  },
  onUpdatePostponed: (callback) => {
    const handler = (_, info) => callback(info);
    ipcRenderer.on('update-postponed', handler);
    return () => ipcRenderer.removeListener('update-postponed', handler);
  },

  // Открытие чата из уведомления
  onOpenChatFromNotification: (callback) => {
    ipcRenderer.on('open-chat-from-notification', (event, chatId) => callback(chatId));
  },

  // Обновление индикатора непрочитанных сообщений
  setUnreadCount: (count) => ipcRenderer.send('set-unread-count', count),

  // Статус видимости приложения (для корректного подсчёта непрочитанных)
  onAppVisibility: (callback) => {
    ipcRenderer.on('app-visibility', (_, status) => callback(status));
  },
  getAppVisibilityStatus: () => ipcRenderer.send('get-app-visibility-status'),

  // Платформа
  platform: process.platform,

  // Открыть папку скачанного файла в проводнике
  openDownloadFolder: (url) => ipcRenderer.send('open-download-folder', url),

  // Проверить, скачан ли файл
  isFileDownloaded: (url) => ipcRenderer.invoke('is-file-downloaded', url),

  // Событие завершения загрузки файла
  onDownloadComplete: (callback) => {
    ipcRenderer.on('file-downloaded', (event, data) => callback(data));
  },

  // Автозапуск приложения
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled)
});
