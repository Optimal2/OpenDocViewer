@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "pauseArg=-Pause"
set "scriptArgs="

:parse_args
if "%~1"=="" goto run_script
if /I "%~1"=="--no-pause" (
    set "pauseArg="
) else (
    set "scriptArgs=!scriptArgs! "%~1""
)
shift /1
goto parse_args

:run_script
powershell -NoProfile -File "%~dp0build-universal-package.ps1" !scriptArgs! %pauseArg%
exit /b %ERRORLEVEL%
