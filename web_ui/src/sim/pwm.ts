// Derived PWM / modulation metrics.
//
// WHY THIS EXISTS
// ---------------
// The three "PWM" numbers in a simulation.state message are the per-phase
// duties produced by SVPWM from a ROTATING terminal-voltage vector. Each phase
// duty is therefore a sinusoid at the electrical frequency
//
//     f_e = num_pole_pairs * |omega_m| / 2*pi      (63.7 Hz at 100 rad/s, 4 pp)
//
// while the telemetry carries only ~50/speed_scale samples per SIMULATED
// second (the server pushes every 20 ms of wall time and speed_scale = 2, so
// ~25 samples per simulated second). That is ~2.5 electrical revolutions
// between two UI frames: the raw duty readout is aliased and looks like random
// jitter, even though the underlying waveform is perfectly clean.
//
// The aliasing-immune summaries - and the ones that actually answer "how hard
// is the inverter working" - are the ones below:
//
//   m   modulation index, |V_qd| / (V_bus / 2).
//       NOT zero at no load: a spinning motor needs terminal voltage to hold
//       its own back-EMF while drawing no current.
//   amp half-swing of each phase duty around 0.5, in duty units.
//       For the min-max SVPWM used upstream the peak-to-peak duty swing is
//       exactly sqrt(2) * m for m <= sqrt(2), hence amp = m / (2 * sqrt(2)).
//       Verified against the real server (tools/verify_pwm.py, case P-05).
//   fE  electrical frequency: how fast that vector rotates.
//
// Everything is computed from ONE snapshot, by plain algebra on quantities
// that snapshot already carries (vq, vd, busVoltage, numPolePairs, dutyA..C) -
// the same way rpm is derived from mechanicalSpeed. No second data path, and
// nothing is integrated on the client.
import type { SimState } from "./store";

/** Modulation index above which the SVPWM runs out of linear range and the
 *  duties start pinning at 0 / 1 (sqrt(2), by the hexagon geometry). */
export const PWM_LINEAR_M = Math.SQRT2;

export interface PwmMetrics {
  /** |V_qd| / (V_bus / 2); dimensionless, >= PWM_LINEAR_M means overmodulation */
  m: number;
  /** per-phase duty half-swing around 0.5 (duty units) */
  amp: number;
  /** electrical frequency [Hz] - the rotation rate of the voltage vector */
  fE: number;
  /** electrical cycles per telemetry frame; > 0.5 means the raw duty readout
   *  is aliased (it *cannot* be read as a number) */
  aliasPerFrame: number;
  /** measured simulated-seconds between two telemetry frames (0 until known) */
  frameDtSim: number;
  /** true once the voltage vector exceeds the linear SVM range */
  limited: boolean;
  /** true when a phase duty is actually pinned at 0 or 1 right now */
  clipped: boolean;
}

export function electricalHz(numPolePairs: number, mechanicalSpeed: number): number {
  return (numPolePairs * Math.abs(mechanicalSpeed)) / (2 * Math.PI);
}

export function modulationIndex(vq: number, vd: number, busVoltage: number): number {
  const half = busVoltage / 2;
  return half > 0 ? Math.hypot(vq, vd) / half : 0;
}

/** Per-phase duty half-swing for min-max SVPWM, straight from the modulation
 *  index (no curve fitting: p-p = sqrt(2) * m in the linear range). */
export function dutyHalfSwing(m: number): number {
  return m / (2 * Math.SQRT2);
}

/**
 * @param frameDtSim simulated seconds between the last two telemetry frames,
 *        measured from `timestamp` deltas by the store. It is NOT a nominal
 *        constant: the server's push loop adds a few ms of overhead on top of
 *        the 20 ms wall interval, and `speed_scale` multiplies that into
 *        simulated time. Measuring beats assuming - the first UI version
 *        guessed `speedScale / 50`, read `undefined` (the field is not on the
 *        wire) and under-reported the aliasing by 2x.
 */
export function pwmMetrics(s: SimState, frameDtSim: number): PwmMetrics {
  const m = modulationIndex(s.electrical.vq, s.electrical.vd, s.pwm.busVoltage);
  const fE = electricalHz(s.params.numPolePairs, s.rotor.mechanicalSpeed);
  const dt = frameDtSim > 0 ? frameDtSim : 0;
  const d = [s.pwm.dutyA, s.pwm.dutyB, s.pwm.dutyC];
  return {
    m,
    amp: dutyHalfSwing(m),
    fE,
    frameDtSim: dt,
    aliasPerFrame: fE * dt,
    limited: m >= PWM_LINEAR_M,
    clipped: Math.min(...d) <= 0.002 || Math.max(...d) >= 0.998,
  };
}
