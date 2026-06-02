@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

title Smart Commit - Chat App Backup

echo ========================================
echo   Smart Backup with Change History
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

:: Menu
echo Select change type:
echo   1) Feature - New functionality
echo   2) Fix - Bug fixes
echo   3) Security - Security updates
echo   4) Performance - Speed improvements
echo   5) Docs - Documentation updates
echo   6) Style - Design changes
echo   7) Refactor - Code refactoring
echo   8) Tests - Add/update tests
echo.

set /p TYPE="Change type (1-8): "

:: Type mapping
set "TYPE_1=Feature"
set "TYPE_2=Fix"
set "TYPE_3=Security"
set "TYPE_4=Performance"
set "TYPE_5=Docs"
set "TYPE_6=Style"
set "TYPE_7=Refactor"
set "TYPE_8=Tests"

for %%i in (%TYPE%) do set "PREFIX=!TYPE_%%i!"

if "%PREFIX%"=="" set "PREFIX=Update"

echo.
set /p COMMENT="Description: "

if "%COMMENT%"=="" (
    echo ERROR: Description required!
    pause
    exit /b 1
)

:: Version
set DATE=%DATE:~-4,4%%DATE:~-7,2%%DATE:~-10,2%
set TIME=%TIME:~0,2%%TIME:~3,2%
set VERSION=v%DATE%-%TIME%

echo.
echo Version: %VERSION%
echo Type: %PREFIX%
echo Description: %COMMENT%
echo.

cd /d "%~dp0"

:: Check changes
echo [1/5] Checking changes...
git status --porcelain > changes.txt
set /p CHANGED=<changes.txt
del changes.txt

if "%CHANGED%"=="" (
    echo No changes to commit
    pause
    exit /b 0
)

:: Add files
echo [2/5] Adding files...
git add -A

:: Commit
echo [3/5] Creating commit...
git commit -m "%VERSION% - %PREFIX%: %COMMENT%"

:: Tag
echo [4/5] Creating tag...
git tag -a "%VERSION%" -m "%PREFIX%: %COMMENT%"

:: Generate CHANGELOG
echo [5/5] Generating CHANGELOG...
node generate-changelog.js

:: Commit CHANGELOG
git add CHANGELOG.md
git commit -m "%VERSION% - CHANGELOG update" > nul 2>&1

echo.
echo ========================================
echo Backup completed: %VERSION%
echo ========================================
echo.

:: Statistics
echo Repository stats:
git log --oneline | find /c /v "" > count.txt
set /p TOTAL=<count.txt
del count.txt
echo Total versions: %TOTAL%

echo.
echo Last 5 versions:
echo ----------------------------------------
git log --pretty=format:"  %%h %%ad - %%s" --date=short -5
echo.
echo ----------------------------------------

pause
