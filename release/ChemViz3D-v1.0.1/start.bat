@echo off
title ChemViz3D

cd /d "%~dp0"

echo.
echo ============================================
echo     ChemViz3D - Molecular Visualizer
echo ============================================
echo.

:: Method 1: PowerShell (built-in on Windows 7+)
where powershell >nul 2>nul
if %errorlevel% equ 0 (
    echo [Info] Starting HTTP server via PowerShell...
    echo [URL]  http://localhost:8080
    echo [Tip]  Press Ctrl+C to stop the server
    echo.
    powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0server.ps1"
    goto :end
)

:: Method 2: Python (fallback)
where python >nul 2>nul
if %errorlevel% equ 0 (
    echo [Info] Starting HTTP server via Python...
    echo.
    start http://localhost:8080
    python -m http.server 8080 -d "%~dp0dist"
    goto :end
)

:: Neither found
echo [ERROR] Neither PowerShell nor Python found!
echo.
echo PowerShell is built into Windows 7 and later.
echo If missing, install Python or deploy dist/ to any web server.
echo.
pause

:end
pause
