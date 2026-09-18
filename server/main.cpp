// MotorForge simulation server (adapter layer over markisus/motor_sim).
// Usage: motorforge_server.exe [--host 127.0.0.1] [--port 8080]
#include "mini_json.h"
#include "simulation_controller.h"
#include "ws_server.h"

#include <atomic>

#include <chrono>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>

#ifdef _WIN32
#include <windows.h>
#include <timeapi.h>
#endif

namespace {
// Windows default timer resolution is ~15.6 ms; raise it so the 2 ms
// simulation pacing tick and 4 ms tx poll are not quantized to 15.6 ms.
// (link with -lwinmm)
struct TimerResolution {
    TimerResolution() { timeBeginPeriod(1); }
    ~TimerResolution() { timeEndPeriod(1); }
};
} // namespace

namespace {

void send_error(WsServer& ws, uint64_t client, const std::string& msg) {
    std::string out = "{\"type\":\"simulation.error\",\"message\":\"";
    json::esc(msg, &out);
    out += "\"}";
    ws.send_text(client, out);
}

void handle_text(WsServer& ws, SimulationController& sim, uint64_t client,
                 const std::string& text) {
    mj::Value v;
    if (!mj::parse(text, &v) || v.type != mj::Value::OBJ) {
        send_error(ws, client, "invalid JSON message");
        return;
    }
    const std::string type = v.get_str("type", "");

    if (type == "simulation.start") {
        sim.cmd_start();
    } else if (type == "simulation.stop") {
        sim.cmd_stop();
    } else if (type == "simulation.pause") {
        sim.cmd_pause();
    } else if (type == "simulation.resume") {
        sim.cmd_resume();
    } else if (type == "simulation.reset") {
        sim.cmd_reset();
    } else if (type == "simulation.target_speed") {
        const double value = v.get_num("value", -1);
        if (!sim.cmd_target_speed(value)) {
            send_error(ws, client, "target_speed value out of range: " +
                                       std::to_string(value));
        }
    } else if (type == "simulation.target_torque") {
        const double value = v.get_num("value", 0);
        if (!sim.cmd_target_torque(value))
            send_error(ws, client, "target_torque value out of range");
    } else if (type == "simulation.control_mode") {
        const std::string mode = v.get_str("mode", "");
        if (!sim.cmd_control_mode(mode))
            send_error(ws, client, "control_mode must be 'speed' or 'torque'");
    } else if (type == "simulation.speed_pi") {
        const double kp = v.get_num("kp", -1);
        const double ki = v.get_num("ki", -1);
        const double kd = v.get_num("kd", 0); // V1.1: optional, default off
        const double limit = v.get_num("torque_limit", -1);
        if (!sim.cmd_speed_pi(kp, ki, kd, limit))
            send_error(ws, client, "speed_pi parameters invalid");
    } else if (type == "simulation.speed_scale") {
        const double value = v.get_num("value", 0);
        if (!sim.cmd_speed_scale(value))
            send_error(ws, client, "speed_scale must be in [1, 1000]");
    } else if (type == "load.configure") {
        SimulationController::LoadConfig cfg;
        cfg.mode = v.get_str("mode", "manual");
        cfg.torque = v.get_num("torque", 0);
        cfg.on_duration = v.get_num("on_duration", 1);
        cfg.off_duration = v.get_num("off_duration", 1);
        cfg.enabled = v.get_bool("enabled", false);
        if (!sim.cmd_load_configure(cfg))
            send_error(ws, client, "load.configure parameters invalid");
    } else if (type == "motor.parameter") {
        const std::string name = v.get_str("name", "");
        const double value = v.get_num("value", 0);
        std::string err;
        if (!sim.cmd_motor_parameter(name, value, &err))
            send_error(ws, client, err);
    } else if (type == "ping") {
        // no-op, client-side liveness check
    } else {
        send_error(ws, client, "unknown message type: " + type);
    }
}

} // namespace

int main(int argc, char** argv) {
    std::string host = "127.0.0.1";
    uint16_t port = 8080;
    for (int i = 1; i + 1 < argc; i += 2) {
        if (strcmp(argv[i], "--host") == 0) host = argv[i + 1];
        else if (strcmp(argv[i], "--port") == 0) port = (uint16_t)atoi(argv[i + 1]);
    }

    printf("MotorForge simulation server (upstream: markisus/motor_sim)\n");
    printf("  dt=1e-6 s (1 MHz, upstream fixed), FOC 10 kHz, PWM 15 kHz\n");

    SimulationController sim([](const std::string&) { /* set below */ });

    WsServer ws(
        [&](uint64_t client, const std::string& text) {
            handle_text(ws, sim, client, text);
        },
        [](uint64_t) {});

    // wire broadcast now that both objects exist
    sim.set_broadcast([&](const std::string& msg) { ws.broadcast(msg); });

    if (!ws.start(host, port)) {
        fprintf(stderr, "FATAL: %s\n", ws.last_error().c_str());
        return 1;
    }
    printf("WebSocket listening on ws://%s:%u/ws\n", host.c_str(), port);
    sim.start_thread();

    printf("Press Ctrl+C to quit.\n");
    for (;;) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
    }
    return 0;
}
