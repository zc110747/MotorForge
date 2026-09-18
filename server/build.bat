@echo off
rem ============================================================
rem  MotorForge simulation server build script (g++ / MSYS2)
rem  Upstream: markisus/motor_sim (unmodified, see docs/UPSTREAM_ANALYSIS.md)
rem ============================================================
setlocal
set ROOT=%~dp0
set OUT=%ROOT%build\motorforge_server.exe

where g++ >nul 2>nul
if errorlevel 1 (
    echo [ERROR] g++ not found in PATH. Install MSYS2 mingw-w64-gcc.
    goto fail
)

if not exist "%ROOT%build" mkdir "%ROOT%build"

set UPINC=-isystem "%ROOT%..\motor_sim" -isystem "%ROOT%..\motor_sim\third_party\eigen" -isystem "%ROOT%..\motor_sim\global_debug"
set SRC=%ROOT%
set UP=%ROOT%..\motor_sim

echo [1/2] Compiling upstream core (warnings suppressed, unmodified)...
for %%f in ("%UP%\simulator\motor.cpp" "%UP%\simulator\motor_state.cpp" "%UP%\controls\foc.cpp" "%UP%\controls\pi_control.cpp" "%UP%\controls\space_vector_modulation.cpp" "%UP%\controls\six_step.cpp" "%UP%\util\clarke_transform.cpp") do (
    g++ -std=c++17 -O2 -include cmath %UPINC% -c %%f -o "%ROOT%build\%%~nf.o" || goto fail
)

echo [2/2] Compiling adapter + server (zero-warning)...
for %%f in ("%SRC%main.cpp" "%SRC%simulation_controller.cpp" "%SRC%ws_server.cpp") do (
    g++ -std=c++17 -O2 -Wall -Wextra -Werror -include cmath %UPINC% -I"%SRC%" -c %%f -o "%ROOT%build\%%~nf.o" || goto fail
)

g++ "%ROOT%build\main.o" "%ROOT%build\simulation_controller.o" "%ROOT%build\ws_server.o" "%ROOT%build\motor.o" "%ROOT%build\motor_state.o" "%ROOT%build\foc.o" "%ROOT%build\pi_control.o" "%ROOT%build\space_vector_modulation.o" "%ROOT%build\six_step.o" "%ROOT%build\clarke_transform.o" -o "%OUT%" -lws2_32 -lwinmm -static -static-libgcc -static-libstdc++ || goto fail

echo Build OK: %OUT%
pause
exit /b 0

:fail
echo Build FAILED.
pause
exit /b 1
