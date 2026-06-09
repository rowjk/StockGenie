@echo off
chcp 65001 > nul
cd /d "%~dp0"

python --version > nul 2>&1
if %errorlevel% neq 0 (
    echo Python not found. Please install Python 3.8+
    echo https://www.python.org/downloads/
    pause
    exit /b 1
)

python -c "import shioaji" > nul 2>&1
if %errorlevel% neq 0 (
    echo Installing shioaji...
    python -m pip install shioaji -q
)

echo.
echo === SinoPac Position Monitor ===
echo.
echo [1] Query once (default)
echo [2] Auto-refresh every 30s
echo [3] Auto-refresh every 60s
echo.
set /p "choice=Select (Enter=1): "

if "%choice%"=="2" (
    python monitor.py --interval 30
) else if "%choice%"=="3" (
    python monitor.py --interval 60
) else (
    python monitor.py
)

echo.
pause
