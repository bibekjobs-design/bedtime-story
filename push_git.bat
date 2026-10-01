@echo off
setlocal
cd /d "%~dp0"
set LOG=%~dp0push_git_log.txt
echo Push log > "%LOG%"
git remote remove origin >nul 2>&1
git remote add origin https://github.com/bibekjobs-design/bedtime-story.git >> "%LOG%" 2>&1
git branch -M main >> "%LOG%" 2>&1
git push -u origin main >> "%LOG%" 2>&1
if errorlevel 1 (echo RESULT: PUSH_FAILED >> "%LOG%") else (echo RESULT: PUSH_OK >> "%LOG%")
exit /b 0
