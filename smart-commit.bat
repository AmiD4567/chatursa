@echo off
setlocal enabledelayedexpansion

echo ========================================
echo   Умный бэкап с историей изменений
echo ========================================
echo.

:: Проверка Git
git --version > nul 2>&1
if errorlevel 1 (
    echo ❌ Git не установлен!
    echo    Скачайте с https://git-scm.com/
    pause
    exit /b 1
)

:: Меню
echo Выберите тип изменений:
echo   1) ✨ Новая функция
echo   2) 🐛 Исправление ошибки
echo   3) 🔒 Безопасность
echo   4) ⚡ Производительность
echo   5) 📝 Документация
echo   6) 🎨 Стиль/дизайн
echo   7) ♻️ Рефакторинг
echo   8) 🧪 Тесты
echo.

set /p TYPE="Тип изменений (1-8): "

:: Маппинг типов
set "TYPE_1=✨ Feature"
set "TYPE_2=🐛 Fix"
set "TYPE_3=🔒 Security"
set "TYPE_4=⚡ Performance"
set "TYPE_5=📝 Docs"
set "TYPE_6=🎨 Style"
set "TYPE_7=♻️ Refactor"
set "TYPE_8=🧪 Tests"

for %%i in (%TYPE%) do set "PREFIX=!TYPE_%%i!"

if "%PREFIX%"=="" set "PREFIX=📝 Update"

echo.
set /p COMMENT="Описание изменений: "

if "%COMMENT%"=="" (
    echo ❌ Описание обязательно!
    pause
    exit /b 1
)

:: Версия
set DATE=%DATE:~-4,4%%DATE:~-7,2%%DATE:~-10,2%
set TIME=%TIME:~0,2%%TIME:~3,2%
set VERSION=v%DATE%-%TIME%

echo.
echo 📦 Версия: %VERSION%
echo 📝 Тип: %PREFIX%
echo 📝 Описание: %COMMENT%
echo.

cd /d "%~dp0"

:: Статус до коммита
echo [1/5] Проверка изменений...
git status --porcelain > changes.txt
set /p CHANGED=<changes.txt
del changes.txt

if "%CHANGED%"=="" (
    echo ⚠️ Нет изменений для коммита
    pause
    exit /b 0
)

:: Коммит
echo [2/5] Добавление файлов...
git add -A

echo [3/5] Создание коммита...
git commit -m "%VERSION% - %PREFIX%: %COMMENT%"

echo [4/5] Создание тега...
git tag -a "%VERSION%" -m "%PREFIX%: %COMMENT%"

echo [5/5] Генерация CHANGELOG...
node generate-changelog.js

echo.
echo ========================================
echo ✅ Бэкап завершён: %VERSION%
echo ========================================
echo.

:: Статистика
echo 📊 Статистика репозитория:
git log --oneline | find /c /v "" > count.txt
set /p TOTAL=<count.txt
del count.txt
echo    Всего версий: %TOTAL%

echo.
echo 📜 Последние 5 версий:
echo ----------------------------------------
git log --pretty=format:"  %%h %%ad - %%s" --date=short -5
echo.
echo ----------------------------------------

pause
