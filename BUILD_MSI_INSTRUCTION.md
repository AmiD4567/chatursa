# 📦 Инструкция по сборке Chat App в установщик MSI

## Требования

- Node.js 16+
- npm 8+
- Windows 10/11

## Быстрый старт

### 1. Установка зависимостей

```bash
cd chat-app
npm install
```

### 2. Сборка приложения

```bash
# Сборка frontend
npm run build

# Сборка MSI установщика
npm run electron:build
```

Или одной командой:

```bash
npm run electron:build:all
```

## Скрипты сборки

| Команда | Описание |
|---------|----------|
| `npm run build` | Сборка React frontend |
| `npm run electron:dev` | Запуск в режиме разработки |
| `npm run electron:build` | Сборка MSI установщика |
| `npm run electron:build:all` | Сборка всех версий (MSI) |
| `npm run release` | Сборка с публикацией на GitHub |

## Результат сборки

После успешной сборки в папке `dist/` появятся файлы:

```
dist/
├── Chat App-1.0.8.msi    # MSI установщик
└── win-unpacked/         # Распакованная версия
```

## Настройки установщика

### MSI

Установщик создает:
- Ярлык на рабочем столе
- Ярлык в меню Пуск
- Запись в "Программы и компоненты" для удаления

### Конфигурация

Файл: `package.json` → `build` секция

```json
{
  "build": {
    "msi": {
      "artifactName": "${productName}-${version}.${ext}"
    }
  }
}
```

## Автообновления

Приложение поддерживает автообновления через GitHub Releases.

### Настройка

1. Создайте релиз на GitHub с тегом версии (например, `v1.0.8`)
2. Прикрепите `.msi` файл к релизу
3. Приложение автоматически проверит и предложит обновление

### Публикация

```bash
npm run release
```

## Логирование

Логи приложения сохраняются в:

- **Development:** `chat-app/logs/chat-app.log`
- **Production:** `%APPDATA%\Chat App\logs\chat-app.log`

## База данных и файлы

В production режиме данные хранятся в:

```
%APPDATA%\Chat App\
├── database\
│   └── chat.db          # База данных SQLite
├── uploads\             # Загруженные файлы
└── logs\
    └── chat-app.log     # Логи приложения
```

## Устранение проблем

### Ошибка: "electron-builder not found"

```bash
npm install -g electron-builder
```

### Ошибка: "icon.ico not found"

Убедитесь что файл `electron/icon.ico` существует.

### Ошибка сборки на Windows

Установите Visual C++ Build Tools:
```bash
npm install --global windows-build-tools
```

### Бэкенд не запускается в production

Проверьте логи в `%APPDATA%\Chat App\logs\chat-app.log`

## Проверка перед релизом

- [ ] Версия в `package.json` обновлена
- [ ] Версия в `backend/config.json` обновлена
- [ ] `electron/icon.ico` существует
- [ ] Все зависимости установлены
- [ ] Frontend собран (`npm run build`)
- [ ] Тесты пройдены
- [ ] Логи не содержат ошибок

## Контакты

Разработчик: Pantyuhov DI
Версия: 1.0.8
