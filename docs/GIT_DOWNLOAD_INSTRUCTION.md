# 📥 Подробная Инструкция по Скачиванию Проекта с GitHub

## 🎯 Описание

Эта инструкция поможет вам скачать проект **chat-app** с последними изменениями из репозитория GitHub.

---

## 📍 Адрес Репозитория

```
https://github.com/AmiD4567/chat-app.git
```

---

## 🚀 Вариант 1: Полное Клонирование (Первый Раз)

Используйте этот вариант, если вы скачиваете проект впервые.

### Шаг 1: Откройте терминал

- **Windows:** Нажмите `Win + R`, введите `cmd` или `PowerShell`
- **macOS/Linux:** Откройте приложение Terminal

### Шаг 2: Выполните команды

```bash
# Клонировать репозиторий
git clone https://github.com/AmiD4567/chat-app.git

# Перейти в папку проекта
cd chat-app
```

### Шаг 3: Проверка скачивания

```bash
# Посмотреть структуру проекта
ls -la          # Windows (PowerShell) или dir
tree /F         # Показать дерево файлов (если установлен)

# Посмотреть историю коммитов
git log --oneline
```

---

## 🔄 Вариант 2: Обновление Существующего Проекта

Используйте этот вариант, если проект уже скачан и нужно обновить до последних изменений.

### Шаг 1: Перейдите в папку проекта

```bash
cd chat-app
```

### Шаг 2: Проверьте статус репозитория

```bash
# Посмотреть текущее состояние
git status
```

**Ожидаемый вывод:**
```
On branch master
Your branch is up to date with 'origin/master'.
nothing to commit, working tree clean
```

### Шаг 3: Подтяните последние изменения

```bash
# Обновить до последних изменений из репозитория
git pull origin master
```

**Возможные варианты вывода:**

#### ✅ Успешное обновление:
```
remote: Counting objects: 150, done.
remote: Compressing objects: 100% (45/45), done.
remote: Total 150 (delta 80), reused 60 (delta 50)
Unpacking objects: 100% (150/150), done.
From https://github.com/AmiD4567/chat-app
   a1b2c3d..e4f5g6h  master -> origin/master
Updating a1b2c3d...e4f5g6h
Fast-forward
 backend/server.js | 50 ++++++++++++++++++++++++++++++++++++++++++++++++
 1 file changed, 50 insertions(+)
```

#### ⚠️ Конфликт изменений:
Если у вас есть локальные изменения, вы увидите сообщение о конфликте. В этом случае:

```bash
# Сначала сохраните локальные изменения
git stash

# Или посмотрите какие файлы изменены
git diff

# Затем обновите проект
git pull origin master

# Верните свои изменения (если сохранили через stash)
git stash pop
```

---

## 🔍 Дополнительные Команды Git

### Проверка состояния репозитория

```bash
# Показать все изменения в проекте
git status

# Показать какие файлы изменены
git diff --name-only

# Показать детали изменений
git diff
```

### История коммитов

```bash
# Краткая история (по 1 строке на коммит)
git log --oneline

# Подробная история с датами
git log --pretty=format:"%h - %an, %ar : %s"

# Посмотреть последние N коммитов
git log -10

# Показать изменения в конкретном файле
git log backend/server.js
```

### Ветки (Branches)

```bash
# Список всех веток
git branch

# Переключиться на ветку master
git checkout master

# Создать новую ветку
git checkout -b my-new-branch

# Слияние ветки в текущую
git merge my-new-branch
```

### Скачивание изменений без применения

```bash
# Скачать изменения, но не применять их
git fetch origin

# Посмотреть что скачано
git log origin/master..HEAD
```

---

## 🛠️ Решение Проблем

### Проблема 1: "fatal: Could not read from remote repository"

**Причина:** Не настроены права доступа к репозиторию.

**Решение:**
```bash
# Проверьте URL репозитория
git remote -v

# Если нужно изменить URL на HTTPS
git remote set-url origin https://github.com/AmiD4567/chat-app.git
```

### Проблема 2: "Already up to date"

**Причина:** Проект уже обновлён до последней версии.

**Решение:** Это нормально — значит всё актуально!

### Проблема 3: Конфликт при merge

**Причина:** Есть локальные изменения, которые конфликтуют с удалёнными.

**Решение:**
```bash
# Отменить конфликт и сохранить удалённые изменения
git checkout --theirs <файл>

# Или свои изменения
git checkout --ours <файл>

# Или вручную отредактировать файл и решить конфликт

# Завершить слияние
git add .
git commit -m "Merge conflict resolved"
```

### Проблема 4: Нет доступа к Git

**Причина:** Git не установлен.

**Решение (Windows):**
1. Скачайте Git для Windows с https://git-scm.com/download/win
2. Установите и перезапустите терминал

**Решение (macOS):**
```bash
# Через Homebrew
brew install git

# Или через Terminal
xcode-select --install
```

---

## 📂 Структура Скачанного Проекта

```
chat-app/
├── .env.example              # Пример файла конфигурации
├── .gitignore               # Файл игнорирования Git
├── package.json             # Зависимости и скрипты
├── README.md                # Основное описание проекта
├── backend/                 # Бэкенд (Node.js + Express)
│   ├── chat.db              # База данных SQLite
│   └── server.js            # Основной сервер
├── frontend/                # Фронтенд (React)
├── electron/                # Конфигурация Electron
├── uploads/                 # Папка для загруженных файлов
└── GIT_DOWNLOAD_INSTRUCTION.md  # Эта инструкция
```

---

## 🚀 Установка После Скачивания

### Шаг 1: Установите зависимости

```bash
cd chat-app
npm install
```

### Шаг 2: Настройте переменные окружения

Создайте файл `.env` в корневой папке:

```bash
# Создайте .env (можно через блокнот)
echo "CHAT_APP_PORT=3001" > .env
echo "CHAT_APP_HOST=0.0.0.0" >> .env
```

### Шаг 3: Запустите сервер

**Windows:**
```bash
# Используйте готовый скрипт
run-chat.bat

# Или вручную
cd backend
node server.js
```

**macOS/Linux:**
```bash
npm start
# или
cd backend && node server.js
```

---

## 📞 Контакты и Поддержка

- **Репозиторий:** https://github.com/AmiD4567/chat-app
- **Инструкция по сборке:** `BUILD_INSTRUCTION.md`
- **Инструкция по релизам:** `RELEASE_GUIDE.md`

---

## ✅ Чеклист После Скачивания

- [ ] Проект скачан в папку `chat-app`
- [ ] Команда `git status` показывает чистое состояние
- [ ] Выполнена команда `npm install`
- [ ] Создан файл `.env` с настройками
- [ ] Сервер запущен и работает

---

**Дата создания инструкции:** 2026-05-03  
**Версия проекта:** Проверьте в `package.json` → поле `"version"`