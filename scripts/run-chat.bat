@echo off
echo Запуск Chat App...
echo.

cd /d "%~dp0chat-app"

echo Запуск backend и frontend...
npm start

pause
