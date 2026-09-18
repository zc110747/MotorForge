import { useState } from "react";
import { store } from "../sim/store";

const RAD2RPM = 60 / (2 * Math.PI);

// V1.2: target speed is set in rad/s (SI), range 1..100 rad/s. The backend and
// every readout use the same unit, so the setpoint and the displayed actual
// speed correspond 1:1. rpm is shown as a secondary conversion only.
const MAX_TARGET_RAD = 100;
const MIN_TARGET_RAD = 1;

export function ControlPanel() {
  const status = store.latest.status;
  const [targetRad, setTargetRad] = useState(() =>
    Math.min(MAX_TARGET_RAD, Math.max(MIN_TARGET_RAD,
      Math.round(store.latest.control.targetSpeed * 10) / 10))
  );
  const [voltage, setVoltage] = useState<12 | 24>(
    store.latest.params.busVoltage === 12 ? 12 : 24
  );

  const running = status === "running";
  const paused = status === "paused";

  const sendTarget = (rad: number) => {
    const v = Math.min(MAX_TARGET_RAD, Math.max(MIN_TARGET_RAD, rad));
    setTargetRad(v);
    store.send({ type: "simulation.target_speed", value: v });
  };

  const sendVoltage = (v: 12 | 24) => {
    setVoltage(v);
    store.send({ type: "motor.parameter", name: "bus_voltage", value: v });
  };

  return (
    <div className="panel">
      <div className="panel-title"><span className="tag">CTRL</span>仿真控制</div>

      <div className="btn-row" style={{ marginBottom: 12 }}>
        <button
          className="btn primary"
          disabled={running}
          onClick={() => store.send({ type: "simulation.start" })}
        >
          Start
        </button>
        <button
          className="btn"
          disabled={!running}
          onClick={() => store.send({ type: "simulation.stop" })}
        >
          Stop
        </button>
        <button
          className="btn"
          disabled={!running}
          onClick={() => store.send({ type: "simulation.pause" })}
        >
          Pause
        </button>
        <button
          className="btn"
          disabled={!paused}
          onClick={() => store.send({ type: "simulation.resume" })}
        >
          Resume
        </button>
        <button
          className="btn danger"
          onClick={() => {
            store.send({ type: "simulation.reset" });
            store.reset();
          }}
        >
          Reset
        </button>
      </div>

      <div className="field">
        <label>
          目标转速 Target Speed
          <span className="val">{targetRad.toFixed(1)} rad/s</span>
        </label>
        <input
          type="range"
          min={MIN_TARGET_RAD}
          max={MAX_TARGET_RAD}
          step={0.5}
          value={targetRad}
          onChange={(e) => sendTarget(Number(e.target.value))}
        />
        <div className="target-row">
          <input
            type="number"
            min={MIN_TARGET_RAD}
            max={MAX_TARGET_RAD}
            step={0.5}
            value={targetRad}
            onChange={(e) => sendTarget(Number(e.target.value))}
          />
          <span className="conv">≈ {(targetRad * RAD2RPM).toFixed(0)} rpm</span>
        </div>
      </div>

      <div className="field">
        <label>母线电压 Bus Voltage</label>
        <div className="seg">
          <button
            className={voltage === 12 ? "seg-btn active" : "seg-btn"}
            onClick={() => sendVoltage(12)}
          >
            12 V
          </button>
          <button
            className={voltage === 24 ? "seg-btn active" : "seg-btn"}
            onClick={() => sendVoltage(24)}
          >
            24 V
          </button>
        </div>
        <div className="hint" style={{ marginTop: 4 }}>
          负载上限 = 100 rad/s 时最大转矩 ≈
          {store.latest.params.loadMaxTorque.toFixed(3)} N·m
        </div>
      </div>

      <div className="hint">
        实测转速 {store.latest.rotor.mechanicalSpeed.toFixed(1)} rad/s（
        {(store.latest.rotor.mechanicalSpeed * RAD2RPM).toFixed(0)} rpm）· 状态 {status}
      </div>
    </div>
  );
}
