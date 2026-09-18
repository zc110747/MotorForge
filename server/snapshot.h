#pragma once
// Simulation snapshot: a POD-ish copy of the upstream SimState taken at a
// single simulation instant. All numbers are SI units exactly as upstream
// stores them (rad, rad/s, A, N*m, V, duty 0..1). JSON serialization adds
// only derived display units (rpm, deg) computed from these raw values.
#include "config/scalar.h"
#include <array>
#include <complex>
#include <string>

enum class SimStatus { STOPPED, RUNNING, PAUSED };

struct Snapshot {
    SimStatus status = SimStatus::STOPPED;

    // time
    double time = 0; // simulation time, sec

    // rotor (upstream: MotorKinematicState)
    double rotor_angle = 0;          // rad, [0, 2*pi)
    double rotor_angular_vel = 0;    // rad/s (mechanical)
    double electrical_angle = 0;     // rad, [0, 2*pi)
    double total_torque = 0;         // N*m, kinematic.torque (includes load)
    double em_torque = 0;            // N*m, electromagnetic (i . dpsi/dtheta)
    double load_torque = 0;          // N*m, applied mechanical load

    // electrical (upstream: MotorElectricalState)
    std::array<double, 3> phase_currents = {}; // A
    std::array<double, 3> bEmfs = {};          // V

    // dq quantities (derived with upstream clarke/park primitives, same
    // expression as controls/foc.cpp step_foc_current_controller)
    double iq = 0; // A
    double id = 0; // A
    double vd = 0; // V (foc.voltage_qd.imag())
    double vq = 0; // V (foc.voltage_qd.real())

    // control (adapter speed PID + upstream FOC)
    double target_speed = 0;    // rad/s
    double speed_error = 0;     // rad/s
    double speed_kp = 0;        // V1.1: speed loop Kp (adapter)
    double speed_ki = 0;        // V1.1: speed loop Ki (adapter)
    double speed_kd = 0;        // V1.1: speed loop Kd (adapter)
    double target_torque = 0;   // N*m (speed loop output or manual torque)
    double target_iq = 0;       // A  (get_desired_current_qd output)
    double target_id = 0;       // A
    double iq_err = 0;          // A  (upstream foc.iq_controller.err)
    double id_err = 0;          // A
    bool speed_mode = true;

    // pwm (upstream: PwmState)
    std::array<double, 3> pwm_duties = {}; // 0..1
    double bus_voltage = 24;               // V

    // load controller state (adapter)
    bool load_enabled = false;
    std::string load_mode = "manual"; // "manual" | "periodic"
    double load_torque_setting = 0;   // N*m
    double load_on_duration = 1;      // s
    double load_off_duration = 1;     // s
    std::string load_phase = "off";   // "on" | "off" (periodic only)
    double load_phase_time = 0;       // s
    double load_phase_remaining = 0;  // s

    // motor params (for dashboard)
    int num_pole_pairs = 4;
    double phase_resistance = 1.0; // ohm
    double phase_inductance = 1e-3; // H
    double rotor_inertia = 0.1;     // kg*m^2
    double bEmf0 = 0.01;            // N*m/A (normed_bEmf_coeffs(0))
    double dt = 1e-6;               // s (read-only, upstream fixed)
    double speed_scale = 2;         // adapter: sim seconds per wall second
    double load_max_torque = 0;     // N*m, actuator capability at 100 rad/s (V1.2)
};

// --- JSON writer helpers (shared by state/status/load messages) ---
namespace json {

inline void esc(const std::string& s, std::string* out) {
    for (char c : s) {
        switch (c) {
        case '"': *out += "\\\""; break;
        case '\\': *out += "\\\\"; break;
        case '\n': *out += "\\n"; break;
        case '\r': *out += "\\r"; break;
        case '\t': *out += "\\t"; break;
        default:
            if ((unsigned char)c < 0x20) {
                char buf[8];
                snprintf(buf, sizeof(buf), "\\u%04x", c);
                *out += buf;
            } else {
                *out += c;
            }
        }
    }
}

inline void num(double v, std::string* out) {
    char buf[32];
    snprintf(buf, sizeof(buf), "%.9g", v);
    *out += buf;
}

inline void kv_num(const char* key, double v, std::string* out, bool comma) {
    if (comma) *out += ',';
    *out += '"'; *out += key; *out += "\":";
    num(v, out);
}

inline void kv_int(const char* key, long long v, std::string* out, bool comma) {
    if (comma) *out += ',';
    char buf[32];
    snprintf(buf, sizeof(buf), "\"%s\":%lld", key, v);
    *out += buf;
}

inline void kv_str(const char* key, const std::string& v, std::string* out,
                   bool comma) {
    if (comma) *out += ',';
    *out += '"'; *out += key; *out += "\":\"";
    esc(v, out);
    *out += '"';
}

inline void kv_bool(const char* key, bool v, std::string* out, bool comma) {
    if (comma) *out += ',';
    *out += '"'; *out += key; *out += "\":";
    *out += v ? "true" : "false";
}

// Serialize a full simulation.state message from the snapshot.
inline std::string state_message(const Snapshot& s) {
    std::string o = "{\"type\":\"simulation.state\",\"data\":{";
    kv_num("timestamp", s.time, &o, false);
    o += ",\"status\":\"" +
         std::string(s.status == SimStatus::RUNNING ? "running"
                     : s.status == SimStatus::PAUSED ? "paused" : "stopped") +
         "\"";
    o += ",\"rotor\":{";
    kv_num("angle", s.rotor_angle, &o, false);
    kv_num("mechanicalSpeed", s.rotor_angular_vel, &o, true);
    kv_num("electricalAngle", s.electrical_angle, &o, true);
    o += "}";
    o += ",\"electrical\":{";
    kv_num("phaseA", s.phase_currents[0], &o, false);
    kv_num("phaseB", s.phase_currents[1], &o, true);
    kv_num("phaseC", s.phase_currents[2], &o, true);
    kv_num("bEmfA", s.bEmfs[0], &o, true);
    kv_num("bEmfB", s.bEmfs[1], &o, true);
    kv_num("bEmfC", s.bEmfs[2], &o, true);
    kv_num("id", s.id, &o, true);
    kv_num("iq", s.iq, &o, true);
    kv_num("vd", s.vd, &o, true);
    kv_num("vq", s.vq, &o, true);
    o += "}";
    o += ",\"mechanical\":{";
    kv_num("torque", s.total_torque, &o, false);
    kv_num("emTorque", s.em_torque, &o, true);
    kv_num("loadTorque", s.load_torque, &o, true);
    o += "}";
    o += ",\"control\":{";
    kv_num("targetSpeed", s.target_speed, &o, false);
    kv_num("speedError", s.speed_error, &o, true);
    kv_num("speedKp", s.speed_kp, &o, true);
    kv_num("speedKi", s.speed_ki, &o, true);
    kv_num("speedKd", s.speed_kd, &o, true);
    kv_num("targetTorque", s.target_torque, &o, true);
    kv_num("targetIq", s.target_iq, &o, true);
    kv_num("targetId", s.target_id, &o, true);
    kv_num("iqErr", s.iq_err, &o, true);
    kv_num("idErr", s.id_err, &o, true);
    kv_bool("speedMode", s.speed_mode, &o, true);
    o += "}";
    o += ",\"pwm\":{";
    kv_num("dutyA", s.pwm_duties[0], &o, false);
    kv_num("dutyB", s.pwm_duties[1], &o, true);
    kv_num("dutyC", s.pwm_duties[2], &o, true);
    kv_num("busVoltage", s.bus_voltage, &o, true);
    o += "}";
    o += ",\"load\":{";
    kv_bool("enabled", s.load_enabled, &o, false);
    kv_str("mode", s.load_mode, &o, true);
    kv_num("torque", s.load_torque_setting, &o, true);
    kv_num("onDuration", s.load_on_duration, &o, true);
    kv_num("offDuration", s.load_off_duration, &o, true);
    kv_str("phase", s.load_phase, &o, true);
    kv_num("phaseTime", s.load_phase_time, &o, true);
    kv_num("phaseRemaining", s.load_phase_remaining, &o, true);
    o += "}";
    o += ",\"params\":{";
    kv_int("numPolePairs", s.num_pole_pairs, &o, false);
    kv_num("phaseResistance", s.phase_resistance, &o, true);
    kv_num("phaseInductance", s.phase_inductance, &o, true);
    kv_num("rotorInertia", s.rotor_inertia, &o, true);
    kv_num("bEmf0", s.bEmf0, &o, true);
    kv_num("busVoltage", s.bus_voltage, &o, true);
    kv_num("dt", s.dt, &o, true);
    kv_num("loadMaxTorque", s.load_max_torque, &o, true);
    o += "}";
    o += "}}";
    return o;
}

inline std::string status_message(SimStatus status) {
    std::string o = "{\"type\":\"simulation.status\",\"status\":\"";
    o += (status == SimStatus::RUNNING ? "running"
          : status == SimStatus::PAUSED ? "paused" : "stopped");
    o += "\"}";
    return o;
}

} // namespace json
