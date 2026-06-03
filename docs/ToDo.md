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

## 🐛 Известные проблемы

_(по мере обнаружения)_
