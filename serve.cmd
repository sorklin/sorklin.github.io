@echo off
REM Double-click to preview the site at http://localhost:8080/
REM Extra arguments are passed through, e.g.
REM   serve.cmd -Port 9000
REM   serve.cmd -Assets D:\work\rthunder\app

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*

echo.
pause
