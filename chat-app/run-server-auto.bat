@echo off
title Chat App Backend - Auto Restart
color 0A
echo ============================================
echo Chat App Backend - Auto Restart Mode
echo ============================================
echo.
echo Сервер будет автоматически перезапускаться
echo при возникновении ошибок.
echo.
echo Для остановки нажмите Ctrl+C
echo ============================================
echo.

:restart
echo [%DATE% %TIME%] Запуск сервера...
cd /d "%~dp0chat-app\backend"

REM Запуск сервера и перехват ошибок
node server.js >> "..\server-crash.log" 2>&1

echo.
echo ============================================
echo [%DATE% %TIME%] СЕРВЕР ОСТАНОВЛЕН!
echo ============================================
echo.
echo Перезапуск через 3 секунды...
echo.
timeout /t 3 /nobreak >nul
goto restart
