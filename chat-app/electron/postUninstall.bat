@echo off
REM Очистка после удаления Chat App

echo Очистка файлов Chat App...

REM Удаляем временные файлы приложения
del /Q /F "%APPDATA%\Chat App\*.tmp" >nul 2>&1
del /Q /F "%APPDATA%\Chat App\logs\*.log" >nul 2>&1
del /Q /F "%LOCALAPPDATA%\Chat App\*.tmp" >nul 2>&1

REM Очищаем кэш
del /Q /F "%APPDATA%\Chat App\Cache\*" >nul 2>&1
del /Q /F "%APPDATA%\Chat App\GPUCache\*" >nul 2>&1

REM Удаляем ярлыки
del /Q /F "%DESKTOP%\Chat App.lnk" >nul 2>&1
del /Q /F "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Chat App.lnk" >nul 2>&1

echo Очистка завершена.
exit /b 0
