# TODO — Chat Ursa

## ✅ Выполнено

### E2EE (End-to-End Encryption)

#### Бэкенд (server.js)
- [x] Миграция БД: колонки `e2ee`, `e2ee_nonce`, `e2ee_ephemeral` в `messages`, колонка `e2ee_public_key` в `users`
- [x] REST API: `PUT /api/e2ee/key`, `GET /api/e2ee/key/:userId`, `GET /api/e2ee/status/:userId`
- [x] `send_message` — принимает e2ee-флаги, хранит ciphertext без расшифровки
- [x] `getChatMessages` / `GET /api/messages/:chatId` — e2ee-aware, не расшифровывает
- [x] thread API — e2ee-aware
- [x] `forward_message` — e2ee-aware (пробрасывает ciphertext)
- [x] `edit_message` — e2ee-aware (+ обновление nonce)
- [x] pin/unpin — e2ee-aware
- [x] preview last message — заглушка "🔒 Encrypted message"

#### Фронтенд (crypto.js)
- [x] Генерация ECDH P-256 ключей (Web Crypto API)
- [x] Экспорт/импорт ключей (SPKI/PKCS8 ↔ base64)
- [x] ECDH общий ключ → AES-256-GCM
- [x] Шифрование/расшифровка сообщений (encryptMessage/decryptMessage)
- [x] Хранение своих ключей в IndexedDB (`chat-e2ee`, store `e2ee_keys`)
- [x] Кэш публичных ключей собеседников в IndexedDB (`e2ee_peer_keys`)
- [x] Кэш общих ключей в памяти (Map<chatId, CryptoKey>)

#### Фронтенд (App.js — интеграция)
- [x] Инициализация E2EE при входе (генерация/загрузка ключей, upload на сервер)
- [x] `handleSendMessage` — шифрование текста перед отправкой при e2ee=true
- [x] `new_message` handler — расшифровка при e2ee=true
- [x] `chat_history` handler — расшифровка всех e2ee-сообщений
- [x] `edit_message` — шифрование нового текста + передача nonce
- [x] `message_edited` handler — расшифровка полученного edited-text
- [x] UI: кнопка 🔒/🔓 в шапке direct-чата
- [x] CSS: `.e2ee-toggle-btn` стили

### Multi-device синхронизация
- [x] `getUserSockets(userId)` / `emitToUser(userId, event, data)` — helpers для доставки всем сессиям
- [x] `mark_read` — уведомляет все сессии отправителей о прочтении
- [x] `send_message` — join в комнату чата для всех сокетов участника
- [x] `forward_message` — доставка всем сессиям получателя
- [x] `create_chat` — уведомление всех сессий участников
- [x] Таблица `user_device_sessions` (per-device, с deviceId/deviceName/IP)
- [x] Принятие `deviceId`/`deviceName` в `user_joined`
- [x] Очистка device_sessions при disconnect
- [x] API: `GET /api/sessions/:userId` — список сессий
- [x] API: `DELETE /api/sessions/:sessionId` — завершение сессии
- [x] `getDeviceId()` — генерация/хранение в localStorage
- [x] `getDeviceName()` — определение браузера/платформы
- [x] Отправка deviceId при логине и reconnect
- [x] Вкладка "📱 Устройства" в настройках с кнопкой "Завершить"

### Офлайн-режим
- [x] Service Worker (v2) — кэширование статики и API-запросов
- [x] IndexedDB: хранение сообщений, чатов, outbox
- [x] Очередь отправки при reconnect
- [x] Fallback загрузка из кэша при недоступности сервера

### Автообновления (GitHub Releases)
- [x] Backend: `/api/version`, `/api/check-update`
- [x] Electron: `electron-updater` + IPC + фронтенд-баннер
- [x] Баннер с прогресс-баром, кнопками «Обновить» / «Установить и перезапустить»

### Backup БД
- [x] Авто-бэкап SQLite по расписанию (каждый час)
- [x] Ротация (24 копии), WAL checkpoint перед копированием
- [x] Кастомный интервал и директория через .env

### Безопасность
- [x] Пароль НЕ хранится в localStorage (исправлено)
- [x] JWT, bcrypt, Helmet, HSTS, XSS, CSRF, rate limiting
- [x] 2FA (TOTP) для админов, security logs

---

## 🔄 Phase 1 (MVP) — Без этого запускаться нельзя

### Push-уведомления
- [x] **Web Push (VAPID)** — бэкенд (web-push, БД, API), клиент (подписка после логина), SW (push/notificationclick)
- [x] **FCM для Android** — Firebase Admin SDK (backend), FCM-сервис (Android), токен endpoints, интеграция с sendPushNotification
- [ ] **APNs для iOS** — настроить Apple Push Notification service

### Инфраструктура
- [ ] **SQLite → PostgreSQL** (или SQLite WAL2 с репликацией) — для 50+ concurrent users
- [x] **Docker Compose** — `Dockerfile` (multi-stage: frontend build + backend), `docker-compose.yml` (persistent volume для SQLite + uploads, restart policy), env vars через `CHAT_APP_*`

### E2EE — доработки Phase 1
- [x] **Индикатор E2EE в списке чатов** — значок 🔒 рядом с названием чата (App.js + chat.css)
- [ ] **Групповые E2EE чаты** — Sender Keys протокол
- [ ] **Perfect Forward Secrecy** — Double Ratchet / смена ключей при каждом N сообщений
- [ ] **Self-destruct сообщения** — таймер самоуничтожения для E2EE-чатов
- [ ] **Аудит безопасности E2EE** — утечки plaintext в IndexedDB, очистка ключей при logout
- [x] **Отзыв/сброс ключей** — кнопка в Настройки → О приложении, перегенерация ключей, очистка кэша, загрузка на сервер

---

## 📋 Phase 2 (Retention) — Заставит вернуться на второй день

- [ ] **Голосовые и видеозвонки (WebRTC + TURN)**
- [ ] **LDAP / SSO / OIDC интеграция** — AD, Google, Azure
- [ ] **Архив чатов + поиск с фильтрацией** — по дате, файлам, отправителю
- [ ] **Треды с уведомлениями**
- [ ] **Улучшения баннера обновлений** — release notes, кнопка принудительной проверки
- [ ] **Bot assistant** — context state machine, аналитика
- [ ] **2FA для обычных пользователей** (TOTP)

---

## 📋 Phase 3 (Killer-features) — Ниша

- [ ] **Self-destruct сообщения / секретные чаты** (прочитал и забыл)
- [ ] **Полный LAN-режим (P2P mesh синхронизация)** — без интернета
- [ ] **Корпоративный портал** — HR, опросы, документы, согласования, интеграция с 1С/Bitrix24
- [ ] **Аудиторский лог (compliance-ready)** — неизменяемость, экспорт для регуляторов
- [ ] **Bot API (Slack-подобные /commands)** — публичное API для интеграций

---

## 🐛 Известные проблемы E2EE
- E2EE пока только для direct-чатов (2 участника). Групповые чаты используют серверное шифрование
- Офлайн-сообщения с E2EE: если ключ собеседника не получен, сообщение уходит незашифрованным (с предупреждением в консоли)
- При перегенерации ключей старые сообщения становятся недоступными для расшифровки
