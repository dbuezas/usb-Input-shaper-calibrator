import {
  applyShaperToMagnitudeSpectrumFromTaps,
  type ShaperTaps,
} from '@/screens/ShaperScreen/input-shaper';

const derivative = (values: Float32Array, dist: number) => {
  const out = new Float32Array(values.length);
  for (let i = dist; i < values.length; i++) {
    out[i] = values[i] - values[i - dist];
  }
  return out;
};

export const variationScoreFromMagnitudeSpectrumFromTaps = (
  magnitudes: Float32Array,
  taps: ShaperTaps,
  freqRangeHz: [number, number]
) => {
  let shaped = applyShaperToMagnitudeSpectrumFromTaps(taps, magnitudes, freqRangeHz);
  const dist = 10;
  shaped = derivative(shaped, dist);
  let tv = 0;
  for (let i = dist; i < shaped.length; i++) {
    const diff = shaped[i];
    tv += diff * diff;
  }
  return tv / shaped.length;
};
