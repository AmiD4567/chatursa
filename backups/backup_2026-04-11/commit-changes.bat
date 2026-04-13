@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

title Commit Changes - Chat App Backup

echo ========================================
echo   Code Change Backup
echo ========================================
echo.

:: Check Git
git --version > nul 2>&1
if errorlevel 1 (
    echo ERROR: Git not installed!
    echo Download from https://git-scm.com/
    pause
    exit /b 1
)

:: Get comment
set /p COMMENT="Enter change description: "

if "%COMMENT%"=="" (
    echo ERROR: Comment required!
    pause
    exit /b 1
)

:: Version
set DATE=%DATE:~-4,4%%DATE:~-7,2%%DATE:~-10,2%
set TIME=%TIME:~0,2%%TIME:~3,2%
set VERSION=v%DATE%-%TIME%

echo.
echo Version: %VERSION%
echo Changes: %COMMENT%
echo.

cd /d "%~dp0"

:: Check changes
git status --porcelain > nul 2>&1
if errorlevel 1 (
    echo No changes to commit
    pause
    exit /b 1
)

:: Add files
echo [1/4] Adding files...
git add -A

:: Commit
echo [2/4] Creating commit...
git commit -m "%VERSION% - %COMMENT%"

:: Tag
echo [3/4] Creating tag...
git tag -a "%VERSION%" -m "%COMMENT%"

echo [4/4] Done!
echo.
echo ========================================
echo Backup created: %VERSION%
echo ========================================
echo.

:: Show history
echo Last 5 versions:
git log --oneline -5

pause
