// Simulation data layer.
//
// Design rules (from spec section ten / fourteen):
//  - Every displayed quantity (speed, torque, current, angle, Id, Iq, PWM,
//    load) comes from ONE simulation.state message at ONE timestamp.
//  - Incoming WebSocket messages mutate this store directly. They do NOT
//    trigger React re-renders. A single ~30 FPS ticker (see useFrameTick)
//    drives the UI, and the Three.js render loop reads the latest angle
//    itself. This satisfies "don't re-render the whole page per message".
//  - The 3D rotor rotation is driven ONLY by store.latest.rotor.angle.
//    We never integrate angle on the client.

export type SimStatus = "stopped" | "running" | "paused";

export interface SimLoad {
  enabled: boolean;
  mode: string;
  torque: number;
  onDuration: number;
  offDuration: number;
  phase: string;
  phaseTime: number;
  phaseRemaining: number;
}

export interface SimState {
  timestamp: number; // simulation seconds
  status: SimStatus;
  rotor: { angle: number; mechanicalSpeed: number; electricalAngle: number };
  electrical: {
    phaseA: number;
    phaseB: number;
    phaseC: number;
    bEmfA: number;
    bEmfB: number;
    bEmfC: number;
    id: number;
    iq: number;
    vd: number;
    vq: number;
  };
  mechanical: { torque: number; emTorque: number; loadTorque: number };
  control: {
    targetSpeed: number;
    speedError: number;
    speedKp: number;
    speedKi: number;
    speedKd: number;
    targetTorque: number;
    targetIq: number;
    targetId: number;
    iqErr: number;
    idErr: number;
    speedMode: boolean;
  };
  pwm: { dutyA: number; dutyB: number; dutyC: number; busVoltage: number };
  load: SimLoad;
  params: {
    numPolePairs: number;
    phaseResistance: number;
    phaseInductance: number;
    rotorInertia: number;
    bEmf0: number;
    busVoltage: number;
    dt: number;
    speedScale: number;
    loadMaxTorque: number; // N*m, actuator capability at 100 rad/s (reported by backend, V1.2)
  };
}

// One oscilloscope sample (all derived from a single state message).
export interface Sample {
  t: number;
  rpm: number;
  targetRpm: number; // setpoint at the same instant (for the deviation trace)
  torque: number;
  load: number;
  iq: number;
  ia: number;
  ib: number;
  ic: number;
  dA: number;
  dB: number;
  dC: number;
}

const RAD2RPM = 60 / (2 * Math.PI);

function zeroState(): SimState {
  return {
    timestamp: 0,
    status: "stopped",
    rotor: { angle: 0, mechanicalSpeed: 0, electricalAngle: 0 },
    electrical: {
      phaseA: 0, phaseB: 0, phaseC: 0,
      bEmfA: 0, bEmfB: 0, bEmfC: 0,
      id: 0, iq: 0, vd: 0, vq: 0,
    },
    mechanical: { torque: 0, emTorque: 0, loadTorque: 0 },
    control: {
      targetSpeed: 0, speedError: 0, speedKp: 0, speedKi: 0, speedKd: 0,
      targetTorque: 0, targetIq: 0, targetId: 0, iqErr: 0, idErr: 0,
      speedMode: true,
    },
    pwm: { dutyA: 0, dutyB: 0, dutyC: 0, busVoltage: 24 },
    load: {
      enabled: false, mode: "manual", torque: 0,
      onDuration: 1, offDuration: 1, phase: "off",
      phaseTime: 0, phaseRemaining: 0,
    },
    params: {
      numPolePairs: 4, phaseResistance: 1, phaseInductance: 1e-3,
      rotorInertia: 0.005, bEmf0: 0.01, busVoltage: 24, dt: 1e-6, speedScale: 2,
      loadMaxTorque: 0.16,
    },
  };
}

type ConnStatus = "connecting" | "open" | "closed";

export class SimStore {
  latest: SimState = zeroState();
  conn: ConnStatus = "closed";
  error = "";
  // Status-only listeners (cheap, used by header / control panel).
  private statusListeners = new Set<() => void>();
  private ws: WebSocket | null = null;
  private url = "";
  private reconnectTimer: number | null = null;
  private manualClose = false; // V1.1: user pressed Disconnect — no auto-reconnect

  private samples: Sample[] = [];
  private capacity = 600; // ~12 s at 50 Hz

  reset() {
    this.samples = [];
  }

  getBuffer(): Sample[] {
    return this.samples;
  }

  onStatus(fn: () => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  private notifyStatus() {
    for (const fn of this.statusListeners) fn();
  }

  connect(host: string, port: number) {
    this.manualClose = false;
    this.url = `ws://${host}:${port}/ws`;
    this.open();
  }

  // V1.1: user-initiated disconnect. Closes the socket and suppresses the
  // auto-reconnect until the next explicit connect().
  disconnect() {
    this.manualClose = true;
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = this.ws.onclose = this.ws.onerror = this.ws.onmessage = null;
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.conn = "closed";
    this.notifyStatus();
  }

  private open() {
    if (this.ws) {
      this.ws.onopen = this.ws.onclose = this.ws.onerror = this.ws.onmessage = null;
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.conn = "connecting";
    this.notifyStatus();
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      this.conn = "closed";
      this.error = String(e);
      this.notifyStatus();
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.conn = "open";
      this.error = "";
      this.notifyStatus();
    };
    ws.onclose = () => {
      this.conn = "closed";
      this.notifyStatus();
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      this.conn = "closed";
      this.notifyStatus();
    };
    ws.onmessage = (ev) => this.handle(ev.data as string);
  }

  private scheduleReconnect() {
    if (this.manualClose) return;
    if (this.reconnectTimer != null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.conn !== "open") this.open();
    }, 1000);
  }

  private handle(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    switch (msg.type) {
      case "simulation.state": {
        const d = msg.data;
        if (d) {
          this.latest = d as SimState;
          this.pushSample(d as SimState);
        }
        break;
      }
      case "simulation.status": {
        if (msg.status) this.latest.status = msg.status as SimStatus;
        this.notifyStatus();
        break;
      }
      case "load.state": {
        if (msg.data) {
          this.latest.load = { ...this.latest.load, ...(msg.data as SimLoad) };
        }
        break;
      }
      case "simulation.error": {
        this.error = String(msg.message ?? "simulation error");
        this.notifyStatus();
        break;
      }
    }
  }

  private pushSample(s: SimState) {
    const smp: Sample = {
      t: s.timestamp,
      rpm: s.rotor.mechanicalSpeed * RAD2RPM,
      targetRpm: s.control.targetSpeed * RAD2RPM,
      torque: s.mechanical.torque,
      load: s.mechanical.loadTorque,
      iq: s.electrical.iq,
      ia: s.electrical.phaseA,
      ib: s.electrical.phaseB,
      ic: s.electrical.phaseC,
      dA: s.pwm.dutyA,
      dB: s.pwm.dutyB,
      dC: s.pwm.dutyC,
    };
    this.samples.push(smp);
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  send(obj: Record<string, unknown>) {
    if (this.ws && this.conn === "open") {
      this.ws.send(JSON.stringify(obj));
    }
  }
}

// Single shared instance for the whole app.
export const store = new SimStore();

export function rpmOf(s: SimState): number {
  return s.rotor.mechanicalSpeed * RAD2RPM;
}
