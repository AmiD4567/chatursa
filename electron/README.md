# Electron для чат-приложения

## Структура
```
chat-app/
├── electron/
│   ├── main.js          # Главный процесс Electron
│   ├── preload.js       # Мост безопасности
│   ├── icon.ico         # Иконка приложения (нужно создать)
│   └── icon.png         # Исходная иконка 256x256
├── backend/             # Серверная часть
├── frontend/            # Клиентская часть
├── uploads/             # Загруженные файлы
└── dist/                # Сборка (создаётся после сборки)
```

## Установка

```bash
# Установка зависимостей
npm install

# Создание иконки (опционально)
# Поместите icon.ico в папку electron/
```

## Запуск в режиме разработки

```bash
# Запуск frontend и backend
npm start

# Запуск Electron (после сборки frontend)
npm run electron:dev
```

## Сборка приложения

```bash
# Сборка установщика Windows (.exe)
npm run electron:build

# Сборка портативной версии
npm run electron:build:portable
```

## Результат сборки

После сборки в папке `dist/` появятся:
- `Chat App Setup 1.0.0.exe` - установщик
- `Chat App-Portable-1.0.0.exe` - портативная версия (если собирали)

## Требования

- Node.js 18+
- Windows 10/11 (для сборки)

## Создание иконки

1. Создайте изображение 256x256 пикселей
2. Конвертируйте в ICO: https://convertio.co/png-ico/
3. Сохраните как `electron/icon.ico`
