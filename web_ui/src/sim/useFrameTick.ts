import { useEffect, useReducer } from "react";

// Drives a re-render at a fixed UI rate (~30 FPS) so components can read the
// latest store snapshot. WebSocket messages never trigger React updates on
// their own (see store.ts).
export function useFrameTick(fps = 30): void {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const interval = 1000 / fps;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last >= interval) {
        last = t;
        force();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fps]);
}
