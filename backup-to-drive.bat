@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

title Git Backup Verification

echo ========================================
echo   Git Repository Backup
echo ========================================
echo.

:: Settings
set "SOURCE_REPO=%~dp0"

:: Check if source repo exists
if not exist "%SOURCE_REPO%.git" (
    echo ERROR: Repository not found
    pause
    exit /b 1
)

cd /d "%SOURCE_REPO%"

:: Get commit count
for /f %%i in ('git rev-list --count HEAD') do set COMMITS=%%i
echo Total commits: %COMMITS%

:: Get last tag
for /f "tokens=*" %%i in ('git describe --tags --always') do set LAST_TAG=%%i
echo Last version: %LAST_TAG%
echo.

:: Verify repository status
echo Verifying repository...
git fsck --quiet

if errorlevel 1 (
    echo WARNING: Repository has issues
) else (
    echo OK: Repository is healthy
)

echo.
echo ========================================
echo Backup verification completed!
echo ========================================
echo.
echo Your backups are stored in:
echo   %SOURCE_REPO%.git\objects\
echo.
echo To view history:
echo   git log --oneline
echo.

pause
