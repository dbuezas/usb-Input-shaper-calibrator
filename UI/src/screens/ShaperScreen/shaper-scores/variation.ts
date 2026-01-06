import {
  applyShaperToMagnitudeSpectrum,
  type ShaperParams,
} from '@/screens/ShaperScreen/input-shaper';

export const variationScoreFromMagnitudeSpectrum = (
  magnitudes: Float32Array,
  params: ShaperParams,
  freqRangeHz: [number, number]
) => {
  const shaped = applyShaperToMagnitudeSpectrum(params, magnitudes, freqRangeHz);
  const dist = 10;
  let tv = 0;
  for (let i = 0 + dist; i < shaped.length; i++) {
    const diff = shaped[i] - shaped[i - dist];
    tv += diff * diff;
  }
  return tv / shaped.length;
};
