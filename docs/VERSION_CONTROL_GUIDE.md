# 📦 Руководство по контролю версий

## 🚀 Быстрый старт

### 1. Инициализация (один раз)

```bash
cd c:\Users\user\Desktop\Чат\chat-app

git init
git config user.name "Ваше Имя"
git config user.email "your@email.com"
```

### 2. Создание первого бэкапа

```bash
smart-commit.bat
```

---

## 📁 Файлы системы

| Файл | Назначение |
|------|------------|
| `smart-commit.bat` | Умный коммит с типами изменений |
| `commit-changes.bat` | Простой коммит |
| `view-history.bat` | Просмотр истории версий |
| `generate-changelog.js` | Генерация CHANGELOG |
| `CHANGELOG.md` | История изменений (автообновление) |
| `.gitignore` | Исключения из репозитория |

---

## 🎯 Рабочий процесс

### Внесли изменения → Создали бэкап

```
1. Изменили код
   ↓
2. Запустили smart-commit.bat
   ↓
3. Выбрали тип изменений (1-8)
   ↓
4. Ввели описание
   ↓
5. Готово! ✅
```

---

## 📝 Примеры коммитов

### Новая функция
```
Тип: 1 (✨ Feature)
Описание: добавил экспорт сообщений в PDF
```

### Исправление ошибки
```
Тип: 2 (🐛 Fix)
Описание: исправил отображение эмодзи в Safari
```

### Обновление безопасности
```
Тип: 3 (🔒 Security)
Описание: обновил зависимости bcryptjs
```

---

## 🔍 Полезные команды Git

```bash
# Показать историю
git log --oneline -10

# Показать изменения в коммите
git show <hash>

# Отменить последние изменения (до коммита)
git checkout -- <файл>

# Посмотреть статус
git status

# Показать все теги
git tag -l

# Удалить тег
git tag -d v20260328-1430
```

---

## 🌿 Ветвление (опционально)

```bash
# Создать новую ветку
git checkout -b feature/new-design

# Переключиться на ветку
git checkout feature/new-design

# Вернуться на main
git checkout main

# Слить ветки
git merge feature/new-design
```

---

## ☁️ Резервное копирование в облако

### GitHub
```bash
# Создать репозиторий на github.com
git remote add origin https://github.com/username/chat-app.git
git push -u origin main --tags
```

### GitLab
```bash
git remote add origin https://gitlab.com/username/chat-app.git
git push -u origin main --tags
```

### Локальный сервер
```bash
git remote add backup \\server\git\chat-app.git
git push backup main --tags
```

---

## 🔄 Восстановление из бэкапа

### К конкретной версии
```bash
git checkout v20260328-1430
```

### Откат изменений
```bash
# Отменить последний коммит (сохранить изменения)
git reset --soft HEAD~1

# Отменить последний коммит (удалить изменения)
git reset --hard HEAD~1
```

### Восстановить файл
```bash
git checkout v20260328-1430 -- path/to/file.js
```

---

## ⚠️ Важные замечания

1. **Не коммитьте** файлы с паролями и секретами
2. **Делайте коммиты** после каждого значимого изменения
3. **Пишите понятные** описания изменений
4. **Проверяйте** CHANGELOG после коммита

---

## 🆘 Решение проблем

### Git не установлен
```
Скачайте с https://git-scm.com/
```

### Ошибка "nothing to commit"
```
Нет изменений для коммита. Сначала внесите изменения в файлы.
```

### Ошибка генерации CHANGELOG
```
Запустите: node generate-changelog.js
```

---

## 📞 Поддержка

При возникновении проблем обратитесь к документации:
- [Git Docs](https://git-scm.com/doc)
- [GitHub Guides](https://guides.github.com/)
