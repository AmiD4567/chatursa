# 🚀 Инструкция по сборке Windows-приложения

## ✅ Что уже настроено

1. **Electron** установлен и настроен
2. **main.js** — главный процесс с автозапуском бэкенда
3. **preload.js** — безопасный мост
4. **package.json** — конфигурация сборки

## 📦 Варианты запуска

### 1. Запуск без сборки (для тестирования)

```bash
# Запуск в режиме разработки
npm start
```

### 2. Запуск Electron без сборки

```bash
# Сначала соберите frontend
npm run build

# Затем запустите Electron
cd electron
electron .
```

### 3. Полная сборка приложения

**Вариант A: Запуск от имени администратора** (требуется для символических ссылок)

```bash
# Откройте PowerShell от имени администратора
cd c:\Users\user\Desktop\Чат\chat-app
npm run electron:build
```

**Вариант B: Включить режим разработчика** (альтернатива администратору)

```powershell
# PowerShell от имени администратора
Enable-WindowsDeveloperLicense
```

**Вариант C: Использовать Docker**

```bash
# Создайте Dockerfile для сборки
docker run --rm -ti -v ${PWD}:/project electronuserland/builder:wine npm run electron:build
```

## 📁 Структура после сборки

```
chat-app/
├── dist/                    # Результаты сборки
│   ├── win-unpacked/       # Распакованная версия
│   └── Chat App-Portable-1.0.0.exe  # Портативная версия
├── electron/
│   ├── main.js             # Главный процесс
│   ├── preload.js          # Мост безопасности
│   └── icon.png            # Иконка 256x256
├── backend/                # Сервер
├── frontend/build/         # Клиент
└── uploads/                # Файлы
```

## 🎨 Создание иконки

1. Создайте изображение 256×256 пикселей
2. Конвертируйте в ICO: https://convertio.co/ru/png-ico/
3. Сохраните как `electron/icon.ico`
4. В `package.json` раскомментируйте строки с иконками

## 🔧 Решение проблем

### Ошибка: "Cannot create symbolic link"

**Причина:** Недостаточно прав для создания символических ссылок

**Решение:**
1. Запустите PowerShell от имени администратора
2. Или включите режим разработчика Windows
3. Или используйте `npm run electron:build:portable`

### Ошибка: "image has unknown format"

**Причина:** Неверный формат иконки

**Решение:**
1. Удалите `electron/icon.ico`
2. Создайте новую иконку через онлайн-конвертер
3. Или уберите `"icon": "electron/icon.ico"` из package.json

### Ошибка: "ENOENT: no such file or directory"

**Причина:** Отсутствуют файлы сборки

**Решение:**
```bash
npm run build
npm run electron:build
```

## 📝 Ручная сборка (без electron-builder)

Если electron-builder не работает, можно собрать вручную:

```bash
# 1. Установите Electron
npm install electron --save-dev

# 2. Соберите frontend
npm run build

# 3. Скопируйте файлы в папку приложения
mkdir dist/manual-app
cp -r electron/* dist/manual-app/
cp -r backend dist/manual-app/
cp -r frontend/build dist/manual-app/frontend/
cp -r uploads dist/manual-app/

# 4. Запустите
cd dist/manual-app
electron .
```

## 🎯 Готовое решение

Для простоты можно использовать **портативную версию**:

```bash
npm run electron:build:portable
```

Файл появится в `dist/Chat App-Portable-1.0.0.exe`

## 📞 Поддержка

Если возникли проблемы:
1. Проверьте версию Node.js (требуется 18+)
2. Очистите кэш: `npm cache clean --force`
3. Переустановите зависимости: `rm -rf node_modules && npm install`
