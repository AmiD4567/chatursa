@echo off
setlocal enabledelayedexpansion

echo ========================================
echo   Бэкап изменений кода
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

:: Запрос комментария
set /p COMMENT="Введите описание изменений: "

if "%COMMENT%"=="" (
    echo ❌ Комментарий не введён!
    pause
    exit /b 1
)

:: Дата и время
set DATE=%DATE:~-4,4%%DATE:~-7,2%%DATE:~-10,2%
set TIME=%TIME:~0,2%%TIME:~3,2%
set VERSION=v%DATE%-%TIME%

echo.
echo 📝 Версия: %VERSION%
echo 📝 Изменения: %COMMENT%
echo.

:: Переход в папку проекта
cd /d "%~dp0"

:: Проверка изменений
git status --porcelain > nul 2>&1
if errorlevel 1 (
    echo ❌ Нет изменений для коммита
    pause
    exit /b 1
)

:: Добавление всех файлов
echo [1/4] Добавление файлов...
git add -A

:: Коммит
echo [2/4] Создание коммита...
git commit -m "%VERSION% - %COMMENT%"

:: Создание тега
echo [3/4] Создание тега...
git tag -a "%VERSION%" -m "%COMMENT%"

echo [4/4] Готово!
echo.
echo ========================================
echo ✅ Бэкап создан: %VERSION%
echo ========================================
echo.

:: Показать историю
echo 📜 Последние 5 версий:
git log --oneline -5

pause
