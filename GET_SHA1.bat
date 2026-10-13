@echo off
title STORYLAND - Get SHA-1 fingerprint
cd /d "%~dp0mobile"
echo ================================================
echo  STORYLAND - find the SHA-1 fingerprint
echo ================================================
echo.
echo Follow these choices when asked (use arrow keys + Enter):
echo   1. Select platform: Android (if asked)
echo   2. Which build profile: preview
echo   3. Choose: "Keystore: Manage everything needed to build your project"
echo   4. The screen then shows the keystore details.
echo      Copy the line that says "SHA1 Fingerprint" (it has 20 pairs like AB:CD:...)
echo   5. Press Ctrl+C to leave when done. Do NOT choose delete or generate new.
echo.
pause
call npx eas-cli credentials -p android
echo.
pause
