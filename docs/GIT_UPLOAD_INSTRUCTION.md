# 📤 Инструкция по Загрузке Проекта на GitHub

## 🎯 Куда Загружать Проект

### Адрес репозитория:
```
https://github.com/AmiD4567/chat-app.git
```

---

## 🔧 Настройка Git и GitHub Token

### ⚡ Предпочтительный метод загрузки на GitHub

**Токен уже настроен в файле `.env`:**
```
GITHUB_TOKEN=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
```

Для использования токена при загрузке релиза установите переменную окружения:

**PowerShell:**
```powershell
$env:GH_TOKEN="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"
```

**CMD:**
```cmd
set GH_TOKEN=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
```

### Настройка Git (Первичная)

Если вы только начали работать с проектом:

1. **Инициализация git** (если не инициализирован):
    ```bash
    cd chat-app
    git init
    ```

2. **Настройка имени и email**:
    ```bash
    git config user.name "Pantyuhov DI"
    git config user.email "your-email@example.com"
    ```

3. **Смена remote на правильный репозиторий** (если нужен):
    ```bash
    git remote set-url origin https://github.com/AmiD4567/chat-app.git
    ```

---

## 🚀 Быстрая публикация релиза

Используйте готовый скрипт для загрузки:

```powershell
cd chat-app
.\upload-release.bat
```

Скрипт автоматически:
1. Считает токен из `.env` файла
2. Создаст тег версии
3. Загрузит файл на GitHub Releases


---

## 📝 Команды для Загрузки Проекта

### Стандартная загрузка:
```bash
cd chat-app

# Добавить все изменения
git add .

# Скоммитьть изменения с комментарием
git commit -m "Описание изменений"

# Запушить в репозиторий
git push origin master
```

---

## 🚀 Полная Инструкция: Сборка и Публикация Релиза

### Шаг 1: Подготовка

Убедитесь, что переменная окружения `GH_TOKEN` настроена с вашим GitHub Personal Access Token.

Команда проверки:
```powershell
$env:GH_TOKEN
```

### Шаг 2: Обновление версии в `package.json`

Измените версию на нужную (например, `1.0.55`):
```json
"version": "1.0.55"
```

Скоммитьте изменения:
```bash
git add package.json
git commit -m "Update version to 1.0.55"
git push origin master
```

### Шаг 3: Публикация Релиза

Выполните команду:
```bash
cd chat-app
npm run release
```

Это выполнит:
1. Сборку фронтенда (`npm run build`)
2. Создание установщика Windows (`electron-builder --win nsis`)
3. Автоматическую публикацию релиза на GitHub с тегом `v{VERSION}`

---

## 📁 Структура Проекта

```
chat-app/
├── package.json          # Зависимости и скрипты сборки
├── app-update.yml        # Конфигурация автообновления
├── frontend/             # React фронтенд
├── backend/              # Express бэкенд
└── electron/             # Electron конфигурация
```

---

## 🔑 Важные Файлы

| Файл | Назначение |
|------|------------|
| `package.json` | Версия, зависимости, скрипты сборки |
| `app-update.yml` | Конфиг автообновления (указывает репозиторий для обновлений) |
| `.gitignore` | Игнорируемые файлы (node_modules, dist/ и т.д.) |

---

## 📞 Контакты

При возникновении проблем обратитесь к файлам:
- `RELEASE_GUIDE.md` - рекомендации по созданию релизов
- `BUILD_INSTRUCTION.md` - инструкция по сборке