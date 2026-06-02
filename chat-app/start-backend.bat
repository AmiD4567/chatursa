@echo off
title Chat App Backend Server
color 0A
echo ============================================
echo Chat App Backend Server
echo ============================================
echo.
echo Запуск сервера...
echo.

cd /d "%~dp0chat-app\backend"

REM Запуск сервера - окно остаётся открытым
node server.js

echo.
echo Сервер остановлен.
pause
