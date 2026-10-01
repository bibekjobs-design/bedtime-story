@echo off
setlocal
cd /d "%~dp0"
set LOG=%~dp0push_update_log.txt
echo Push update log > "%LOG%"
git add . >> "%LOG%" 2>&1
git -c user.name="Bedtime Story" -c user.email="bibekjobs@gmail.com" commit -m "Update" >> "%LOG%" 2>&1
git push >> "%LOG%" 2>&1
if errorlevel 1 (echo RESULT: PUSH_FAILED >> "%LOG%") else (echo RESULT: PUSH_OK >> "%LOG%")
exit /b 0
