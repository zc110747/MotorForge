// Transient characterisation of the speed response, computed from the SAME
// sample buffer the oscilloscope draws (no extra data path).
//
// Why this exists: the SPEED window has to cover 0..100 rad/s to be useful as
// a global view, and a resistive load step only drags the shaft by a couple of
// rad/s. That dip is ~1-2 % of a full-scale axis, i.e. a few pixels on screen,
// so the textbook "dip -> correct -> recover" shape is invisible by eye even
// though the controller is behaving perfectly. These numbers extract the shape
// from the buffer so it can be read (and asserted) directly.
//
// The subtlety is WHICH dip to report. The buffer holds ~12 s of history, so
// right after Start it also contains the spin-up ramp from 0 rad/s, whose
// deviation (the whole setpoint) dwarfs any load transient. Taking a plain
// min() over the buffer would label the start-up as a "dip" and hide the real
// disturbance. So the search starts at the ONSET of the most recent excursion:
// the last sample that was still at the setpoint, with a departure after it.
import { Sample } from "./store";

export interface Transient {
  settled: boolean;        // has the speed been at the setpoint at least once in view?
  current: number;         // rpm, latest deviation from setpoint
  dip: number;             // rpm, deepest deviation since the excursion onset (<= 0)
  tDip: number;            // simulation time of that dip
  recoverS: number | null; // sim seconds from dip back inside the band, null = never
  tailMean: number;        // rpm, mean deviation over the trailing window
  band: number;            // rpm, recovery band actually used
}

// "at the setpoint" threshold for detecting an excursion onset, in rpm.
const QUIET = 1.0;

export function computeTransient(buf: Sample[], tailWindow = 1.0): Transient | null {
  const n = buf.length;
  if (n < 4) return null;

  const dev = buf.map((s) => s.rpm - s.targetRpm);

  // has it ever been at the setpoint inside this window?
  let iQuiet = -1;
  for (let i = 0; i < n; i++) if (Math.abs(dev[i]) <= QUIET) iQuiet = i;
  const settled = iQuiet >= 0;

  // suffix minimum: sufMin[i] = min(dev[i + 1 .. n - 1])
  const sufMin = new Array<number>(n).fill(Infinity);
  for (let i = n - 2; i >= 0; i--) sufMin[i] = Math.min(sufMin[i + 1], dev[i + 1]);

  // onset of the most recent excursion, or the last quiet sample when the
  // window contains no excursion at all (= everything is steady).
  let lo = 0;
  if (settled) {
    let onset = -1;
    for (let i = 0; i < n; i++) {
      if (dev[i] >= -QUIET && sufMin[i] < -QUIET) onset = i;
    }
    lo = onset >= 0 ? onset : iQuiet;
  }

  let iDip = lo;
  for (let i = lo + 1; i < n; i++) if (dev[i] < dev[iDip]) iDip = i;
  const dip = dev[iDip];
  const tDip = buf[iDip].t;

  const band = Math.max(0.5, Math.abs(dip) * 0.1);
  let recoverS: number | null = null;
  if (Math.abs(dip) <= band) {
    recoverS = 0; // never left the band inside this window
  } else {
    for (let i = iDip + 1; i < n; i++) {
      if (Math.abs(dev[i]) <= band) {
        recoverS = buf[i].t - tDip;
        break;
      }
    }
  }

  const tEnd = buf[n - 1].t;
  let sum = 0;
  let count = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (tEnd - buf[i].t > tailWindow) break;
    sum += dev[i];
    count++;
  }

  return {
    settled,
    current: dev[n - 1],
    dip,
    tDip,
    recoverS,
    tailMean: count > 0 ? sum / count : 0,
    band,
  };
}
