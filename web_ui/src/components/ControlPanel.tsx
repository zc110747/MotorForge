import { useState } from "react";
import { store, rpmOf } from "../sim/store";

const RAD2RPM = 60 / (2 * Math.PI);

export function ControlPanel() {
  const status = store.latest.status;
  const [targetRpm, setTargetRpm] = useState(() =>
    Math.round(store.latest.control.targetSpeed * RAD2RPM)
  );

  const running = status === "running";
  const paused = status === "paused";

  const sendTarget = (rpm: number) => {
    setTargetRpm(rpm);
    store.send({ type: "simulation.target_speed", value: rpm / RAD2RPM });
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
          <span className="val">{targetRpm} rpm</span>
        </label>
        <input
          type="range"
          min={0}
          max={4000}
          step={10}
          value={targetRpm}
          onChange={(e) => sendTarget(Number(e.target.value))}
        />
        <input
          type="number"
          min={0}
          max={4000}
          value={targetRpm}
          onChange={(e) => sendTarget(Number(e.target.value))}
          style={{ marginTop: 6 }}
        />
      </div>

      <div className="hint">
        实测转速 {rpmOf(store.latest).toFixed(1)} rpm · 状态 {status}
      </div>
    </div>
  );
}
