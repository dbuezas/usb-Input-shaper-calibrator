import type { ShaperParams, ShaperScoreMode, CorneringSettings } from '../input-shaper';
import { flatnessScoreFromMagnitudeSpectrum } from './flatness';
import { klipperScoreFromMagnitudeSpectrum } from './klipper';
import { variationScoreFromMagnitudeSpectrum } from './variation';

export const scoreCandidate = (
  magnitudes: Float32Array,
  params: ShaperParams,
  scoreMode: ShaperScoreMode,
  cornering: CorneringSettings,
  scoreRangeHz: [number, number]
) => {
  switch (scoreMode) {
    case 'flatness':
      return flatnessScoreFromMagnitudeSpectrum(magnitudes, params, scoreRangeHz);
    case 'klipper':
      return klipperScoreFromMagnitudeSpectrum(magnitudes, params, cornering, 5000, scoreRangeHz);
    case 'variation':
      return variationScoreFromMagnitudeSpectrum(magnitudes, params, scoreRangeHz);
  }
};
