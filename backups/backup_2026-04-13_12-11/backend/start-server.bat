@echo off
cd /d "%~dp0"
node server.js <nul 2>&1
pause
