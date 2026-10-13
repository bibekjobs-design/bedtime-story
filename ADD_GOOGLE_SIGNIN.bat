@echo off
title STORYLAND - Add Google sign-in library
cd /d "%~dp0mobile"
echo ================================================
echo  Installing the Google sign-in library (one time)
echo ================================================
call npx expo install @react-native-google-signin/google-signin
echo.
echo If you see errors above, take a screenshot and send it to Claude.
echo When it finishes without errors, you can build the new APK (BUILD_APK.bat).
pause
