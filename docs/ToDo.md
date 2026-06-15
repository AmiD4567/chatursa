# TODO — Chat Ursa

## ✅ Выполнено

### Проверка обновлений (GitHub Releases)
- [x] Backend `/api/version` — возвращает текущую версию из package.json
- [x] Backend `/api/check-update` — проверяет GitHub releases, сравнивает версии
- [x] Electron main.js: автообновление через `electron-updater`, события передаются фронтенду (убран нативный диалог)
- [x] Electron preload.js: IPC методы `checkForUpdates`, `downloadUpdate`, `quitAndInstall` + слушатели с cleanup
- [x] Frontend App.js: единая система обновлений (Electron + Browser)
  - Слушатели событий autoUpdater (checking, available, downloaded, progress, error)
  - Функция `checkForUpdates()` — автоматически выбирает Electron или API путь
  - Баннер с кнопками «Обновить» / «Отмена»
  - Прогресс-бар при скачивании
  - Кнопка «Установить и перезапустить» после завершения загрузки
- [x] Раздел «О приложении»: кнопки используют единую систему `checkForUpdates`
- [x] CSS: стили баннера, прогресс-бара inline, секции error/ready

---

## 🔄 В процессе

### Улучшения баннера обновлений
- [ ] Кнопка «🔄 Обновить сейчас» на баннере — принудительная проверка + показать release notes
- [ ] Показ `releaseName` / `publishedAt` в баннере (не только версия)

---

## 📋 Запланировано

### Bot assistant
- [ ] Context state machine — Map(socketId -> {step, context}) для многошаговых диалогов
- [ ] Bot analytics — трекинг команд, fallback phrases, статистика

### Electron / Desktop
- [ ] Тест публикации релизов через `node publish.js` → AmiD4567/chatursa
- [ ] Проверка: автообновление через electron-updater работает корректно после миграции на repo `chatursa`

---

---

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

## 🔄 В процессе / План доработок E2EE

- [ ] **Perfect Forward Secrecy** — добавить ratcheting (Double Ratchet / смена ключей при каждом N сообщений)
- [ ] **Групповые E2EE чаты** — реализовать Sender Keys или аналогичный протокол
- [ ] **Аудит безопасности** — проверить: нет ли утечки plaintext в IndexedDB, корректно ли очищаются ключи при logout
- [ ] **Self-destruct сообщения** (таймер самоуничтожения для E2EE-чатов)
- [ ] **Индикатор E2EE в списке чатов** — показывать значок замка рядом с lastMessage
- [ ] **Отзыв/сброс ключей** — возможность перегенерировать ключи

---

## ✅ Выполнено

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

## 📋 Следующие пункты

### Push-уведомления (Phase 1)
- [ ] FCM для Android (Capacitor), APNs для iOS

### Инфраструктура (Phase 1)
- [ ] SQLite → PostgreSQL (для 50+ concurrent users)

### Инфраструктура (Phase 1)
- [ ] SQLite → PostgreSQL (или SQLite WAL2 с репликацией) — для 50+ concurrent users
- [ ] Docker Compose (уже есть в плане)

### Phase 2 (Retention)
- [ ] Голосовые/видеозвонки (WebRTC + TURN)
- [ ] LDAP/SSO/OIDC интеграция
- [ ] Архив чатов + поиск с фильтрацией
- [ ] Треды с уведомлениями

## 🐛 Известные проблемы E2EE
- E2EE пока только для direct-чатов (2 участника). Групповые чаты используют серверное шифрование
- Офлайн-сообщения с E2EE: если ключ собеседника не получен, сообщение уходит незашифрованным (с предупреждением в консоли)
- При перегенерации ключей старые сообщения становятся недоступными для расшифровки
