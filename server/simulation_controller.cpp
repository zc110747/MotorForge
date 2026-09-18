#include "simulation_controller.h"

#include "high_res_sleep.h"

#include <chrono>
#include <cmath>
#include <cstdio>

namespace {
constexpr Scalar kRpmPerRadS = 60.0 / (2.0 * kPI);
constexpr Scalar kRadSPerRpm = 2.0 * kPI / 60.0;
// wall tick for the realtime pacing loop
constexpr auto kWallTick = std::chrono::milliseconds(2);
// clamp sim steps per wall tick (prevents catch-up avalanche after stalls)
constexpr int kMaxStepsPerTick = 40000;

inline double sim_time_now() {
    using namespace std::chrono;
    return duration<double>(steady_clock::now().time_since_epoch()).count();
}
} // namespace

SimulationController::SimulationController(BroadcastFn on_broadcast)
    : broadcast_(std::move(on_broadcast)) {
    // adapter: default speed-loop gains. Plant is ~integrator (domega/dt =
    // T/J, J=0.1), so Kp ~ J*wc, Ki ~ J*wc^2/5 with wc = 20 rad/s. Tunable
    // at runtime via simulation.speed_pi.
    speed_pi_params_.p_gain = 0.5; // N*m per rad/s
    speed_pi_params_.i_gain = 5.0; // N*m per rad
    speed_pi_params_.bias = 0;
    speed_torque_limit_ = 2.0;     // N*m
    reset_state();
}

SimulationController::~SimulationController() { stop_thread(); }

void SimulationController::reset_state() {
    // Rebuild SimState from scratch, then restore persisted parameters.
    // NOTE (adapter): upstream leaves MotorParams::cogging_torque_map
    // uninitialized; we zero it here (state initialization only, the
    // cogging torque model itself is untouched and still all-zero).
    state_ = SimState{};
    init_sim_state(&state_);
    std::fill(state_.motor.params.cogging_torque_map.begin(),
              state_.motor.params.cogging_torque_map.end(), 0.0);

    state_.board.bus_voltage = bus_voltage_;
    state_.motor.params.phase_resistance = phase_resistance_;
    state_.motor.params.phase_inductance = phase_inductance_;
    state_.motor.params.num_pole_pairs = num_pole_pairs_;
    state_.motor.params.rotor_inertia = rotor_inertia_;
    state_.motor.params.normed_bEmf_coeffs.setZero();
    state_.motor.params.normed_bEmf_coeffs(0) = bEmf0_;

    // current-loop PI gains: same expression as upstream simulator.cpp:28
    state_.foc.i_controller_params = make_motor_pi_params(
        /*bandwidth=*/10000,
        /*resistance=*/state_.motor.params.phase_resistance,
        /*inductance=*/state_.motor.params.phase_inductance);

    state_.commutation_mode = kCommutationModeFOC;

    // adapter state reset
    speed_pi_ctx_ = PiContext{};
    speed_pi_params_.bias = 0;
    load_phase_start_time_ = 0;

    status_ = SimStatus::STOPPED;
    force_status_broadcast_ = true;
}

void SimulationController::start_thread() {
    if (thread_running_.exchange(true)) return;
    thread_ = std::thread([this] { thread_loop(); });
}

void SimulationController::stop_thread() {
    if (!thread_running_.exchange(false)) return;
    if (thread_.joinable()) thread_.join();
}

// --- commands -------------------------------------------------------------

void SimulationController::cmd_start() {
    std::lock_guard<std::mutex> lk(mtx_);
    if (status_ != SimStatus::RUNNING) {
        status_ = SimStatus::RUNNING;
        force_status_broadcast_ = true;
    }
}
void SimulationController::cmd_stop() {
    std::lock_guard<std::mutex> lk(mtx_);
    if (status_ != SimStatus::STOPPED) {
        status_ = SimStatus::STOPPED;
        force_status_broadcast_ = true;
    }
}
void SimulationController::cmd_pause() {
    std::lock_guard<std::mutex> lk(mtx_);
    if (status_ == SimStatus::RUNNING) {
        status_ = SimStatus::PAUSED;
        force_status_broadcast_ = true;
    }
}
void SimulationController::cmd_resume() { cmd_start(); }

void SimulationController::cmd_reset() {
    std::lock_guard<std::mutex> lk(mtx_);
    reset_state();
}

bool SimulationController::cmd_target_speed(double rpm) {
    if (!std::isfinite(rpm) || rpm < 0 || rpm > 100000) return false;
    std::lock_guard<std::mutex> lk(mtx_);
    target_speed_rads_ = rpm * kRadSPerRpm;
    return true;
}

bool SimulationController::cmd_target_torque(double nm) {
    if (!std::isfinite(nm) || std::abs(nm) > 1000) return false;
    std::lock_guard<std::mutex> lk(mtx_);
    target_torque_ = nm;
    return true;
}

bool SimulationController::cmd_control_mode(const std::string& mode) {
    if (mode != "speed" && mode != "torque") return false;
    std::lock_guard<std::mutex> lk(mtx_);
    speed_mode_ = (mode == "speed");
    speed_pi_ctx_ = PiContext{}; // clear integrator on mode switch
    return true;
}

bool SimulationController::cmd_speed_pi(double kp, double ki,
                                        double torque_limit) {
    if (!std::isfinite(kp) || !std::isfinite(ki) || kp < 0 || ki < 0 ||
        !std::isfinite(torque_limit) || torque_limit <= 0)
        return false;
    std::lock_guard<std::mutex> lk(mtx_);
    speed_pi_params_.p_gain = kp;
    speed_pi_params_.i_gain = ki;
    speed_pi_params_.bias = 0;
    speed_torque_limit_ = torque_limit;
    return true;
}

bool SimulationController::cmd_speed_scale(double scale) {
    if (!std::isfinite(scale) || scale < 1 || scale > 1000) return false;
    std::lock_guard<std::mutex> lk(mtx_);
    speed_scale_ = scale;
    return true;
}

bool SimulationController::cmd_load_configure(const LoadConfig& cfg) {
    if (cfg.mode != "manual" && cfg.mode != "periodic") return false;
    if (!std::isfinite(cfg.torque) || cfg.torque < 0 || cfg.torque > 1000)
        return false;
    if (cfg.mode == "periodic" &&
        (!std::isfinite(cfg.on_duration) || !std::isfinite(cfg.off_duration) ||
         cfg.on_duration <= 0 || cfg.off_duration <= 0))
        return false;
    std::lock_guard<std::mutex> lk(mtx_);
    load_ = cfg;
    // restart phase timing from the current simulation instant
    load_phase_start_time_ = state_.time;
    return true;
}

bool SimulationController::cmd_motor_parameter(const std::string& name,
                                               double value, std::string* err) {
    auto bad = [&](const std::string& msg) { *err = msg; return false; };
    if (!std::isfinite(value)) return bad("value must be finite");
    std::lock_guard<std::mutex> lk(mtx_);
    if (name == "bus_voltage") {
        if (value <= 0 || value > 1000) return bad("bus_voltage out of range");
        bus_voltage_ = value;
        state_.board.bus_voltage = value;
    } else if (name == "phase_resistance") {
        if (value <= 0 || value > 1e6) return bad("phase_resistance out of range");
        phase_resistance_ = value;
        state_.motor.params.phase_resistance = value;
        state_.foc.i_controller_params = make_motor_pi_params(
            10000, value, state_.motor.params.phase_inductance);
    } else if (name == "phase_inductance") {
        if (value <= 0 || value > 1e3) return bad("phase_inductance out of range");
        phase_inductance_ = value;
        state_.motor.params.phase_inductance = value;
        state_.foc.i_controller_params = make_motor_pi_params(
            10000, state_.motor.params.phase_resistance, value);
    } else if (name == "num_pole_pairs") {
        if (value < 1 || value > 100 || value != std::floor(value))
            return bad("num_pole_pairs must be an integer >= 1");
        num_pole_pairs_ = (int)value;
        state_.motor.params.num_pole_pairs = (int)value;
    } else if (name == "rotor_inertia") {
        if (value <= 0 || value > 1e6) return bad("rotor_inertia out of range");
        rotor_inertia_ = value;
        state_.motor.params.rotor_inertia = value;
    } else if (name == "bEmf0") {
        if (value <= 0 || value > 1e6) return bad("bEmf0 out of range");
        bEmf0_ = value;
        state_.motor.params.normed_bEmf_coeffs(0) = value;
    } else {
        return bad("unknown parameter: " + name);
    }
    return true;
}

// --- core stepping (mirrors upstream simulator.cpp FOC loop) --------------

void SimulationController::update_load() {
    // adapter: periodic load based on SIMULATION time (state.time).
    // Pause naturally freezes it because no steps are executed.
    //
    // NOTE on sign: upstream adds load_torque with a PLUS sign into the
    // mechanical equation (torque = i*dpsi + cogging + load_torque), i.e.
    // positive values DRIVE the rotor. A resistive load (MotorForge
    // semantics) must therefore be applied negated.
    if (!load_.enabled) {
        state_.load_torque = 0;
        return;
    }
    if (load_.mode == "manual") {
        state_.load_torque = -load_.torque;
        return;
    }
    const double period = load_.on_duration + load_.off_duration;
    const double phase_time =
        std::fmod(state_.time - load_phase_start_time_, period);
    const bool on = phase_time < load_.on_duration;
    state_.load_torque = on ? -load_.torque : 0.0;
}

void SimulationController::update_speed_loop() {
    // adapter: speed PI over upstream pi_control. Runs at the FOC rate
    // (state.foc.period), output clamped to +/- speed_torque_limit_ with
    // upstream's own anti-windup back-calculation.
    if (speed_mode_) {
        const Scalar target = target_speed_rads_;
        const Scalar actual = state_.motor.kinematic.rotor_angular_vel;
        Scalar torque = pi_control(speed_pi_params_, &speed_pi_ctx_,
                                   state_.foc.period, actual, target);
        if (torque > speed_torque_limit_) {
            pi_unwind(speed_pi_params_, speed_torque_limit_, &speed_pi_ctx_);
            torque = speed_torque_limit_;
        } else if (torque < -speed_torque_limit_) {
            pi_unwind(speed_pi_params_, -speed_torque_limit_, &speed_pi_ctx_);
            torque = -speed_torque_limit_;
        }
        state_.foc_desired_torque = torque;
        target_torque_ = torque;
    } else {
        state_.foc_desired_torque = target_torque_;
    }
}

void SimulationController::step_one() {
    // ---- verbatim structure of upstream simulator.cpp main loop (FOC) ----
    const bool new_pwm_cycle = step_pwm_state(state_.dt, &state_.board.pwm);

    std::array<bool, 3> gate_command = {};

    if (state_.commutation_mode == kCommutationModeManual) {
        gate_command = state_.board.gate.commanded;
    }

    if (state_.commutation_mode == kCommutationModeSixStep) {
        gate_command = six_step_commutate(
            get_electrical_angle(state_.motor.params.num_pole_pairs,
                                 state_.motor.kinematic.rotor_angle),
            state_.six_step_phase_advance);
    }

    if (state_.commutation_mode == kCommutationModeFOC) {
        if (periodic_timer(state_.foc.period, state_.dt, &state_.foc.timer)) {
            // adapter: speed loop feeds the upstream torque input
            update_speed_loop();

            // upstream: (cogging compensation disabled in V1; map is zero)
            const Scalar desired_torque = state_.foc_desired_torque;

            const std::complex<Scalar> desired_current_qd =
                get_desired_current_qd(
                    desired_torque,
                    state_.motor.params.normed_bEmf_coeffs(0));

            step_foc_current_controller(desired_current_qd, state_.motor,
                                        &state_.foc);

            // upstream anti-windup (verbatim)
            const Scalar voltage_qd_norm = std::abs(state_.foc.voltage_qd);
            if (voltage_qd_norm >
                state_.board.bus_voltage * kClarkeScale) {
                const std::complex<Scalar> voltage_qd_saturation =
                    state_.foc.voltage_qd *
                    (state_.board.bus_voltage * kClarkeScale /
                     voltage_qd_norm);
                pi_unwind(state_.foc.i_controller_params,
                          voltage_qd_saturation.real(),
                          &state_.foc.iq_controller);
                pi_unwind(state_.foc.i_controller_params,
                          voltage_qd_saturation.imag(),
                          &state_.foc.id_controller);
            }
        }

        // assert the requested qd voltage with PWM (upstream verbatim)
        if (new_pwm_cycle) {
            const std::complex<Scalar> inv_park_transform =
                get_rotation(get_q_axis_electrical_angle(
                    state_.motor.params.num_pole_pairs,
                    state_.motor.kinematic.rotor_angle));

            std::complex<Scalar> voltage_ab =
                inv_park_transform * state_.foc.voltage_qd;

            // (qd decoupling off, matches upstream defaults)

            state_.board.pwm.duties =
                get_pwm_duties(state_.board.bus_voltage, voltage_ab);
        }

        gate_command = get_pwm_gate_command(state_.board.pwm);
    }

    state_.board.gate.commanded = gate_command;
    update_gate_state(state_.dt, &state_.board.gate);

    const auto pole_voltages = get_pole_voltages(
        state_.board.bus_voltage, state_.motor.electrical.phase_currents,
        state_.board.gate);

    update_load(); // adapter: sim-time based load before mechanical step

    step_motor(state_.dt, state_.load_torque, pole_voltages, &state_.motor);

    state_.time += state_.dt;
}

// --- snapshot --------------------------------------------------------------

void SimulationController::make_snapshot_locked(Snapshot* s) const {
    s->status = status_;
    s->time = state_.time;

    const auto& kin = state_.motor.kinematic;
    const auto& elec = state_.motor.electrical;
    s->rotor_angle = kin.rotor_angle;
    s->rotor_angular_vel = kin.rotor_angular_vel;
    s->electrical_angle = get_electrical_angle(
        state_.motor.params.num_pole_pairs, kin.rotor_angle);
    s->total_torque = kin.torque;
    // electromagnetic torque = i . (d flux / d theta), both upstream fields
    s->em_torque = elec.phase_currents.dot(elec.normed_bEmfs);
    // Sign convention: state_.load_torque holds the value injected into the
    // upstream mechanical equation (negative = resisting, see update_load).
    // The snapshot reports the load as a positive resistance magnitude so the
    // client sees "0.1 Nm load applied" for load.configure torque=0.1.
    s->load_torque = -state_.load_torque;

    for (int i = 0; i < 3; ++i) {
        s->phase_currents[i] = elec.phase_currents(i);
        s->bEmfs[i] = elec.bEmfs(i);
    }

    // dq currents via the same upstream primitives used inside foc.cpp
    const Scalar q_axis_angle = get_q_axis_electrical_angle(
        state_.motor.params.num_pole_pairs, kin.rotor_angle);
    const std::complex<Scalar> park = get_rotation(-q_axis_angle);
    const std::complex<Scalar> current_qd =
        park * clarke_transform(elec.phase_currents);
    s->iq = current_qd.real();
    s->id = current_qd.imag();
    s->vq = state_.foc.voltage_qd.real();
    s->vd = state_.foc.voltage_qd.imag();

    s->target_speed = target_speed_rads_;
    s->speed_error = target_speed_rads_ - kin.rotor_angular_vel;
    s->target_torque = target_torque_;
    s->target_iq = get_desired_current_qd(
        state_.foc_desired_torque,
        state_.motor.params.normed_bEmf_coeffs(0)).real();
    s->target_id = 0;
    s->iq_err = state_.foc.iq_controller.err;
    s->id_err = state_.foc.id_controller.err;
    s->speed_mode = speed_mode_;

    s->pwm_duties = state_.board.pwm.duties;
    s->bus_voltage = state_.board.bus_voltage;

    // load controller reporting
    s->load_enabled = load_.enabled;
    s->load_mode = load_.mode;
    s->load_torque_setting = load_.torque;
    s->load_on_duration = load_.on_duration;
    s->load_off_duration = load_.off_duration;
    if (load_.enabled && load_.mode == "periodic") {
        const double period = load_.on_duration + load_.off_duration;
        double phase_time =
            std::fmod(state_.time - load_phase_start_time_, period);
        if (phase_time < 0) phase_time += period;
        const bool on = phase_time < load_.on_duration;
        s->load_phase = on ? "on" : "off";
        s->load_phase_time = phase_time;
        s->load_phase_remaining =
            on ? load_.on_duration - phase_time : period - phase_time;
    } else {
        s->load_phase = "off";
        s->load_phase_time = 0;
        s->load_phase_remaining = 0;
    }

    s->num_pole_pairs = state_.motor.params.num_pole_pairs;
    s->phase_resistance = state_.motor.params.phase_resistance;
    s->phase_inductance = state_.motor.params.phase_inductance;
    s->rotor_inertia = state_.motor.params.rotor_inertia;
    s->bEmf0 = state_.motor.params.normed_bEmf_coeffs(0);
    s->dt = state_.dt;
    s->speed_scale = speed_scale_;
}

void SimulationController::broadcast_status_locked() {
    if (!force_status_broadcast_ && status_ == last_broadcast_status_) return;
    if (broadcast_) broadcast_(json::status_message(status_));
    last_broadcast_status_ = status_;
    force_status_broadcast_ = false;
}

Snapshot SimulationController::latest_snapshot() {
    std::lock_guard<std::mutex> lk(mtx_);
    Snapshot s;
    make_snapshot_locked(&s);
    return s;
}

// --- realtime thread --------------------------------------------------------

void SimulationController::thread_loop() {
    HighResSleep sleep_helper;
    auto last = std::chrono::steady_clock::now();
    auto last_state_push = last;
    while (thread_running_.load()) {
        sleep_helper.sleep_ms(2.0);
        auto now = std::chrono::steady_clock::now();
        const double wall_sec =
            std::chrono::duration<double>(now - last).count();
        last = now;

        {
            std::lock_guard<std::mutex> lk(mtx_);
            if (status_ == SimStatus::RUNNING) {
                double sim_steps =
                    wall_sec * speed_scale_ / state_.dt;
                if (sim_steps > kMaxStepsPerTick) sim_steps = kMaxStepsPerTick;
                const int steps = (int)sim_steps;
                for (int i = 0; i < steps; ++i) step_one();
            }
            broadcast_status_locked();
            // push state every ~20 ms of wall time (50 Hz) regardless of
            // pause so the client sees timestamps stop advancing (E2E-10).
            const double since_push =
                std::chrono::duration<double>(now - last_state_push).count();
            if (since_push >= 0.02) {
                last_state_push = now;
                Snapshot s;
                make_snapshot_locked(&s);
                if (broadcast_) broadcast_(json::state_message(s));
            }
        }
    }
}
