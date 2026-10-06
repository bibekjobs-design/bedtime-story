@echo off
title Phone App via tunnel (keep open)
cd /d "%~dp0mobile"
if not exist node_modules\@expo\ngrok call npm install @expo/ngrok --no-audit --no-fund
set EXPO_PUBLIC_API_URL=https://bedtime-story-icmv.onrender.com
call npx expo start --tunnel --port 8082 -c
pause
