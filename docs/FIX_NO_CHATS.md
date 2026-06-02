# 🔧 Решение проблем с чатами

## Проблема: "Нет чатов. Создайте новый чат!"

### Возможные причины:

1. **Frontend кэш** - Браузер использует старую версию JS
2. **WebSocket не подключён** - Сервер не отправил чаты
3. **Пользователь не в чате** - Нет записи в chat_participants

---

## ✅ Решение 1: Очистка кэша

**Жёсткая перезагрузка страницы:**
- Windows: `Ctrl + Shift + R` или `Ctrl + F5`
- Mac: `Cmd + Shift + R`

**Или очистка кэша вручную:**
1. F12 → Console
2. Правый клик на кнопке обновления → "Очистить кэш и перезагрузить"

---

## ✅ Решение 2: Проверка WebSocket

1. Откройте консоль (F12)
2. Найдите сообщение "✓ Сокет подключён"
3. Если нет - сервер не работает

**Проверка сервера:**
```bash
netstat -ano | findstr :3001
```

Если пусто - запустите сервер:
```bash
c:\ChatServer\run-server-auto.bat
```

---

## ✅ Решение 3: Добавление в общий чат

Если пользователь не в общем чате, выполните SQL:

```sql
INSERT INTO chat_participants (chat_id, user_id) 
VALUES ('general', '<USER_ID>');
```

**Автоматически через Node.js:**
```bash
cd c:\ChatServer\chat-app\backend
node -e "const SQL = require('sql.js'); const fs = require('fs'); const db = new SQL.Database(fs.readFileSync('chat.db')); db.run(\"INSERT INTO chat_participants (chat_id, user_id) VALUES ('general', '27a747d0-3cde-454c-aa42-2abaaa7dbcaf')\"); db.run('COMMIT'); db.save('chat.db'); console.log('Готово!');"
```

---

## ✅ Решение 4: Создание чата вручную

**Через API:**
```bash
curl -X POST http://localhost:3001/api/chats \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d "{\"type\":\"direct\",\"name\":\"Тест\",\"participantIds\":[\"<USER_ID>\"]}"
```

**Через SQL:**
```sql
-- Создаём чат
INSERT INTO chats (id, type, name, created_by) 
VALUES ('chat-1', 'direct', 'Новый чат', '<USER_ID>');

-- Добавляем участника
INSERT INTO chat_participants (chat_id, user_id) 
VALUES ('chat-1', '<USER_ID>');
```

---

## 📝 Проверка чатов в БД

```bash
cd c:\ChatServer\chat-app\backend
node -e "const SQL = require('sql.js'); const fs = require('fs'); const db = new SQL.Database(fs.readFileSync('chat.db')); console.log('Чатов:', db.exec('SELECT COUNT(*) FROM chats')[0]?.values[0][0]); console.log('Участников:', db.exec('SELECT COUNT(*) FROM chat_participants')[0]?.values[0][0]);"
```

---

## 🔄 Полный сброс

Если ничего не помогает:

1. Остановите сервер
2. Очистите кэш браузера
3. Перезапустите сервер
4. Обновите страницу

```bash
# Windows
taskkill /F /IM node.exe
Start-Process "c:\ChatServer\run-server-auto.bat"
# Затем Ctrl+Shift+R в браузере
```

---

*Инструкция создана: 02.04.2026*
