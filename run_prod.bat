@echo off
echo Building production bundle...
npm run build
echo Starting production servers concurrently...
npx concurrently "npx serve -s build" "npm run start:log-server"
pause
