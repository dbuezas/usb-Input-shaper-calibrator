import { FIXED_SAMPLE_RATE } from '@/constants';
import {
  computeMarlinShaperTaps,
  shaperMagnitudeAtHzFromTaps,
  type ShaperParams,
} from '@/screens/ShaperScreen/input-shaper';

export const flatnessScoreFromMagnitudeSpectrum = (
  magnitudes: Float32Array,
  params: ShaperParams,
  freqRangeHz: [number, number]
) => {
  if (!magnitudes.length) return Number.POSITIVE_INFINITY;

  const freqStepHz = FIXED_SAMPLE_RATE / (2 * (magnitudes.length - 1));
  const fMinHz = Math.min(freqRangeHz[0], freqRangeHz[1]);
  const fMaxHz = Math.max(freqRangeHz[0], freqRangeHz[1]);
  const start = Math.max(0, Math.floor(fMinHz / freqStepHz));
  const end = Math.min(magnitudes.length - 1, Math.floor(fMaxHz / freqStepHz));
  if (end <= start) return Number.POSITIVE_INFINITY;
  const count = end - start + 1;

  const taps = computeMarlinShaperTaps(params);
  const a = taps.a;
  const t = taps.t;
  if (!a.length || !t.length) return Number.POSITIVE_INFINITY;

  // Two-pass: mean then SSE, but no allocations and taps computed once.
  let sum = 0;
  for (let i = start; i <= end; i++) {
    const h = shaperMagnitudeAtHzFromTaps(a, t, i * freqStepHz);
    sum += (magnitudes[i] ?? 0) * h;
  }
  const mean = sum / count;
  if (!Number.isFinite(mean) || mean <= 0) return Number.POSITIVE_INFINITY;

  let sse = 0;
  for (let i = start; i <= end; i++) {
    const h = shaperMagnitudeAtHzFromTaps(a, t, i * freqStepHz);
    const d = (magnitudes[i] ?? 0) * h - mean;
    sse += d * d;
  }

  const denom = mean * mean * count;
  return denom > 0 ? sse / denom : Number.POSITIVE_INFINITY;
};
