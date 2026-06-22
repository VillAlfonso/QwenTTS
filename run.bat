@echo off
REM Launch Qwen3-TTS Studio (double-click friendly)
cd /d "%~dp0"
set "HF_HOME=%~dp0models"
echo.
echo   Qwen3-TTS Studio  ->  http://127.0.0.1:8000
echo   (first synthesis downloads the model - be patient)
echo.
start "" http://127.0.0.1:8000
".venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
