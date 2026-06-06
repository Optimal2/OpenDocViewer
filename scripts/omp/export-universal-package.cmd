@echo off
setlocal
powershell -NoProfile -File "%~dp0export-universal-package.ps1"
exit /b %ERRORLEVEL%
