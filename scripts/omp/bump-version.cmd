@echo off
setlocal
powershell -NoProfile -File "%~dp0bump-version.ps1" -Interactive -Pause
exit /b %ERRORLEVEL%
