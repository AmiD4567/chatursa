const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// Определяем isDev после app.whenReady()
let isDev;
let logDir;
let logFile;

function initPaths() {
  isDev = !app.isPackaged;
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
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowDowngrade = false;

autoUpdater.on('checking-for-update', () => {
  logToFile('Проверка обновлений...');
});

autoUpdater.on('update-available', (info) => {
  logToFile(`Доступно обновление: ${info.version}`);
  if (mainWindow) {
    mainWindow.webContents.send('update-available', info);
  }
});

autoUpdater.on('update-not-available', (info) => {
  logToFile(`Обновлений не найдено. Текущая версия: ${info.version}`);
});

autoUpdater.on('download-progress', (progressObj) => {
  logToFile(`Загрузка обновления: ${progressObj.percent}%`);
  if (mainWindow) {
    mainWindow.webContents.send('download-progress', progressObj);
  }
});

autoUpdater.on('update-downloaded', (info) => {
  logToFile('Обновление загружено. Перезапуск для установки...');
  if (mainWindow) {
    mainWindow.webContents.send('update-downloaded', info);
    // Показываем уведомление о готовности обновления
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Обновление готово',
      message: 'Доступна новая версия приложения. Перезапустить сейчас?',
      buttons: ['Перезапустить', 'Позже'],
      defaultId: 0,
      cancelId: 1
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  }
});

autoUpdater.on('error', (err) => {
  logError(`Ошибка автообновления: ${err.message}`);
});

const gotTheLock = app.requestSingleInstanceLock();

let mainWindow;
let tray;
let backendProcess;

// Если не получили блокировку - приложение уже запущено
if (!gotTheLock) {
  logToFile('Приложение уже запущено. Выходим...');
  app.quit();
  return;
}

// Обработка второго экземпляра
app.on('second-instance', (event, commandLine, workingDirectory) => {
  logToFile('Попытка запуска второго экземпляра');
  // Показываем существующее окно
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.show();

    // Уведомление
    new Notification({
      title: 'Чат',
      body: 'Приложение уже запущено и работает в трее'
    }).show();
  }
});

// Для production используем пути относительно process.resourcesPath
const getResourcesPath = () => {
  if (isDev) {
    return path.join(__dirname, '..');
  }
  // В production ресурсы находятся в resources (electron-builder копирует туда)
  return process.resourcesPath;
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
    env: backendEnv
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

  // Обработка закрытия
  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.hide();

    // Показываем уведомление в трей
    if (tray) {
      tray.displayBalloon({
        title: 'Чат',
        content: 'Приложение свёрнуто в трей. Двойной клик для открытия.'
      });
    }
  });

  // Открытие DevTools в разработке (раскомментировать при необходимости)
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  logToFile('Window created successfully');
  
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
  // Инициализация путей и логирования
  initPaths();
  logToFile(`App Path: ${app.getAppPath()}`);
  logToFile(`Resources Path: ${process.resourcesPath}`);
  
  // Запуск бэкенда
  startBackend();

  // Создание окна
  createWindow();

  // Создание трея
  createTray();
});

// Обработка закрытия приложения
app.on('before-quit', (event) => {
  logToFile('Закрытие приложения (before-quit)...');
  app.isQuiting = true;
  stopBackend();
  
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

// Обработка уведомлений от веб-приложения
ipcMain.on('show-notification', (event, { title, body, icon }) => {
  new Notification({
    title,
    body,
    icon: icon ? path.join(__dirname, icon) : undefined
  }).show();
});

// Обработка запросов на обновление
ipcMain.on('start-update', () => {
  logToFile('Пользователь запустил обновление');
  autoUpdater.downloadUpdate();
});

ipcMain.on('quit-and-install', () => {
  logToFile('Пользователь запустил установку обновления');
  autoUpdater.quitAndInstall();
});

// Логирование непредвиденных ошибок
process.on('uncaughtException', (err) => {
  logError(`Uncaught Exception: ${err.message}`);
  logError(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  logError(`Unhandled Rejection: ${reason}`);
});
