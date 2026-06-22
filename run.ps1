# Launch Qwen3-TTS Studio (Windows / PowerShell)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$env:HF_HOME = Join-Path $PSScriptRoot "models"

Write-Host ""
Write-Host "  Qwen3-TTS Studio" -ForegroundColor Yellow
Write-Host "  http://127.0.0.1:8000" -ForegroundColor Yellow
Write-Host "  (first synthesis downloads the model - be patient)" -ForegroundColor DarkGray
Write-Host ""

# open the browser shortly after the server comes up
Start-Job { Start-Sleep 3; Start-Process "http://127.0.0.1:8000" } | Out-Null

& $py -m uvicorn app.main:app --host 127.0.0.1 --port 8000
