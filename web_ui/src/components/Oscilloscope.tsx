import { useState } from "react";
import { Scope, Ch } from "./Scope";
import { store } from "../sim/store";
import { pwmMetrics } from "../sim/pwm";
import { computeTransient } from "../sim/transient";

// V1.2 layout - three oscilloscope windows:
//   left  : [SPEED, spans two rows, with a selectable Y range]
//   right : [PWM (top)] [SIGNALS (bottom)]
//
// V1.3 range selection (the fix for "the real speed trace doesn't look like
// what the controller is actually doing"):
//   global - locked 0..1100 rpm. Good overview, but a resistive load step
//            only pulls ~2 rad/s (~19 rpm), i.e. ~1.7 % of the axis, which is
//            a couple of pixels: the dip is real but invisible.
//   auto   - y-axis follows the buffer min/max, so a settled trace zooms in.
//   dev    - plots speed MINUS setpoint, centred on zero and auto-scaled to
//            the excursion. This is the mode that makes "dip -> correct ->
//            settle back" unmistakable, and it is the mode the response
//            regression (tools/verify_response.py) asserts numerically.
const SPEED_FULL_RANGE: [number, number] = [0, 1100]; // rpm, covers 0-100 rad/s (~955 rpm)

type SpeedRange = "global" | "auto" | "dev";

const RANGE_LABEL: Record<SpeedRange, string> = {
  global: "全局 0-1100",
  auto: "自动缩放",
  dev: "偏差 Δ(rpm)",
};

function fmt(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
}

export function Oscilloscope() {
  const [range, setRange] = useState<SpeedRange>("global");
  const rest: Ch[] = ["torque", "load", "iq", "ia", "ib", "ic"];

  const tr = computeTransient(store.getBuffer());
  const pwm = pwmMetrics(store.latest, store.frameDtSim);

  const speedChannels: Ch[] = range === "dev" ? ["speedDev"] : ["speed"];
  const speedFixed = range === "global" ? SPEED_FULL_RANGE : undefined;

  return (
    <div className="panel">
      <div className="panel-title"><span className="tag">SCOPE</span>示波器</div>

      <div className="scope-3col">
        {/* left: tall speed window spanning both rows */}
        <div className="scope-tall">
          <div className="scope-box">
            <div className="scope-head">
              <span className="scope-title">SPEED · {RANGE_LABEL[range]}</span>
              <div className="seg seg-sm">
                {(["global", "auto", "dev"] as SpeedRange[]).map((m) => (
                  <button
                    key={m}
                    className={range === m ? "seg-btn active" : "seg-btn"}
                    onClick={() => setRange(m)}
                    title={
                      m === "dev"
                        ? "以目标转速为零线显示速度偏差，负载跌落在图上可见"
                        : m === "auto"
                        ? "Y 轴随缓冲区自动缩放"
                        : "锁定 0-1100 rpm 全局量程"
                    }
                  >
                    {m === "global" ? "全局" : m === "auto" ? "自动" : "偏差"}
                  </button>
                ))}
              </div>
            </div>

            <Scope
              channels={speedChannels}
              className="scope-sm"
              fixed={speedFixed}
            />

            {/* Numeric transient readout from the same buffer the plot uses.
                dip / recoverS / tailMean are exactly the "dip -> correct ->
                settle" shape; with Ki = 0 tailMean stays negative (droop).
                While the shaft is still spinning up the buffer holds nothing
                but the start-up ramp, so no dip is reported at all. */}
            <div className="pid-live" style={{ marginTop: 6 }}>
              <span>Δ 当前 <b>{fmt(tr?.current ?? 0)}</b> rpm</span>
              {tr && !tr.settled ? (
                <span>加速中 · 尚未到达目标转速</span>
              ) : (
                <>
                  <span>Δ 跌落 <b>{fmt(tr?.dip ?? 0)}</b> rpm</span>
                  <span>@ <b>{(tr?.tDip ?? 0).toFixed(2)}</b> s</span>
                  <span>调整 <b>{tr?.recoverS == null ? "未回归" : tr.recoverS.toFixed(2) + " s"}</b></span>
                  <span>稳态 Δ <b>{fmt(tr?.tailMean ?? 0)}</b> rpm</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* right: PWM (top) + Signals (bottom) stacked */}
        <div className="scope-stack">
          <div className="scope-half">
            {/* Two traces on purpose: `pwm` is phase A's duty, which ROTATES at
                f_e (63.7 Hz at 100 rad/s) and is aliased by the ~25 Hz
                telemetry -> it looks like jitter by design. `pwmM` is the
                length of that same vector: DC in steady state, so it is the
                one to read, and the one that tracks back-EMF and load. */}
            <Scope
              channels={["pwmM", "pwm"]}
              title={
                pwm.frameDtSim > 0
                  ? `PWM · m=${pwm.m.toFixed(3)} (${pwm.fE.toFixed(1)} Hz, ${pwm.aliasPerFrame.toFixed(1)} 电周期/帧)`
                  : `PWM · m=${pwm.m.toFixed(3)}`
              }
              className="scope-sm"
            />
          </div>
          <div className="scope-half">
            <Scope channels={rest} defaultOn={["torque", "load", "iq"]} title="SIGNALS" />
          </div>
        </div>
      </div>
    </div>
  );
}
