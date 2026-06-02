@echo off
REM Завершение процессов Chat App перед установкой

echo Завершение работы Chat App...

REM Завершаем основной процесс Electron
taskkill /F /IM "Chat App.exe" >nul 2>&1
taskkill /F /IM "electron.exe" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq Chat App*" >nul 2>&1

REM Завершаем процесс сервера
taskkill /F /IM "node.exe" /FI "WINDOWTITLE eq *server.js*" >nul 2>&1

REM Ждем немного для завершения всех операций
timeout /t 2 /nobreak >nul

echo Готово к установке.
exit /b 0
