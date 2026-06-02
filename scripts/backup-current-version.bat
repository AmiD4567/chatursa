@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

title Backup Current Version

echo ========================================
echo   Backup Current Version
echo ========================================
echo.

:: Get current date and time
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value') do set "dt=%%a"
set "YEAR=%dt:~0,4%"
set "MONTH=%dt:~4,2%"
set "DAY=%dt:~6,2%"
set "HOUR=%dt:~8,2%"
set "MINUTE=%dt:~10,2%"

set "BACKUP_DATE=%YEAR%-%MONTH%-%DAY%_%HOUR%-%MINUTE%"
set "BACKUP_DIR=%~dp0backups\backup_%BACKUP_DATE%"

echo Backup date: %BACKUP_DATE%
echo.

:: Create backups directory
if not exist "%~dp0backups" mkdir "%~dp0backups"

:: Create backup directory
echo Creating backup directory...
mkdir "%BACKUP_DIR%"

:: Copy project files
echo Copying project files...
xcopy "%~dp0frontend" "%BACKUP_DIR%\frontend\" /E /I /Q /Y > nul
xcopy "%~dp0backend" "%BACKUP_DIR%\backend\" /E /I /Q /Y > nul
xcopy "%~dp0electron" "%BACKUP_DIR%\electron\" /E /I /Q /Y > nul

:: Copy config files
echo Copying configuration files...
copy "%~dp0package.json" "%BACKUP_DIR%\" > nul
copy "%~dp0README.md" "%BACKUP_DIR%\" > nul
copy "%~dp0CHANGELOG.md" "%BACKUP_DIR%\" > nul
copy "%~dp0LICENSE" "%BACKUP_DIR%\" > nul
copy "%~dp0.gitignore" "%BACKUP_DIR%\" > nul

:: Get git info
echo Getting version info...
cd /d "%~dp0"
for /f "tokens=*" %%i in ('git describe --tags --always 2^>nul') do set "VERSION=%%i"
for /f "tokens=*" %%i in ('git log -1 --format^="%%h" 2^>nul') do set "COMMIT=%%i"

:: Create version info file
echo Version: %VERSION% > "%BACKUP_DIR%\VERSION.txt"
echo Commit: %COMMIT% >> "%BACKUP_DIR%\VERSION.txt"
echo Date: %BACKUP_DATE% >> "%BACKUP_DIR%\VERSION.txt"
echo. >> "%BACKUP_DIR%\VERSION.txt"
echo Changes in this version: >> "%BACKUP_DIR%\VERSION.txt"
git log --oneline -20 >> "%BACKUP_DIR%\VERSION.txt" 2>nul

echo.
echo ========================================
echo Backup completed successfully!
echo ========================================
echo.
echo Backup location:
echo   %BACKUP_DIR%
echo.
echo Version: %VERSION%
echo Commit: %COMMIT%
echo.

pause
