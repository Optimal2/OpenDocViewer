@echo off
echo Preparing development environment...

REM Install dependencies
call npm install
IF %ERRORLEVEL% NEQ 0 (
  echo Failed to install dependencies.
  pause
  exit /b %ERRORLEVEL%
)

REM Ensure dependencies installed successfully, then run the application
echo Starting development environment...
call npm run start:both

pause
