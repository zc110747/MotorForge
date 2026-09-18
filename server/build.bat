@echo off
rem ============================================================
rem  MotorForge simulation server build script (Windows)
rem
rem  Toolchain: any mingw-w64 g++ >= 8.0. MSYS2 (mingw64 / ucrt64)
rem             is preferred; a stripped bundled mingw is rejected.
rem             The compiler is auto-selected by syntax-checking the
rem             real adapter translation unit first, so an incomplete
rem             g++ earlier on PATH can never fail the build with
rem             unrelated-looking errors.
rem  Output:    server\build\motorforge_server.exe
rem  Usage:     build.bat [nopause]
rem             nopause - never wait for a key (used by start.bat)
rem  Env:       MOTORFORGE_GXX - force a specific g++ executable
rem  Upstream:  markisus/motor_sim (unmodified, docs/UPSTREAM_ANALYSIS.md)
rem  NOTE: pure ASCII on purpose (GBK consoles mangle UTF-8 text).
rem ============================================================
setlocal
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "SRC=%ROOT%"
set "UP=%ROOT%\..\motor_sim"
set "OUTDIR=%ROOT%\build"
set "LOG=%OUTDIR%\build_probe.log"
set "NO_PAUSE=0"
if /i "%~1"=="nopause" set "NO_PAUSE=1"

if not exist "%OUTDIR%" mkdir "%OUTDIR%"

set "FLAGS=-std=c++17 -O2 -D_WIN32_WINNT=0x0601 -include cmath"
set "UPINC=-isystem "%UP%" -isystem "%UP%\third_party\eigen" -isystem "%UP%\global_debug""

echo [MotorForge] selecting a mingw-w64 g++ ...
set "GXX="
if defined MOTORFORGE_GXX call :try "%MOTORFORGE_GXX%"
call :try "C:\Software\msys2\mingw64\bin\g++.exe"
call :try "C:\msys64\mingw64\bin\g++.exe"
call :try "C:\msys64\ucrt64\bin\g++.exe"
call :try "C:\msys64\clang64\bin\g++.exe"
call :try "g++"

if not defined GXX (
    echo [ERROR] no usable mingw-w64 g++ found.
    echo         Need g++ 8.0 or newer that can compile this project.
    echo         Checked MOTORFORGE_GXX, MSYS2 mingw64/ucrt64/clang64
    echo         installs, then the first g++ on PATH.
    echo         Install MSYS2 mingw-w64-gcc, or set MOTORFORGE_GXX.
    if exist "%LOG%" (
        echo ---- last compiler probe log ----
        type "%LOG%"
        echo ---------------------------------
    )
    goto :fail
)
echo [MotorForge] compiler: %GXX%

rem ---- upstream core: warnings suppressed, sources are unmodified ----
echo [1/3] compiling upstream core ...
for %%f in ("%UP%\simulator\motor.cpp" "%UP%\simulator\motor_state.cpp" "%UP%\controls\foc.cpp" "%UP%\controls\pi_control.cpp" "%UP%\controls\space_vector_modulation.cpp" "%UP%\controls\six_step.cpp" "%UP%\util\clarke_transform.cpp") do (
    "%GXX%" %FLAGS% %UPINC% -c "%%~ff" -o "%OUTDIR%\%%~nf.o"
    if errorlevel 1 goto :fail
)

rem ---- adapter + server: zero warning is a hard requirement ----
echo [2/3] compiling adapter + server [zero-warning] ...
for %%f in ("%SRC%\main.cpp" "%SRC%\simulation_controller.cpp" "%SRC%\ws_server.cpp") do (
    "%GXX%" %FLAGS% -Wall -Wextra -Werror %UPINC% -I"%SRC%" -c "%%~ff" -o "%OUTDIR%\%%~nf.o"
    if errorlevel 1 goto :fail
)

echo [3/3] linking ...
"%GXX%" "%OUTDIR%\main.o" "%OUTDIR%\simulation_controller.o" "%OUTDIR%\ws_server.o" "%OUTDIR%\motor.o" "%OUTDIR%\motor_state.o" "%OUTDIR%\foc.o" "%OUTDIR%\pi_control.o" "%OUTDIR%\space_vector_modulation.o" "%OUTDIR%\six_step.o" "%OUTDIR%\clarke_transform.o" -o "%OUTDIR%\motorforge_server.exe" -lws2_32 -lwinmm -static -static-libgcc -static-libstdc++
if errorlevel 1 goto :fail

echo Build OK: %OUTDIR%\motorforge_server.exe
if not "%NO_PAUSE%"=="0" goto :done
pause
:done
exit /b 0

:fail
echo Build FAILED.
if not "%NO_PAUSE%"=="0" goto :done_fail
pause
:done_fail
exit /b 1

rem ============================================================
rem  :try <path or bare name>
rem  Accept the first candidate that can syntax-check the real
rem  adapter TU. Known-answer probe - the acceptance test is the
rem  actual source file, not a synthetic snippet.
rem ============================================================
:try
if defined GXX goto :eof
set "CAND=%~1"
if not defined CAND goto :eof
if /i "%~nx1"=="%~1" (
    set "CAND="
    for /f "delims=" %%P in ('where "%~1" 2^>nul') do if not defined CAND set "CAND=%%P"
)
if not defined CAND goto :eof
if not exist "%CAND%" goto :eof
"%CAND%" %FLAGS% %UPINC% -I"%SRC%" -fsyntax-only "%SRC%\main.cpp" >"%LOG%" 2>&1
if errorlevel 1 (
    echo [probe] rejected: %CAND%
    goto :eof
)
set "GXX=%CAND%"
goto :eof
