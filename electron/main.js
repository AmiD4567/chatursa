const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// Определяем isDev после app.whenReady()
let isDev;
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
repo: chat-app
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
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowDowngrade = false;

autoUpdater.on('checking-for-update', () => {
  logToFile('Проверка обновлений...');
  if (mainWindow) {
    mainWindow.webContents.send('checking-for-update');
  }
});

autoUpdater.on('update-available', (info) => {
  logToFile(`Доступно обновление: ${info.version}`);
  if (mainWindow) {
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
ipcMain.on('show-notification', (event, { title, body, icon, chatId }) => {
  const notif = new Notification({
    title,
    body,
    icon: icon ? path.join(__dirname, icon) : undefined
  });
  
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
  
  notif.show();
});

// Обработка обновления счетчика непрочитанных сообщений
let currentUnreadCount = 0;
let badgeUpdatePromise = null;

ipcMain.on('set-unread-count', (event, count) => {
  logToFile(`Получен set-unread-count: count=${count}`);
  currentUnreadCount = count;
  updateUnreadBadge();
});

// Функция создания/обновления бейджа непрочитанных сообщений
async function updateUnreadBadge() {
  if (!mainWindow) {
    logError('updateUnreadBadge: mainWindow не существует');
    return;
  }

  logToFile(`updateUnreadBadge: текущий счетчик непрочитанных = ${currentUnreadCount}`);

  // Ждем завершения предыдущего обновления бейджа если оно есть
  if (badgeUpdatePromise) {
    logToFile('updateUnreadBadge: ожидаем завершения предыдущего обновления');
    await badgeUpdatePromise;
  }

  if (currentUnreadCount > 0) {
    logToFile(`updateUnreadBadge: создаем бейдж с count=${currentUnreadCount}`);
    // Создаем иконку с бейджем асинхронно
    badgeUpdatePromise = createBadgeIcon(currentUnreadCount).then(icon => {
      badgeUpdatePromise = null;

      if (icon) {
        logToFile('updateUnreadBadge: бейдж успешно создан');
        // Устанавливаем overlay иконку на окно (для панели задач)
        mainWindow.setOverlayIcon(icon, `${currentUnreadCount} непрочитанных сообщений`);
        logToFile('updateUnreadBadge: overlay иконка установлена на окно');

        // Обновляем иконку трея если есть
        if (tray) {
          tray.setImage(icon);
          logToFile('updateUnreadBadge: иконка трея обновлена');
        } else {
          logToFile('updateUnreadBadge: tray не существует');
        }
      } else {
        logError('updateUnreadBadge: не удалось создать бейдж');
      }
    }).catch(err => {
      badgeUpdatePromise = null;
      logError(`Ошибка обновления бейджа: ${err.message}`);
    });
  } else {
    logToFile('updateUnreadBadge: убираем бейдж (count=0)');
    // Убираем бейдж
    mainWindow.setOverlayIcon(null, '');

    // Возвращаем стандартную иконку трея
    if (tray) {
      const iconPath = path.join(__dirname, 'icon.ico');
      if (fs.existsSync(iconPath)) {
        tray.setImage(iconPath);
      }
    }
  }
}

// Функция создания иконки с красной точкой - упрощенная версия
function createBadgeIcon(count) {
  try {
    const iconPath = path.join(__dirname, 'icon.ico');
    if (!fs.existsSync(iconPath)) {
      logError('createBadgeIcon: icon.ico не найден');
      return Promise.resolve(null);
    }

    logToFile(`createBadgeIcon: создаем бейдж с count=${count}`);
    
    const baseIcon = nativeImage.createFromPath(iconPath);
    const baseSize = baseIcon.getSize();
    logToFile(`createBadgeIcon: размер базовой иконки ${baseSize.width}x${baseSize.height}`);
    
    // Создаем offscreen окно для рисования
    const canvasSize = Math.max(baseSize.width, baseSize.height, 48);
    logToFile(`createBadgeIcon: размер canvas ${canvasSize}x${canvasSize}`);
    
    const offscreen = new BrowserWindow({
      show: false,
      width: canvasSize,
      height: canvasSize,
      frame: false,
      transparent: true,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'badge-preload.js')
      }
    });

    const dataUrl = baseIcon.toDataURL();
    logToFile(`createBadgeIcon: baseIcon converted to dataURL (length: ${dataUrl.length})`);

    const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; width: ${canvasSize}px; height: ${canvasSize}px; overflow: hidden; }
    canvas { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <canvas id="canvas" width="${canvasSize}" height="${canvasSize}"></canvas>
  <script>
    console.log('[Badge Canvas] Script started');
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const canvasSize = ${canvasSize};
    const badgeCount = ${count};
    
    console.log('[Badge Canvas] Canvas size:', canvasSize, 'Count:', badgeCount);
    
    const img = new Image();
    img.onload = () => {
      console.log('[Badge Canvas] Image loaded');
      ctx.drawImage(img, 0, 0, canvasSize, canvasSize);
      
      const dotRadius = canvasSize * 0.25;
      const dotX = canvasSize - dotRadius - 3;
      const dotY = dotRadius + 3;
      
      console.log('[Badge Canvas] Drawing dot at', dotX, dotY, 'radius:', dotRadius);
      
      // Тень
      ctx.beginPath();
      ctx.arc(dotX, dotY + 2, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.fill();
      
      // Красная точка с градиентом
      ctx.beginPath();
      ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
      const gradient = ctx.createRadialGradient(
        dotX - dotRadius * 0.3, dotY - dotRadius * 0.3, 0,
        dotX, dotY, dotRadius
      );
      gradient.addColorStop(0, '#ff6b6b');
      gradient.addColorStop(0.7, '#ef4444');
      gradient.addColorStop(1, '#dc2626');
      ctx.fillStyle = gradient;
      ctx.fill();
      
      // Обводка
      ctx.beginPath();
      ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      
      // Число
      if (badgeCount > 0 && badgeCount <= 99) {
        const fontSize = Math.max(dotRadius * 1.1, 10);
        ctx.font = 'bold ' + fontSize + 'px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
        ctx.shadowBlur = 2;
        ctx.fillText(badgeCount.toString(), dotX, dotY + 1);
      } else if (badgeCount > 99) {
        const fontSize = Math.max(dotRadius * 1.0, 9);
        ctx.font = 'bold ' + fontSize + 'px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
        ctx.shadowBlur = 2;
        ctx.fillText('99+', dotX, dotY + 1);
      }
      
      const dataURL = canvas.toDataURL('image/png');
      console.log('[Badge Canvas] Canvas rendered, dataURL length:', dataURL.length);
      
      if (window.badgeAPI) {
        console.log('[Badge Canvas] Sending result via badgeAPI');
        window.badgeAPI.sendResult(dataURL);
      } else {
        console.error('[Badge Canvas] badgeAPI not found on window');
      }
    };
    
    img.onerror = (e) => {
      console.error('[Badge Canvas] Image failed to load:', e);
      if (window.badgeAPI) {
        window.badgeAPI.sendResult(null);
      }
    };
    
    img.src = '${dataUrl}';
    console.log('[Badge Canvas] Image src set');
  <\/script>
</body>
</html>`;

    // Возвращаем Promise
    return new Promise((resolve) => {
      logToFile('createBadgeIcon: waiting for badge-result...');
      
      const timeout = setTimeout(() => {
        logError('createBadgeIcon: timeout waiting for badge result');
        if (!offscreen.isDestroyed()) {
          offscreen.close();
        }
        resolve(null);
      }, 5000);

      const handler = (event, resultDataURL) => {
        logToFile(`createBadgeIcon: received badge-result (length: ${resultDataURL ? resultDataURL.length : 0})`);
        clearTimeout(timeout);
        ipcMain.removeListener('badge-result', handler);
        
        if (!offscreen.isDestroyed()) {
          offscreen.close();
        }

        try {
          if (resultDataURL) {
            const icon = nativeImage.createFromDataURL(resultDataURL);
            logToFile(`createBadgeIcon: icon created successfully, size: ${icon.getSize().width}x${icon.getSize().height}`);
            resolve(icon);
          } else {
            logError('createBadgeIcon: resultDataURL is null');
            resolve(null);
          }
        } catch (err) {
          logError(`createBadgeIcon: error creating icon from dataURL: ${err.message}`);
          resolve(null);
        }
      };

      ipcMain.on('badge-result', handler);

      offscreen.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
        .then(() => {
          logToFile('createBadgeIcon: HTML loaded successfully in offscreen window');
        })
        .catch(err => {
          logError(`createBadgeIcon: error loading HTML: ${err.message}`);
          clearTimeout(timeout);
          ipcMain.removeListener('badge-result', handler);
          if (!offscreen.isDestroyed()) {
            offscreen.close();
          }
          resolve(null);
        });
    });
  } catch (err) {
    logError(`createBadgeIcon: fatal error: ${err.message}`);
    logError(err.stack);
    return Promise.resolve(null);
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
