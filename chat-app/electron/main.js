const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage, dialog, globalShortcut, shell, session, clipboard } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const isDev = !app.isPackaged;
let logDir;
let logFile;
let isUpdating = false; // true, когда quitAndInstall вызвана для обновления
let forceClose = false; // true, когда пользователь подтвердил закрытие

function ensureUpdateConfig() {
  if (isDev) return;

  // Путь к app-update.yml в resources директории
  const resourcesPath = process.resourcesPath || path.join(app.getAppPath(), 'resources');
  const updateConfigPath = path.join(resourcesPath, 'app-update.yml');

  if (!fs.existsSync(updateConfigPath)) {
    logToFile('Создание app-update.yml...');
    const configContent = `provider: github
owner: AmiD4567
repo: chatursa
private: false
releaseType: release
`;
    try {
      const configDir = path.dirname(updateConfigPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      fs.writeFileSync(updateConfigPath, configContent);
      logToFile('app-update.yml создан успешно');
    } catch (err) {
      logError(`Ошибка создания app-update.yml: ${err.message}`);
    }
  }
}

function initPaths() {
  logDir = isDev
    ? path.join(__dirname, '..')
    : path.join(app.getPath('userData'), 'logs');

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  logFile = path.join(logDir, 'chat-app.log');
  logToFile('='.repeat(50));
  logToFile('Electron App Starting...');
  logToFile('='.repeat(50));
  logToFile(`Is Dev: ${isDev}`);
  logToFile(`Is Packaged: ${app.isPackaged}`);

  ensureUpdateConfig();
}

function logToFile(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(logFile, logMessage);
  console.log(message);
}

function logError(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ERROR: ${message}\n`;
  fs.appendFileSync(logFile, logMessage);
  console.error(message);
}

// Настройка автообновлений
autoUpdater.autoDownload = false;        // Не скачиваем автоматически — ждём команды от пользователя
autoUpdater.autoInstallOnAppQuit = true; // Автоматически установить при закрытии (как в бекапе)
autoUpdater.allowDowngrade = false;      // Запрещены откаты версии

autoUpdater.on('checking-for-update', () => {
  logToFile('Проверка обновлений...');
  if (mainWindow) mainWindow.webContents.send('checking-for-update');
});

autoUpdater.on('update-available', (info) => {
  logToFile(`Доступно обновление: ${info.version}`);
  if (mainWindow) {
    // Уведомляем рендерер (для UI в настройках)
    mainWindow.webContents.send('update-available', info);

    // Показываем нативный диалог (как в бекапе) — пользователь точно его увидит
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Доступно обновление',
      message: `Доступна новая версия приложения (${info.version}). Скачать и установить?`,
      buttons: ['Скачать и установить', 'Позже'],
      defaultId: 0,
      cancelId: 1
    }).then((result) => {
      if (result.response === 0) {
        logToFile('Пользователь подтвердил установку через нативный диалог. Начинаем загрузку...');
        autoUpdater.downloadUpdate();
      } else {
        logToFile('Пользователь отложил установку обновления');
        mainWindow.webContents.send('update-postponed');
      }
    }).catch((err) => {
      logError(`Ошибка показа диалога: ${err.message}`);
    });
  }
});

autoUpdater.on('update-not-available', (info) => {
  logToFile(`Обновлений не найдено. Текущая версия: ${info.version}`);
  if (mainWindow) mainWindow.webContents.send('update-not-available', info);
});

autoUpdater.on('download-progress', (progressObj) => {
  logToFile(`Загрузка обновления: ${Math.round(progressObj.percent)}%`);
  if (mainWindow) mainWindow.webContents.send('download-progress', progressObj);
});

autoUpdater.on('update-downloaded', async (info) => {
  logToFile('Обновление загружено. Начинаем установку...');
  if (mainWindow) {
    mainWindow.webContents.send('update-downloaded', info);

    // Останавливаем бэкенд (чтобы не было блокировки файлов)
    try {
      await stopBackend();
      logToFile('Бэкенд остановлен. Запускаем quitAndInstall...');
    } catch (err) {
      logError(`Ошибка остановки бэкенда: ${err.message}`);
    }
  }
  // Устанавливаем обновление и перезапускаем (isSilent=false — показываем установщик)
  isUpdating = true;
  autoUpdater.quitAndInstall(false, true);
});

autoUpdater.on('error', (err) => {
  logError(`Ошибка автообновления: ${err.message}`);
  if (mainWindow) mainWindow.webContents.send('update-error', err.message);
});

const gotTheLock = app.requestSingleInstanceLock();

let mainWindow;
let tray;
let backendProcess;

if (!gotTheLock) {
  app.on('ready', () => app.quit());
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      mainWindow.show();
      new Notification({ title: 'Чат', body: 'Приложение уже запущено' }).show();
    }
  });
}

const getResourcesPath = () => {
  if (isDev) return path.join(__dirname, '..');
  return path.join(process.resourcesPath, 'app');
};

const appRoot = getResourcesPath();
const backendPath = path.join(appRoot, 'backend');
const backendScript = path.join(backendPath, 'server.js');
const frontendBuildPath = path.join(appRoot, 'frontend', 'build');
const frontendIndex = path.join(frontendBuildPath, 'index.html');

const userDataPath = app.getPath('userData');
const dbPath = path.join(userDataPath, 'database');
const uploadsPath = path.join(userDataPath, 'uploads');

function startBackend() {
  logToFile('Запуск бэкенда...');
  if (!fs.existsSync(backendScript)) {
    logError(`Backend script not found: ${backendScript}`);
    return;
  }

  const backendEnv = {
    ...process.env,
    NODE_ENV: isDev ? 'development' : 'production',
    ELECTRON_RUN_AS_NODE: '1',
    CHAT_APP_DATA_PATH: userDataPath,
    CHAT_APP_DB_PATH: dbPath,
    CHAT_APP_UPLOADS_PATH: uploadsPath
  };

  backendProcess = spawn(process.execPath, [backendScript], {
    cwd: backendPath,
    env: backendEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });

  backendProcess.stdout.on('data', (data) => logToFile(`Backend: ${data.toString().trim()}`));
  backendProcess.stderr.on('data', (data) => logError(`Backend Error: ${data.toString().trim()}`));
  backendProcess.on('error', (err) => logError(`Ошибка запуска бэкенда: ${err.message}`));
}

function stopBackend() {
  return new Promise((resolve) => {
    if (!backendProcess) {
      logToFile('Бэкенд не запущен, продолжаем.');
      resolve();
      return;
    }

    logToFile('Остановка бэкенда...');
    const pid = backendProcess.pid;

    const onClose = () => {
      logToFile(`Бэкенд завершён.`);
      backendProcess = null;
      resolve();
    };

    backendProcess.once('close', onClose);

    const timeout = setTimeout(() => {
      logToFile('Таймаут остановки бэкенда, принудительное завершение...');
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', pid, '/f', '/t']);
      } else {
        backendProcess.kill('SIGTERM');
      }
      backendProcess = null;
      resolve();
    }, 5000);

    backendProcess.once('error', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    show: false,
    icon: path.join(__dirname, 'icon.ico')
  });

  // Убираем меню (File, Edit, View, Window, Help)
  Menu.setApplicationMenu(null);

  // Не создаём новые окна приложения: target="_blank"/window.open
  // открываем в системном браузере (иначе — пустое белое окно).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch((err) => {
        logError(`Ошибка открытия внешней ссылки: ${err.message}`);
      });
    }
    return { action: 'deny' };
  });

  // Оставляем Ctrl+Shift+I для открытия консоли
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i' && !input.alt && !input.meta) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // Подтверждение закрытия окна
  mainWindow.on('close', (event) => {
    if (isUpdating || forceClose) return; // Обновление или пользователь уже подтвердил

    event.preventDefault();
    dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Да, закрыть', 'Нет'],
      defaultId: 1,
      cancelId: 1,
      title: 'Подтверждение закрытия',
      message: 'Вы уверены, что хотите закрыть приложение?'
    }).then((result) => {
      if (result.response === 0) {
        forceClose = true;
        mainWindow.close();
      }
    }).catch((err) => {
      logError(`Ошибка диалога закрытия: ${err.message}`);
    });
  });

  if (fs.existsSync(frontendIndex)) {
    mainWindow.loadFile(frontendIndex);
  } else {
    mainWindow.loadURL(`file://${frontendBuildPath}/index.html`);
  }

  // Отслеживание видимости окна (для уведомлений и непрочитанных)
  const notifyVisibility = (visible) => {
    mainWindow.webContents.send('app-visibility', visible);
  };

  mainWindow.on('minimize', () => notifyVisibility(false));
  mainWindow.on('restore', () => notifyVisibility(true));
  mainWindow.on('show', () => notifyVisibility(true));
  mainWindow.on('hide', () => notifyVisibility(false));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize();
  });
}

// --- IPC HANDLERS ---

ipcMain.on('start-backend', () => {
  startBackend();
});

ipcMain.on('stop-backend', async () => {
  await stopBackend();
});

ipcMain.on('quit-and-install', async () => {
  logToFile('Пользователь запустил установку обновления вручную.');

  // Останавливаем бэкенд, чтобы не было блокировки файлов
  try {
    await stopBackend();
    logToFile('Бэкенд остановлен.');
  } catch (err) {
    logError(`Ошибка остановки бэкенда: ${err.message}`);
  }

  isUpdating = true;
  autoUpdater.quitAndInstall(false, true);
});

// Фокус окна приложения (при клике на уведомление)
ipcMain.on('focus-app-window', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

/**
 * Загружает изображение по URL и возвращает NativeImage для использования в уведомлениях.
 * Поддерживает локальные пути, file:// и удалённые URL.
 */
async function fetchImageAsNativeImage(url) {
  if (!url) return null;
  try {
    // Локальный путь (начинается с /)
    if (url.startsWith('/')) {
      const fullPath = path.join(__dirname, '..', url);
      if (fs.existsSync(fullPath)) {
        return nativeImage.createFromPath(fullPath).resize({ width: 64, height: 64 });
      }
      return null;
    }
    // file:// URL
    if (url.startsWith('file://')) {
      const filePath = url.startsWith('file:///') ? url.slice(8) : url.slice(7);
      if (fs.existsSync(filePath)) {
        return nativeImage.createFromPath(filePath).resize({ width: 64, height: 64 });
      }
      return null;
    }
    // Удалённый URL — скачиваем через fetch
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return nativeImage.createFromBuffer(buffer).resize({ width: 64, height: 64 });
  } catch (e) {
    logError(`Ошибка загрузки иконки уведомления: ${e.message}`);
    return null;
  }
}

// --- ДОПОЛНИТЕЛЬНЫЕ IPC HANDLERS ---

ipcMain.on('show-notification', async (event, data) => {
  const { title, body, chatId, icon } = data || {};
  if (Notification.isSupported()) {
    const options = { title: title || 'Чат', body: body || '' };

    // Загружаем аватар и добавляем в уведомление
    if (icon) {
      const img = await fetchImageAsNativeImage(icon);
      if (img) options.icon = img;
    }

    const notification = new Notification(options);
    notification.on('click', () => {
      // Фокусируем окно
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
      // Если указан chatId — отправляем событие в рендерер для навигации
      if (chatId && mainWindow) {
        mainWindow.webContents.send('open-chat-from-notification', chatId);
      }
    });
    notification.show();
  }
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// Чтение текста из буфера обмена в main-процессе:
// navigator.clipboard.readText() в рендерере требует разрешений и
// secure context, здесь работает всегда
ipcMain.handle('read-clipboard', () => {
  try {
    return clipboard.readText();
  } catch (e) {
    logError(`Ошибка чтения буфера обмена: ${e.message}`);
    return '';
  }
});

ipcMain.handle('get-user-data-path', () => {
  return app.getPath('userData');
});

ipcMain.handle('get-uploads-path', () => {
  return uploadsPath;
});

ipcMain.on('check-for-updates', () => {
  ensureUpdateConfig();
  autoUpdater.checkForUpdates();
});

ipcMain.on('start-update', () => {
  autoUpdater.downloadUpdate();
});

ipcMain.on('set-unread-count', (event, count) => {
  if (tray) {
    tray.setToolTip(count > 0 ? `Чат (${count} новых)` : 'Чат');
    if (count > 0) {
      tray.setImage(path.join(__dirname, 'icon.ico'));
    } else {
      tray.setImage(path.join(__dirname, 'icon.ico'));
    }
  }
});

ipcMain.on('set-badge-icon', (event, dataUrl) => {
  if (mainWindow) {
    mainWindow.setOverlayIcon(
      dataUrl ? nativeImage.createFromDataURL(dataUrl) : null,
      dataUrl ? 'Новые сообщения' : ''
    );
  }
});

ipcMain.on('get-app-visibility-status', () => {
  if (mainWindow) {
    mainWindow.webContents.send('app-visibility', !mainWindow.isMinimized() && mainWindow.isVisible());
  }
});

ipcMain.on('open-download-folder', (event, url) => {
  // Открыть папку с загрузками
  shell.openPath(app.getPath('downloads'));
});

ipcMain.handle('is-file-downloaded', async (event, url) => {
  // Проверка существования файла
  if (!url) return false;
  try {
    const filename = path.basename(new URL(url).pathname);
    const filePath = path.join(app.getPath('downloads'), filename);
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
});

ipcMain.handle('get-auto-launch', () => {
  const AutoLaunch = (() => {
    try {
      return require('auto-launch');
    } catch {
      return null;
    }
  })();

  if (!AutoLaunch) return false;

  const autoLauncher = new AutoLaunch({ name: 'ChatApp' });
  return autoLauncher.isEnabled();
});

ipcMain.handle('set-auto-launch', async (event, enabled) => {
  const AutoLaunch = (() => {
    try {
      return require('auto-launch');
    } catch {
      return null;
    }
  })();

  if (!AutoLaunch) return false;

  const autoLauncher = new AutoLaunch({ name: 'ChatApp' });
  if (enabled) {
    await autoLauncher.enable();
  } else {
    await autoLauncher.disable();
  }
  return true;
});

// --- APP LIFECYCLE ---

app.on('ready', () => {
  initPaths();
  createWindow();
  startBackend();

  // Авто-проверка обновлений при старте (как в бекапе)
  if (!isDev) {
    setTimeout(() => {
      logToFile('Авто-проверка обновлений...');
      autoUpdater.checkForUpdates();
    }, 2000);
  }
});

app.on('will-quit', () => {
  logToFile('Приложение закрывается...');
  stopBackend().catch(err => logError(`Ошибка при выходе: ${err.message}`));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
