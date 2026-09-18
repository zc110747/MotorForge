import { useEffect, useRef, useState } from "react";
import { store, Sample } from "../sim/store";

type Ch = "speed" | "torque" | "load" | "iq" | "ia" | "ib" | "ic" | "pwm";

const META: Record<Ch, { label: string; color: string; pick: (s: Sample) => number; fixed?: [number, number] }> = {
  speed: { label: "Speed", color: "#38bdf8", pick: (s) => s.rpm },
  torque: { label: "Torque", color: "#f5a623", pick: (s) => s.torque },
  load: { label: "Load", color: "#f87171", pick: (s) => s.load },
  iq: { label: "Iq", color: "#34d399", pick: (s) => s.iq },
  ia: { label: "Ia", color: "#60a5fa", pick: (s) => s.ia },
  ib: { label: "Ib", color: "#a78bfa", pick: (s) => s.ib },
  ic: { label: "Ic", color: "#fb923c", pick: (s) => s.ic },
  pwm: { label: "PWM", color: "#e6edf3", pick: (s) => s.dA, fixed: [0, 1] },
};

const ALL: Ch[] = ["speed", "torque", "load", "iq", "ia", "ib", "ic", "pwm"];

export function Oscilloscope() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [on, setOn] = useState<Record<Ch, boolean>>({
    speed: true, torque: true, load: true, iq: true,
    ia: false, ib: false, ic: false, pwm: true,
  });

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

      const active = ALL.filter((c) => on[c]);
      // horizontal grid
      ctx.strokeStyle = "#1c232c";
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = (h * i) / 4;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      const n = buf.length;
      for (const c of active) {
        const meta = META[c];
        let lo: number, hi: number;
        if (meta.fixed) { [lo, hi] = meta.fixed; }
        else {
          lo = Infinity; hi = -Infinity;
          for (const s of buf) { const v = meta.pick(s); if (v < lo) lo = v; if (v > hi) hi = v; }
          if (lo === hi) { lo -= 1; hi += 1; }
          const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
        }
        const span = hi - lo || 1;
        ctx.strokeStyle = meta.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = (i / (n - 1)) * w;
          const y = h - ((meta.pick(buf[i]) - lo) / span) * h;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [on]);

  return (
    <div className="panel">
      <div className="panel-title"><span className="tag">SCOPE</span>示波器</div>
      <div className="scope-wrap">
        <canvas ref={canvasRef} className="scope" />
      </div>
      <div className="scope-legend">
        {ALL.map((c) => (
          <span key={c}>
            <i style={{ background: META[c].color, opacity: on[c] ? 1 : 0.25 }} />
            <label style={{ opacity: on[c] ? 1 : 0.4, cursor: "pointer" }} onClick={() => setOn((p) => ({ ...p, [c]: !p[c] }))}>
              {META[c].label}
            </label>
          </span>
        ))}
      </div>
    </div>
  );
}
