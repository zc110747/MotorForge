@echo off
rem ============================================================
rem  MotorForge one-click launcher
rem    1. build (if missing) + start the C++ simulation server
rem    2. install web UI deps (if missing) + start Vite dev server
rem  Web UI:  http://localhost:5173
rem  WS API:  ws://127.0.0.1:18098/ws
rem  NOTE: pure ASCII (GBK consoles mangle UTF-8 text).
rem        Error paths pause, success path stays alive.
rem ============================================================
setlocal
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%"

set "SIM_PORT=18098"
set "SIM_EXE=%ROOT%\server\build\motorforge_server.exe"
set "WEB_DIR=%ROOT%\web_ui"

rem ---- ensure simulation server binary exists ----
if not exist "%SIM_EXE%" (
    echo [MotorForge] simulation server not built, running server\build.bat ...
    call "%ROOT%\server\build.bat" nopause
    if not exist "%SIM_EXE%" (
        echo [MotorForge] FATAL: server build failed. Run server\build.bat to see why.
        pause
        exit /b 1
    )
)

rem ---- locate node / npm -------------------------------------------------
rem npm.cmd is preferred; on locked-down machines where the npm shim is
rem blocked we fall back to "node <npm-cli.js>" behind the npm.cmd shim.
set "NODE_EXE="
for /f "delims=" %%P in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%P"

set "NPM_CMD="
for /f "delims=" %%P in ('where npm.cmd 2^>nul') do if not defined NPM_CMD set "NPM_CMD=%%P"
if not defined NPM_CMD for /f "delims=" %%P in ('where npm 2^>nul') do if not defined NPM_CMD set "NPM_CMD=%%P"

set "NPM_CLI="
if defined NPM_CMD (
    for %%P in ("%NPM_CMD%") do set "NPM_DIR=%%~dpP"
    if exist "%NPM_DIR%node_modules\npm\bin\npm-cli.js" set "NPM_CLI=%NPM_DIR%node_modules\npm\bin\npm-cli.js"
)

set "NPM_RUN="
if defined NPM_CMD set "NPM_RUN="%NPM_CMD%""
if not defined NPM_RUN if defined NPM_CLI set "NPM_RUN="%NODE_EXE%" "%NPM_CLI%""

if not defined NPM_RUN (
    echo [MotorForge] FATAL: node/npm not found on PATH.
    echo               Install Node.js 18+ and reopen this window.
    pause
    exit /b 1
)

rem ---- ensure web UI dependencies exist --------------------------------
if not exist "%WEB_DIR%\node_modules\vite" (
    echo [MotorForge] web UI dependencies missing, running npm install ...
    echo                ^(first run only, may take a minute^)
    pushd "%WEB_DIR%"
    call %NPM_RUN% install --no-audit --no-fund
    if errorlevel 1 (
        echo [MotorForge] FATAL: npm install failed in web_ui.
        popd
        pause
        exit /b 1
    )
    popd
    if not exist "%WEB_DIR%\node_modules\vite" (
        echo [MotorForge] FATAL: node_modules\vite still missing after install.
        pause
        exit /b 1
    )
)

rem ---- start simulation server (detached background window) ----
echo [MotorForge] starting simulation server on port %SIM_PORT% ...
start "MotorForge-Sim" "%SIM_EXE%" --port %SIM_PORT%
if errorlevel 1 (
    echo [MotorForge] FATAL: could not launch simulation server.
    pause
    exit /b 1
)
rem ~1 s so the server has bound the port before the browser connects.
rem (ping, not "timeout", which errors out when stdin is redirected)
ping -n 2 127.0.0.1 >nul 2>nul

rem ---- start web UI dev server (foreground) ----
echo [MotorForge] simulation server : ws://127.0.0.1:%SIM_PORT%/ws
echo [MotorForge] web UI            : http://localhost:5173
echo [MotorForge] LAN access        : http://THIS-PC-IP:5173  ^(Vite serves all
echo                interfaces; the page auto-targets the host it was opened from^)
echo [MotorForge] starting web UI dev server ...
pushd "%WEB_DIR%"
call %NPM_RUN% run dev
if errorlevel 1 (
    echo [MotorForge] FATAL: web UI dev server failed.
    popd
    pause
    exit /b 1
)
popd
exit /b 0
