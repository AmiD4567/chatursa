# Инструкция по отладке красной точки

## 1. Установка новой версии

Скачайте и установите последнюю версию с:
https://github.com/AmiD4567/chat-app/releases/tag/v1.0.37

## 2. Проверка логов после установки

После установки запустите приложение и проверьте логи:
```
%APPDATA%\chat-app\logs\chat-app.log
```

Откройте файл и посмотрите есть ли записи:
- `Получен set-unread-count: count=X`
- `updateUnreadBadge: создаем бейдж с count=X`
- `createBadgeIcon: создаем бейдж с count=X`

## 3. Проверка через DevTools

### 3.1. Включите DevTools
В работающем приложении нажмите `Ctrl+Shift+I` или `F12`

### 3.2. Проверка console.log
В консоли DevTools должны быть сообщения:
```
[Badge] Общее количество непрочитанных: X
[Badge] electronAPI существует: true
[Badge] Отправляем setUnreadCount: X
```

### 3.3. Ручной тест
В консоли DevTools выполните:
```javascript
window.electronAPI.setUnreadCount(5)
```

Если после этого появится красная точка - значит проблема в том что useEffect не срабатывает автоматически.

### 3.4. Проверка состояния chats
В консоли DevTools выполните:
```javascript
// Показать все чаты и их unreadCount
console.log('Chats:', chats.map(c => ({id: c.id, name: c.name, unread: c.unreadCount})))
```

## 4. Возможные проблемы

### Проблема 1: Нет window.electronAPI
Если `window.electronAPI` не существует, значит приложение запущено не в Electron, а в браузере.

### Проблема 2: Нет логов в chat-app.log
Если в логах нет записей про set-unread-count, значит IPC не доходит до основного процесса.

### Проблема 3: Логи есть но нет точки
Если в логах есть `createBadgeIcon: icon created successfully`, но точки нет - проблема в Windows overlay.

## 5. Альтернативный тест

Если ничего не помогает, можно попробовать упрощенную версию без offscreen окна:
```javascript
// В основном процессе это должно работать:
mainWindow.setOverlayIcon(nativeImage.createFromPath('electron/icon.ico'), 'test')
```

Это покажет работает ли вообще setOverlayIcon.
