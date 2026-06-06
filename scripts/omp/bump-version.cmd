@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "pauseArg=-Pause"
set "interactiveArg=-Interactive"
set "scriptArgs="

:parse_args
if "%~1"=="" goto run_script
if /I "%~1"=="--no-pause" (
    set "pauseArg="
) else (
    set "interactiveArg="
    set "scriptArgs=!scriptArgs! "%~1""
)
shift /1
goto parse_args

:run_script
powershell -NoProfile -File "%~dp0bump-version.ps1" !scriptArgs! %interactiveArg% %pauseArg%
exit /b %ERRORLEVEL%
