import { useState } from "react";
import { store, rpmOf } from "../sim/store";

const RAD2DEG = 180 / Math.PI;

export function Header() {
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState(18098);

  const s = store.latest;
  const rpm = rpmOf(s);
  const angleDeg = (s.rotor.angle * RAD2DEG) % 360;

  const dotClass =
    store.conn === "open" ? "open" : store.conn === "connecting" ? "connecting" : "closed";

  return (
    <div className="topbar">
      <div className="brand">
        MotorForge <small>BLDC/PMSM 仿真实验台</small>
      </div>

      <div className="conn">
        <span className={`conn-dot ${dotClass}`} />
        <span style={{ color: "var(--text-dim)" }}>
          {store.conn === "open" ? "WS Connected" : store.conn === "connecting" ? "Connecting…" : "Disconnected"}
        </span>
        <input value={host} onChange={(e) => setHost(e.target.value)} title="host" />
        <input
          type="number"
          value={port}
          onChange={(e) => setPort(Number(e.target.value))}
          title="port"
        />
        <button onClick={() => store.connect(host, port)}>Connect</button>
      </div>

      {store.error && <div className="error-note">{store.error}</div>}

      <div className="top-readouts">
        <div className="top-readout">
          <div className="k">ACTUAL SPEED</div>
          <div className="v">{rpm.toFixed(1)}</div>
        </div>
        <div className="top-readout">
          <div className="k">ROTOR ANGLE</div>
          <div className="v">{angleDeg.toFixed(1)}°</div>
        </div>
        <div className="top-readout">
          <div className="k">SIM TIME</div>
          <div className="v">{s.timestamp.toFixed(2)}</div>
        </div>
      </div>
    </div>
  );
}
