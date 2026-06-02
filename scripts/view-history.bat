@echo off
chcp 65001 > nul

title View History - Chat App Versions

echo ========================================
echo   Version History
echo ========================================
echo.

cd /d "%~dp0"

:: Check Git
git --version > nul 2>&1
if errorlevel 1 (
    echo ERROR: Git not installed!
    pause
    exit /b 1
)

:: Statistics
echo Repository stats:
echo ----------------------------------------
git log --oneline | find /c /v "" > count.txt
set /p TOTAL=<count.txt
del count.txt
echo Total commits: %TOTAL%
echo.

:: Branches
echo Branches:
git branch -a
echo.

:: Tags
echo Tags (versions):
echo ----------------------------------------
git tag -l "v*" --sort=-version:refname | findstr /n "^" | findstr /c:"1:" /c:"2:" /c:"3:" /c:"4:" /c:"5:" /c:"6:" /c:"7:" /c:"8:" /c:"9:" /c:"10:"
echo.

:: Last commits
echo Last 10 commits:
echo ----------------------------------------
git log --pretty=format:"%%C(yellow)%%h%%reset %%C(green)%%ad%%reset - %%s %%C(dim)(%%an)%%Creset" --date=short -10
echo.
echo ----------------------------------------
echo.

:: CHANGELOG
echo CHANGELOG:
echo ----------------------------------------
if exist "CHANGELOG.md" (
    type CHANGELOG.md
) else (
    echo CHANGELOG.md not found
    echo Run: node generate-changelog.js
)

pause
