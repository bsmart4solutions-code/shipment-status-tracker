@echo off
REM Stops the backend and frontend dev servers started by start-app.bat.
REM The PostgreSQL service is deliberately LEFT RUNNING: it is a Windows
REM service that costs almost nothing idle and starts with Windows anyway.
REM To stop it too, run (as Administrator):  net stop postgresql-17

echo Stopping the dev servers...

taskkill /FI "WINDOWTITLE eq Backend - Shipment Tracker*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Frontend - Shipment Tracker*" /T /F >nul 2>&1

REM Fallback: kill whatever still holds ports 4000 / 3000.
for %%P in (4000 3000) do (
    for /f "tokens=5" %%I in ('netstat -ano ^| findstr ":%%P" ^| findstr "LISTENING"') do (
        taskkill /PID %%I /F >nul 2>&1
    )
)

echo Done. The database service is still running (that is intentional).
timeout /t 3 >nul
