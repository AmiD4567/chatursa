# 📊 Анализ архитектуры чат-приложения

**Дата анализа:** 28 марта 2026 г.  
**Версия приложения:** 1.0.8

---

## 📋 Содержание

1. [Текущая архитектура](#текущая-архитектура)
2. [Сравнение с Rocket.Chat](#сравнение-socketchat)
3. [Компоненты системы](#компоненты-системы)
4. [Структура базы данных](#структура-базы-данных)
5. [API эндпоинты](#api-эндпоинты)
6. [WebSocket события](#websocket-события)
7. [Рекомендации по развитию](#рекомендации-по-развитию)

---

## 🏗️ Текущая архитектура

### Общая схема

```
┌─────────────────────────────────────────────────────────────────┐
│                    Chat App.exe (Electron)                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Frontend (React)                                         │  │
│  │  - Порт: 3000 (dev) / file:// (prod)                      │  │
│  │  - Socket.IO Client → http://localhost:3001               │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              ↕ IPC                               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Backend (Node.js + Express)                              │  │
│  │  - Порт: 3001                                             │  │
│  │  - Socket.IO Server                                       │  │
│  │  - REST API                                               │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              ↕                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  SQLite (sql.js)                                          │  │
│  │  - Файл: chat.db                                          │  │
│  │  - In-memory с сохранением на диск                        │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Тип архитектуры: **Монолитный**

Все компоненты упакованы в один `.exe` файл:
- ✅ Простая установка (один файл)
- ✅ Работает из коробки
- ❌ Сложно масштабировать
- ❌ Нет сетевой работы
- ❌ Обновление требует переустановки

---

## 🔄 Сравнение с Rocket.Chat

| Компонент | Rocket.Chat | Наш чат |
|-----------|-------------|---------|
| **Архитектура** | Клиент-сервер | Монолит |
| **Сервер** | Отдельная установка | Внутри .exe |
| **Клиент** | Отдельное приложение | Внутри .exe |
| **База данных** | MongoDB | SQLite (sql.js) |
| **Сетевая работа** | ✅ Да | ❌ Только localhost |
| **Масштабируемость** | ✅ Высокая | ❌ Ограничена |
| **Установка** | Docker/Snap/Manual | .exe / .msi |

---

## 🧩 Компоненты системы

### 1. Backend (`backend/server.js`)

**Технологии:**
- Node.js + Express
- Socket.IO (WebSocket)
- sql.js (SQLite in-memory)
- bcryptjs (хеширование паролей)
- multer (загрузка файлов)
- cors

**Конфигурация:**
```javascript
PORT = 3001  // Порт сервера
DB_PATH = chat.db  // Путь к базе данных
UPLOADS_PATH = uploads/  // Путь к файлам
```

**Основные возможности:**
- Регистрация/авторизация пользователей
- Обмен сообщениями (текст + файлы)
- Управление чатами (general, direct, group)
- Календарь задач
- Бронирование переговорной
- Админ-панель
- Аудит безопасности

### 2. Frontend (`frontend/src/App.js`)

**Технологии:**
- React 18
- Socket.IO Client
- Emoji Picker

**Основные возможности:**
- Авторизация/регистрация
- Личные и групповые чаты
- Отправка файлов (до 50MB)
- Статусы пользователей
- Профиль пользователя
- Календарь задач
- Бронирование переговорной
- Телефонный справочник
- Админ-панель
- Уведомления (Desktop + Browser)

### 3. Electron (`electron/main.js`)

**Роль:** Обёртка для запуска frontend + backend

**Функции:**
- Запуск backend сервера (spawn)
- Отображение frontend (BrowserWindow)
- Работа в трее
- Автообновления (electron-updater)
- IPC коммуникация
- Desktop уведомления

**Пути в production:**
```javascript
userDataPath = %APPDATA%\Chat App
dbPath = userDataPath\database
uploadsPath = userDataPath\uploads
```

---

## 🗄️ Структура базы данных

### Таблицы

#### `users` - Пользователи
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  password_hash TEXT,
  avatar TEXT,
  full_name TEXT,
  birth_date TEXT,
  about TEXT,
  mobile_phone TEXT,
  work_phone TEXT,
  status_text TEXT,
  host TEXT,
  ip_address TEXT,
  status TEXT DEFAULT 'offline',
  is_admin INTEGER DEFAULT 0,
  can_book_meeting_room INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_seen TEXT DEFAULT CURRENT_TIMESTAMP
);
```

#### `chats` - Чаты
```sql
CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('general', 'direct', 'group')),
  name TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

#### `chat_participants` - Участники чата
```sql
CREATE TABLE chat_participants (
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_id, user_id)
);
```

#### `messages` - Сообщения
```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  text TEXT,
  file_data TEXT,  -- JSON {name, url, size, mimetype}
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
  read_at TEXT,
  forwarded_from TEXT
);
```

#### `unread_messages` - Непрочитанные сообщения
```sql
CREATE TABLE unread_messages (
  user_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, message_id)
);
```

#### `user_sessions` - Сессии пользователей
```sql
CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  socket_id TEXT,
  ip_address TEXT,
  browser TEXT,
  login_time TEXT DEFAULT CURRENT_TIMESTAMP,
  last_activity TEXT DEFAULT CURRENT_TIMESTAMP
);
```

#### `calendar_tasks` - Задачи календаря
```sql
CREATE TABLE calendar_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  task_date TEXT NOT NULL,
  task_time TEXT,
  color TEXT DEFAULT '#667eea',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

#### `task_shares` - Общие задачи
```sql
CREATE TABLE task_shares (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

#### `meeting_room_bookings` - Бронирование переговорной
```sql
CREATE TABLE meeting_room_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  meeting_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  organizer_id TEXT,
  organizer_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

#### `security_logs` - Логи безопасности
```sql
CREATE TABLE security_logs (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  event TEXT NOT NULL,
  user_id TEXT,
  username TEXT,
  ip_address TEXT,
  status TEXT DEFAULT 'info',
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP
);
```

#### `ui_settings` - Настройки интерфейса
```sql
CREATE TABLE ui_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

---

## 🌐 API эндпоинты

### Авторизация

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| POST | `/api/register` | Регистрация пользователя |
| POST | `/api/login` | Вход в систему |
| GET | `/api/profile/:userId` | Получение профиля |
| PUT | `/api/profile/:userId` | Обновление профиля |
| POST | `/api/upload-avatar` | Загрузка аватара |

### Админ-панель

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| GET | `/api/admin/check` | Проверка статуса админа |
| GET | `/api/admin/stats` | Статистика системы |
| GET | `/api/admin/users` | Список пользователей |
| POST | `/api/admin/users` | Создание пользователя |
| PUT | `/api/admin/users/:id/rights` | Изменение прав админа |
| PUT | `/api/admin/users/:id/status` | Блокировка пользователя |
| DELETE | `/api/admin/users/:id` | Удаление пользователя |
| PUT | `/api/admin/users/:id/reset-password` | Сброс пароля |
| GET | `/api/admin/sessions` | Активные сессии |
| DELETE | `/api/admin/sessions/:id` | Завершение сессии |
| GET | `/api/admin/files` | Список файлов |
| DELETE | `/api/admin/files/:id` | Удаление файла |
| GET | `/api/admin/security-logs` | Логи безопасности |
| GET | `/api/admin/ui-settings` | Настройки интерфейса |
| PUT | `/api/admin/ui-settings` | Сохранение настроек |

### Календарь и задачи

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| GET | `/api/calendar/tasks` | Получение задач |
| POST | `/api/calendar/tasks` | Создание задачи |
| PUT | `/api/calendar/tasks/:id` | Обновление задачи |
| DELETE | `/api/calendar/tasks/:id` | Удаление задачи |
| GET | `/api/task-shares/received` | Полученные задачи |
| GET | `/api/task-shares/sent` | Отправленные задачи |
| POST | `/api/task-shares` | Поделиться задачей |
| PUT | `/api/task-shares/:id/accept` | Принять задачу |
| PUT | `/api/task-shares/:id/decline` | Отклонить задачу |

### Бронирование переговорной

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| GET | `/api/meeting-room/bookings` | Список бронирований |
| POST | `/api/meeting-room/bookings` | Создать бронирование |
| PUT | `/api/meeting-room/bookings/:id` | Обновить бронирование |
| DELETE | `/api/meeting-room/bookings/:id` | Удалить бронирование |

---

## 🔌 WebSocket события

### Клиент → Сервер

| Событие | Данные | Описание |
|---------|--------|----------|
| `user_joined` | `{userId, username, email}` | Подключение пользователя |
| `join_chat` | `chatId` | Присоединиться к чату |
| `send_message` | `{chatId, text, fileData}` | Отправить сообщение |
| `typing_start` | `{chatId}` | Начал ввод текста |
| `typing_stop` | `{chatId}` | Закончил ввод текста |
| `mark_read` | `{chatId, userId}` | Прочитать сообщения |
| `request_users_list` | - | Запрос списка пользователей |
| `disconnect` | - | Отключение |

### Сервер → Клиент

| Событие | Данные | Описание |
|---------|--------|----------|
| `user_joined_success` | `{user, chats}` | Успешное подключение |
| `chat_history` | `{chatId, messages}` | История чата |
| `new_message` | `{message, chat, isOwnMessage}` | Новое сообщение |
| `user_typing` | `{chatId, userId, username}` | Пользователь печатает |
| `user_stopped_typing` | `{chatId, userId}` | Закончил ввод |
| `users_list` | `users[]` | Список пользователей |
| `users_list_updated` | `users[]` | Обновление списка |
| `user_status_changed` | `{userId, status}` | Статус изменился |
| `message_read` | `{chatId, messageId, userId}` | Сообщение прочитано |
| `new_task` | `task` | Новая задача |
| `task_updated` | `task` | Задача обновлена |
| `task_deleted` | `taskId` | Задача удалена |
| `booking_created` | `booking` | Бронирование создано |
| `booking_updated` | `booking` | Бронирование обновлено |
| `booking_deleted` | `bookingId` | Бронирование удалено |

---

## 📁 Структура проекта

```
chat-app/
├── backend/
│   ├── server.js              # Основной сервер (2742 строки)
│   ├── config.json            # Конфигурация
│   ├── chat.db                # База данных SQLite
│   └── uploads/               # Загруженные файлы
│
├── frontend/
│   ├── src/
│   │   ├── App.js             # Основное приложение (6202 строки)
│   │   └── index.js           # Точка входа
│   └── build/                 # Собранный frontend
│
├── electron/
│   ├── main.js                # Главный процесс Electron
│   ├── preload.js             # Preload скрипт
│   └── icon.ico               # Иконка приложения
│
├── dist/                      # Собранные билды
├── package.json               # Зависимости и скрипты
└── run-chat.bat               # Скрипт запуска
```

---

## ⚠️ Проблемы текущей архитектуры

### 1. Безопасность

- ❌ **SQL Injection уязвимость**: Использование конкатенации строк в SQL запросах
  ```javascript
  // ПЛОХО:
  db.exec(`SELECT * FROM users WHERE username = '${username}'`)
  
  // ХОРОШО:
  db.exec('SELECT * FROM users WHERE username = ?', [username])
  ```

- ❌ **CORS разрешён для всех**: `origin: "*"`
- ❌ **Пароли в localStorage**: `localStorage.setItem(STORAGE_KEY, JSON.stringify({...}))`

### 2. Производительность

- ❌ **База данных в памяти**:每次保存都写入磁盘
- ❌ **Нет пагинации сообщений**: Все сообщения загружаются сразу
- ❌ **Нет кэширования**: Повторные запросы к БД

### 3. Масштабируемость

- ❌ **Один сервер**: Нет поддержки кластеризации
- ❌ **Нет балансировки**: Все подключения на один экземпляр
- ❌ **SQLite ограничения**: Не подходит для высокой нагрузки

### 4. Сетевая функциональность

- ❌ **Только localhost**: Невозможно подключить удалённых клиентов
- ❌ **Нет HTTPS**: Только HTTP
- ❌ **Нет аутентификации через токены**: Сессии в памяти

---

## 🎯 Рекомендации по развитию

### Приоритет 1: Безопасность (Критично)

```markdown
- [ ] Использовать prepared statements для всех SQL запросов
- [ ] Добавить JWT аутентификацию
- [ ] Валидация входных данных на сервере
- [ ] Rate limiting для API
- [ ] HTTPS поддержка
```

### Приоритет 2: Разделение на клиент-сервер (Важно)

```markdown
- [ ] Выделить backend в отдельный пакет
- [ ] Создать установщик сервера
- [ ] Добавить экран выбора сервера в клиент
- [ ] Поддержка подключения к удалённому серверу
- [ ] Сохранение нескольких серверов
```

### Приоритет 3: Производительность (Желательно)

```markdown
- [ ] Пагинация сообщений (50 на страницу)
- [ ] Кэширование запросов к БД
- [ ] Индексы для частых запросов
- [ ] Оптимизация загрузки файлов
```

### Приоритет 4: Масштабируемость (Перспектива)

```markdown
- [ ] Поддержка MongoDB (опционально)
- [ ] Кластеризация сервера
- [ ] Redis для сессий
- [ ] Load balancing
```

---

## 📈 Метрики кода

| Файл | Строк кода | Сложность |
|------|------------|-----------|
| `backend/server.js` | 2,742 | Высокая |
| `frontend/src/App.js` | 6,202 | Очень высокая |
| `electron/main.js` | ~400 | Средняя |
| **Всего** | **~9,344** | - |

---

## 🔧 Технические долги

1. **Дублирование кода миграций** в `server.js` (многократные `ALTER TABLE`)
2. **Отсутствие обработки ошибок** в некоторых местах
3. **Глобальные состояния** в `App.js` (один компонент ~6000 строк)
4. **Нет тестов** для backend и frontend
5. **Хардкод значений** (порты, пути, цвета)

---

## 📝 Выводы

### Текущее состояние
Приложение представляет собой **монолитный чат** с богатым функционалом:
- ✅ Работает из коробки (один .exe)
- ✅ SQLite база данных
- ✅ WebSocket + REST API
- ✅ Админ-панель
- ✅ Календарь и бронирование

### Ограничения
- ❌ Только локальное использование
- ❌ Проблемы безопасности (SQL injection)
- ❌ Сложно масштабировать
- ❌ Нет сетевой работы

### Направления развития
1. **Краткосрочное**: Исправить SQL injection, добавить JWT
2. **Среднесрочное**: Разделить на клиент-сервер
3. **Долгосрочное**: Поддержка MongoDB, кластеризация

---

**Документ создан:** 28 марта 2026 г.  
**Автор:** Анализ архитектуры
