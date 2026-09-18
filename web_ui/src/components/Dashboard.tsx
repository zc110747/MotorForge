import { store } from "../sim/store";
import { pwmMetrics } from "../sim/pwm";

const RAD2RPM = 60 / (2 * Math.PI);

export function Dashboard() {
  const s = store.latest;
  const actual = s.rotor.mechanicalSpeed; // rad/s
  const target = s.control.targetSpeed;   // rad/s
  const err = target - actual;
  const rpm = (v: number) => v * RAD2RPM;
  const pwm = pwmMetrics(s, store.frameDtSim);

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
        <label>PWM 相占空比 Duty (0–1)</label>
        <div className="pwm-bars">
          {[["A", s.pwm.dutyA], ["B", s.pwm.dutyB], ["C", s.pwm.dutyC]].map(([k, v]) => (
            <div className="pwm-bar" key={k}>
              <div className="fill" style={{ height: `${Math.max(0, Math.min(1, v as number)) * 100}%` }} />
              <div className="lab">{k} {(v as number).toFixed(2)}</div>
            </div>
          ))}
        </div>
        {/* The three bars above are the projection of ONE rotating voltage
            vector, so they are meant to swing. These four numbers are the
            aliasing-immune summary of the same snapshot (see sim/pwm.ts). */}
        <div className="pid-live" style={{ marginTop: 6 }}>
          <span>调制比 m <b>{pwm.m.toFixed(3)}</b></span>
          <span>摆幅 <b>0.50 ± {pwm.amp.toFixed(3)}</b></span>
          <span>电频率 f<sub>e</sub> <b>{pwm.fE.toFixed(1)}</b> Hz</span>
          <span>帧间隔 <b>{pwm.frameDtSim > 0 ? (pwm.frameDtSim * 1000).toFixed(0) : "—"}</b> ms</span>
          <span>帧/电周期 <b>{pwm.frameDtSim > 0 ? pwm.aliasPerFrame.toFixed(2) : "—"}</b></span>
        </div>
        <div className="hint">
          三相占空比是同一个电压矢量在三相上的投影，以 f<sub>e</sub> = n<sub>pp</sub>·ω/2π 旋转。
          空载时逆变器仍需输出反电动势电压（{pwm.m.toFixed(2)} · V<sub>bus</sub>/2 = {(pwm.m * s.pwm.busVoltage / 2).toFixed(2)} V），
          因此并非恒定 0.5。遥测帧间隔 <b>实测</b> 为 ≈{pwm.frameDtSim > 0 ? (pwm.frameDtSim * 1000).toFixed(0) : "?"} ms
          仿真时间，其间矢量转过 ≈{pwm.frameDtSim > 0 ? pwm.aliasPerFrame.toFixed(1) : "?"} 个电周期，
          相占空比原始读数必然混叠 —— 要看 <b>m</b>（矢量长度，稳态即为常量）。
          {pwm.limited ? " ⚠ m ≥ 1.414：已过调制，占空比被钳位在 0/1。" : ""}
        </div>
      </div>

      <div className="hint">
        母线电压 {s.pwm.busVoltage.toFixed(0)} V · Vd {s.electrical.vd.toFixed(2)} V · Vq {s.electrical.vq.toFixed(2)} V
      </div>
    </div>
  );
}
