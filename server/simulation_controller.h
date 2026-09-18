#pragma once
// SimulationController (adapter layer).
//
// Owns the upstream SimState and runs the exact same per-step loop as
// upstream simulator.cpp (FOC branch), with two adapter-level additions:
//   1. Speed PI: target speed [rad/s] -> target torque, built on upstream's
//      own pi_control/pi_unwind (controls/pi_control.h). Upstream has NO
//      speed loop; torque mode passes the manual torque straight through.
//   2. Periodic load controller: switches state.load_torque based on
//      simulation time (state.time), never wall-clock.
//
// Upstream files are included unmodified.
#include "snapshot.h"

#include "config/scalar.h"
#include "board/board_state.h"
#include "controls/foc.h"
#include "controls/pi_control.h"
#include "controls/six_step.h"
#include "controls/space_vector_modulation.h"
#include "simulator/motor.h"
#include "simulator/motor_state.h"
#include "simulator/sim_state.h"

#include "util/clarke_transform.h"
#include "util/math_constants.h"
#include "util/rotation.h"
#include "util/time.h"

#include <Eigen/Dense>
#include <array>
#include <atomic>
#include <complex>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

// NOTE: upstream core files (board/ controls/ simulator/ util/) declare no
// namespace; all names are global. Adapter code uses no namespace either.

class SimulationController {
public:
    // on_broadcast is called with a serialized JSON message; it must be
    // cheap/non-blocking (queue it elsewhere).
    using BroadcastFn = std::function<void(const std::string&)>;

    explicit SimulationController(BroadcastFn on_broadcast);
    ~SimulationController();

    void start_thread();
    void stop_thread();

    // called by main() after both objects are constructed
    void set_broadcast(BroadcastFn fn) { broadcast_ = std::move(fn); }

    // --- commands (thread-safe) ---
    void cmd_start();           // stopped/paused -> running
    void cmd_stop();            // running/paused -> stopped (time preserved)
    void cmd_pause();           // running -> paused
    void cmd_resume();          // paused -> running
    void cmd_reset();           // state -> initial, time -> 0

    bool cmd_target_speed(double rpm);   // speed mode target
    bool cmd_target_torque(double nm);   // torque mode target
    bool cmd_control_mode(const std::string& mode); // "speed" | "torque"
    bool cmd_speed_pi(double kp, double ki, double torque_limit);
    bool cmd_speed_scale(double scale); // sim-time multiplier vs wall clock

    struct LoadConfig {
        bool enabled = false;
        std::string mode = "manual"; // "manual" | "periodic"
        double torque = 0;           // N*m
        double on_duration = 1;      // s
        double off_duration = 1;     // s
    };
    bool cmd_load_configure(const LoadConfig& cfg);

    // name: bus_voltage | phase_resistance | phase_inductance |
    //       num_pole_pairs | rotor_inertia | bEmf0
    bool cmd_motor_parameter(const std::string& name, double value,
                             std::string* err);

    Snapshot latest_snapshot(); // thread-safe copy

private:
    void thread_loop();
    void step_one();          // one upstream dt step (mirrors simulator.cpp)
    void update_speed_loop(); // called once per FOC period
    void update_load();       // called every step, based on state.time
    void reset_state();       // re-init SimState + restore persisted params
    void make_snapshot_locked(Snapshot* out) const;
    void broadcast_status_locked();

    BroadcastFn broadcast_;

    std::mutex mtx_;
    SimState state_;
    SimStatus status_ = SimStatus::STOPPED;

    // adapter: speed loop (uses upstream PiParams/PiContext)
    bool speed_mode_ = true;
    double target_speed_rads_ = 0;
    double target_torque_ = 0; // torque-mode manual target / last speed cmd
    PiParams speed_pi_params_;
    PiContext speed_pi_ctx_;
    double speed_torque_limit_ = 2.0; // N*m clamp

    // adapter: simulation speed multiplier (sim seconds per wall second).
    // Same concept as upstream GUI's `step_multiplier`. Physics and the
    // 1 MHz timestep are untouched; only steps-per-wall-tick scales.
    // 2x is safe on typical hardware (~2 Mstep/s); higher values are
    // clamped internally if the machine cannot keep up.
    double speed_scale_ = 2.0;

    // adapter: load controller
    LoadConfig load_;
    double load_phase_start_time_ = 0; // sim time when phase timing (re)started

    // persisted parameters (restored on reset)
    double bus_voltage_ = 24;
    double phase_resistance_ = 1.0;
    double phase_inductance_ = 1e-3;
    int num_pole_pairs_ = 4;
    double rotor_inertia_ = 0.1;
    double bEmf0_ = 0.01;

    // broadcast versioning
    SimStatus last_broadcast_status_ = SimStatus::STOPPED;
    bool force_status_broadcast_ = true;

    std::atomic<bool> thread_running_{false};
    std::thread thread_;
};
