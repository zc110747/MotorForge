import { store } from "../sim/store";

const RAD2RPM = 60 / (2 * Math.PI);

export function Dashboard() {
  const s = store.latest;
  const actual = s.rotor.mechanicalSpeed; // rad/s
  const target = s.control.targetSpeed;   // rad/s
  const err = target - actual;
  const rpm = (v: number) => v * RAD2RPM;

  return (
    <div className="panel">
      <div className="panel-title"><span className="tag">DASH</span>控制仪表盘</div>

      <div className="stat-grid" style={{ marginBottom: 10 }}>
        <div className="stat">
          <div className="k">Target Speed</div>
          <div className="v">{target.toFixed(1)}<span className="u">rad/s</span></div>
          <div className="k">{rpm(target).toFixed(0)} rpm</div>
        </div>
        <div className="stat">
          <div className="k">Actual Speed</div>
          <div className="v" style={{ color: "var(--accent)" }}>{actual.toFixed(1)}<span className="u">rad/s</span></div>
          <div className="k">{rpm(actual).toFixed(0)} rpm</div>
        </div>
        <div className="stat">
          <div className="k">Speed Error</div>
          <div className="v">{err.toFixed(1)}<span className="u">rad/s</span></div>
        </div>
        <div className="stat">
          <div className="k">Em. Torque</div>
          <div className="v">{s.mechanical.emTorque.toFixed(3)}<span className="u">N·m</span></div>
        </div>
        <div className="stat">
          <div className="k">Total Torque</div>
          <div className="v">{s.mechanical.torque.toFixed(3)}<span className="u">N·m</span></div>
        </div>
        <div className="stat">
          <div className="k">Load Torque</div>
          <div className="v">{s.mechanical.loadTorque.toFixed(3)}<span className="u">N·m</span></div>
        </div>
        <div className="stat">
          <div className="k">Id</div>
          <div className="v">{s.electrical.id.toFixed(2)}<span className="u">A</span></div>
        </div>
        <div className="stat">
          <div className="k">Iq</div>
          <div className="v">{s.electrical.iq.toFixed(2)}<span className="u">A</span></div>
        </div>
      </div>

      <div className="field">
        <label>相电流 Phase Currents (A)</label>
        <div className="stat-grid">
          <div className="stat"><div className="k">Ia</div><div className="v">{s.electrical.phaseA.toFixed(2)}</div></div>
          <div className="stat"><div className="k">Ib</div><div className="v">{s.electrical.phaseB.toFixed(2)}</div></div>
          <div className="stat"><div className="k">Ic</div><div className="v">{s.electrical.phaseC.toFixed(2)}</div></div>
        </div>
      </div>

      <div className="field" style={{ marginTop: 10 }}>
        <label>PWM 占空比 Duty (0–1)</label>
        <div className="pwm-bars">
          {[["A", s.pwm.dutyA], ["B", s.pwm.dutyB], ["C", s.pwm.dutyC]].map(([k, v]) => (
            <div className="pwm-bar" key={k}>
              <div className="fill" style={{ height: `${Math.max(0, Math.min(1, v as number)) * 100}%` }} />
              <div className="lab">{k} {(v as number).toFixed(2)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="hint">
        母线电压 {s.pwm.busVoltage.toFixed(0)} V · Vd {s.electrical.vd.toFixed(2)} V · Vq {s.electrical.vq.toFixed(2)} V
      </div>
    </div>
  );
}
