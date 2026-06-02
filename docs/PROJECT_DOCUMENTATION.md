# 📚 Chat App Project Documentation

## 🎯 Общая информация

**Название:** Chat App - Корпоративный мессенджер  
**Версия:** 2.0.0  
**Платформа:** Electron + React + Node.js  
**База данных:** SQLite (sql.js - in-memory)  
**Порт сервера:** 3001  
**Порт frontend:** 3000  

---

## 📁 Структура проекта

```
c:\ChatServer\
├── chat-app/
│   ├── backend/           # Серверная часть
│   │   ├── db/           # Работа с БД
│   │   ├── middleware/   # Промежуточное ПО
│   │   ├── routes/       # API маршруты
│   │   ├── websocket/    # WebSocket обработчики
│   │   ├── server.js     # Главный файл сервера
│   │   ├── config.json   # Конфигурация
│   │   └── .env          # Переменные окружения
│   │
│   ├── frontend/         # Клиентская часть
│   │   ├── src/
│   │   │   ├── api/      # API клиенты
│   │   │   ├── components/ # React компоненты
│   │   │   ├── hooks/    # React хуки
│   │   │   ├── utils/    # Утилиты
│   │   │   └── App.js    # Главный компонент
│   │   └── public/       # Статические файлы
│   │
│   ├── uploads/          # Загруженные файлы
│   └── electron/         # Electron конфигурация
│
├── .env                  # Глобальные переменные
├── run-chat.bat          # Скрипт запуска
└── start-backend.bat     # Запуск backend
```

---

## 🔄 Поток данных

### 1. Авторизация пользователя
```
Frontend (App.js)
    ↓ login()
frontend/src/api/auth.js
    ↓ POST /api/login
backend/server.js → authMiddleware()
    ↓ Проверка credentials
БД: users table
    ↓ JWT токен
Frontend сохраняет токен в localStorage
```

### 2. Подключение WebSocket
```
Frontend (useChat.js)
    ↓ socket.io connect
backend/server.js → io.on('connection')
    ↓ socketAuthMiddleware
websocket/handlers.js → 'join' событие
    ↓ Обновление статуса
БД: users.status = 'online'
```

### 3. Отправка сообщения
```
Frontend (sendMessage)
    ↓ socket.emit('send_message')
websocket/handlers.js
    ↓ Вставка в БД
БД: messages table
    ↓ Сохранение (debounced)
fs.writeFile(chat.db)
    ↓ Рассылка получателям
socket.emit('new_message')
```

---

## 🗄️ База данных (SQLite)

### Таблицы:

#### users
- id (TEXT PRIMARY KEY)
- username (TEXT UNIQUE)
- email (TEXT UNIQUE)
- password_hash (TEXT)
- avatar (TEXT)
- status (TEXT: online/offline)
- is_admin (INTEGER)
- last_seen (TIMESTAMP)

#### chats
- id (TEXT PRIMARY KEY)
- type (TEXT: direct/group)
- name (TEXT)
- created_by (TEXT)

#### chat_participants
- chat_id (TEXT)
- user_id (TEXT)
- joined_at (TIMESTAMP)

#### messages
- id (TEXT PRIMARY KEY)
- chat_id (TEXT)
- sender_id (TEXT)
- text (TEXT)
- file_data (TEXT)
- timestamp (TIMESTAMP)
- forwarded_from (TEXT)

#### unread_messages
- user_id (TEXT)
- message_id (TEXT)
- chat_id (TEXT)

---

## 🔌 API Endpoints

### Аутентификация
| Метод | Endpoint | Описание |
|-------|----------|----------|
| POST | /api/login | Вход пользователя |
| POST | /api/register | Регистрация |
| POST | /api/logout | Выход |
| GET | /api/profile/:id | Профиль пользователя |
| PUT | /api/profile/:id | Обновление профиля |

### Чаты
| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | /api/chats | Список чатов |
| POST | /api/chats | Создание чата |
| GET | /api/chats/:id/messages | Сообщения чата |
| POST | /api/chats/:id/messages | Отправка сообщения |

### Админ панель
| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | /api/admin/check | Проверка прав |
| GET | /api/admin/stats | Статистика |
| GET | /api/admin/users | Все пользователи |

---

## 🔌 WebSocket События

### Клиент → Сервер
| Событие | Данные | Описание |
|---------|--------|----------|
| join | { userId } | Подключение пользователя |
| send_message | { text, chatId } | Отправка сообщения |
| create_chat | { type, name, participants } | Создание чата |
| join_chat | chatId | Присоединение к чату |
| mark_read | { chatId } | Прочтение сообщений |
| typing | { chatId } | Индикатор набора |
| get_users | - | Запрос списка пользователей |
| forward_message | { messageId, targetChatId } | Пересылка |

### Сервер → Клиент
| Событие | Данные | Описание |
|---------|--------|----------|
| user_joined | { userId, username } | Пользователь онлайн |
| user_left | { userId } | Пользователь офлайн |
| new_message | { message } | Новое сообщение |
| chat_created | { chat } | Чат создан |
| users_list | [users] | Список пользователей |
| message_read | { chatId, userId } | Сообщение прочитано |

---

## 🧩 Компоненты Frontend

### Hooks
- **useAuth** - Управление аутентификацией
- **useChat** - WebSocket и чаты
- **useProfile** - Профиль пользователя
- **useTasks** - Задачи календаря

### Components
- **ChatWindow** - Окно чата
- **ChatList** - Список чатов
- **MessageBubble** - Сообщение
- **MessageInput** - Ввод сообщения
- **CreateChatModal** - Создание чата
- **ProfileModal** - Профиль

---

## 🔐 Безопасность

1. **JWT Authentication** - Токены с expiration
2. **SQL Injection Protection** - Параметризованные запросы
3. **Rate Limiting** - Ограничение запросов
4. **CORS** - Проверка доменов
5. **Password Hashing** - bcryptjs

---

## 🚀 Запуск проекта

### Backend
```bash
cd c:\ChatServer\chat-app\backend
node server.js
```

### Frontend
```bash
cd c:\ChatServer\chat-app
npm start
```

### Автоматический перезапуск
```bash
c:\ChatServer\run-server-auto.bat
```

---

## 🐛 Известные проблемы

1. **Сервер падает периодически** - Использовать auto-restart скрипт
2. **404 /api/calendar/tasks/shared/received** - Эндпоинт не реализован
3. **CORS для IP адреса** - Добавлен в config.json

---

## 📝 Логирование

- **Backend логи:** `c:\ChatServer\chat-app\backend\server-runtime.log`
- ** Crash логи:** `c:\ChatServer\chat-app\server-crash.log`

---

## 📊 Метрики

- **Пользователей в БД:** 6
- **Чатов:** 20
- **Сообщений:** ~500+

---

*Документ создан: 02.04.2026*  
*Версия документации: 1.0*
