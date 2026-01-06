import { atom } from 'jotai';
import { FIXED_SAMPLE_RATE, FREQUENCY_SLIDER_RANGE_HZ } from '@/constants';
import { frequencyRangeAtom } from '@/atoms/frequency-range';
import {
  applyShaperToMagnitudeSpectrum,
  computeDelayCentroidSeconds,
  type CorneringSettings,
  type ShaperParams,
  type ShaperScoreMode,
} from './input-shaper';
import { spectrogramMaxHoldAtom } from '../MeasureScreen/atoms';
import { flatnessScoreFromMagnitudeSpectrum } from './shaper-scores/flatness';
import { klipperScoreFromMagnitudeSpectrum, suggestedMaxAccel } from './shaper-scores/klipper';
import type { OptimisationResult } from './shaper-optimiser.worker';

export const shaperParamsAtom = atom<ShaperParams>({
  type: 'zv',
  fHz: 55,
  zeta: 0.1,
  vtol: 0.1,
});

export const shaperScoreModeAtom = atom<ShaperScoreMode>('klipper');

export const corneringSettingsAtom = atom<CorneringSettings>({ model: 'jerk', value: 10 });

export const shapedSpectrumAtom = atom((get) => {
  const base = get(spectrogramMaxHoldAtom);
  if (!base.length) return new Float32Array();
  return applyShaperToMagnitudeSpectrum(get(shaperParamsAtom), base);
});

export const currentScoreAtom = atom((get) => {
  const base = get(spectrogramMaxHoldAtom);
  if (!base.length) return undefined;
  const scoreMode = get(shaperScoreModeAtom);
  const params = get(shaperParamsAtom);
  const cornering = get(corneringSettingsAtom);
  const shaped = applyShaperToMagnitudeSpectrum(params, base);
  const freqStepHz = FIXED_SAMPLE_RATE / (2 * (shaped.length - 1));
  const [fMinHz, fMaxHz] = get(frequencyRangeAtom);
  const minBins = Math.max(0, Math.floor(fMinHz / freqStepHz));
  const maxBins = Math.min(shaped.length, Math.floor(fMaxHz / freqStepHz) + 1);

  let score: number;
  if (scoreMode === 'flatness') {
    score = flatnessScoreFromMagnitudeSpectrum(base, params, [fMinHz, fMaxHz]);
  } else if (scoreMode === 'variation') {
    if (maxBins - minBins <= 1) return undefined;
    let tv = 0;
    let prev = shaped[minBins];
    for (let i = minBins + 1; i < maxBins; i++) {
      const next = shaped[i];
      tv += Math.abs(next - prev);
      prev = next;
    }
    score = tv;
  } else {
    score = klipperScoreFromMagnitudeSpectrum(base, params, cornering, 5000, [fMinHz, fMaxHz]);
  }
  return Number.isFinite(score) ? score : undefined;
});

export const currentMaxAccelAtom = atom((get) => {
  const base = get(spectrogramMaxHoldAtom);
  if (!base.length) return undefined;
  const maxAccel = suggestedMaxAccel(get(shaperParamsAtom), get(corneringSettingsAtom), 0.12);
  return Number.isFinite(maxAccel) ? maxAccel : undefined;
});

export const delayCentroidSecondsAtom = atom((get) => {
  return computeDelayCentroidSeconds(get(shaperParamsAtom));
});

export type HistoryMode = 'centroid_ms' | 'suggested_max_accel';

export const historyModeAtom = atom<HistoryMode>('centroid_ms');

export const optimisationHistoryAtom = atom<OptimisationResult[]>([]);

export const analysisRangeAtom = atom(FREQUENCY_SLIDER_RANGE_HZ);
