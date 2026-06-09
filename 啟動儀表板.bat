@echo off
chcp 65001 > nul
cd /d "%~dp0"

python dashboard.py
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Failed to execute dashboard.py. Please ensure Python is installed and added to PATH.
    echo.
    pause
)
