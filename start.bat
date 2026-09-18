@echo off
rem ============================================================
rem  MotorForge one-click launcher
rem  1. build (if missing) + start the C++ simulation server
rem  2. start the React/Vite web UI dev server
rem  Web UI:  http://localhost:5173
rem  WS API:  ws://127.0.0.1:18098/ws
rem  NOTE: pure ASCII; error paths pause, success path stays alive.
rem ============================================================
setlocal
set ROOT=%~dp0
cd /d "%ROOT%"

rem ---- ensure simulation server binary exists ----
if not exist "%ROOT%server\build\motorforge_server.exe" (
    echo [MotorForge] simulation server not built, running server/build.bat ...
    call "%ROOT%server\build.bat"
    if not exist "%ROOT%server\build\motorforge_server.exe" (
        echo [MotorForge] FATAL: server build failed
        pause
        exit /b 1
    )
)

rem ---- start simulation server (detached background window) ----
start "MotorForge-Sim" "%ROOT%server\build\motorforge_server.exe" --port 18098
if errorlevel 1 (
    echo [MotorForge] FATAL: could not launch simulation server
    pause
    exit /b 1
)
timeout /t 1 >nul

rem ---- start web UI dev server (foreground) ----
echo [MotorForge] simulation server: ws://127.0.0.1:18098/ws
echo [MotorForge] starting web UI dev server ...
cd /d "%ROOT%web_ui"
call npm run dev
if errorlevel 1 (
    echo [MotorForge] FATAL: web UI dev server failed
    pause
    exit /b 1
)
exit /b 0
