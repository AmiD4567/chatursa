# 🛡️ Защита чата от несанкционированного копирования и использования

## 📋 Описание

Документ содержит методы защиты корпоративного чата от копирования и несанкционированного использования другими системными администраторами при развёртывании внутри организации.

---

## 🎯 Специфика защиты внутри организации

### Проблема
Другие сисадмины имеют доступ к:
- Файлам сервера (`backend/`, `frontend/build/`)
- Базе данных (`chat.db`)
- Конфигурационным файлам
- Исходному коду (если он не скомпилирован)

---

## 🛡️ Практические меры защиты

### 1. Компиляция в исполняемый файл (.exe)

Собрать всё в один защищённый `.exe` через Electron Builder:

```bash
npm run electron:build
```

**Что это даёт:**
- Код упаковывается в ASAR-архив (не просто папки с JS)
- Запуск только через Electron runtime
- Сложнее достать исходники

**Дополнительно в package.json:**
```json
"build": {
  "asar": true,
  "asarUnpack": ["**/*.node"],
  "protect": true
}
```

---

### 2. Привязка к конкретному серверу (Hardware Lock)

Сервер проверяет "железо" машины при запуске:

**Файл: `backend/hardware-lock.js`**
```javascript
const { machineIdSync } = require('node-machine-id');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EXPECTED_MACHINE_ID = 'зашифрованный-ID-вашего-сервера';

function validateHardware() {
  const currentId = machineIdSync();
  const hash = crypto.createHash('sha256').update(currentId).digest('hex');
  
  if (hash !== EXPECTED_MACHINE_ID) {
    console.error('❌ Несанкционированный запуск!');
    process.exit(1);
  }
}

module.exports = { validateHardware };
```

**Как работает:**
- При первой установке генерируется ID
- Сервер запускается только на этой машине
- При копировании на другой сервер — не запустится

---

### 3. Лицензионный файл с шифрованием

**Файл: `backend/license.js`**
```javascript
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LICENSE_FILE = path.join(__dirname, 'license.dat');
const SECRET_KEY = process.env.LICENSE_SECRET || 'ваш-секретный-ключ';

function validateLicense() {
  if (!fs.existsSync(LICENSE_FILE)) {
    console.error('❌ Лицензионный файл не найден!');
    process.exit(1);
  }
  
  const encrypted = fs.readFileSync(LICENSE_FILE);
  const decipher = crypto.createDecipher('aes-256-cbc', SECRET_KEY);
  
  try {
    const license = decipher.update(encrypted, 'hex', 'utf8');
    license += decipher.final('utf8');
    const data = JSON.parse(license);
    
    // Проверка срока действия
    if (new Date(data.expires) < new Date()) {
      console.error('❌ Лицензия истекла!');
      process.exit(1);
    }
    
    // Проверка компании
    if (data.company !== 'Ваша Компания') {
      console.error('❌ Лицензия не для этой компании!');
      process.exit(1);
    }
    
    console.log('✅ Лицензия действительна:', data.company);
  } catch (err) {
    console.error('❌ Неверная лицензия!');
    process.exit(1);
  }
}

module.exports = { validateLicense };
```

**Генерация лицензии: `generate-license.js`**
```javascript
const crypto = require('crypto');
const fs = require('fs');

const SECRET_KEY = 'ваш-секретный-ключ';
const license = {
  company: 'Ваша Компания',
  issued: '2026-01-01',
  expires: '2027-12-31',
  maxUsers: 100,
  serverId: 'уникальный-ID-сервера'
};

const cipher = crypto.createCipher('aes-256-cbc', SECRET_KEY);
let encrypted = cipher.update(JSON.stringify(license), 'utf8', 'hex');
encrypted += cipher.final('hex');

fs.writeFileSync('license.dat', encrypted);
console.log('✅ Лицензия создана');
```

---

### 4. Онлайн-активация (требуется внешний сервер)

Сервер чата при запуске обращается к **внешнему серверу активации**:

```javascript
async function activateServer() {
  const hardwareId = getHardwareId();
  const licenseKey = process.env.LICENSE_KEY;
  
  const response = await fetch('https://activation.yoursite.com/api/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ licenseKey, hardwareId })
  });
  
  const result = await response.json();
  
  if (!result.valid) {
    console.error('❌ Активация не удалась:', result.reason);
    process.exit(1);
  }
  
  console.log('✅ Сервер активирован');
}

activateServer();
```

**Преимущества:**
- Можно отозвать лицензию удалённо
- Ограничение числа одновременных запусков
- Перевыпуск лицензии при смене сервера

---

### 5. Удаление исходников из продакшена

**Что сделать после сборки:**
```bash
# Удалить исходники
rm -rf frontend/src/
rm -rf frontend/node_modules/
rm -rf backend/node_modules/
rm backend/package.json

# Оставить только:
# - backend/server.js (скомпилированный)
# - frontend/build/ (скомпилированный React)
# - license.dat
# - config.json
```

**Или использовать компилятор:**
```bash
npm install pkg
pkg backend/server.js --target node18-win-x64 --output chat-server.exe
```

---

### 6. Шифрование базы данных

SQLite можно зашифровать через SQLCipher:

```bash
npm install sqlcipher
```

```javascript
const sqlcipher = require('sqlcipher');
const db = new sqlcipher.Database('chat.db');
db.run("PRAGMA key = 'ваш-ключ-шифрования'");
```

---

### 7. Проверка целостности файлов

Сервер проверяет, что файлы не были изменены:

```javascript
const crypto = require('crypto');
const fs = require('fs');

const FILE_HASHES = {
  'server.js': 'оригинальный-hash-server.js',
  'App.js': 'оригинальный-hash-App.js'
};

function checkIntegrity() {
  for (const [file, expectedHash] of Object.entries(FILE_HASHES)) {
    const content = fs.readFileSync(file);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    
    if (hash !== expectedHash) {
      console.error(`❌ Файл ${file} изменён!`);
      process.exit(1);
    }
  }
}
```

---

### 8. Скрытие конфигов в переменные окружения

```javascript
// Не в config.json (который можно прочитать)
const DB_PASSWORD = process.env.CHAT_DB_PASSWORD;
const LICENSE_KEY = process.env.CHAT_LICENSE_KEY;
const SECRET_SALT = process.env.CHAT_SECRET_SALT;
```

**Настроить в Windows:**
```powershell
setx CHAT_DB_PASSWORD "ваш-пароль"
setx CHAT_LICENSE_KEY "ваш-ключ"
setx CHAT_SECRET_SALT "ваша-соль"
```

---

## 📋 План внедрения

| Шаг | Действие | Время | Эффект |
|-----|----------|-------|--------|
| 1 | Сборка в .exe через Electron Builder | 1 час | ⭐⭐⭐ |
| 2 | Лицензионный файл (license.dat) | 2 часа | ⭐⭐⭐⭐ |
| 3 | Привязка к Hardware ID | 2 часа | ⭐⭐⭐⭐ |
| 4 | Удаление исходников из продакшена | 30 мин | ⭐⭐⭐ |
| 5 | Шифрование БД | 1 час | ⭐⭐⭐ |
| 6 | Онлайн-активация (опционально) | 4 часа | ⭐⭐⭐⭐⭐ |

---

## 🔐 Рекомендуемая конфигурация для офиса

```
Сервер чата:
├── chat-server.exe          # Скомпилированный сервер
├── frontend/build/          # Скомпилированный React
├── license.dat              # Зашифрованная лицензия
├── chat.db                  # Зашифрованная БД
└── config.json              # Без чувствительных данных

Переменные окружения Windows:
├── CHAT_LICENSE_KEY
├── CHAT_DB_PASSWORD
└── CHAT_SERVER_ID
```

---

## ⚠️ Важное предупреждение

**100% защиты не существует!** Любую защиту можно обойти. Цель — сделать взлом:
- Достаточно сложным
- Экономически невыгодным
- Временнó́о затратным

---

## 📦 Необходимые зависимости

```bash
# Для Hardware ID
npm install node-machine-id

# Для шифрования
npm install crypto-js

# Для компиляции
npm install pkg

# Для шифрования БД
npm install sqlcipher
```

---

## 📞 Контакты для активации

Для настройки онлайн-активации обратитесь к разработчику.

---

**Версия документа:** 1.0  
**Дата создания:** 28 марта 2026 г.
