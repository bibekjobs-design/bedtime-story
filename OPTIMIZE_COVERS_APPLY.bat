@echo off
cd /d "%~dp0backend"
call venv\Scripts\activate
python optimize_covers.py --apply > "%~dp0optimize_covers_log.txt" 2>&1
type "%~dp0optimize_covers_log.txt"
pause
