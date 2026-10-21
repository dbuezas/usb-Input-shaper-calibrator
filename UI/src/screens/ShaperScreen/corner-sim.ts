// Simulates the toolhead around a 90° corner: the planner's moves, then the input shaper, then one
// resonance (a mass on a spring) on each axis. Gives the real path, to show rounding and ringing.
import {
  CORNER_SIM_DEFAULT_ZETA,
  CORNER_SIM_LEG_MM,
  CORNER_SIM_SPEED_MM_S,
  CORNER_SIM_ZETA_RANGE,
  FREQUENCY_SLIDER_RANGE_HZ,
} from '@/constants';
import { binToHz, peakFromSeries, type CorneringSettings, type ShaperTaps } from './input-shaper';
import { scvEquivalentAtAccel } from './shaper-scores/klipper';

const DT_S = 1e-5;
const SAMPLE_EVERY = 10;
const LEAD_IN_S = 0.02;
const SETTLE_S = 0.05;

/** Position and speed along one straight move (start speed v0, end speed v1, cruise in between). */
const trapezoid = (v0: number, v1: number, accel: number) => {
  const v = Math.max(v0, v1, CORNER_SIM_SPEED_MM_S);
  const ta = (v - v0) / accel;
  const da = (v * v - v0 * v0) / (2 * accel);
  const td = (v - v1) / accel;
  const dd = (v * v - v1 * v1) / (2 * accel);
  const tc = Math.max(0, (CORNER_SIM_LEG_MM - da - dd) / v);
  const duration = ta + tc + td;
  const at = (t: number): [number, number] => {
    if (t <= 0) return [v0 * t, v0];
    if (t < ta) return [v0 * t + 0.5 * accel * t * t, v0 + accel * t];
    if (t < ta + tc) return [da + v * (t - ta), v];
    if (t < duration) {
      const u = t - ta - tc;
      return [da + v * tc + v * u - 0.5 * accel * u * u, v - accel * u];
    }
    return [da + v * tc + dd + v1 * (t - duration), v1];
  };
  return { duration, at };
};

export type Resonance = {
  peakHz: number;
  /** Damping ratio ζ. */
  zeta: number;
  /** False when the peak width could not be measured and ζ is the default. */
  measured: boolean;
};

/**
 * The highest peak and its damping, from the half-power width: ζ ≈ (f2 − f1) / (2·f0), where the
 * magnitude falls to peak/√2 at f1 and f2.
 */
export const resonanceFromSpectrum = (magnitudes: Float32Array): Resonance => {
  const peakHz = peakFromSeries(magnitudes, FREQUENCY_SLIDER_RANGE_HZ);
  const fallback = { peakHz, zeta: CORNER_SIM_DEFAULT_ZETA, measured: false };
  const peakBin = magnitudes.findIndex((_, i) => binToHz(i) === peakHz);
  const half = (magnitudes[peakBin] ?? 0) / Math.SQRT2;
  if (peakBin < 0 || !(half > 0)) return fallback;

  // Walks from the peak until the magnitude drops below `half`; interpolates the crossing.
  const crossingHz = (step: 1 | -1) => {
    for (let i = peakBin + step; i >= 0 && i < magnitudes.length; i += step) {
      const f = binToHz(i);
      if (f < FREQUENCY_SLIDER_RANGE_HZ[0] || f > FREQUENCY_SLIDER_RANGE_HZ[1]) return undefined;
      const prev = magnitudes[i - step];
      const cur = magnitudes[i];
      if (cur < half)
        return binToHz(i - step) + ((prev - half) / (prev - cur)) * (f - binToHz(i - step));
    }
    return undefined;
  };
  const f1 = crossingHz(-1);
  const f2 = crossingHz(1);
  if (f1 === undefined || f2 === undefined) return fallback;
  const zeta = (f2 - f1) / (2 * peakHz);
  if (zeta < CORNER_SIM_ZETA_RANGE[0] || zeta > CORNER_SIM_ZETA_RANGE[1]) return fallback;
  return { peakHz, zeta, measured: true };
};

export type CornerPath = {
  /** Toolhead positions (mm). The ideal corner is at (0, 0): in along +x, out along +y. */
  points: [number, number][];
};

export const simulateCorner = (
  taps: Pick<ShaperTaps, 'a' | 't'>,
  { peakHz, zeta }: Resonance,
  accel: number,
  cornering: CorneringSettings
): CornerPath => {
  const cornerSpeed = Math.min(CORNER_SIM_SPEED_MM_S, scvEquivalentAtAccel(cornering, accel));
  const legIn = trapezoid(CORNER_SIM_SPEED_MM_S, cornerSpeed, accel);
  const legOut = trapezoid(cornerSpeed, CORNER_SIM_SPEED_MM_S, accel);
  const sumA = taps.a.reduce((s, v) => s + v, 0);

  // Shaped command: weighted sum of time-shifted copies of the planned move (pos, speed per axis).
  const shaped = (t: number) => {
    let x = 0,
      vx = 0,
      y = 0,
      vy = 0;
    for (let i = 0; i < taps.a.length; i++) {
      const ti = t - taps.t[i];
      const w = taps.a[i] / sumA;
      if (ti < legIn.duration) {
        const [p, v] = legIn.at(ti);
        x += w * (p - CORNER_SIM_LEG_MM);
        vx += w * v;
      } else {
        const [p, v] = legOut.at(ti - legIn.duration);
        y += w * p;
        vy += w * v;
      }
    }
    return { x, vx, y, vy };
  };

  const omega = 2 * Math.PI * peakHz;
  const end = legIn.duration + legOut.duration + SETTLE_S;
  let { x, vx, y, vy } = shaped(-LEAD_IN_S);
  const points: [number, number][] = [];
  for (let step = 0, t = -LEAD_IN_S; t < end; step++, t += DT_S) {
    const c = shaped(t);
    vx += (-omega * omega * (x - c.x) - 2 * zeta * omega * (vx - c.vx)) * DT_S;
    vy += (-omega * omega * (y - c.y) - 2 * zeta * omega * (vy - c.vy)) * DT_S;
    x += vx * DT_S;
    y += vy * DT_S;
    if (step % SAMPLE_EVERY === 0) points.push([x, y]);
  }
  return { points };
};

/** How far the path cuts inside the corner (mm). */
export const cornerCutMm = ({ points }: CornerPath) =>
  points.reduce((m, [x, y]) => Math.max(m, Math.min(-x, y)), 0);

/** Largest sideways wobble of the outgoing wall (mm), from `fromMm` after the corner on. */
export const wallRippleMm = ({ points }: CornerPath, fromMm: number) =>
  points.reduce((m, [x, y]) => (y >= fromMm ? Math.max(m, Math.abs(x)) : m), 0);

export const NO_SHAPER: Pick<ShaperTaps, 'a' | 't'> = { a: [1], t: [0] };
