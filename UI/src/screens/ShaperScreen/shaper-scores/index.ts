import type { CorneringSettings, ShaperTaps } from '../input-shaper';
import { klipperScoreFromMagnitudeSpectrumFromTaps } from './klipper';
import { variationScoreFromMagnitudeSpectrumFromTaps } from './variation';

export const scoreCandidateFromTaps = (
  magnitudes: Float32Array,
  taps: ShaperTaps,
  scoreMode: ShaperScoreMode,
  cornering: CorneringSettings,
  scoreRangeHz: [number, number]
) => {
  switch (scoreMode) {
    case 'klipper':
      return klipperScoreFromMagnitudeSpectrumFromTaps(magnitudes, taps, cornering, scoreRangeHz);
    case 'variation':
      return variationScoreFromMagnitudeSpectrumFromTaps(magnitudes, taps, scoreRangeHz);
  }
};

export type ShaperScoreMode = 'klipper' | 'variation';
