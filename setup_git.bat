@echo off
setlocal
cd /d "%~dp0"
set LOG=%~dp0setup_git_log.txt
echo Bedtime Story git setup > "%LOG%"
where git >> "%LOG%" 2>&1
if errorlevel 1 (
  echo RESULT: GIT_NOT_INSTALLED >> "%LOG%"
  exit /b 1
)
rem The Expo template left a tiny separate repo inside mobile; remove it so one repo covers everything
if exist mobile\.git (
  attrib -h -s mobile\.git >nul 2>&1
  ren mobile\.git .git_old_expo_template >> "%LOG%" 2>&1
)
if exist mobile\.git (
  rmdir /s /q mobile\.git >> "%LOG%" 2>&1
)
if exist mobile\.git (
  echo RESULT: MOBILE_GIT_STILL_PRESENT >> "%LOG%"
  exit /b 1
)
if not exist .git git init -b main >> "%LOG%" 2>&1
git rm -r --cached -q . >> "%LOG%" 2>&1
git add . >> "%LOG%" 2>&1
echo ---- FILES TO BE SAVED ---- >> "%LOG%"
git ls-files >> "%LOG%" 2>&1
git -c user.name="Bedtime Story" -c user.email="bibekjobs@gmail.com" commit -q -m "Bedtime Story app - initial commit" >> "%LOG%" 2>&1
git log --oneline -n 3 >> "%LOG%" 2>&1
echo RESULT: DONE >> "%LOG%"
exit /b 0
