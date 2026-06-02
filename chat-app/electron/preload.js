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
  onUpdatePostponed: (callback) => ipcRenderer.on('update-postponed', callback),
  startUpdate: () => ipcRenderer.send('start-update'),
  quitAndInstall: () => ipcRenderer.send('quit-and-install'),

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
