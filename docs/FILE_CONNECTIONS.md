# 🔗 Схема взаимосвязей файлов Chat App

## 📊 Визуальная схема потока данных

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React)                            │
│  Port: 3000                                                         │
│                                                                     │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │   App.js    │───▶│  useChat.js  │───▶│ socket.io.js │          │
│  │             │    │              │    │              │          │
│  │ - Auth      │    │ - WebSocket  │    │ - Connect    │          │
│  │ - Routing   │    │ - Messages   │    │ - Events     │          │
│  │ - State     │    │ - Users      │    │              │          │
│  └──────┬──────┘    └──────┬───────┘    └──────┬───────┘          │
│         │                  │                   │                   │
│         ▼                  ▼                   ▼                   │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │  useAuth.js │    │  useProfile  │    │   api/       │          │
│  │             │    │              │    │   client.js  │          │
│  │ - Login     │    │ - Get Profile│    │              │          │
│  │ - Token     │    │ - Update     │    │ - HTTP Req   │          │
│  └─────────────┘    └──────────────┘    └──────────────┘          │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP / WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         BACKEND (Node.js)                           │
│  Port: 3001                                                         │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────┐       │
│  │                    server.js (Main)                     │       │
│  │                                                         │       │
│  │  - Express App Setup                                    │       │
│  │  - CORS Configuration                                   │       │
│  │  - Rate Limiting                                        │       │
│  │  - Socket.IO Server                                     │       │
│  │  - Database Init (sql.js)                               │       │
│  └────┬──────────────────────────────────────────┬─────────┘       │
│       │                                          │                 │
│       ▼                                          ▼                 │
│  ┌─────────────────┐                    ┌─────────────────┐       │
│  │  API Routes     │                    │  WebSocket      │       │
│  │  (HTTP)         │                    │  (Real-time)    │       │
│  │                 │                    │                 │       │
│  │ /api/login      │                    │ on('join')      │       │
│  │ /api/register   │                    │ on('send_msg')  │       │
│  │ /api/profile    │                    │ on('create_chat')│      │
│  │ /api/chats      │                    │ on('mark_read') │       │
│  │ /api/admin/*    │                    │ on('get_users') │       │
│  └────┬────────────┘                    └────┬────────────┘       │
│       │                                      │                    │
│       ▼                                      ▼                    │
│  ┌─────────────────┐                    ┌─────────────────┐       │
│  │  middleware/    │                    │ websocket/      │       │
│  │                 │                    │ handlers.js     │       │
│  │ - auth.js       │                    │                 │       │
│  │ - validators.js │                    │ - join          │       │
│  │ - rate-limiter  │                    │ - send_message  │       │
│  │ - socket-auth   │                    │ - create_chat   │       │
│  └─────────────────┘                    │ - get_users     │       │
│                                         └────────┬────────┘       │
└──────────────────────────────────────────────────┼────────────────┘
                                                   │
                                                   ▼
                                    ┌──────────────────────────┐
                                    │   safe-database.js       │
                                    │                          │
                                    │  - select()              │
                                    │  - insert()              │
                                    │  - update()              │
                                    │  - delete()              │
                                    │  - transaction()         │
                                    └────────────┬─────────────┘
                                                 │
                                                 ▼
                                    ┌──────────────────────────┐
                                    │   chat.db (SQLite)       │
                                    │                          │
                                    │  ┌──────────────────┐   │
                                    │  │ users            │   │
                                    │  │ chats            │   │
                                    │  │ messages         │   │
                                    │  │ chat_participants│   │
                                    │  │ unread_messages  │   │
                                    │  └──────────────────┘   │
                                    └──────────────────────────┘
```

---

## 📝 Детальные взаимосвязи

### 1. Аутентификация

```
App.js (handleLogin)
    │
    ▼
useAuth.js (login function)
    │
    ▼
api/auth.js (login API call)
    │
    ▼
backend/server.js (POST /api/login)
    │
    ├─▶ middleware/auth.js (verifyPassword)
    │
    ├─▶ safe-database.js (select users WHERE username)
    │
    ├─▶ БД (chat.db)
    │
    └─▶ JWT token → Frontend
```

### 2. Отправка сообщения

```
ChatWindow.js (sendMessage)
    │
    ▼
useChat.js (sendMessage via socket)
    │
    ▼
WebSocket: emit('send_message')
    │
    ▼
websocket/handlers.js (on send_message)
    │
    ├─▶ safe-database.js (insert into messages)
    │
    ├─▶ debouncedSaveDatabase()
    │
    ├─▶ fs.writeFile(chat.db)
    │
    └─▶ socket.emit('new_message') всем участникам
```

### 3. Получение пользователей

```
Phonebook.js (component mount)
    │
    ▼
useChat.js (getUsers)
    │
    ▼
WebSocket: emit('get_users')
    │
    ▼
websocket/handlers.js (on get_users)
    │
    ├─▶ getAllUsers()
    │
    ├─▶ safe-database.js (select from users)
    │
    ├─▶ БД (chat.db)
    │
    └─▶ socket.emit('users_list', users)
```

---

## 🔄 Цикл сохранения БД

```
Изменение данных
    │
    ▼
debouncedSaveDatabase() вызван
    │
    ├─▶ clearTimeout(prev)
    │
    ├─▶ setTimeout(1000ms)
    │
    ▼
db.export() → Buffer
    │
    ▼
fs.writeFile(chat.db)
    │
    └─▶ pendingSave = false
```

---

## 🎯 Критические точки отказа

### 1. Backend Server
- **Файл:** `backend/server.js`
- **Проблема:** Падает периодически
- **Решение:** `run-server-auto.bat` (auto-restart)

### 2. Database Save
- **Файл:** `backend/server.js` (debouncedSaveDatabase)
- **Проблема:** Может не успеть сохраниться
- **Решение:** Сохранение при выгрузке

### 3. WebSocket Connection
- **Файл:** `frontend/src/hooks/useChat.js`
- **Проблема:** Разрыв соединения
- **Решение:** Автоматический reconnect

### 4. CORS Configuration
- **Файл:** `backend/config.json`
- **Проблема:** Блокировка по IP
- **Решение:** Добавлен `192.168.210.48:3000`

---

## 📦 Зависимости

### Backend
```json
{
  "express": "^4.18.2",
  "socket.io": "^4.6.1",
  "sql.js": "^1.8.0",
  "bcryptjs": "^2.4.3",
  "jsonwebtoken": "^9.0.0",
  "cors": "^2.8.5",
  "dotenv": "^16.0.3",
  "uuid": "^9.0.0"
}
```

### Frontend
```json
{
  "react": "^18.2.0",
  "react-dom": "^18.2.0",
  "socket.io-client": "^4.6.1",
  "jwt-decode": "^3.1.2"
}
```

---

*Схема создана: 02.04.2026*
