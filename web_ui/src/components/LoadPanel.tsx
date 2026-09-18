import { useState } from "react";
import { store } from "../sim/store";

export function LoadPanel() {
  const [mode, setMode] = useState<"manual" | "periodic">(
    store.latest.load.mode as "manual" | "periodic"
  );
  const [torque, setTorque] = useState(store.latest.load.torque);
  const [onDur, setOnDur] = useState(store.latest.load.onDuration);
  const [offDur, setOffDur] = useState(store.latest.load.offDuration);
  const [enabled, setEnabled] = useState(store.latest.load.enabled);

  const apply = (next: Partial<{
    mode: "manual" | "periodic";
    torque: number;
    onDuration: number;
    offDuration: number;
    enabled: boolean;
  }>) => {
    const merged = {
      mode: next.mode ?? mode,
      torque: next.torque ?? torque,
      onDuration: next.onDuration ?? onDur,
      offDuration: next.offDuration ?? offDur,
      enabled: next.enabled ?? enabled,
    };
    store.send({
      type: "load.configure",
      mode: merged.mode,
      torque: merged.torque,
      on_duration: merged.onDuration,
      off_duration: merged.offDuration,
      enabled: merged.enabled,
    });
  };

  const load = store.latest.load;

  return (
    <div className="panel">
      <div className="panel-title"><span className="tag">LOAD</span>负载控制</div>

      <div className="btn-row" style={{ marginBottom: 10 }}>
        <button
          className={mode === "manual" ? "btn primary" : "btn"}
          onClick={() => { setMode("manual"); apply({ mode: "manual", enabled: false }); }}
        >
          手动 Manual
        </button>
        <button
          className={mode === "periodic" ? "btn primary" : "btn"}
          onClick={() => { setMode("periodic"); apply({ mode: "periodic", enabled: false }); }}
        >
          周期 Periodic
        </button>
      </div>

      <div className="field">
        <label>
          负载转矩 Torque
          <span className="val">{torque.toFixed(2)} N·m</span>
        </label>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={torque}
          onChange={(e) => { const v = Number(e.target.value); setTorque(v); apply({ torque: v }); }}
        />
      </div>

      {mode === "periodic" && (
        <>
          <div className="field">
            <label>ON 时长 (s)<span className="val">{onDur.toFixed(1)}</span></label>
            <input
              type="number" min={0.1} step={0.1} value={onDur}
              onChange={(e) => { const v = Number(e.target.value); setOnDur(v); apply({ onDuration: v }); }}
            />
          </div>
          <div className="field">
            <label>OFF 时长 (s)<span className="val">{offDur.toFixed(1)}</span></label>
            <input
              type="number" min={0.1} step={0.1} value={offDur}
              onChange={(e) => { const v = Number(e.target.value); setOffDur(v); apply({ offDuration: v }); }}
            />
          </div>
        </>
      )}

      <div className="btn-row">
        <button
          className={enabled ? "btn primary" : "btn"}
          onClick={() => { const e = !enabled; setEnabled(e); apply({ enabled: e }); }}
        >
          {enabled ? "负载 启用中" : "应用负载"}
        </button>
      </div>

      <div className="hint">
        相位 {load.phase} · 剩余 {load.phaseRemaining.toFixed(2)}s ·
        实测负载 {store.latest.mechanical.loadTorque.toFixed(3)} N·m
      </div>
    </div>
  );
}
