@echo off
title ChemViz3D

cd /d "%~dp0"

echo.
echo ============================================
echo     ChemViz3D - Molecular Visualizer
echo ============================================
echo.

if exist "%~dp0ChemViz3D.exe" goto :run_executable

where python >nul 2>nul
if errorlevel 1 goto :missing_runtime

python -c "import PySide6" >nul 2>nul
if not errorlevel 1 goto :run_python

where uv >nul 2>nul
if errorlevel 1 goto :missing_pyside
echo [Info] PySide6 is not installed; starting it through uv...
cd /d "%~dp0"
uv run --with "PySide6>=6.7,<7" python -m desktop --root "%~dp0" --port 0
goto :end

:run_executable
echo [Info] Starting the native ChemViz3D client...
"%~dp0ChemViz3D.exe"
goto :end

:run_python
echo [Info] Starting the native ChemViz3D client via Python...
echo.
cd /d "%~dp0"
python -m desktop --root "%~dp0" --port 0
goto :end

:missing_pyside
echo [ERROR] PySide6 is required. Install desktop\requirements.txt first.
goto :end

:missing_runtime
echo [ERROR] ChemViz3D.exe or Python 3 was not found!
echo.
echo Install Python 3 and PySide6, or use a platform executable build.
echo.
pause

:end
pause
