# 📦 Инструкция по Публикации Релиза на GitHub

## 🎯 Куда Загружать Проект

### Основной репозиторий:
```
https://github.com/AmiD4567/chatursa.git
```

### Для Автообновления:
Приложение будет проверять обновления в этом репозитории:
```
https://github.com/AmiD4567/chatursa/releases
```

---

## 📄 Файлы Конфигурации

### 1. `package.json`
Файл сборки и публикации релизов.
- **Версия приложения:** `"version": "1.0.55"`
- **Команда сборки:** `npm run build`
- **Команда публикации:** `npm run release` (или `electron-builder --win nsis`)

### 2. `app-update.yml`
Файл конфигурации для автообновления Electron приложения.
```yaml
provider: github
owner: AmiD4567          # Логин владельца репозитория
repo: chatursa           # Название репозитория (ИМЕННО ЗДЕСЬ ГДЕ НАДО ЗАГРУЖАТЬ)
private: false
releaseType: release     // или draft для черновика
```

---

## 🚀 Команды для Публикации Релиза

### Сборка приложения:
```bash
cd chat-app
npm run build
```

### Публикация релиза (включает автообновление):
```bash
npm run release
# или
electron-builder --win nsis --publish always
```

### Вручную создать релиз на GitHub:
```bash
npm run release  # создаст .exe файл
git tag v1.0.55          # если авто-тэг не создан
git push origin v1.0.55  # запушить тэг
# затем создать релиз в веб-интерфейсе GitHub
```

---

## 📁 Структура Релиза

Файл будет сгенерирован как:
```
Chat App-Setup-{VERSION}.exe
```

Например: `Chat App-Setup-1.0.55.exe`

---

## 🔧 Настройка GitHub Token

Для публикации релизов нужен GitHub Personal Access Token (PAT):
1. Создайте token на https://github.com/settings/tokens
2. Дайте доступ к репозиториям и type "write"
3. Установите доменной переменной:
   ```powershell
   $env:GH_TOKEN="ваш_token"
   ```

---

## 📝 Частая Информация

| Параметр | Значение |
|----------|----------|
| Владелец | AmiD4567 |
| Репозиторий | chatursa |
| Публичный/Приватный | false (public) |
| Формат релиза | Windows NSIS (.exe) |

---

## 📚 Полезные Ссылки

- [Рекомендации по созданию релизов](RELEASE_GUIDE.md)
- [Инструкция по сборке](BUILD_INSTRUCTION.md)