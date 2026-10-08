@echo off
cd /d "%~dp0backend"
call venv\Scripts\activate
python cleanup_orphan_audio.py --delete
pause
