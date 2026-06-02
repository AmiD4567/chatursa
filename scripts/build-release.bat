@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo   Chat App - Сборка релиза и публикация
echo ========================================
echo.

REM === Конфигурация ===
set "GH_TOKEN=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"
set "GITHUB_REPO=AmiD4567/chatursa"

REM Определяем сетевой путь (родительская папка батника)
set "SCRIPT_DIR=%~dp0"
if "!SCRIPT_DIR:~-1!"=="\" set "SCRIPT_DIR=!SCRIPT_DIR:~0,-1!"

echo   Исходная папка: !SCRIPT_DIR!
echo.

REM === Проверка Git ===
where git >nul 2>&1 || (
    echo [ERROR] Git не найден в PATH!
    pause
    exit /b 1
)

REM === Копируем проект локально ===
set "LOCAL_DIR=C:\temp\chat-app-build-%RANDOM%"
if exist "%LOCAL_DIR%" rd /s /q "%LOCAL_DIR%"
mkdir "%LOCAL_DIR%" >nul 2>&1

echo [0/6] Копирование проекта в %LOCAL_DIR%...
robocopy "!SCRIPT_DIR!" "%LOCAL_DIR%" /E /NFL /NDL /NJH /NJS /NC /NS /NP >nul 2>&1

if not exist "%LOCAL_DIR%\package.json" (
    echo [ERROR] Ошибка копирования файлов!
    pause
    exit /b 1
)
echo   OK!
cd /d "%LOCAL_DIR%"
echo.

REM === Сборка фронтенда ===
echo [1/6] Сборка фронтенда...
cd frontend
call npm run build >build.log 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Сборка фронтенда не удалась!
    type build.log
    pause
    exit /b 1
)
echo   OK!
cd ..

REM === Зависимости backend ===
echo.
echo [2/6] Установка зависимостей backend...
cd backend
call npm install >nul 2>&1
cd ..

REM === Сборка Electron ===
echo.
echo [3/6] Сборка Electron-приложения...
call npm run electron:build >electron-build.log 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Сборка Electron не удалась!
    type electron-build.log
    pause
    exit /b 1
)
echo   OK!

REM === Артефакты ===
set "DIST_DIR=%LOCAL_DIR%\dist"
if not exist "%DIST_DIR%" set "DIST_DIR=dist"

echo.
echo [4/6] Артефакты сборки:
dir /b "%DIST_DIR%\*.exe" 2>nul | findstr /i ".exe" >nul && (
    for %%F in ("%DIST_DIR%\*.exe") do echo   - %%~nxF
) || (
    echo   [WARNING] .exe файлы не найдены!
)

REM === Git: версия, коммит, тег, push ===
echo.
echo [5/6] Публикация на GitHub...

REM Чтение версии из package.json
for /f "tokens=2 delims=:, " %%V in ('findstr "\"version\"" package.json') do (
    set "VERSION=%%V"
    set "VERSION=!VERSION:"=!"
    set "VERSION=!VERSION: =!"
)

if not defined VERSION (
    echo [ERROR] Не удалось прочитать версию из package.json!
    pause
    exit /b 1
)

echo   Текущая версия: !VERSION!

REM Инкремент версии
for /f "tokens=1,2 delims=." %%X in ("!VERSION!") do (
    set "MAJOR=%%X"
    set "MINOR=%%Y"
)
for /f "tokens=3 delims=." %%P in ("!VERSION!") do (
    set /a PATCH=%%P+1
)
set "NEW_VERSION=!MAJOR!.!MINOR!.!PATCH!"

echo   Новая версия: !NEW_VERSION!

REM Обновление package.json
powershell -Command "(Get-Content 'package.json') -replace '\"version\":\s*\"[^\"]+\"', '\"version\": \"!NEW_VERSION!\"' | Set-Content 'package.json'" >nul 2>&1

REM Git init + remote (если нет)
if not exist ".git" (
    call git init >nul 2>&1
    call git remote add origin https://%GH_TOKEN%@github.com/AmiD4567/chat-app.git 2>nul || true
)

REM Git add + commit
call git add -A >nul 2>&1
call git commit -m "Release !NEW_VERSION!" --author="AmiD <amid@chat.local>" >nul 2>&1

REM Push на master
call git push origin master >push.log 2>&1
if %ERRORLEVEL% neq 0 (
    echo   [WARNING] Push не удался, продолжаем...
)

REM Tag + push tags
call git tag -a "!NEW_VERSION!" -m "Release !NEW_VERSION!" >nul 2>&1
call git push origin master --tags >push-tags.log 2>&1

echo.
echo   Создание GitHub Release...

powershell -Command "
    $headers = @{
        'Authorization' = 'token '%GH_TOKEN%'
        'Content-Type' = 'application/json'
    }
    $body = @{
        tag_name = ''%NEW_VERSION%''
        target_commitish = 'master'
        name = 'Chat App v' + ''%NEW_VERSION%''
        body = '- Автоматический релиз`n- Обновлено: ' + (Get-Date -Format 'dd.MM.yyyy HH:mm')
        draft = $false
        prerelease = $false
    } | ConvertTo-Json -Depth 5

    try {
        Invoke-RestMethod -Uri 'https://api.github.com/repos/'%GITHUB_REPO'/releases' `
            -Method POST `
            -Headers $headers `
            -Body $body >$null
        Write-Host 'Release created!'
    } catch {
        Write-Error $_.Exception.Message
    }
" >github-release.log 2>&1

if exist "github-release.log" type github-release.log

echo.
echo   Загрузка установщика на GitHub...

powershell -Command "
    $headers = @{ 'Authorization' = 'token '%GH_TOKEN%' }
    
    try {
        $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/'%GITHUB_REPO'/releases/tags/'%NEW_VERSION%' `
            -Headers $headers
        
        Get-ChildItem '%DIST_DIR%\*.exe' | ForEach-Object {
            $file = $_
            $uploadUrl = ($release.upload_url -split '\{')[0] + 'name=' + [System.Uri]::EscapeDataString($file.Name)
            
            Write-Host ('  Uploading: ' + $file.Name)
            
            Invoke-RestMethod -Uri $uploadUrl `
                -Headers @{$headers; 'Content-Type'='application/octet-stream'} `
                -Method POST `
                -InFile $file.FullName >$null
        }
    } catch {
        Write-Error $_.Exception.Message
    }
" >github-upload.log 2>&1

if exist "github-upload.log" type github-upload.log

echo.
echo ========================================
echo   ГОТОВО!
echo ========================================
echo   Версия: !NEW_VERSION!
echo   Релиз: https://github.com/%GITHUB_REPO%/releases/tag/!NEW_VERSION!
echo.

REM === Копируем dist обратно на сетевой диск ===
echo   Копирование dist/ обратно...
robocopy "%DIST_DIR%" "!SCRIPT_DIR!\dist" /E /NFL /NDL /NJH /NJS /NC /NS /NP >nul 2>&1

REM Очистка временной папки
rd /s /q "%LOCAL_DIR%" 2>nul

echo   Временная папка очищена.
pause
