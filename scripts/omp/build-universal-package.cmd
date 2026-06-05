@echo off
setlocal
powershell -NoProfile -File "%~dp0build-universal-package.ps1" -Pause
exit /b %ERRORLEVEL%
