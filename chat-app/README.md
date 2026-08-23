# 💬 Чат-приложение ChatUrsa (RocketChat-подобный)

Приложение для обмена сообщениями и файлами в реальном времени: личные и групповые чаты,
голосовые сообщения, стикеры, реакции, треды, опросы, E2EE, админ-панель, KPI-дашборд.

## Возможности

### Чаты и сообщения
- ✅ Личные, групповые чаты и общий чат
- ✅ Файлы, изображения, видео, аудио + превью
- ✅ Голосовые сообщения
- ✅ Стикеры и реакции на сообщения
- ✅ Ответы (reply), редактирование, закреплённые сообщения
- ✅ Треды (обсуждения) и пересылка сообщений
- ✅ Опросы
- ✅ Самоуничтожающиеся сообщения
- ✅ E2EE для личных чатов
- ✅ Пагинация истории, поиск по сообщениям и файлам
- ✅ Орфография в поле ввода

### Прочее
- ✅ Регистрация по email/паролю, 2FA (TOTP)
- ✅ Бот-помощник
- ✅ Календарь задач и бронирование переговорных
- ✅ Wiki
- ✅ KPI-дашборд с интеграцией Power BI
- ✅ Админ-панель (пользователи, сессии, файлы, логи безопасности)
- ✅ Push-уведомления (Web Push / FCM)

### Клиенты
| Клиент | Технологии |
|--------|-----------|
| Web | React (CRA) |
| Desktop | Electron |
| Android | Kotlin (Jetpack Compose) — `frontend/android/` |

## Структура проекта

```
chat-app/
├── backend/              # Node.js + Express + Socket.IO + SQLite (better-sqlite3)
│   ├── server.js         # Точка входа (инициализация, роуты, сокеты)
│   ├── kpi.js            # KPI API
│   ├── pbi-proxy.js      # Прокси Power BI
│   ├── bot/              # Бот-помощник
│   ├── scripts/          # Одноразовые скрипты (тесты, фиксы)
│   │   └── migration/    # Скрипты миграции шифрования БД
│   └── smoke-test.js     # Smoke-тест API (изолированная БД, случайный порт)
├── frontend/             # React-клиент + Android (frontend/android/)
├── electron/             # Desktop-клиент
├── uploads/              # Загруженные файлы
└── doc/                  # Документация (security.md)
```

## Запуск

### Backend

```bash
cd chat-app/backend
npm install
npm start          # http://localhost:3001
```

База данных SQLite создаётся автоматически (`backend/chat.db`).
Пути/порт переопределяются через `.env`:

| Переменная | По умолчанию |
|------------|--------------|
| `CHAT_APP_PORT` | `3001` |
| `CHAT_APP_HOST` | `0.0.0.0` |
| `CHAT_APP_DB_PATH` | `backend/chat.db` |
| `CHAT_APP_UPLOADS_PATH` | `backend/uploads` |

### Frontend

```bash
cd chat-app/frontend
npm install
npm start          # http://localhost:3000
```

### Smoke-тест

Проверка ключевых эндпоинтов на изолированной БД (прод данные не затрагиваются):

```bash
npm run smoke      # из корня репозитория
```

## База данных

Основные таблицы: `users`, `chats`, `chat_participants`, `messages`,
`unread_messages`, а также таблицы реакций, тредов, опросов, задач календаря,
бронирований переговорных, E2EE-ключей и FCM-токенов.

Резервные копии: `backend/backups/`.

## API

### REST (основное)

| Метод | Endpoint | Описание |
|-------|----------|----------|
| POST | `/api/register` | Регистрация |
| POST | `/api/login` | Вход (+ 2FA) |
| PUT | `/api/profile` | Обновление профиля |
| GET | `/api/chats/:chatId/messages` | История чата |
| POST | `/upload` | Загрузка файла |
| GET | `/api/download/:uuid` | Скачивание файла |
| GET | `/api/search/messages` | Поиск по сообщениям |
| GET | `/api/search/files` | Единый поиск файлов |
| GET | `/api/calendar/tasks` | Задачи |
| GET | `/api/meeting-room/bookings` | Бронирования |
| GET | `/api/kpi` | KPI-дашборд |
| GET | `/api/admin/stats` | Статистика системы |
| GET | `/api/csrf-token` | CSRF-токен |
| GET | `/api/health` | Health-check |

Мутирующие запросы требуют заголовок `X-CSRF-Token`.

### Socket.IO события

**Клиент → Сервер:** `join`, `create_chat`, `join_chat`, `send_message`,
`typing`, `get_messages_before`, …

**Сервер → Клиент:** `user_joined_success`, `chat_history`, `new_message`,
`chat_created`, `chat_updated`, `user_status_changed`, `user_typing`,
`message_deleted`, …

Полный список — в коде `backend/server.js`.

## Безопасность

- Helmet, rate-limiting (общий + на логин/регистрацию), CSRF-заголовок
- Пароли — bcrypt, 2FA — TOTP (speakeasy)
- Шифрование БД и E2EE — см. `doc/security.md`

## Очистка данных

Для полного сброса остановите сервер и удалите файл БД:

```bash
rm backend/chat.db   # вместе с chat.db-wal и chat.db-shm при наличии
```
