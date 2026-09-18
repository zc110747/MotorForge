import { useEffect, useRef, useState } from "react";
import { store, Sample } from "../sim/store";

export type Ch =
  | "speed"
  | "speedDev"
  | "torque"
  | "load"
  | "iq"
  | "ia"
  | "ib"
  | "ic"
  | "pwm"
  | "pwmM";

export const CH_META: Record<
  Ch,
  {
    label: string;
    color: string;
    pick: (s: Sample) => number;
    fixed?: [number, number];
    // Symmetric channels are plotted around zero and auto-scaled to
    // +/- max|value| with headroom (used by the deviation trace, whose whole
    // point is that it never gets buried by an unrelated full-scale span).
    symmetric?: boolean;
  }
> = {
  speed: { label: "Speed", color: "#38bdf8", pick: (s) => s.rpm },
  // Deviation from the setpoint, in the same unit as the speed trace (rpm).
  speedDev: {
    label: "Speed Δ",
    color: "#38bdf8",
    pick: (s) => s.rpm - s.targetRpm,
    symmetric: true,
  },
  torque: { label: "Torque", color: "#f5a623", pick: (s) => s.torque },
  load: { label: "Load", color: "#f87171", pick: (s) => s.load },
  iq: { label: "Iq", color: "#34d399", pick: (s) => s.iq },
  ia: { label: "Ia", color: "#60a5fa", pick: (s) => s.ia },
  ib: { label: "Ib", color: "#a78bfa", pick: (s) => s.ib },
  ic: { label: "Ic", color: "#fb923c", pick: (s) => s.ic },
  // Per-phase duty of phase A. This is a ROTATING waveform at the electrical
  // frequency f_e = n_pp*omega/2pi (63.7 Hz at 100 rad/s, 4 pole pairs), while
  // the telemetry only carries ~25 frames per simulated second. In steady
  // state the trace is therefore an aliased blur and is NOT meant to be read
  // as a number - use pwmM for that.
  pwm: { label: "PWM-A 相占空比", color: "#e6edf3", pick: (s) => s.dA, fixed: [0, 1] },
  // Modulation index: the LENGTH of the same rotating vector. DC in steady
  // state, so this trace stays readable, and it is the one that answers "how
  // hard is the inverter working" (rises with speed via back-EMF and with load).
  pwmM: { label: "PWM 调制比 m", color: "#67e8f9", pick: (s) => s.m },
};

interface ScopeProps {
  channels: Ch[];
  defaultOn?: Ch[];
  className?: string;
  title?: string;
  // Optional fixed Y-range override applied to every channel in this scope.
  // Takes precedence over CH_META[c].fixed (used for the always-global
  // Speed window so it never auto-zooms after the speed settles).
  fixed?: [number, number];
}

// One scope canvas + channel legend. V1.1: the single big oscilloscope was
// split into composable scopes (PWM | Speed on top, the rest below).
export function Scope({ channels, defaultOn, className, title, fixed }: ScopeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [on, setOn] = useState<Record<Ch, boolean>>(() => {
    const init = {} as Record<Ch, boolean>;
    for (const c of channels) init[c] = defaultOn ? defaultOn.includes(c) : true;
    return init;
  });

  // The channel set can change at runtime (the SPEED window swaps between the
  // absolute trace and the deviation trace). Without this, a channel that was
  // not present on first render stays `undefined` in the on/off map, `active`
  // comes out empty, and the window silently draws nothing at all.
  useEffect(() => {
    setOn((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const c of channels) {
        if (!(c in next)) {
          next[c] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels.join(",")]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(window.devicePixelRatio, 2);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr; canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#0a0e14";
      ctx.fillRect(0, 0, w, h);

      const buf = store.getBuffer();
      if (buf.length < 2) {
        ctx.fillStyle = "#7d8896";
        ctx.font = "12px monospace";
        ctx.fillText("等待仿真数据…", 12, h / 2);
        return;
      }

      const active = channels.filter((c) => on[c]);
      // horizontal grid
      ctx.strokeStyle = "#1c232c";
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = (h * i) / 4;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      const n = buf.length;
      const single = active.length === 1;
      for (const c of active) {
        const meta = CH_META[c];
        let lo: number, hi: number;
        const range = fixed ?? meta.fixed;
        if (range) {
          [lo, hi] = range;
        } else if (meta.symmetric) {
          // Deviation trace: always centred on zero so a 2 rad/s dip is a
          // full-scale excursion instead of a 1 % wiggle on a 0..955 rpm axis.
          let m = 0;
          for (const s of buf) { const v = Math.abs(meta.pick(s)); if (v > m) m = v; }
          if (m < 1e-9) m = 1;
          const pad = m * 0.15;
          lo = -(m + pad); hi = m + pad;
        } else {
          lo = Infinity; hi = -Infinity;
          for (const s of buf) { const v = meta.pick(s); if (v < lo) lo = v; if (v > hi) hi = v; }
          if (lo === hi) { lo -= 1; hi += 1; }
          const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
        }
        const span = hi - lo || 1;
        const yOf = (v: number) => h - ((v - lo) / span) * h;

        // zero baseline for deviation plots (the setpoint reference)
        if (meta.symmetric && lo < 0 && hi > 0) {
          ctx.save();
          ctx.strokeStyle = "#2b333d";
          ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(0, yOf(0)); ctx.lineTo(w, yOf(0)); ctx.stroke();
          ctx.restore();
        }

        ctx.strokeStyle = meta.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = (i / (n - 1)) * w;
          const y = yOf(meta.pick(buf[i]));
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // scale readout: without it the plot has no absolute reference and a
        // small transient looks identical to no transient at all.
        if (single) {
          const unit = c === "pwm" ? "" : c === "speed" || c === "speedDev" ? " rpm" : "";
          ctx.fillStyle = "#7d8896";
          ctx.font = "10px monospace";
          ctx.textAlign = "left";
          ctx.fillText(`${hi.toFixed(hi >= 100 ? 0 : 1)}${unit}`, 6, 12);
          ctx.fillText(`${lo.toFixed(lo <= -100 ? 0 : 1)}${unit}`, 6, h - 5);
        }
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, channels.join(","), fixed]);

  return (
    <div className="scope-box">
      {title && <div className="scope-title">{title}</div>}
      <canvas ref={canvasRef} className={`scope ${className ?? ""}`} />
      <div className="scope-legend">
        {channels.map((c) => (
          <span key={c}>
            <i style={{ background: CH_META[c].color, opacity: on[c] ? 1 : 0.25 }} />
            <label
              style={{ opacity: on[c] ? 1 : 0.4, cursor: "pointer" }}
              onClick={() => setOn((p) => ({ ...p, [c]: !p[c] }))}
            >
              {CH_META[c].label}
            </label>
          </span>
        ))}
      </div>
    </div>
  );
}
