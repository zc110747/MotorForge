import { useEffect } from "react";
import { store } from "./sim/store";
import { defaultWsHost, defaultWsPort } from "./sim/net";
import { useFrameTick } from "./sim/useFrameTick";
import { Header } from "./components/Header";
import { ControlPanel } from "./components/ControlPanel";
import { PidPanel } from "./components/PidPanel";
import { LoadPanel } from "./components/LoadPanel";
import { CsvPanel } from "./components/CsvPanel";
import { Dashboard } from "./components/Dashboard";
import { Motor3D } from "./components/Motor3D";
import { Oscilloscope } from "./components/Oscilloscope";

export function App() {
  // Drive UI re-renders at a fixed rate; WebSocket messages only mutate the
  // store (no per-message React updates).
  useFrameTick(30);

  useEffect(() => {
    // Connect to the same host the page was served from, so LAN access works
    // without reconfiguring anything (see sim/net.ts).
    store.connect(defaultWsHost(), defaultWsPort());
  }, []);

  return (
    <div className="app">
      <Header />
      <div className="body">
        <div className="col">
          <ControlPanel />
          <PidPanel />
          <LoadPanel />
          <CsvPanel />
        </div>
        <div className="col">
          <Motor3D />
          <Oscilloscope />
        </div>
        <div className="col">
          <Dashboard />
        </div>
      </div>
    </div>
  );
}
