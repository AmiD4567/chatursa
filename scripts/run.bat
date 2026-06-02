@echo off
chcp 65001 >nul
echo Запуск чата...
echo.

REM Запуск backend
echo Запуск сервера...
start "Chat Backend" cmd /k "cd backend && node server.js"
timeout /t 3 >nul

REM Запуск frontend
echo Запуск интерфейса...
start "Chat Frontend" cmd /k "cd frontend && npm start"

echo.
echo Чат запущен!
echo Для выхода закройте оба окна.
pause
