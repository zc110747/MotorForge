import { Scope, Ch } from "./Scope";

// V1.2 layout — three oscilloscope windows:
//   left  : [SPEED · global fixed range, spans two rows (tall)]
//   right : [PWM (top)] [SIGNALS (bottom)]
// The previous bottom-right "SPEED · auto-zoom" window was removed; the single
// locked-range speed window was enlarged to two rows so the full 1..100 rad/s
// sweep stays visible without auto-scaling.
const SPEED_FULL_RANGE: [number, number] = [0, 1100]; // rpm, covers 0–100 rad/s (~955 rpm) + headroom

export function Oscilloscope() {
  const rest: Ch[] = ["torque", "load", "iq", "ia", "ib", "ic"];

  return (
    <div className="panel">
      <div className="panel-title"><span className="tag">SCOPE</span>示波器</div>

      <div className="scope-3col">
        {/* left: tall speed (global, fixed range) spanning both rows */}
        <div className="scope-tall">
          <Scope
            channels={["speed"]}
            title="SPEED · 全局(锁定量程)"
            className="scope-sm"
            fixed={SPEED_FULL_RANGE}
          />
        </div>

        {/* right: PWM (top) + Signals (bottom) stacked */}
        <div className="scope-stack">
          <div className="scope-half">
            <Scope channels={["pwm"]} title="PWM" className="scope-sm" />
          </div>
          <div className="scope-half">
            <Scope channels={rest} defaultOn={["torque", "load", "iq"]} title="SIGNALS" />
          </div>
        </div>
      </div>
    </div>
  );
}
