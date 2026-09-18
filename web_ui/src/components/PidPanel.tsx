import { useState } from "react";
import { store } from "../sim/store";

// V1.1: speed-loop PID configuration + live readout.
// Gains are adapter-level (server/simulation_controller.cpp); the current
// values shown below come from the same simulation.state snapshot as every
// other displayed quantity (single source of truth).
export function PidPanel() {
  const c = store.latest.control;

  const [kp, setKp] = useState("0.5");
  const [ki, setKi] = useState("5");
  const [kd, setKd] = useState("0");
  const [limit, setLimit] = useState("2");

  const apply = () => {
    store.send({
      type: "simulation.speed_pi",
      kp: Number(kp),
      ki: Number(ki),
      kd: Number(kd),
      torque_limit: Number(limit),
    });
  };

  return (
    <div className="panel">
      <div className="panel-title"><span className="tag">PID</span>速度环 PID</div>

      <div className="pid-grid">
        <div className="field">
          <label>Kp</label>
          <input type="number" step="0.1" min={0} value={kp}
                 onChange={(e) => setKp(e.target.value)} />
        </div>
        <div className="field">
          <label>Ki</label>
          <input type="number" step="0.5" min={0} value={ki}
                 onChange={(e) => setKi(e.target.value)} />
        </div>
        <div className="field">
          <label>Kd</label>
          <input type="number" step="0.001" min={0} value={kd}
                 onChange={(e) => setKd(e.target.value)} />
        </div>
        <div className="field">
          <label>Torque Limit (N·m)</label>
          <input type="number" step="0.1" min={0.01} value={limit}
                 onChange={(e) => setLimit(e.target.value)} />
        </div>
      </div>

      <button className="btn primary" style={{ width: "100%" }} onClick={apply}>
        应用 PID 参数
      </button>

      {/* live readout — straight from the simulation snapshot */}
      <div className="pid-live">
        <span>Kp <b>{c.speedKp.toFixed(3)}</b></span>
        <span>Ki <b>{c.speedKi.toFixed(3)}</b></span>
        <span>Kd <b>{c.speedKd.toFixed(3)}</b></span>
        <span>输出 <b>{c.targetTorque.toFixed(3)}</b> N·m</span>
        <span>PWM <b>{store.latest.pwm.dutyA.toFixed(2)}</b> /
          <b> {store.latest.pwm.dutyB.toFixed(2)}</b> /
          <b> {store.latest.pwm.dutyC.toFixed(2)}</b>
        </span>
      </div>
    </div>
  );
}
