# Инструкция по сборке Android-версии

## Требования

- **Node.js** 18+ ([скачать](https://nodejs.org/))
- **Android Studio** ([скачать](https://developer.android.com/studio))
- При установке Android Studio обязательно установите:
  - **Android SDK** (последняя версия)
  - **Android SDK Platform** (API 34+)
  - **Gradle**
  - **Android SDK Build-Tools**

---

## 1. Установка зависимостей

```bash
cd chat-app/frontend
npm install
```

Capacitor (`@capacitor/core`, `@capacitor/cli`, `@capacitor/android`) уже добавлен в `package.json`.

---

## 2. Настройка URL сервера

Откройте `chat-app/frontend/src/App.js` и измените `SOCKET_URL` на актуальный IP/домен вашего сервера:

```js
const SOCKET_URL = 'http://192.168.210.48:3001';
```

Для публичного сервера укажите домен:

```js
const SOCKET_URL = 'https://ваш-домен.ru';
```

Для Android-устройства сервер должен быть доступен по сети (один Wi-Fi или удалённый хостинг).

---

## 3. Сборка Web + Синхронизация с Android

```bash
cd chat-app/frontend
npm run build:android
```

Эта команда:
1. Собирает React-приложение (`react-scripts build`)
2. Копирует собранные файлы в `android/app/src/main/assets/public/`
3. Синхронизирует конфигурацию Capacitor

---

## 4. Открытие в Android Studio

```bash
npm run open:android
```

Или откройте папку `chat-app/frontend/android/` вручную через Android Studio:

**File → Open... → выбрать `chat-app/frontend/android/`**

---

## 5. Сборка APK

В Android Studio:

1. Дождитесь завершения Gradle Sync (зелёная галочка внизу)
2. **Build → Build Bundle(s) / APK → Build APK**

APK появится в:
```
android/app/build/outputs/apk/debug/app-debug.apk
```

### Релизная сборка (unsigned):

**Build → Build Bundle(s) / APK → Build APK** (выбрать release variant)

### Релизная сборка (подписанная):

1. **Build → Generate Signed Bundle / APK**
2. Выберите **APK**
3. Укажите keystore (или создайте новый)
4. Готовый APK: `android/app/build/outputs/apk/release/app-release.apk`

---

## 6. Установка на устройство

- Перекиньте `app-debug.apk` на Android-устройство
- Разрешите установку из неизвестных источников
- Откройте APK и установите

### Установка через ADB (если подключены по USB):

```bash
cd chat-app/frontend
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

---

## Полезные команды

| Команда | Описание |
|---|---|
| `npm run build:android` | Собрать web + синхронизировать с Android |
| `npm run open:android` | Открыть проект в Android Studio |
| `npm run sync` | Только синхронизировать web-сборку с Android |
| `npx cap copy` | Скопировать web-ресурсы в Android (без полной синхронизации) |

---

## Примечания

- При каждом изменении React-кода нужно запускать `npm run build:android` для обновления APK
- Для отладки на устройстве используйте Chrome DevTools → `chrome://inspect` при подключённом по USB устройстве
- Если сервер работает по HTTP (без HTTPS), в AndroidManifest.xml уже добавлен `android:usesCleartextTraffic="true"`
- В `AndroidManifest.xml` добавлен `android:windowSoftInputMode="adjustResize"` — при открытии клавиатуры WebView корректно сжимается, а не сдвигается вверх
