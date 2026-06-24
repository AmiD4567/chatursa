const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage, dialog, globalShortcut, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const isDev = !app.isPackaged;
let logDir;
let logFile;

function ensureUpdateConfig() {
  if (isDev) return;

  // Путь к app-update.yml в resources директории
  const resourcesPath = process.resourcesPath || path.join(app.getAppPath(), 'resources');
  const updateConfigPath = path.join(resourcesPath, 'app-update.yml');

  if (!fs.existsSync(updateConfigPath)) {
    logToFile(`app-update.yml не найден по пути: ${updateConfigPath}`);
    logToFile('Создание app-update.yml...');
    const configContent = `provider: github
owner: AmiD4567
repo: chatursa
private: false
releaseType: release
`;
    try {
      // Убедимся, что директория существует
      const configDir = path.dirname(updateConfigPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
        logToFile(`Создана директория: ${configDir}`);
      }
      fs.writeFileSync(updateConfigPath, configContent);
      logToFile('app-update.yml создан успешно');
    } catch (err) {
      logError(`Ошибка создания app-update.yml: ${err.message}`);
    }
  } else {
    logToFile(`app-update.yml найден по пути: ${updateConfigPath}`);
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

  // Убедимся, что конфигурация обновления существует
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
autoUpdater.autoDownload = true;        // скачивать автоматически
autoUpdater.autoInstallOnAppQuit = false; // управляем установкой сами (нужен isSilent)
autoUpdater.autoRunAppAfterInstall = true; // автозапуск после установки
autoUpdater.allowDowngrade = false;     // запрещены откаты версии

autoUpdater.on('checking-for-update', () => {
  logToFile('Проверка обновлений...');
  if (mainWindow) {
    mainWindow.webContents.send('checking-for-update');
  }
});

autoUpdater.on('update-available', (info) => {
  logToFile(`Доступно обновление: ${info.version}`);
  if (mainWindow) {
    // Передаём информацию о доступном обновлении фронтенду — он покажет баннер с кнопками
    mainWindow.webContents.send('update-available', info);
  }
});

autoUpdater.on('update-not-available', (info) => {
  logToFile(`Обновлений не найдено. Текущая версия: ${info.version}`);
  if (mainWindow) {
    mainWindow.webContents.send('update-not-available', info);
  }
});

autoUpdater.on('download-progress', (progressObj) => {
  logToFile(`Загрузка обновления: ${Math.round(progressObj.percent)}%`);
  if (mainWindow) {
    mainWindow.webContents.send('download-progress', progressObj);
  }
});

autoUpdater.on('update-downloaded', (info) => {
  logToFile('Обновление загружено. Ожидаем подтверждения для установки...');
  if (mainWindow) {
    mainWindow.webContents.send('update-downloaded', info);
  }
});

autoUpdater.on('error', (err) => {
  logError(`Ошибка автообновления: ${err.message}`);
  if (mainWindow) {
    mainWindow.webContents.send('update-error', err.message);
  }
});

const gotTheLock = app.requestSingleInstanceLock();

let mainWindow;
let tray;
let backendProcess;

// Если не получили блокировку - приложение уже запущено
if (!gotTheLock) {
  logToFile('Приложение уже запущено. Выходим...');
  // Ждём ready, чтобы гарантировать что event loop активен, затем выходим
  app.on('ready', () => app.quit());
} else {
  // Обработка второго экземпляра — только если мы получили блокировку
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    logToFile('Попытка запуска второго экземпляра');
    // Показываем существующее окно
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      mainWindow.show();

      // Уведомление о повторном запуске
      new Notification({
        title: 'Чат',
        body: 'Приложение уже запущено и работает в трее'
      }).show();
    }
  });
}

// Для production используем пути относительно process.resourcesPath
const getResourcesPath = () => {
  if (isDev) {
    return path.join(__dirname, '..');
  }
  // В production ресурсы находятся в resources/app (electron-builder копирует туда)
  return path.join(process.resourcesPath, 'app');
};

const appRoot = getResourcesPath();
const backendPath = path.join(appRoot, 'backend');
const backendScript = path.join(backendPath, 'server.js');
const frontendBuildPath = path.join(appRoot, 'frontend', 'build');
const frontendIndex = path.join(frontendBuildPath, 'index.html');

// Путь к базе данных и файлам в userData для production
const userDataPath = app.getPath('userData');
const dbPath = path.join(userDataPath, 'database');
const uploadsPath = path.join(userDataPath, 'uploads');

// Создаём директории если их нет
if (!isDev) {
  if (!fs.existsSync(dbPath)) {
    fs.mkdirSync(dbPath, { recursive: true });
  }
  if (!fs.existsSync(uploadsPath)) {
    fs.mkdirSync(uploadsPath, { recursive: true });
  }
}

// Запуск бэкенда
function startBackend() {
  logToFile('Запуск бэкенда...');

  // Проверяем существование файла сервера
  if (!fs.existsSync(backendScript)) {
    logError(`Backend script not found: ${backendScript}`);
    return;
  }

  // Устанавливаем переменные окружения для бэкенда
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
    stdio: ['pipe', 'pipe', 'pipe'], // не наследуем stdout/stderr родителя — скрываем консоль CMD
    windowsHide: true                // полностью скрыть окно консоли на Windows
  });

  backendProcess.stdout.on('data', (data) => {
    logToFile(`Backend: ${data.toString().trim()}`);
  });

  backendProcess.stderr.on('data', (data) => {
    logError(`Backend Error: ${data.toString().trim()}`);
  });

  backendProcess.on('close', (code) => {
    logToFile(`Бэкенд завершён с кодом ${code}`);
  });

  backendProcess.on('error', (err) => {
    logError(`Ошибка запуска бэкенда: ${err.message}`);
  });
}

// Остановка бэкенда
function stopBackend() {
  if (backendProcess) {
    logToFile('Остановка бэкенда...');
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', backendProcess.pid, '/f', '/t']);
      } else {
        backendProcess.kill('SIGTERM');
      }
    } catch (err) {
      logError(`Ошибка остановки бэкенда: ${err.message}`);
    }
  }
}

function createWindow() {
  logToFile(`Creating window...`);
  logToFile(`__dirname: ${__dirname}`);
  logToFile(`process.resourcesPath: ${process.resourcesPath}`);
  logToFile(`app.getAppPath(): ${app.getAppPath()}`);
  logToFile(`isDev: ${isDev}`);
  logToFile(`getResourcesPath(): ${getResourcesPath()}`);
  logToFile(`frontendBuildPath: ${frontendBuildPath}`);
  logToFile(`frontendIndex: ${frontendIndex}`);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false
    },
    show: false,
    backgroundColor: '#667eea',
    icon: path.join(__dirname, 'icon.ico')
  });

  // Загрузка frontend
  logToFile(`Loading frontend from: ${frontendIndex}`);
  logToFile(`Frontend exists: ${fs.existsSync(frontendIndex)}`);

  if (fs.existsSync(frontendIndex)) {
    mainWindow.loadFile(frontendIndex);
    logToFile('Frontend loaded successfully');
  } else {
    logError(`Frontend not found: ${frontendIndex}`);
    // Пробуем альтернативный путь
    const altPath = isDev
      ? path.join(__dirname, '..', '..', 'frontend', 'build', 'index.html')
      : path.join(process.resourcesPath, 'app', 'frontend', 'build', 'index.html');
    logToFile(`Trying alternative path: ${altPath}`);
    if (fs.existsSync(altPath)) {
      mainWindow.loadFile(altPath);
      logToFile('Alternative frontend loaded');
    } else {
      logError('Alternative frontend not found either');
      mainWindow.loadURL('about:blank');
    }
  }

  // Показ окна после загрузки
  mainWindow.once('ready-to-show', () => {
    logToFile('Window ready to show');
    mainWindow.show();
    mainWindow.focus();
    mainWindow.maximize();
  });

  // Обработка ошибок загрузки
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    logError(`Failed to load: ${errorDescription}`);
  });

  // ========================================
  // Предотвращение открытия окон при скачивании файлов
  // ========================================

  // Блокируем навигацию в окнах загрузок и скачивания — пусть Electron скачивает файл
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.includes('/uploads/') || url.includes('/api/download/')) {
      event.preventDefault();
      // Скачиваем файл без открытия окна
      mainWindow.webContents.downloadURL(url);
    }
  });

  // Блокируем открытие новых окон для файлов — скачиваем напрямую
  mainWindow.webContents.on('new-window', (event, url) => {
    if (url.includes('/uploads/') || url.includes('/api/download/')) {
      event.preventDefault();
      mainWindow.webContents.downloadURL(url);
    }
  });

  // ========================================
  // Отслеживание скачанных файлов
  // ========================================

  const downloadedFiles = new Map(); // url -> filePath

  mainWindow.webContents.session.on('will-download', (event, item) => {
    const url = item.getURL();

    // Не устанавливаем savePath — будет показан стандартный диалог сохранения
    item.on('done', (event, state) => {
      if (state === 'completed') {
        const savePath = item.getSavePath();
        downloadedFiles.set(url, savePath);
        // Уведомляем рендерер о завершении загрузки
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('file-downloaded', { url, path: savePath });
        }
      }
    });
  });

  // IPC: открыть папку с файлом в проводнике
  ipcMain.on('open-download-folder', (event, url) => {
    const filePath = downloadedFiles.get(url);
    if (filePath && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
    }
  });

  // IPC: проверить, скачан ли файл
  ipcMain.handle('is-file-downloaded', (event, url) => {
    const filePath = downloadedFiles.get(url);
    return filePath && fs.existsSync(filePath) ? filePath : null;
  });

  // Обработка закрытия — подтверждение выхода
  mainWindow.on('close', (e) => {
    if (app.isQuiting) return;

    e.preventDefault();

    dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Остаться', 'Выйти'],
      defaultId: 0,
      title: 'Выход из чата',
      message: 'Вы уверены, что хотите выйти из чата?',
      detail: 'Приложение будет полностью закрыто.'
    }).then(({ response }) => {
      if (response === 1) {
        app.isQuiting = true;
        app.quit();
      }
    });
  });

  // Открытие DevTools в разработке (раскомментировать при необходимости)
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  logToFile('Window created successfully');

  // Отслеживание видимости окна для корректного подсчёта непрочитанных
  let lastVisibilityState = true;

  const sendVisibilityStatus = () => {
    const isVisible = mainWindow.isVisible() && !mainWindow.isMinimized();
    if (isVisible !== lastVisibilityState) {
      lastVisibilityState = isVisible;
      logToFile(`app-visibility: ${isVisible}`);
      mainWindow.webContents.send('app-visibility', isVisible);
    }
  };

  // Слушаем события окна для отслеживания видимости
  mainWindow.on('minimize', () => sendVisibilityStatus());
  mainWindow.on('restore', () => sendVisibilityStatus());
  mainWindow.on('focus', () => sendVisibilityStatus());
  mainWindow.on('blur', () => sendVisibilityStatus());
  mainWindow.on('hide', () => sendVisibilityStatus());
  mainWindow.on('show', () => sendVisibilityStatus());

  // Запускаем проверку обновлений после создания окна
  if (!isDev) {
    setTimeout(() => {
      logToFile('Запуск проверки обновлений...');
      autoUpdater.checkForUpdates();
    }, 2000);
  }
}

function createTray() {
  const iconPath = path.join(__dirname, 'icon.ico');

  if (!fs.existsSync(iconPath)) {
    logError(`Icon not found: ${iconPath}`);
    return;
  }

  tray = new Tray(iconPath);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Открыть',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      }
    },
    {
      label: 'Перезагрузить',
      click: () => {
        mainWindow.reload();
      }
    },
    { type: 'separator' },
    {
      label: 'Проверить обновления',
      click: () => {
        logToFile('Ручная проверка обновлений...');
        autoUpdater.checkForUpdates();
      }
    },
    { type: 'separator' },
    {
      label: 'Выйти',
      click: () => {
        app.isQuiting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Чат - Мессенджер');
  tray.setContextMenu(contextMenu);

  // Двойной клик для открытия
  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  logToFile('Tray created successfully');
}

// Готовность приложения
app.whenReady().then(() => {
  // Убираем системное меню (File, Edit, View, Window, Help)
  Menu.setApplicationMenu(null);

  // Настраиваем имя приложения для уведомлений и панели задач
  app.setName('Чат');

  // Инициализация путей и логирования
  initPaths();
  logToFile(`App Path: ${app.getAppPath()}`);

  // Включение автозапуска при первом запуске
  const autoLaunchFlag = path.join(app.getPath('userData'), '.autolaunch-enabled');
  if (!fs.existsSync(autoLaunchFlag)) {
    try {
      app.setLoginItemSettings({ openAtLogin: true });
      fs.writeFileSync(autoLaunchFlag, '', 'utf-8');
      logToFile('Автозапуск включён по умолчанию (первый запуск)');
    } catch (err) {
      logError(`Ошибка включения автозапуска: ${err.message}`);
    }
  }
  logToFile(`Resources Path: ${process.resourcesPath}`);

  // Запуск бэкенда
  startBackend();

  // Создание окна
  createWindow();

  // Создание трея
  createTray();

  // Горячая клавиша Ctrl+Shift+I для DevTools
  globalShortcut.register('Control+Shift+I', () => {
    if (mainWindow) {
      mainWindow.webContents.openDevTools();
    }
  });
});

// Обработка закрытия приложения
app.on('before-quit', (event) => {
  logToFile('Закрытие приложения (before-quit)...');

  // Если загружено обновление — устанавливаем его тихо и с автозапуском
  if (autoUpdater.isUpdateDownloaded) {
    logToFile('before-quit: обнаружено загруженное обновление, запускаю тихую установку...');
    app.isQuiting = true;
    stopBackend();
    globalShortcut.unregisterAll();
    autoUpdater.quitAndInstall(true, true); // isSilent=true, isForceRunAfter=true
    return;
  }

  app.isQuiting = true;
  stopBackend();

  // Убираем все зарегистрированные горячие клавиши
  globalShortcut.unregisterAll();

  // Закрываем все окна
  const windows = BrowserWindow.getAllWindows();
  windows.forEach(win => {
    win.destroy();
  });
});

app.on('will-quit', (event) => {
  logToFile('Закрытие приложения (will-quit)...');
  stopBackend();
});

app.on('window-all-closed', () => {
  logToFile('Все окна закрыты');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Обработка завершения сессии Windows (для корректного закрытия при установке обновлений)
app.on('session-end', () => {
  logToFile('Завершение сессии Windows, закрываем приложение...');
  globalShortcut.unregisterAll();
  stopBackend();
  app.quit();
});

// Обработка IPC запросов от frontend
ipcMain.handle('get-app-version', () => {
  const version = app.getVersion();
  logToFile(`Запрошена версия приложения: ${version}`);
  return version;
});

ipcMain.handle('get-user-data-path', () => {
  return userDataPath;
});

ipcMain.handle('get-uploads-path', () => {
  return isDev ? path.join(getResourcesPath(), 'uploads') : uploadsPath;
});

// Автозапуск приложения при входе в Windows
ipcMain.handle('get-auto-launch', () => {
  const settings = app.getLoginItemSettings();
  return settings.openAtLogin;
});

ipcMain.handle('set-auto-launch', (event, enabled) => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath
  });
  logToFile(`Автозапуск ${enabled ? 'включён' : 'отключён'}`);
  return enabled;
});

// Обработка запроса статуса видимости приложения
ipcMain.on('get-app-visibility-status', () => {
  if (mainWindow) {
    const isVisible = mainWindow.isVisible() && !mainWindow.isMinimized();
    logToFile(`get-app-visibility-status: ${isVisible}`);
    mainWindow.webContents.send('app-visibility', isVisible);
  }
});

// Кэш скачанных аватаров: Map<url, nativeImage>
const avatarCache = new Map();

/** Скачивает изображение по URL и возвращает Buffer */
function downloadImage(url, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? require('https') : require('http');
    const req = client.get(url, { headers: { 'User-Agent': 'ChatApp/1.0' } }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const buf = Buffer.concat(chunks);
          resolve(buf);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.on('error', reject);
  });
}

/** Получает nativeImage аватара с кэшированием + путь к файлу для toastXml */
const avatarFileCache = new Map();

async function getAvatarImage(url) {
  if (!url) return null;
  if (avatarCache.has(url)) return avatarCache.get(url);
  try {
    const buf = await downloadImage(url);
    const img = nativeImage.createFromBuffer(buf);

    // Сохраняем в temp для toastXml (Windows)
    const ext = '.png';
    const fileName = `chat_avatar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    const filePath = path.join(app.getPath('temp'), fileName);
    fs.writeFileSync(filePath, buf);

    avatarCache.set(url, img);
    avatarFileCache.set(url, filePath);
    return img;
  } catch (e) {
    console.warn('Не удалось скачать аватар:', url, e.message);
    return null;
  }
}

// Группировка уведомлений по чату (замена старого уведомления для того же чата)
const activeNotifications = new Map();

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Обработка уведомлений от веб-приложения
ipcMain.on('show-notification', async (event, { title, body, icon, chatId }) => {
  let iconImage = undefined;

  // Если указан аватар — скачиваем и используем
  if (icon) {
    try {
      if (icon.startsWith('http://') || icon.startsWith('https://')) {
        iconImage = await getAvatarImage(icon);
      } else {
        // Локальный файл
        iconImage = nativeImage.createFromPath(path.join(__dirname, icon));
      }
    } catch (e) {
      console.warn('Ошибка загрузки иконки уведомления:', e.message);
    }
  }

  // Закрываем предыдущее уведомление для того же чата (группировка)
  if (chatId && activeNotifications.has(chatId)) {
    try {
      activeNotifications.get(chatId).close();
    } catch (e) {
      // игнорируем ошибку если уведомление уже закрыто
    }
  }

  // Создаём объект опций уведомления
  const notifOptions = { title, body, sound: 'default' };

  // Используем иконку аватара если есть (БЕЗ toastXml — не требует регистрации AUMID в Windows)
  if (iconImage) {
    notifOptions.icon = iconImage;
  }

  let notif;
  try {
    notif = new Notification(notifOptions);
  } catch (e) {
    logToFile('Ошибка создания уведомления: ' + e.message);
    return;
  }

  // Сохраняем в Map для последующей замены
  if (chatId) {
    activeNotifications.set(chatId, notif);
  }

  // Обработчик клика по уведомлению
  notif.on('click', () => {
    // Показываем главное окно
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();

      // Отправляем событие в рендерер для открытия чата
      if (chatId) {
        mainWindow.webContents.send('open-chat-from-notification', chatId);
      }
    }
  });

  // Очищаем Map при закрытии уведомления
  notif.on('close', () => {
    if (chatId && activeNotifications.get(chatId) === notif) {
      activeNotifications.delete(chatId);
    }
  });

  notif.show();
});

// Обработка обновления счетчика непрочитанных сообщений
let currentUnreadCount = 0;

// Кэш иконок с бейджем по количеству непрочитанных
const badgeCache = new Map();

/**
 * Создаёт иконку для tray с красным бейджем непрочитанных сообщений.
 * Использует offscreen BrowserWindow + HTML Canvas для рисования.
 * @param {number} count - количество непрочитанных (>0 — рисуем бейдж, 0 — оригинал)
 * @returns {Promise<nativeImage|null>}
 */
async function createTrayImageWithBadge(count) {
  // Проверяем кэш — если уже есть готовая иконка, возвращаем её
  if (badgeCache.has(count)) {
    const cached = badgeCache.get(count);
    if (cached !== null) return cached;
  }

  const iconPath = path.join(__dirname, 'icon.ico');
  if (!fs.existsSync(iconPath)) {
    logError('createTrayImageWithBadge: icon.ico не найден');
    return null;
  }

  // Кэшируем null пока идёт генерация (чтобы не создать два offscreen окна)
  badgeCache.set(count, null);

  try {
    const baseIcon = nativeImage.createFromPath(iconPath);
    const baseSize = baseIcon.getSize();
    const size = Math.max(baseSize.width, baseSize.height, 64);

    // Окно чуть больше иконки — место под бейдж в правом верхнем углу
    const winWidth = size + 32;
    const winHeight = size + 32;

    const offscreen = new BrowserWindow({
      show: false,
      width: winWidth,
      height: winHeight,
      frame: false,
      transparent: true,
      skipTaskbar: true,
      offscreen: true,
      webPreferences: {
        preload: path.join(__dirname, 'badge-preload.js'),
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    const dataUrl = baseIcon.toDataURL();

    // Определяем текст для бейджа
    let badgeText = '';
    if (count > 0 && count <= 99) {
      badgeText = String(count);
    } else if (count >= 100) {
      badgeText = '99+';
    }

    const html = `<!DOCTYPE html>
<html>
<head>
<style>
  body { margin: 0; width: ${winWidth}px; height: ${winHeight}px; overflow: hidden; background: transparent; }
  canvas { display: block; }
</style>
</head>
<body>
<canvas id="c" width="${winWidth}" height="${winHeight}"></canvas>
<script>
(function() {
  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');
  var W = ${winWidth};
  var H = ${winHeight};
  var count = ${count};

  // Рисуем оригинальную иконку (центрируем если canvas больше)
  var img = new Image();
  img.onload = function() {
    var iconSize = Math.min(W, H);
    var ox = (W - iconSize) / 2;
    var oy = (H - iconSize) / 2;
    ctx.drawImage(img, ox, oy, iconSize, iconSize);

    // Бейдж — красный круг в правом верхнем углу иконки
    if (count > 0) {
      var radius = Math.floor(iconSize * 0.28);
      var bx = W - radius - 4;
      var by = radius + 4;

      // Тень
      ctx.beginPath();
      ctx.arc(bx, by + 2, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fill();

      // Градиент для круга
      var grad = ctx.createRadialGradient(
        bx - radius*0.3, by - radius*0.3, 0,
        bx, by, radius
      );
      grad.addColorStop(0, '#ff8a80');
      grad.addColorStop(0.5, '#ef4444');
      grad.addColorStop(1, '#b91c1c');
      ctx.beginPath();
      ctx.arc(bx, by, radius, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      // Обводка
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Текст внутри бейджа
      if (count > 0) {
        var fontSize = Math.max(radius * 1.1, 9);
        ctx.font = 'bold ' + fontSize + 'px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = 2;
        ctx.fillText('${badgeText}', bx, by + 1);
      }
    }

    // Отправляем результат в main process
    var dataURL = canvas.toDataURL('image/png');
    if (window.badgeAPI) {
      window.badgeAPI.sendResult(dataURL);
    }
  };
  img.onerror = function() {
    if (window.badgeAPI) window.badgeAPI.sendResult(null);
  };
  img.src = '${dataUrl}';
})();
<\/script>
</body>
</html>`;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logError('createTrayImageWithBadge: timeout');
        if (!offscreen.isDestroyed()) offscreen.close();
        resolve(null);
      }, 5000);

      const handler = (event, resultDataURL) => {
        clearTimeout(timeout);
        ipcMain.removeListener('badge-result', handler);
        if (!offscreen.isDestroyed()) offscreen.close();

        let icon = null;
        try {
          if (resultDataURL) {
            icon = nativeImage.createFromDataURL(resultDataURL);
            logToFile(`createTrayImageWithBadge: count=${count}, size=${icon.getSize().width}x${icon.getSize().height}`);
          }
        } catch (err) {
          logError(`createTrayImageWithBadge error: ${err.message}`);
        }

        badgeCache.set(count, icon || null);
        resolve(icon || null);
      };

      ipcMain.on('badge-result', handler);

      offscreen.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
        .catch(err => {
          logError(`createTrayImageWithBadge load error: ${err.message}`);
          clearTimeout(timeout);
          ipcMain.removeListener('badge-result', handler);
          if (!offscreen.isDestroyed()) offscreen.close();
          badgeCache.set(count, null);
          resolve(null);
        });
    });
  } catch (err) {
    logError(`createTrayImageWithBadge fatal: ${err.message}`);
    badgeCache.set(count, null);
    return null;
  }
}

/**
 * Создаёт простую красную иконку-бейдж (круг с числом) для setOverlayIcon.
 * Это маленькая квадратная PNG-картинка: красный круг + белый текст.
 * @param {number} count - количество непрочитанных
 * @returns {Promise<nativeImage|null>}
 */
async function createBadgeOverlayIcon(count) {
  // Кэш по количеству — если уже есть готовая иконка, возвращаем её
  const overlayKey = '__overlay_' + count;
  if (badgeCache.has(overlayKey)) {
    const cached = badgeCache.get(overlayKey);
    if (cached !== null) return cached;
  }

  const SIZE = 64; // размер бейджа — достаточно для круга с числом
  badgeCache.set(overlayKey, null);

  try {
    const winWidth = SIZE;
    const winHeight = SIZE;

    let badgeText = '';
    if (count > 0 && count <= 99) {
      badgeText = String(count);
    } else if (count >= 100) {
      badgeText = '99+';
    }

    const html = `<!DOCTYPE html>
<html>
<head>
<style>
  body { margin: 0; width: ${winWidth}px; height: ${winHeight}px; overflow: hidden; background: transparent; }
  canvas { display: block; }
</style>
</head>
<body>
<canvas id="c" width="${winWidth}" height="${winHeight}"></canvas>
<script>
(function() {
  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');
  var W = ${winWidth};
  var H = ${winHeight};
  var count = ${count};

  // Красный круг по центру
  var radius = Math.floor(W * 0.45);
  var cx = W / 2;
  var cy = H / 2;

  // Тень
  ctx.beginPath();
  ctx.arc(cx, cy + 2, radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();

  // Градиент для круга
  var grad = ctx.createRadialGradient(
    cx - radius*0.25, cy - radius*0.25, 0,
    cx, cy, radius
  );
  grad.addColorStop(0, '#ff6b6b');
  grad.addColorStop(0.4, '#ef4444');
  grad.addColorStop(1, '#b91c1c');
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Обводка
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Текст внутри бейджа
  if (count > 0) {
    var fontSize = Math.max(radius * 1.3, 14);
    ctx.font = 'bold ' + fontSize + 'px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 3;
    ctx.fillText('${badgeText}', cx, cy + 1);
  }

  var dataURL = canvas.toDataURL('image/png');
  if (window.badgeAPI) {
    window.badgeAPI.sendOverlayResult(dataURL);
  }
})();
<\/script>
</body>
</html>`;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logError('createBadgeOverlayIcon: timeout');
        if (!offscreen.isDestroyed()) offscreen.close();
        resolve(null);
      }, 5000);

      const offscreen = new BrowserWindow({
        show: false,
        width: winWidth,
        height: winHeight,
        frame: false,
        transparent: true,
        skipTaskbar: true,
        offscreen: true,
        webPreferences: {
          preload: path.join(__dirname, 'badge-preload.js'),
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      const handler = (event, resultDataURL) => {
        clearTimeout(timeout);
        ipcMain.removeListener('badge-overlay-result', handler);
        if (!offscreen.isDestroyed()) offscreen.close();

        let icon = null;
        try {
          if (resultDataURL) {
            icon = nativeImage.createFromDataURL(resultDataURL);
            logToFile(`createBadgeOverlayIcon: count=${count}, size=${icon.getSize().width}x${icon.getSize().height}`);
          }
        } catch (err) {
          logError(`createBadgeOverlayIcon error: ${err.message}`);
        }

        badgeCache.set('__overlay_' + count, icon || null);
        resolve(icon || null);
      };

      ipcMain.on('badge-overlay-result', handler);

      offscreen.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
        .catch(err => {
          logError(`createBadgeOverlayIcon load error: ${err.message}`);
          clearTimeout(timeout);
          ipcMain.removeListener('badge-overlay-result', handler);
          if (!offscreen.isDestroyed()) offscreen.close();
          badgeCache.set('__overlay_' + count, null);
          resolve(null);
        });
    });
  } catch (err) {
    logError(`createBadgeOverlayIcon fatal: ${err.message}`);
    badgeCache.set('__overlay_' + count, null);
    return null;
  }
}

/**
 * Возвращает иконку для tray: с бейджем или оригинал.
 */
async function getTrayImageForCount(count) {
  if (count > 0) {
    const icon = await createTrayImageWithBadge(count);
    return icon || nativeImage.createFromPath(path.join(__dirname, 'icon.ico'));
  }
  // Без бейджа — оригинал
  return nativeImage.createFromPath(path.join(__dirname, 'icon.ico'));
}

ipcMain.on('set-unread-count', async (event, count) => {
  logToFile(`Получен set-unread-count: count=${count}`);

  // Если счётчик не изменился — ничего не делаем
  if (count === currentUnreadCount) return;

  currentUnreadCount = count;

  // Немедленно обновляем tray-иконку если есть в кэше
  if (tray && badgeCache.has(count)) {
    const cachedIcon = badgeCache.get(count);
    if (cachedIcon) {
      try {
        tray.setImage(cachedIcon);
        logToFile(`updateUnreadBadge: tray image обновлен из кэша для count=${count}`);
      } catch (err) {
        logError(`updateUnreadBadge tray cache error: ${err.message}`);
      }
    } else if (count === 0) {
      // Сбрасываем на оригинал
      try {
        tray.setImage(nativeImage.createFromPath(path.join(__dirname, 'icon.ico')));
        logToFile(`updateUnreadBadge: tray image сброшен для count=0`);
      } catch (err) {
        logError(`updateUnreadBadge tray reset error: ${err.message}`);
      }
    }
  }

  // Обновляем taskbar overlay немедленно если есть в кэше
  if (mainWindow && badgeCache.has('__overlay_' + count)) {
    const cachedOverlay = badgeCache.get('__overlay_' + count);
    if (cachedOverlay) {
      try {
        mainWindow.setOverlayIcon(cachedOverlay, `${count} непрочитанных`);
        logToFile(`updateUnreadBadge: overlay обновлен из кэша для count=${count}`);
      } catch (err) {
        logError(`updateUnreadBadge overlay cache error: ${err.message}`);
      }
    }
  }

  // Асинхронно генерируем новый бейдж если его нет в кэше
  updateUnreadBadge();
});

// Функция обновления бейджа на taskbar и tray
async function updateUnreadBadge() {
  if (!mainWindow) {
    logError('updateUnreadBadge: mainWindow не существует');
    return;
  }

  logToFile(`updateUnreadBadge: текущий счетчик непрочитанных = ${currentUnreadCount}`);

  // --- Taskbar overlay icon (Windows) ---
  try {
    if (currentUnreadCount > 0) {
      const badgeIcon = await createBadgeOverlayIcon(currentUnreadCount);
      if (badgeIcon) {
        mainWindow.setOverlayIcon(badgeIcon, `${currentUnreadCount} непрочитанных`);
      } else {
        logError('updateUnreadBadge: не удалось создать overlay бейдж');
      }
    } else {
      mainWindow.setOverlayIcon(null, '');
    }
  } catch (err) {
    logError(`updateUnreadBadge overlay error: ${err.message}`);
  }

  // --- Tray icon с бейджем ---
  if (tray) {
    try {
      const trayImage = await getTrayImageForCount(currentUnreadCount);
      if (trayImage) {
        tray.setImage(trayImage);
        logToFile(`updateUnreadBadge: tray image обновлен для count=${currentUnreadCount}`);
      }
    } catch (err) {
      logError(`updateUnreadBadge tray error: ${err.message}`);
    }
  }

  // --- macOS native badge (на всякий случай) ---
  try {
    if (process.platform === 'darwin') {
      app.setAppUserModelId('ChatApp.WithBadge');
      mainWindow.setBadgeCount(currentUnreadCount > 0 ? currentUnreadCount : 0);
    }
  } catch (err) {
    logError(`updateUnreadBadge macOS badge error: ${err.message}`);
  }
}

// Обработка запросов на обновление
ipcMain.on('check-for-updates', () => {
  logToFile('Ручная проверка обновлений...');
  try {
    // Убедимся, что конфигурация существует перед проверкой
    ensureUpdateConfig();
    autoUpdater.checkForUpdates();
  } catch (err) {
    logError(`Ошибка при проверке обновлений: ${err.message}`);
    if (mainWindow) {
      mainWindow.webContents.send('update-error', `Не удалось проверить обновления: ${err.message}`);
    }
  }
});

ipcMain.on('start-update', () => {
  logToFile('Пользователь запустил обновление');
  autoUpdater.downloadUpdate();
});

ipcMain.on('quit-and-install', () => {
  logToFile('Пользователь запустил установку обновления (тихая + автозапуск)');
  autoUpdater.quitAndInstall(true, true); // isSilent=true, isForceRunAfter=true
});

// Логирование непредвиденных ошибок
process.on('uncaughtException', (err) => {
  logError(`Uncaught Exception: ${err.message}`);
  logError(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  logError(`Unhandled Rejection: ${reason}`);
});
