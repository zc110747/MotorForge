import { useState } from "react";
import { store } from "../sim/store";
import { defaultWsHost, defaultWsPort } from "../sim/net";

const RAD2DEG = 180 / Math.PI;

export function Header() {
  // Defaults follow the page origin so LAN access works out of the box
  // (see sim/net.ts); the fields remain editable as a manual override.
  const [host, setHost] = useState(defaultWsHost);
  const [port, setPort] = useState(defaultWsPort);

  const s = store.latest;
  const speedRad = s.rotor.mechanicalSpeed;
  const angleDeg = (s.rotor.angle * RAD2DEG) % 360;

  const open = store.conn === "open";
  const dotClass = open ? "open" : store.conn === "connecting" ? "connecting" : "closed";

  const onButton = () => {
    if (open) store.disconnect();
    else store.connect(host, port);
  };

  return (
    <div className="topbar">
      <div className="brand">
        MotorForge <small>BLDC/PMSM 仿真实验台</small>
      </div>

      <div className="conn">
        <span className={`conn-dot ${dotClass}`} />
        <span style={{ color: "var(--text-dim)" }}>
          {open ? "WS Connected" : store.conn === "connecting" ? "Connecting…" : "Disconnected"}
        </span>
        <input
          className="host"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          title="host"
          spellCheck={false}
        />
        <input
          className="port"
          type="number"
          value={port}
          onChange={(e) => setPort(Number(e.target.value))}
          title="port"
        />
        <button
          className={open ? "disconnect" : ""}
          onClick={onButton}
          title={open ? "断开连接" : "连接仿真服务器"}
        >
          {open ? "Disconnect" : "Connect"}
        </button>
      </div>

      {store.error && <div className="error-note">{store.error}</div>}

      <div className="top-readouts">
        <div className="top-readout">
          <div className="k">ACTUAL SPEED</div>
          <div className="v">
            {speedRad.toFixed(1)}<span className="u"> rad/s</span>
          </div>
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
