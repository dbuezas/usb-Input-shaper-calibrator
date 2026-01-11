import {
  binToHz,
  computeMarlinShaperTaps,
  type CorneringSettings,
  type ShaperParams,
  type ShaperTaps,
} from '@/screens/ShaperScreen/input-shaper';

export const klipperScoreFromMagnitudeSpectrum = (
  magnitudes: Float32Array,
  params: ShaperParams,
  cornering: CorneringSettings,
  freqRangeHz: [number, number],
  smoothingAccel = 5000
) => {
  const taps = computeMarlinShaperTaps(params);
  return klipperScoreFromMagnitudeSpectrumFromTaps(
    magnitudes,
    taps,
    cornering,
    freqRangeHz,
    smoothingAccel
  );
};

export const klipperScoreFromMagnitudeSpectrumFromTaps = (
  magnitudes: Float32Array,
  taps: ShaperTaps,
  cornering: CorneringSettings,
  freqRangeHz: [number, number],
  smoothingAccel = 5000
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

  const vibrs = estimateRemainingVibrations(freqsHz, psd, taps.a, taps.t);
  if (!Number.isFinite(vibrs)) return Number.POSITIVE_INFINITY;

  const smoothing = klipperSmoothing(taps.a, taps.t, smoothingAccel, cornering);
  if (!Number.isFinite(smoothing)) return Number.POSITIVE_INFINITY;

  return smoothing * (Math.pow(vibrs, 1.5) + vibrs * 0.2 + 0.01);
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

const klipperSmoothing = (
  a: number[],
  t: number[],
  accel: number,
  cornering: CorneringSettings
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

export const suggestedMaxAccelFromTaps = (
  taps: ShaperTaps,
  cornering: CorneringSettings,
  targetSmoothing = 0.12
) => {
  if (!taps.a.length) return 0;

  const maxAccel = bisectMaxTrue(
    (testAccel) => klipperSmoothing(taps.a, taps.t, testAccel, cornering) <= targetSmoothing
  );
  return Number.isFinite(maxAccel) ? maxAccel : 0;
};

const scvEquivalentAtAccel = ({ model, value }: CorneringSettings, accel: number) => {
  switch (model) {
    case 'scv':
      return value;
    case 'jerk':
      // Approximation: classic jerk is a velocity delta allowance at corners.
      return value;
    case 'junction_deviation': {
      // Marlin-style junction deviation: approximate the 90° cornering speed.
      // For θ=90°, sin(θ/2)=sin(45°)=√2/2, giving factor sin/(1-sin) = 1+√2.
      // v ≈ sqrt(a * jd * (1+√2))
      const jd = value;
      return Math.sqrt(accel * jd * (1 + Math.SQRT2));
    }
  }
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
