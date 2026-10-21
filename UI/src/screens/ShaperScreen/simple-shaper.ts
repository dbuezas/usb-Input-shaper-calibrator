// Simple mode: for each shaper, the frequency that gives the highest max accel while the ringing
// left stays under the chosen limit, also when the resonance drifts a bit.
import {
  FREQUENCY_SLIDER_RANGE_HZ,
  shaperF0RangeHz,
  SIMPLE_SHAPER_ROUNDING_ACCEL,
} from '@/constants';
import {
  ALL_SHAPER_TYPES,
  binToHz,
  computeMarlinShaperTaps,
  type CorneringSettings,
  type InputShaperType,
  type ShaperParams,
  type ShaperTaps,
} from './input-shaper';
import {
  estimateShaperVals,
  klipperSmoothing,
  suggestedMaxAccelFromTaps,
  SHAPER_VIBRATION_REDUCTION,
  TEST_DAMPING_RATIOS,
} from './shaper-scores/klipper';

export type Priority = 'fast' | 'balanced' | 'clean';

export const PRIORITIES: Record<
  Priority,
  { label: string; maxRinging: number; drift: number; description: string }
> = {
  fast: {
    label: 'Fast prints',
    maxRinging: 0.1,
    drift: 0.05,
    description: 'Highest acceleration. Some ringing may stay.',
  },
  balanced: {
    label: 'Balanced',
    maxRinging: 0.07,
    drift: 0.1,
    description: 'Little ringing, good acceleration. Tolerates ±10% resonance drift.',
  },
  clean: {
    label: 'Clean surfaces',
    maxRinging: 0.03,
    drift: 0.15,
    description: 'Least ringing, tolerates ±15% drift. Print slower.',
  },
};
export const PRIORITY_ORDER: Priority[] = ['fast', 'balanced', 'clean'];

// Klipper's defaults for the damping ratio and the EI tolerance.
const SIMPLE_ZETA = 0.1;
const SIMPLE_VTOL = 0.05;
const F_STEP_HZ = 0.5;

export type SimpleCandidate = {
  params: ShaperParams;
  fEffHz: number;
  /** Worst fraction of the vibration left (Klipper's "vibrations"), over the drift band. */
  ringing: number;
  maxAccel: number;
  /** Corner rounding (Klipper smoothing, mm) at SIMPLE_SHAPER_ROUNDING_ACCEL. */
  roundingMm: number;
  meetsTarget: boolean;
};

// Klipper's remaining-vibration estimate, also with the resonance moved by ±drift.
const ringingLeft = (freqsHz: number[], psd: number[], taps: ShaperTaps, drift: number) => {
  const threshold = Math.max(...psd) / SHAPER_VIBRATION_REDUCTION;
  let allSum = 0;
  for (const p of psd) allSum += Math.max(p - threshold, 0);
  if (allSum <= 0) return 0;
  let worst = 0;
  for (const d of [1 - drift, 1, 1 + drift]) {
    const shifted = freqsHz.map((f) => f * d);
    for (const dr of TEST_DAMPING_RATIOS) {
      const vals = estimateShaperVals(taps.a, taps.t, dr, shifted);
      let remaining = 0;
      for (let i = 0; i < psd.length; i++) remaining += Math.max(vals[i] * psd[i] - threshold, 0);
      worst = Math.max(worst, remaining / allSum);
    }
  }
  return worst;
};

const spectrumInRange = (magnitudes: Float32Array) => {
  const freqsHz: number[] = [];
  const psd: number[] = [];
  for (let i = 0; i < magnitudes.length; i++) {
    const f = binToHz(i);
    if (f < FREQUENCY_SLIDER_RANGE_HZ[0]) continue;
    if (f > FREQUENCY_SLIDER_RANGE_HZ[1]) break;
    freqsHz.push(f);
    psd.push(magnitudes[i] * magnitudes[i]);
  }
  return { freqsHz, psd };
};

/** Every distinct shaper Marlin can run for this type (it rounds the tap spacing to FTM_FS). */
const candidatesForType = (type: InputShaperType, ftmFs: number) => {
  const [fMin, fMax] = shaperF0RangeHz(ftmFs);
  const byTaps = new Map<string, { params: ShaperParams; taps: ShaperTaps }>();
  for (let fHz = fMin; fHz <= fMax; fHz += F_STEP_HZ) {
    const params = { type, fHz, zeta: SIMPLE_ZETA, vtol: SIMPLE_VTOL };
    const taps = computeMarlinShaperTaps(params, ftmFs);
    const key = taps.t.join();
    // Keep the f0 closest to the effective notch, so the G-code says what Marlin really runs.
    const prev = byTaps.get(key);
    if (!prev || Math.abs(fHz - taps.fEffHz) < Math.abs(prev.params.fHz - taps.fEffHz))
      byTaps.set(key, { params, taps });
  }
  return [...byTaps.values()];
};

/** Best candidate per shaper type for the priority, sorted by max accel (highest first). */
export const rankShapers = (
  magnitudes: Float32Array,
  priority: Priority,
  cornering: CorneringSettings,
  ftmFs: number
): SimpleCandidate[] => {
  const { maxRinging, drift } = PRIORITIES[priority];
  const { freqsHz, psd } = spectrumInRange(magnitudes);
  if (!psd.length || Math.max(...psd) <= 0) return [];

  const best = ALL_SHAPER_TYPES.map((type) => {
    const all = candidatesForType(type, ftmFs).map(({ params, taps }): SimpleCandidate => {
      const ringing = ringingLeft(freqsHz, psd, taps, drift);
      return {
        params,
        fEffHz: taps.fEffHz,
        ringing,
        maxAccel: suggestedMaxAccelFromTaps(taps, cornering),
        roundingMm: klipperSmoothing(taps.a, taps.t, SIMPLE_SHAPER_ROUNDING_ACCEL, cornering),
        meetsTarget: ringing <= maxRinging,
      };
    });
    const ok = all.filter((c) => c.meetsTarget);
    return ok.length
      ? ok.reduce((a, b) => (b.maxAccel > a.maxAccel ? b : a))
      : all.reduce((a, b) => (b.ringing < a.ringing ? b : a));
  });

  return best.sort(
    (a, b) =>
      Number(b.meetsTarget) - Number(a.meetsTarget) ||
      (a.meetsTarget ? b.maxAccel - a.maxAccel : a.ringing - b.ringing)
  );
};
