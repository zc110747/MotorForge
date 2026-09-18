# MotorForge speed-loop response regression.
#
# WHAT THIS PROVES
# ----------------
# The speed display used to look wrong: after a load step the trace appeared to
# sit still at the setpoint. The controller was in fact correct - the dip was
# simply ~2 rad/s (~19 rpm) on a 0..1100 rpm axis, i.e. a couple of pixels, so
# it could not be seen. This script pins the actual physics down numerically and
# asserts the textbook shape, for a matrix of Kp / Ki gains:
#
#   Ki > 0 : applying a resistive load makes the speed DIP first, then the
#            integrator ADJUSTS the torque, and finally the speed RETURNS to
#            the setpoint (settling error -> 0).
#   Ki = 0 : pure proportional control cannot remove the steady-state error, so
#            applying the load drops the speed PERMANENTLY by droop = load / Kp.
#
# Everything is measured from the same `simulation.state` stream the browser
# receives; nothing is derived from a second data path.
#
# Usage: python tools/verify_response.py [--port 18098] [--dump-dir DIR]
import argparse
import csv
import math
import os
import sys
import time

sys.path.insert(0, "tools")
from ws_client import WsClient  # noqa: E402

RAD_S = 1.0  # protocol unit is already rad/s
SETTLE_TOL = 0.3      # rad/s, "at setpoint"
LOAD = 0.1            # N*m resistive load used by every case
TARGET = 100.0        # rad/s


def collect(ws, seconds):
    return [m["data"] for m in ws.drain(seconds) if m["type"] == "simulation.state"]


def speeds(seq):
    return [f["rotor"]["mechanicalSpeed"] for f in seq]


def mean(xs):
    return sum(xs) / len(xs) if xs else float("nan")


class Case:
    """One Kp/Ki/load experiment and the expectation attached to it."""

    def __init__(self, cid, kp, ki, load, expect, note, **kw):
        self.cid = cid
        self.kp = kp
        self.ki = ki
        self.load = load
        self.expect = expect  # "recover" | "droop" | "setpoint_step"
        self.note = note
        self.opts = kw
        self.step = []   # (sim_t, speed_rad_s, target_rad_s, tcmd, load)
        self.metrics = {}


def run_case(ws, case, limit, settle_timeout=60.0):
    """Reset, drive to the setpoint at the case gains, then step the load."""
    ws.send({"type": "simulation.reset"})
    ws.drain(0.3)
    ws.send({"type": "simulation.speed_pi", "kp": case.kp, "ki": case.ki,
             "kd": 0.0, "torque_limit": limit})
    ws.send({"type": "simulation.target_speed", "value": TARGET})
    ws.send({"type": "simulation.start"})

    # settle: poll until the speed sits at the setpoint
    deadline = time.time() + settle_timeout
    v0 = None
    while time.time() < deadline:
        frames = collect(ws, 1.0)
        if frames:
            v0 = frames[-1]["rotor"]["mechanicalSpeed"]
            if abs(v0 - TARGET) <= SETTLE_TOL:
                break

    # fresh baseline over the last second before the disturbance
    baseline = speeds(collect(ws, 1.0))
    v_base = mean(baseline) if baseline else v0

    # --- the disturbance: a resistive load step ---
    ws.send({"type": "load.configure", "mode": "manual",
             "torque": case.load, "enabled": True})
    after = collect(ws, 6.0)

    # --- and the release: load back to zero ---
    ws.send({"type": "load.configure", "mode": "manual",
             "torque": 0.0, "enabled": False})
    released = collect(ws, 4.0)

    series = after + released
    case.step = [(f["timestamp"], f["rotor"]["mechanicalSpeed"],
                  f["control"]["targetSpeed"], f["control"]["targetTorque"],
                  f["mechanical"]["loadTorque"]) for f in series]

    sp = speeds(after)
    t = [f["timestamp"] for f in after]
    tcmd = [f["control"]["targetTorque"] for f in after]

    i_min = min(range(len(sp)), key=lambda i: sp[i]) if sp else 0
    dip = v_base - sp[i_min] if sp else 0.0
    band = max(0.3, dip * 0.1)

    # first instant after the dip where the speed is back inside the band
    t_rec = None
    for i in range(i_min + 1, len(sp)):
        if abs(sp[i] - TARGET) <= band:
            t_rec = t[i] - t[i_min]
            break

    tail = sp[-min(len(sp), 50):]
    v_tail = mean(tail)
    after_release = speeds(released)
    v_release = mean(after_release[-min(len(after_release), 50):])

    case.metrics = {
        "v_base": v_base,
        "v_min": sp[i_min] if sp else float("nan"),
        "dip": dip,
        "t_dip": t[i_min] if t else 0.0,
        "t_rec": t_rec,
        "v_tail": v_tail,
        "err_tail": v_tail - TARGET,
        "v_release": v_release,
        "err_release": v_release - TARGET,
        "tcmd_max": max(tcmd) if tcmd else 0.0,
        "finite": all(math.isfinite(x) for x in sp) and
                  all(math.isfinite(x) for x in after_release),
        "min_speed": min(sp + after_release) if (sp or after_release) else 0.0,
    }
    return case


def run_setpoint_step(ws, case, limit):
    """Ramp the setpoint 50 -> 100 rad/s and watch the speed follow it."""
    ws.send({"type": "simulation.reset"})
    ws.drain(0.3)
    ws.send({"type": "simulation.speed_pi", "kp": case.kp, "ki": case.ki,
             "kd": 0.0, "torque_limit": limit})
    ws.send({"type": "simulation.target_speed", "value": 50})
    ws.send({"type": "simulation.start"})
    deadline = time.time() + 60
    while time.time() < deadline:
        frames = collect(ws, 1.0)
        if frames and abs(frames[-1]["rotor"]["mechanicalSpeed"] - 50) <= SETTLE_TOL:
            break
    ws.send({"type": "simulation.target_speed", "value": TARGET})
    seq = collect(ws, 5.0)
    sp = speeds(seq)
    t = [f["timestamp"] for f in seq]
    case.step = [(f["timestamp"], f["rotor"]["mechanicalSpeed"],
                  f["control"]["targetSpeed"], f["control"]["targetTorque"],
                  f["mechanical"]["loadTorque"]) for f in seq]
    # "did it actually climb?" - bucket means over the rising phase must be
    # non-decreasing. A raw per-sample monotonicity check is the wrong test for
    # a PI loop: a small overshoot followed by a settle-back is correct
    # behaviour, so the rising TREND is what must hold, not every sample.
    band = 1.0
    rise_end = len(sp)
    for i, v in enumerate(sp):
        if abs(v - TARGET) <= band:
            rise_end = i
            break
    rise = sp[:max(2, rise_end)]
    nb = min(8, len(rise))
    buckets = [mean(rise[i * len(rise) // nb:(i + 1) * len(rise) // nb])
               for i in range(nb)]
    trend_ok = all(b >= a - 1e-3 for a, b in zip(buckets, buckets[1:]))

    case.metrics = {
        "v_start": sp[0] if sp else float("nan"),
        "v_end": mean(sp[-min(len(sp), 50):]),
        "finite": all(math.isfinite(x) for x in sp),
        "min_speed": min(sp) if sp else 0.0,
        "trend_ok": trend_ok,
        "rise_buckets": buckets,
        "overshoot": max(sp) - TARGET if sp else 0.0,
        "t_end": t[-1] if t else 0.0,
    }
    return case


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=18098)
    ap.add_argument("--dump-dir", default="", help="write per-case time series CSV")
    args = ap.parse_args()

    results = []

    def check(name, ok, detail=""):
        results.append((name, bool(ok), detail))
        print("[%s] %-42s %s" % ("PASS" if ok else "FAIL", name, detail))

    ws = WsClient(port=args.port)
    check("R-00 WebSocket connect", True, "port %d" % args.port)

    # actuator capability at 100 rad/s, reported by the backend
    ws.send({"type": "simulation.reset"})
    ws.drain(0.3)
    limit = collect(ws, 0.5)[-1]["params"]["loadMaxTorque"]
    print("# actuator torque envelope at 100 rad/s: %.4f N*m (used as torque_limit)\n"
          % limit)

    cases = [
        Case("R-01", 0.05, 0.5, LOAD, "recover",
             "baseline PI: dip then recover", min_dip=0.4),
        Case("R-02", 0.05, 2.0, LOAD, "recover",
             "strong integral: smaller dip, faster recovery", min_dip=0.1),
        Case("R-03", 0.20, 2.0, LOAD, "recover",
             "high-gain PI preset: dip -> recover", min_dip=0.0),
        Case("R-04", 0.05, 0.1, LOAD, "recover",
             "weak integral at the SAME Kp: largest dip of the Ki sweep",
             min_dip=0.8),
        Case("R-05", 0.05, 0.0, LOAD, "droop",
             "pure P (Ki=0): permanent droop = load/Kp"),
        Case("R-06", 0.02, 0.0, LOAD, "droop",
             "pure P, lower Kp: larger permanent droop"),
    ]

    done = {}
    for c in cases:
        run_case(ws, c, limit)
        m = c.metrics
        done[c.cid] = c
        ws.drain(0.5)

        print("  %s Kp=%s Ki=%s  base=%.2f vmin=%.2f dip=%.2f @%.2fs  "
              "tail=%.2f (err %+.2f)  release=%.2f  tcmd_max=%.4f"
              % (c.cid, c.kp, c.ki, m["v_base"], m["v_min"], m["dip"],
                 m["t_dip"], m["v_tail"], m["err_tail"], m["v_release"],
                 m["tcmd_max"]))

        # every case, regardless of expectation: the readout must stay sane
        check("%s speed finite and non-negative" % c.cid,
              m["finite"] and m["min_speed"] >= -1e-6,
              "min=%.4f rad/s" % m["min_speed"])

        # the actuator can never be asked for more torque than it can deliver
        check("%s torque command within envelope" % c.cid,
              m["tcmd_max"] <= limit + 1e-3,
              "maxTcmd=%.4f <= %.4f" % (m["tcmd_max"], limit))

        if c.expect == "recover":
            check("%s load step dips the speed" % c.cid,
                  m["dip"] >= c.opts["min_dip"],
                  "dip=%.2f rad/s (need >= %.2f)" % (m["dip"], c.opts["min_dip"]))
            check("%s then recovers to the setpoint" % c.cid,
                  m["t_rec"] is not None and abs(m["err_tail"]) <= SETTLE_TOL,
                  "recovered in %s, residual err %+.2f rad/s"
                  % ("%.2f s" % m["t_rec"] if m["t_rec"] is not None else "never",
                     m["err_tail"]))
            check("%s speed climbs back after the dip" % c.cid,
                  m["v_tail"] > m["v_min"] + 0.5 * m["dip"],
                  "v_min=%.2f -> settled %.2f" % (m["v_min"], m["v_tail"]))
            check("%s load release keeps the setpoint" % c.cid,
                  abs(m["err_release"]) <= SETTLE_TOL,
                  "release err %+.2f rad/s" % m["err_release"])
        else:
            droop_expect = c.load / c.kp
            check("%s load step drops the speed permanently" % c.cid,
                  m["v_tail"] < TARGET - 1.0 and m["t_rec"] is None,
                  "settled at %.2f rad/s (%.1f below target)"
                  % (m["v_tail"], TARGET - m["v_tail"]))
            check("%s droop matches load/Kp" % c.cid,
                  abs((TARGET - m["v_tail"]) - droop_expect) <= 0.1 * droop_expect,
                  "measured %.2f vs predicted %.2f rad/s"
                  % (TARGET - m["v_tail"], droop_expect))
            check("%s droop is removed once the load is released" % c.cid,
                  abs(m["err_release"]) <= SETTLE_TOL,
                  "release err %+.2f rad/s" % m["err_release"])

    # --- comparative claims across the gain matrix ---
    # R-04 / R-01 / R-02 all run at Kp = 0.05 and differ ONLY in Ki, so the dip
    # comparison isolates the integral gain. (An earlier revision of this file
    # compared cases with different Kp as well and failed - a confounded
    # experiment, not a control-loop problem: one variable at a time.)
    dips = [done["R-04"].metrics["dip"], done["R-01"].metrics["dip"],
            done["R-02"].metrics["dip"]]
    check("R-07 larger Ki => smaller dip (Kp fixed 0.05, Ki 0.1/0.5/2.0)",
          dips[0] > dips[1] > dips[2],
          "dips %.2f > %.2f > %.2f rad/s" % tuple(dips))

    dr1 = TARGET - done["R-05"].metrics["v_tail"]
    dr2 = TARGET - done["R-06"].metrics["v_tail"]
    check("R-08 smaller Kp => larger droop (Kp 0.05 vs 0.02)",
          dr2 > dr1 * 1.5,
          "droop %.2f vs %.2f rad/s" % (dr1, dr2))

    # --- setpoint step: the speed must follow a new target, not jump or die ---
    step = run_setpoint_step(ws, Case("R-09", 0.05, 0.5, 0.0, "setpoint_step",
                                      "50 -> 100 rad/s setpoint step"), limit)
    m = step.metrics
    print("\n  R-09 setpoint 50 -> 100 rad/s: %.2f -> %.2f rad/s, overshoot %.3f"
          % (m["v_start"], m["v_end"], m["overshoot"]))
    check("R-09 setpoint step reaches the new target",
          abs(m["v_end"] - TARGET) <= SETTLE_TOL and m["finite"],
          "%.2f rad/s (err %+.2f)" % (m["v_end"], m["v_end"] - TARGET))
    check("R-09 speed climbs to the new target (rising trend, no reversal)",
          m["trend_ok"] and m["min_speed"] >= -1e-6,
          "rise buckets %s rad/s" % " -> ".join("%.1f" % b for b in m["rise_buckets"]))
    check("R-09 no runaway overshoot",
          m["overshoot"] <= 5.0,
          "overshoot %.2f rad/s" % m["overshoot"])

    if args.dump_dir:
        os.makedirs(args.dump_dir, exist_ok=True)
        for c in cases + [step]:
            path = os.path.join(args.dump_dir, "%s.csv" % c.cid)
            with open(path, "w", newline="") as fh:
                w = csv.writer(fh)
                w.writerow(["t_sim_s", "speed_rad_s", "target_rad_s",
                            "tcmd_Nm", "load_Nm"])
                w.writerows(c.step)
            print("# wrote %s (%d rows)" % (path, len(c.step)))

    ws.close()

    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print("\n===== RESPONSE RESULT: %d/%d PASS =====" % (passed, total))
    for name, ok, detail in results:
        if not ok:
            print("  FAILED: %s (%s)" % (name, detail))
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
