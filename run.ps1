Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  Starting VARUNA (Kerala Flood Intelligence System)    " -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

$backendDir = Join-Path $PSScriptRoot "backend"
$frontendDir = Join-Path $PSScriptRoot "frontend"

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$backendDir'; .venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$frontendDir'; npm run dev"

Write-Host ""
Write-Host "Both servers launched in background windows:" -ForegroundColor Green
Write-Host " - Frontend: http://localhost:3000" -ForegroundColor Yellow
Write-Host " - Backend:  http://127.0.0.1:8000 (Docs: http://127.0.0.1:8000/docs)" -ForegroundColor Yellow
