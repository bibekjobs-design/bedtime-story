@echo off
title App (keep open)
cd /d "%~dp0mobile"
call npx expo start --web -c
pause
