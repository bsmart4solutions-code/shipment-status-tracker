@echo off
setlocal enabledelayedexpansion
set "ROOT=%~dp0"
cd /d "%ROOT%"

echo ============================================
echo   Shipment Status Tracker - one-click start
echo ============================================
echo.

REM --- 1. Database ------------------------------------------------------
REM Native PostgreSQL 17 installed at C:\PostgreSQL, running as the
REM auto-start Windows service "postgresql-17" on port 5433.
REM (5432 is taken by a Postgres inside WSL, so this one uses 5433.)
REM Docker is no longer needed for local development.
echo [1/3] Checking the database...

sc query postgresql-17 >nul 2>&1
if errorlevel 1 (
    echo.
    echo   ERROR: the "postgresql-17" service is not installed.
    echo   PostgreSQL should be at C:\PostgreSQL - see README.md.
    echo.
    pause
    exit /b 1
)

REM Full path on purpose: with Git for Windows on PATH, a bare `find` or
REM `findstr` can resolve to the Unix tool instead of the Windows one, which
REM fails and makes this look like the service is down when it is running.
sc query postgresql-17 | "%SystemRoot%\System32\findstr.exe" /C:"RUNNING" >nul
if errorlevel 1 (
    echo Database service is stopped. Starting it...
    net start postgresql-17 >nul 2>&1
    sc query postgresql-17 | "%SystemRoot%\System32\findstr.exe" /C:"RUNNING" >nul
    if errorlevel 1 (
        echo.
        echo   Could not start the database service - this needs Administrator
        echo   rights. Right-click Start, choose "Terminal ^(Administrator^)",
        echo   and run:
        echo       net start postgresql-17
        echo.
        echo   Then run this script again.
        echo.
        pause
        exit /b 1
    )
)
echo Database is up ^(PostgreSQL 17 on port 5433^).
echo.

REM --- 2. Backend -------------------------------------------------------
echo [2/3] Backend...
curl -s -o nul http://localhost:4000/api/health/live
if not errorlevel 1 (
    echo Backend already running.
    goto backenddone
)
echo Starting backend on http://localhost:4000 ...
start "Backend - Shipment Tracker" cmd /k "cd /d "%ROOT%backend" && npm run start:dev"

echo Waiting for backend to respond...
:waitbackend
ping -n 3 127.0.0.1 >nul
curl -s -o nul http://localhost:4000/api/health/live
if errorlevel 1 goto waitbackend
:backenddone
echo Backend is up.
echo.

REM --- 3. Frontend ------------------------------------------------------
echo [3/3] Frontend...
curl -s -o nul http://localhost:3000/login
if not errorlevel 1 (
    echo Frontend already running.
    goto frontenddone
)
echo Starting frontend on http://localhost:3000 ...
start "Frontend - Shipment Tracker" cmd /k "cd /d "%ROOT%frontend" && npm run dev"

echo Waiting for frontend to respond...
:waitfrontend
ping -n 3 127.0.0.1 >nul
curl -s -o nul http://localhost:3000/login
if errorlevel 1 goto waitfrontend
:frontenddone
echo Frontend is up.
echo.

echo ============================================
echo   All services are running.
echo   Opening http://localhost:3000 ...
echo ============================================
start "" "http://localhost:3000"

echo.
echo Two extra windows opened for Backend and Frontend logs - leave them
echo running. Both hot-reload, so edited code takes effect immediately.
echo Close those windows (or run stop-app.bat) when you are done.
echo.
echo The database keeps running in the background as a Windows service;
echo it costs almost nothing idle and starts automatically with Windows.
echo.
pause
