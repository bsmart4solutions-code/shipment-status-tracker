@echo off
REM Back up the local database. Safe to run any time - it only reads.
REM Also used by the daily scheduled task (see LOCAL_OPERATIONS.md).
cd /d "%~dp0"
node scripts\backup-db.js
if errorlevel 1 (
    echo.
    echo   *** BACKUP FAILED - see the message above. ***
    echo   Do not ignore this: it means you currently have no fresh backup.
    echo.
)
REM Only pause when a human double-clicked this; the scheduled task passes /quiet.
if /i not "%~1"=="/quiet" pause
