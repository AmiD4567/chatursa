@echo off
echo ========================================
echo   История версий
echo ========================================
echo.

cd /d "%~dp0"

:: Проверка Git
git --version > nul 2>&1
if errorlevel 1 (
    echo ❌ Git не установлен!
    pause
    exit /b 1
)

:: Статистика
echo 📊 Статистика репозитория:
echo ----------------------------------------
git log --oneline | find /c /v "" > count.txt
set /p TOTAL=<count.txt
del count.txt
echo    Всего коммитов: %TOTAL%
echo.

:: Ветви
echo 🌿 Ветви:
git branch -a
echo.

:: Теги
echo 🏷️ Теги (версии):
echo ----------------------------------------
git tag -l "v*" --sort=-version:refname | findstr /n "^" | findstr /c:"1:" /c:"2:" /c:"3:" /c:"4:" /c:"5:" /c:"6:" /c:"7:" /c:"8:" /c:"9:" /c:"10:"
echo.

:: Последние коммиты
echo 📜 Последние 10 коммитов:
echo ----------------------------------------
git log --pretty=format:"%%C(yellow)%%h%%reset %%C(green)%%ad%%reset - %%s %%C(dim)(%%an)%%Creset" --date=short -10
echo.
echo ----------------------------------------
echo.

:: CHANGELOG
echo 📄 CHANGELOG:
echo ----------------------------------------
if exist "CHANGELOG.md" (
    type CHANGELOG.md
) else (
    echo ❌ CHANGELOG.md не найден
    echo    Запустите: node generate-changelog.js
)

pause
