// Standalone harness: run the simulation loop without WS for crash testing.
#include "simulation_controller.h"
#include <cmath>
#include <cstdio>
#include <thread>

int main() {
    int count = 0;
    SimulationController sim([&](const std::string& msg) {
        if (++count % 50 == 1)
            printf("broadcast #%d len=%zu\n", count, msg.size());
    });
    sim.start_thread();
    sim.cmd_target_speed(1000);
    sim.cmd_start();
    for (int i = 1; i <= 10; ++i) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
        Snapshot s = sim.latest_snapshot();
        printf(
            "t=%4.2fs rpm=%8.2f iq=%7.3f emT=%7.4f angle=%6.3f status=%d "
            "tgtT=%7.4f tgtIq=%7.3f tgtSpd=%7.2f spdErr=%7.2f\n",
            s.time, s.rotor_angular_vel * 60.0 / (2 * 3.141592653589793),
            s.iq, s.em_torque, s.rotor_angle, (int)s.status, s.target_torque,
            s.target_iq, s.target_speed, s.speed_error);
        fflush(stdout);
    }
    // load step
    SimulationController::LoadConfig cfg;
    cfg.enabled = true;
    cfg.mode = "manual";
    cfg.torque = 0.5;
    sim.cmd_load_configure(cfg);
    for (int i = 1; i <= 3; ++i) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
        Snapshot s = sim.latest_snapshot();
        printf("load t=%4.2fs rpm=%8.2f iq=%7.3f load=%.3f\n", s.time,
               s.rotor_angular_vel * 60.0 / (2 * 3.141592653589793), s.iq,
               s.load_torque);
        fflush(stdout);
    }
    sim.cmd_pause();
    Snapshot s = sim.latest_snapshot();
    printf("paused at t=%.3f status=%d\n", s.time, (int)s.status);
    printf("HARNESS_OK\n");
    return 0;
}
