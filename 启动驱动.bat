@echo off
cd /d "%~dp0"
title AULA F87 PRO web driver - close this window when done
where python >nul 2>nul
if errorlevel 1 goto nopython
python serve.py
if errorlevel 1 pause
goto end
:nopython
echo Python was not found. Install it from https://www.python.org/downloads/
echo and tick "Add python.exe to PATH" during setup.
pause
:end
