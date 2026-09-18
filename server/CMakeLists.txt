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
    target_link_libraries(motorforge_server PRIVATE ws2_32)
    target_compile_options(motorforge_server PRIVATE
        $<$<CXX_COMPILER_ID:GNU>:-static -static-libgcc -static-libstdc++>)
endif()
