@echo off
title STORYLAND - Build test APK
cd /d "%~dp0mobile"
echo ================================================
echo  STORYLAND test APK build (Expo EAS cloud build)
echo ================================================
echo.
echo Step 1: checking Expo login...
call npx eas-cli whoami
if errorlevel 1 (
  echo Not logged in. Please log in now:
  call npx eas-cli login
)
echo.
echo Step 2: building APK. If asked "Create project?" type Y and press Enter.
echo If asked about Android keystore, choose "Generate new keystore" - press Enter.
echo This takes about 10-20 minutes. Do not close this window.
echo.
call npx eas-cli build -p android --profile preview
echo.
echo ================================================
echo  Done. Copy the download link / QR shown above
echo  and open it on your phone to install the APK.
echo ================================================
pause
