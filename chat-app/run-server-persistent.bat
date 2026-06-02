@echo off
title Chat App Backend Server
color 0A
echo ============================================
echo Chat App Backend - Persistent Mode
echo ============================================
echo.

:restart
echo [%TIME%] Запуск сервера...
cd /d "%~dp0chat-app\backend"
node server.js
echo.
echo [%TIME%] Сервер остановлен. Перезапуск через 3 секунды...
timeout /t 3 /nobreak >nul
goto restart
