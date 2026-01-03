import { computeMarlinShaperTaps, type ShaperParams } from '@/screens/ShaperScreen/input-shaper';
import { FIXED_SAMPLE_RATE } from '@/constants';

import { shaperMagnitudeAtHzFromTaps } from './shaper-magnitude';

export const variationScoreFromMagnitudeSpectrum = (
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

  const taps = computeMarlinShaperTaps(params);
  const a = taps.a;
  const t = taps.t;
  if (!a.length || !t.length) return Number.POSITIVE_INFINITY;

  // Total variation of the shaped spectrum: Σ |y[i] - y[i-1]|.
  let prev = magnitudes[start] * shaperMagnitudeAtHzFromTaps(a, t, start * freqStepHz);
  let tv = 0;
  for (let i = start + 1; i <= end; i++) {
    const h = shaperMagnitudeAtHzFromTaps(a, t, i * freqStepHz);
    const next = magnitudes[i] * h;
    tv += Math.abs(next - prev);
    prev = next;
  }
  return Number.isFinite(tv) ? tv : Number.POSITIVE_INFINITY;
};
