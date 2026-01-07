import { FIXED_SAMPLE_RATE, WINDOW_SIZE } from '@/constants';

export const ALL_SHAPER_TYPES = [
  '3hei',
  'zvddd',
  '2hei',
  'zvdd',
  'zv',
  'mzv',
  'zvd',
  'ei',
] as const;
export type InputShaperType = (typeof ALL_SHAPER_TYPES)[number];

export type ShaperParams = {
  type: InputShaperType;
  fHz: number;
  zeta: number;
  vtol: number;
};

export type CorneringSettings =
  | { model: 'scv'; value: number }
  | { model: 'jerk'; value: number }
  | { model: 'junction_deviation'; value: number };

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const safeSqrt = (v: number) => Math.sqrt(Math.max(0, v));

const computeK = (zeta: number) => {
  const z = clamp(zeta, 0, 0.99);
  return Math.exp((-z * Math.PI) / safeSqrt(1 - z * z));
};

type ShaperTaps = { a: number[]; t: number[] };

export const computeDelayCentroidSeconds = (params: ShaperParams) => {
  const { a, t } = computeMarlinShaperTaps(params);
  const sumA = a.reduce((s, v) => s + v, 0);
  let centroid = 0;
  for (let i = 0; i < a.length; i++) centroid += a[i] * t[i];
  centroid /= sumA;
  return centroid;
};

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

export const binToHz = (bin: number, bins: number) => bin * (FIXED_SAMPLE_RATE / (2 * (bins - 1)));

export const applyShaperToMagnitudeSpectrum = (
  params: ShaperParams,
  magnitudes: Float32Array,
  freqRangeHz?: [number, number]
) => {
  let start = 0;
  let end = magnitudes.length;
  const freqStepHz = FIXED_SAMPLE_RATE / WINDOW_SIZE;

  if (freqRangeHz) {
    start = Math.floor(freqRangeHz[0] / freqStepHz);
    end = Math.floor(freqRangeHz[1] / freqStepHz);
  }

  const { a, t } = computeMarlinShaperTaps(params);
  const out = new Float32Array(end - start);
  for (let i = start; i < end; i++) {
    const f = i * freqStepHz;
    const h = shaperMagnitudeAtHzFromTaps(a, t, f);
    out[i - start] = magnitudes[i] * h;
  }
  return out;
};

export const computeShaperResponse = (params: ShaperParams, freqRangeHz: [number, number]) => {
  // Match the FFT binning used by the DSP pipeline (see `WINDOW_SIZE` in `src/constants.ts`).
  // For an N-point real FFT, the magnitude spectrum has N/2+1 bins from 0..Nyquist.
  const bins = WINDOW_SIZE / 2 + 1;
  const freqStepHz = FIXED_SAMPLE_RATE / WINDOW_SIZE;

  const start = Math.max(0, Math.floor(freqRangeHz[0] / freqStepHz));
  const end = Math.min(bins, Math.ceil(freqRangeHz[1] / freqStepHz));

  const { a, t } = computeMarlinShaperTaps(params);

  // Return a full-length response so it can be plotted/combined with spectra directly.
  // Values outside the requested range are set to 0.
  const out = new Float32Array(bins);
  for (let i = start; i < end; i++) {
    const f = i * freqStepHz;
    out[i] = shaperMagnitudeAtHzFromTaps(a, t, f);
  }
  return out;
};

const shaperMagnitudeAtHzFromTaps = (a: number[], t: number[], freqHz: number) => {
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

export const isEiFamily = (t: InputShaperType) => t === 'ei' || t === '2hei' || t === '3hei';
