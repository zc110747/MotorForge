cmake_minimum_required(VERSION 3.20)
project(motorforge_server LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# upstream: markisus/motor_sim (unmodified) — headers + math sources
set(UPSTREAM ${CMAKE_CURRENT_SOURCE_DIR}/../motor_sim)

add_executable(motorforge_server
    main.cpp
    simulation_controller.cpp
    ws_server.cpp
    # upstream core (verbatim, see docs/UPSTREAM_ANALYSIS.md §18/§20)
    ${UPSTREAM}/simulator/motor.cpp
    ${UPSTREAM}/simulator/motor_state.cpp
    ${UPSTREAM}/controls/foc.cpp
    ${UPSTREAM}/controls/pi_control.cpp
    ${UPSTREAM}/controls/space_vector_modulation.cpp
    ${UPSTREAM}/controls/six_step.cpp
    ${UPSTREAM}/util/clarke_transform.cpp
)

target_include_directories(motorforge_server PRIVATE
    ${UPSTREAM}
    ${UPSTREAM}/third_party/eigen
)

if(WIN32)
    target_link_libraries(motorforge_server PRIVATE ws2_32 winmm)
    # win_compat.h declares the same baseline in-code; keeping it here as well
    # makes the requirement visible to CMake/IDE tooling (and guards against a
    # toolchain that defaults _WIN32_WINNT below Vista, which hides
    # CreateWaitableTimerExW / inet_pton and breaks the build).
    target_compile_definitions(motorforge_server PRIVATE _WIN32_WINNT=0x0601)
    target_compile_options(motorforge_server PRIVATE
        $<$<CXX_COMPILER_ID:GNU>:-static -static-libgcc -static-libstdc++>)
endif()

# The adapter layer is held to zero warnings (-Wall -Wextra -Werror), matching
# server/build.bat. The vendored upstream core is intentionally exempt.
if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    set_source_files_properties(
        main.cpp simulation_controller.cpp ws_server.cpp
        PROPERTIES COMPILE_OPTIONS "-Wall;-Wextra;-Werror")
endif()
