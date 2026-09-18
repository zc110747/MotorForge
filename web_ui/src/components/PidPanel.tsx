import { useState } from "react";
import { store } from "../sim/store";

// Speed-loop PID configuration + live readout.
//
// Gains are adapter-level (server/simulation_controller.cpp) and every readback
// below comes from the same simulation.state snapshot as the rest of the UI.
//
// V1.3 fixes the defaults: this panel used to start at Kp=0.5 / Ki=5 /
// Torque Limit=2 N*m, none of which matched the server (0.05 / 0.5 / 0.1616).
// A 2 N*m limit is 12x what the 24 V actuator can deliver at 100 rad/s, so the
// panel was advertising a setpoint the plant can never reach. The defaults now
// mirror the backend, and the limit field follows params.loadMaxTorque.
const PRESETS: { name: string; kp: string; ki: string; kd: string; hint: string }[] = [
  {
    name: "纯 P (Ki=0)",
    kp: "0.05",
    ki: "0",
    kd: "0",
    hint: "无积分：加阻力后转速永久下降，稳态静差 = 负载 / Kp",
  },
  {
    name: "标准 PI",
    kp: "0.05",
    ki: "0.5",
    kd: "0",
    hint: "负载阶跃后先跌落、再调整、最后回到目标转速",
  },
  {
    name: "高增益 PI",
    kp: "0.2",
    ki: "2",
    kd: "0",
    hint: "跌落更小、回归更快，但转矩指令更激进",
  },
];

export function PidPanel() {
  const c = store.latest.control;
  const loadMax = store.latest.params.loadMaxTorque;

  const [kp, setKp] = useState("0.05");
  const [ki, setKi] = useState("0.5");
  const [kd, setKd] = useState("0");
  const [limit, setLimit] = useState(() => loadMax.toFixed(4));

  const apply = (p = { kp, ki, kd, limit }) => {
    store.send({
      type: "simulation.speed_pi",
      kp: Number(p.kp),
      ki: Number(p.ki),
      kd: Number(p.kd),
      torque_limit: Number(p.limit),
    });
  };

  const usePreset = (p: (typeof PRESETS)[number]) => {
    const lim = loadMax.toFixed(4);
    setKp(p.kp);
    setKi(p.ki);
    setKd(p.kd);
    setLimit(lim);
    apply({ kp: p.kp, ki: p.ki, kd: p.kd, limit: lim });
  };

  // Fill the inputs with what the server is actually running right now.
  const syncFromServer = () => {
    const next = {
      kp: c.speedKp.toString(),
      ki: c.speedKi.toString(),
      kd: c.speedKd.toString(),
      limit: loadMax.toFixed(4),
    };
    setKp(next.kp);
    setKi(next.ki);
    setKd(next.kd);
    setLimit(next.limit);
  };

  return (
    <div className="panel">
      <div className="panel-title"><span className="tag">PID</span>速度环 PID</div>

      <div className="btn-row" style={{ marginBottom: 8 }}>
        {PRESETS.map((p) => (
          <button key={p.name} className="btn" title={p.hint} onClick={() => usePreset(p)}>
            {p.name}
          </button>
        ))}
      </div>

      <div className="pid-grid">
        <div className="field">
          <label>Kp</label>
          <input type="number" step="0.01" min={0} value={kp}
                 onChange={(e) => setKp(e.target.value)} />
        </div>
        <div className="field">
          <label>Ki</label>
          <input type="number" step="0.1" min={0} value={ki}
                 onChange={(e) => setKi(e.target.value)} />
        </div>
        <div className="field">
          <label>Kd</label>
          <input type="number" step="0.001" min={0} value={kd}
                 onChange={(e) => setKd(e.target.value)} />
        </div>
        <div className="field">
          <label>Torque Limit (N·m)</label>
          <input type="number" step="0.01" min={0.001} value={limit}
                 onChange={(e) => setLimit(e.target.value)} />
        </div>
      </div>

      <div className="btn-row">
        <button className="btn primary" style={{ flex: 1 }} onClick={() => apply()}>
          应用 PID 参数
        </button>
        <button className="btn" onClick={syncFromServer} title="用服务器当前生效的增益回填输入框">
          读取当前值
        </button>
      </div>

      <div className="hint" style={{ marginTop: 6 }}>
        执行器能力上限 ≈ {loadMax.toFixed(4)} N·m（100 rad/s @ {store.latest.params.busVoltage.toFixed(0)} V）；
        限幅设得比它大不会更快，只会让积分在不可达指令上积累。
      </div>

      {/* live readout — straight from the simulation snapshot */}
      <div className="pid-live">
        <span>Kp <b>{c.speedKp.toFixed(3)}</b></span>
        <span>Ki <b>{c.speedKi.toFixed(3)}</b></span>
        <span>Kd <b>{c.speedKd.toFixed(3)}</b></span>
        <span>输出 <b>{c.targetTorque.toFixed(4)}</b> N·m</span>
        <span>静差 <b>{(-c.speedError).toFixed(2)}</b> rad/s</span>
        <span>PWM <b>{store.latest.pwm.dutyA.toFixed(2)}</b> /
          <b> {store.latest.pwm.dutyB.toFixed(2)}</b> /
          <b> {store.latest.pwm.dutyC.toFixed(2)}</b>
        </span>
      </div>
    </div>
  );
}
