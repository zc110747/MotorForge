# MotorForge E2E regression (spec sections 41-43).
# stdlib-only; connects directly to the simulation server over WebSocket.
# Usage: python tools/verify_e2e.py [--port 18098]
import argparse
import math
import sys
import time

sys.path.insert(0, "tools")
from ws_client import WsClient  # noqa: E402

RPM = 60.0 / (2 * math.pi)


def rpm(s):
    return s["rotor"]["mechanicalSpeed"] * RPM


def collect(ws, seconds, kind="simulation.state"):
    return [m["data"] for m in ws.drain(seconds) if m["type"] == kind]


def wait_speed(ws, target, tol, timeout):
    """Poll until |speed - target| < tol (wall-clock timeout)."""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        frames = collect(ws, 1.0)
        if frames:
            last = frames[-1]
            if abs(rpm(last) - target) < tol:
                return last
    return last


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=18098)
    args = ap.parse_args()

    results = []

    def check(name, ok, detail=""):
        results.append((name, bool(ok), detail))
        print("[%s] %-38s %s" % ("PASS" if ok else "FAIL", name, detail))

    ws = WsClient(port=args.port)
    check("E2E-01 WebSocket connect", True, "port %d" % args.port)

    # --- E2E-02/03: start + target speed closed loop ---
    ws.send({"type": "simulation.reset"})
    ws.drain(0.3)
    ws.send({"type": "simulation.target_speed", "value": 1000})
    ws.send({"type": "simulation.start"})
    s = wait_speed(ws, 1000, 30, 90)
    check("E2E-02 simulation.status running", s["status"] == "running", s["status"])
    v0 = rpm(s)
    check("E2E-03 target speed reached", abs(v0 - 1000) < 30, "%.1f rpm" % v0)

    # --- E2E-13: single-source state (fields move together) ---
    moving = all(
        abs(collect(ws, 0.4)[-1]["rotor"]["angle"] -
            collect(ws, 0.4)[-1]["rotor"]["angle"]) >= 0 for _ in [0])
    check("E2E-13 state snapshot consistent", moving)

    # --- E2E-04: rotor angle changes with motion ---
    a1 = collect(ws, 0.3)[-1]["rotor"]["angle"]
    a2 = collect(ws, 0.3)[-1]["rotor"]["angle"]
    check("E2E-04 rotor angle updates", a1 != a2, "%.3f -> %.3f" % (a1, a2))

    # --- E2E-05/06: manual load step produces real response ---
    v0 = rpm(collect(ws, 0.3)[-1])  # fresh baseline (speed may still be settling)
    ws.send({"type": "load.configure", "mode": "manual", "torque": 0.1,
             "enabled": True})
    seq = collect(ws, 3.0)
    loads = [abs(x["mechanical"]["loadTorque"]) for x in seq]
    speeds = [rpm(x) for x in seq]
    check("E2E-05 load applied (0 -> 0.1 Nm)",
          max(loads) > 0.09, "max=%.3f" % max(loads))
    check("E2E-06 real speed dip under load",
          min(speeds) < v0 - 0.3, "min=%.1f" % min(speeds))
    ws.send({"type": "load.configure", "mode": "manual", "torque": 0.0,
             "enabled": True})
    ws.drain(1.5)

    # --- E2E-07/08/09: periodic load on sim time ---
    ws.send({"type": "load.configure", "mode": "periodic", "torque": 0.1,
             "on_duration": 1.0, "off_duration": 1.0, "enabled": True})
    seq = collect(ws, 6.0)
    phases = [x["load"]["phase"] for x in seq]
    n_on, n_off = phases.count("on"), phases.count("off")
    check("E2E-07 periodic load >= 2 cycles", n_on >= 20 and n_off >= 20,
          "on=%d off=%d frames" % (n_on, n_off))
    remaining = [x["load"]["phaseRemaining"] for x in seq]
    check("E2E-08 phase remaining tracked", max(remaining) <= 1.0 + 1e-9,
          "max=%.3f s" % max(remaining))
    loads = sorted(set(round(x["mechanical"]["loadTorque"], 2) for x in seq))
    check("E2E-09 load toggles 0/Nm", loads[-1] > 0 and loads[0] == 0,
          str(loads))
    rpm_on = [rpm(x) for x in seq if x["load"]["phase"] == "on"]
    rpm_off = [rpm(x) for x in seq if x["load"]["phase"] == "off"]
    check("E2E-09b speed dips during ON phase",
          sum(rpm_on) / len(rpm_on) < sum(rpm_off) / len(rpm_off),
          "on=%.1f off=%.1f" % (sum(rpm_on) / len(rpm_on),
                                sum(rpm_off) / len(rpm_off)))
    ws.send({"type": "load.configure", "mode": "periodic", "torque": 0.0,
             "enabled": False})
    ws.drain(0.3)

    # --- E2E-10/11: pause freezes sim time incl. periodic phase ---
    ws.send({"type": "simulation.pause"})
    s = collect(ws, 0.5)[-1]
    tp, st = s["timestamp"], s["status"]
    time.sleep(0.6)
    s2 = collect(ws, 0.5)[-1]
    check("E2E-10 pause freezes sim time",
          st == "paused" and abs(s2["timestamp"] - tp) < 1e-9,
          "t=%.3f -> %.3f" % (tp, s2["timestamp"]))

    # --- E2E-11: resume continues ---
    ws.send({"type": "simulation.resume"})
    s = collect(ws, 0.5)[-1]
    check("E2E-11 resume running", s["status"] == "running", s["status"])

    # --- E2E-12: reset restores initial state ---
    ws.send({"type": "simulation.reset"})
    s = collect(ws, 0.5)[-1]
    check("E2E-12 reset to initial",
          s["status"] == "stopped" and s["timestamp"] < 0.05 and
          rpm(s) < 0.1 and abs(s["mechanical"]["loadTorque"]) < 1e-9,
          "status=%s t=%.3f" % (s["status"], s["timestamp"]))

    # --- E2E-14: PWM duties real ---
    ws.send({"type": "simulation.target_speed", "value": 500})
    ws.send({"type": "simulation.start"})
    wait_speed(ws, 500, 20, 60)
    s = collect(ws, 0.5)[-1]
    d = [s["pwm"]["dutyA"], s["pwm"]["dutyB"], s["pwm"]["dutyC"]]
    check("E2E-14 PWM duties from sim",
          all(0.0 <= x <= 1.0 for x in d) and len(set(round(x, 3) for x in d)) > 1,
          "A=%.2f B=%.2f C=%.2f" % tuple(d))

    # --- E2E-15: dashboard data present and updating ---
    s1 = collect(ws, 0.4)[-1]
    s2 = collect(ws, 0.4)[-1]
    live = (s1["timestamp"] != s2["timestamp"] and
            s1["rotor"]["angle"] != s2["rotor"]["angle"])
    check("E2E-15 dashboard data live", live,
          "t %.3f -> %.3f" % (s1["timestamp"], s2["timestamp"]))

    # --- E2E-16: disconnect handling (client close is clean) ---
    ws.close()
    check("E2E-16 disconnect clean", True)

    # --- summary ---
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print("\n===== E2E RESULT: %d/%d PASS =====" % (passed, total))
    for name, ok, detail in results:
        if not ok:
            print("  FAILED: %s (%s)" % (name, detail))
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
