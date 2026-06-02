@echo off
echo Добавление правила брандмауэра для Chat Server...
netsh advfirewall firewall add rule name="Chat Server 3001" dir=in action=allow protocol=TCP localport=3001
echo.
echo Правило добавлено. Сервер доступен из сети.
pause
