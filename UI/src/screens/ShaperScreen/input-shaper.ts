import { FIXED_SAMPLE_RATE } from '@/constants';

export type InputShaperType = 'zv' | 'zvd' | 'zvdd' | 'zvddd' | 'ei' | '2hei' | '3hei' | 'mzv';

export type ShaperParams = {
  type: InputShaperType;
  fHz: number;
  zeta: number;
  vtol: number;
};

export type ShaperScoreMode = 'klipper' | 'flatness' | 'variation';

export type CorneringModel = 'scv' | 'jerk' | 'junction_deviation';

export type CorneringSettings =
  | { model: 'scv'; scv: number }
  | { model: 'jerk'; jerk: number }
  | { model: 'junction_deviation'; junctionDeviation: number };

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const safeSqrt = (v: number) => Math.sqrt(Math.max(0, v));

const computeK = (zeta: number) => {
  const z = clamp(zeta, 0, 0.99);
  return Math.exp((-z * Math.PI) / safeSqrt(1 - z * z));
};

type ShaperTaps = { a: number[]; t: number[] };

export const computeMarlinShaperTaps = ({ type, fHz, zeta, vtol }: ShaperParams): ShaperTaps => {
  const f = Math.max(0.01, fHz);
  const z = clamp(zeta, 0, 0.99);
  const v = clamp(vtol, 0, 0.99);

  const K = computeK(z);
  const K2 = K * K;
  const K3 = K2 * K;
  const K4 = K3 * K;

  // From Marlin: df = sqrt(1 - zeta^2), base=0.5 for these shapers.
  const df = safeSqrt(1 - z * z);
  const base = 0.5;
  const t1 = base / f / df; // seconds between taps (except i=0)

  let a: number[];
  switch (type) {
    case 'zv': {
      a = [1 / (1 + K), (1 / (1 + K)) * K];
      break;
    }
    case 'zvd': {
      const a0 = 1 / (1 + 2 * K + K2);
      a = [a0, a0 * 2 * K, a0 * K2];
      break;
    }
    case 'zvdd': {
      const a0 = 1 / (1 + 3 * K + 3 * K2 + K3);
      a = [a0, a0 * 3 * K, a0 * 3 * K2, a0 * K3];
      break;
    }
    case 'zvddd': {
      const a0 = 1 / (1 + 4 * K + 6 * K2 + 4 * K3 + K4);
      a = [a0, a0 * 4 * K, a0 * 6 * K2, a0 * 4 * K3, a0 * K4];
      break;
    }
    case 'ei': {
      // Marlin EI uses vtol
      const a0 = 0.25 * (1 + v);
      const a1 = 0.5 * (1 - v) * K;
      const a2 = a0 * K2;
      const adj = 1 / (a0 + a1 + a2);
      a = [a0 * adj, a1 * adj, a2 * adj];
      break;
    }
    case '2hei': {
      const v2 = v * v;
      const X = Math.pow(v2 * (safeSqrt(1 - v2) + 1), 1 / 3);
      const a0 = (3 * X * X + 2 * X + 3 * v2) / (16 * X);
      const a1 = (0.5 - a0) * K;
      const a2 = a1 * K;
      const a3 = a0 * K3;
      const adj = 1 / (a0 + a1 + a2 + a3);
      a = [a0 * adj, a1 * adj, a2 * adj, a3 * adj];
      break;
    }
    case '3hei': {
      const a0 = 0.0625 * (1 + 3 * v + 2 * safeSqrt(2 * (v + 1) * v));
      const a1 = 0.25 * (1 - v) * K;
      const a2 = (0.5 * (1 + v) - 2 * a0) * K2;
      const a3 = a1 * K2;
      const a4 = a0 * K4;
      const adj = 1 / (a0 + a1 + a2 + a3 + a4);
      a = [a0 * adj, a1 * adj, a2 * adj, a3 * adj, a4 * adj];
      break;
    }
    case 'mzv': {
      // Marlin MZV
      const Bx = 1.4142135623730951 * K;
      const a0 = 1 / (1 + Bx + K2);
      a = [a0, a0 * Bx, a0 * K2];
      break;
    }
    default:
      a = [1];
      break;
  }

  const t = a.map((_, i) => i * t1);
  return { a, t };
};

export const shaperMagnitudeAtHz = (params: ShaperParams, freqHz: number) => {
  const { a, t } = computeMarlinShaperTaps(params);
  const w = 2 * Math.PI * freqHz;
  let re = 0;
  let im = 0;
  for (let i = 0; i < a.length; i++) {
    const phase = -w * t[i];
    re += a[i] * Math.cos(phase);
    im += a[i] * Math.sin(phase);
  }
  return Math.sqrt(re * re + im * im);
};

const binToHz = (bin: number, bins: number) => bin * (FIXED_SAMPLE_RATE / (2 * (bins - 1)));

export const applyShaperToMagnitudeSpectrum = (params: ShaperParams, magnitudes: Float32Array) => {
  const out = new Float32Array(magnitudes.length);
  for (let i = 0; i < magnitudes.length; i++) {
    const f = i * (FIXED_SAMPLE_RATE / (2 * (magnitudes.length - 1)));
    const h = shaperMagnitudeAtHz(params, f);
    out[i] = magnitudes[i] * h;
  }
  return out;
};

export const flatnessScoreFromMagnitudeSpectrum = (
  magnitudes: Float32Array,
  params: ShaperParams,
  freqRangeHz: [number, number] = [0, 200]
) => {
  if (!magnitudes.length) return Number.POSITIVE_INFINITY;

  const shaped = applyShaperToMagnitudeSpectrum(params, magnitudes);

  const fMin = Math.max(0, Math.min(freqRangeHz[0], freqRangeHz[1]));
  const fMax = Math.max(0, Math.max(freqRangeHz[0], freqRangeHz[1]));
  let sum = 0;
  let count = 0;
  for (let i = 0; i < shaped.length; i++) {
    const f = binToHz(i, shaped.length);
    if (f < fMin) continue;
    if (f > fMax) break;
    sum += shaped[i];
    count++;
  }
  if (!count) return Number.POSITIVE_INFINITY;
  const mean = sum / count;

  let sse = 0;
  // Second pass must iterate the same bins as the first pass.
  let seen = 0;
  for (let i = 0; i < shaped.length; i++) {
    const f = binToHz(i, shaped.length);
    if (f < fMin) continue;
    if (f > fMax) break;
    const d = shaped[i] - mean;
    sse += d * d;
    seen++;
  }

  // Normalize by mean² so the score is roughly scale-invariant.
  const denom = mean * mean * seen;
  return denom > 0 ? sse / denom : Number.POSITIVE_INFINITY;
};

export const applyShaperToWelchPsd = (params: ShaperParams, psd: number[]) => {
  // PSD is power, so apply |H|^2.
  const out = new Array<number>(psd.length);
  for (let i = 0; i < psd.length; i++) {
    const f = i * (FIXED_SAMPLE_RATE / (2 * (psd.length - 1)));
    const h = shaperMagnitudeAtHz(params, f);
    out[i] = psd[i] * h * h;
  }
  return out;
};

// Klipper-like scoring (adapted for our Marlin tap generator). This mirrors the
// logic in `klipper-master/klippy/extras/shaper_calibrate.py`.

const TEST_DAMPING_RATIOS = [0.075, 0.1, 0.15] as const;
const SHAPER_VIBRATION_REDUCTION = 20;

const estimateShaperVals = (
  a: number[],
  t: number[],
  testDampingRatio: number,
  freqsHz: number[]
) => {
  const invD = 1 / a.reduce((s, v) => s + v, 0);
  const lastT = t.length ? (t[t.length - 1] ?? 0) : 0;
  const out = new Array<number>(freqsHz.length);

  for (let i = 0; i < freqsHz.length; i++) {
    const omega = 2 * Math.PI * (freqsHz[i] ?? 0);
    const damping = testDampingRatio * omega;
    const omegaD = omega * Math.sqrt(Math.max(0, 1 - testDampingRatio * testDampingRatio));

    let sSum = 0;
    let cSum = 0;
    for (let j = 0; j < a.length; j++) {
      const tj = t[j] ?? 0;
      const w = (a[j] ?? 0) * Math.exp(-damping * (lastT - tj));
      sSum += w * Math.sin(omegaD * tj);
      cSum += w * Math.cos(omegaD * tj);
    }

    out[i] = Math.sqrt(sSum * sSum + cSum * cSum) * invD;
  }

  return out;
};

const estimateRemainingVibrations = (
  freqsHz: number[],
  psd: number[],
  a: number[],
  t: number[]
) => {
  let worstRemaining = 0;
  const psdMax = Math.max(...psd);
  const vibrThreshold = psdMax / SHAPER_VIBRATION_REDUCTION;

  for (const dr of TEST_DAMPING_RATIOS) {
    const vals = estimateShaperVals(a, t, dr, freqsHz);
    let remainingSum = 0;
    let allSum = 0;
    for (let i = 0; i < psd.length; i++) {
      const base = Math.max((psd[i] ?? 0) - vibrThreshold, 0);
      allSum += base;
      remainingSum += Math.max((vals[i] ?? 0) * (psd[i] ?? 0) - vibrThreshold, 0);
    }
    const ratio = allSum > 0 ? remainingSum / allSum : Number.POSITIVE_INFINITY;
    worstRemaining = Math.max(worstRemaining, ratio);
  }

  return worstRemaining;
};

const clampPositive = (v: number, fallback: number) => (Number.isFinite(v) && v > 0 ? v : fallback);

const scvEquivalentAtAccel = (settings: CorneringSettings, accel: number) => {
  switch (settings.model) {
    case 'scv':
      return clampPositive(settings.scv, 5);
    case 'jerk':
      // Approximation: classic jerk is a velocity delta allowance at corners.
      return clampPositive(settings.jerk, 10);
    case 'junction_deviation': {
      // Marlin-style junction deviation: approximate the 90° cornering speed.
      // For θ=90°, sin(θ/2)=sin(45°)=√2/2, giving factor sin/(1-sin) = 1+√2.
      // v ≈ sqrt(a * jd * (1+√2))
      const jd = clampPositive(settings.junctionDeviation, 0.02);
      const a = Math.max(0, accel);
      return Math.sqrt(a * jd * (1 + Math.SQRT2));
    }
  }
};

const klipperSmoothing = (
  a: number[],
  t: number[],
  accel = 5000,
  cornering: CorneringSettings = { model: 'scv', scv: 5 }
) => {
  const invD = 1 / a.reduce((s, v) => s + v, 0);
  const halfAccel = accel * 0.5;
  const scv = scvEquivalentAtAccel(cornering, accel);

  let ts = 0;
  for (let i = 0; i < t.length; i++) ts += (a[i] ?? 0) * (t[i] ?? 0);
  ts *= invD;

  let offset90 = 0;
  let offset180 = 0;
  for (let i = 0; i < t.length; i++) {
    const dt = (t[i] ?? 0) - ts;
    if ((t[i] ?? 0) >= ts) offset90 += (a[i] ?? 0) * (scv + halfAccel * dt) * dt;
    offset180 += (a[i] ?? 0) * halfAccel * dt * dt;
  }
  offset90 *= invD * Math.sqrt(2);
  offset180 *= invD;
  return Math.max(offset90, offset180);
};

const bisectMaxTrue = (predicate: (x: number) => boolean) => {
  let left = 1;
  let right = 1;

  if (!predicate(1e-9)) return 0;

  while (!predicate(left)) {
    right = left;
    left *= 0.5;
  }

  if (right === left) {
    while (predicate(right)) right *= 2;
  }

  while (right - left > 1e-8) {
    const middle = (left + right) * 0.5;
    if (predicate(middle)) left = middle;
    else right = middle;
  }

  return left;
};

// Klipper-style max_accel projection.
// In Klipper this is used to suggest a maximum acceleration that keeps the
// smoothing under a fixed threshold (TARGET_SMOOTHING).
export const klipperSuggestedMaxAccel = (params: ShaperParams, scv = 5, targetSmoothing = 0.12) => {
  const taps = computeMarlinShaperTaps(params);
  if (!taps.a.length) return 0;

  const maxAccel = bisectMaxTrue(
    (testAccel) =>
      klipperSmoothing(taps.a, taps.t, testAccel, { model: 'scv', scv }) <= targetSmoothing
  );

  return Number.isFinite(maxAccel) ? maxAccel : 0;
};

export const suggestedMaxAccel = (
  params: ShaperParams,
  cornering: CorneringSettings,
  targetSmoothing = 0.12
) => {
  const taps = computeMarlinShaperTaps(params);
  if (!taps.a.length) return 0;

  const maxAccel = bisectMaxTrue(
    (testAccel) => klipperSmoothing(taps.a, taps.t, testAccel, cornering) <= targetSmoothing
  );
  return Number.isFinite(maxAccel) ? maxAccel : 0;
};

export const klipperScoreFromMagnitudeSpectrum = (
  magnitudes: Float32Array,
  params: ShaperParams,
  cornering: CorneringSettings = { model: 'scv', scv: 5 },
  smoothingAccel = 5000,
  freqRangeHz: [number, number] = [0, 200]
) => {
  if (!magnitudes.length) return Number.POSITIVE_INFINITY;

  const fMin = Math.max(0, Math.min(freqRangeHz[0], freqRangeHz[1]));
  const fMax = Math.max(0, Math.max(freqRangeHz[0], freqRangeHz[1]));

  const freqsHz: number[] = [];
  const psd: number[] = [];
  for (let i = 0; i < magnitudes.length; i++) {
    const f = binToHz(i, magnitudes.length);
    if (f < fMin) continue;
    if (f > fMax) break;
    freqsHz.push(f);
    const m = magnitudes[i];
    psd.push(m * m);
  }

  const taps = computeMarlinShaperTaps(params);
  const vibrs = estimateRemainingVibrations(freqsHz, psd, taps.a, taps.t);
  if (!Number.isFinite(vibrs)) return Number.POSITIVE_INFINITY;

  const smoothing = klipperSmoothing(taps.a, taps.t, smoothingAccel, cornering);
  if (!Number.isFinite(smoothing)) return Number.POSITIVE_INFINITY;

  return smoothing * (Math.pow(vibrs, 1.5) + vibrs * 0.2 + 0.01);
};
