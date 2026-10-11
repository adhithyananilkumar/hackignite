@echo off
echo ========================================================
echo   Starting VARUNA (Kerala Flood Intelligence System)
echo ========================================================

start "VARUNA - Backend (Port 8000)" cmd /k "cd /d %~dp0backend && .venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000"
start "VARUNA - Frontend (Port 3000)" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo Both servers have been launched in separate windows!
echo - Frontend: http://localhost:3000
echo - Backend:  http://127.0.0.1:8000 (Docs: http://127.0.0.1:8000/docs)
echo.
pause
