@echo off
REM Inicia a plataforma: http://localhost:8765
cd /d "%~dp0"
start "" http://localhost:8765
python governance\server.py
pause
