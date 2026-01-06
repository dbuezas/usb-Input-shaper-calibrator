import { atom } from 'jotai';
import { FREQUENCY_SLIDER_RANGE_HZ } from '@/constants';
import {
  applyShaperToMagnitudeSpectrum,
  computeShaperResponse,
  computeDelayCentroidSeconds,
  type CorneringSettings,
  type ShaperParams,
} from './input-shaper';
import { spectrogramMaxHoldAtom } from '../MeasureScreen/atoms';
import { suggestedMaxAccel } from './shaper-scores/klipper';
import type { OptimisationResult } from './shaper-optimiser.worker';
import { scoreCandidate, type ShaperScoreMode } from './shaper-scores';

export const shaperParamsAtom = atom<ShaperParams>({
  type: 'zv',
  fHz: 55,
  zeta: 0.1,
  vtol: 0.1,
});

export const shaperScoreModeAtom = atom<ShaperScoreMode>('variation');

export const corneringSettingsAtom = atom<CorneringSettings>({ model: 'jerk', value: 10 });

export const shapedSpectrumAtom = atom((get) =>
  applyShaperToMagnitudeSpectrum(get(shaperParamsAtom), get(spectrogramMaxHoldAtom))
);

export const shaperResponseAtom = atom((get) =>
  computeShaperResponse(get(shaperParamsAtom), FREQUENCY_SLIDER_RANGE_HZ)
);

export const currentScoreAtom = atom((get) =>
  scoreCandidate(
    get(spectrogramMaxHoldAtom),
    get(shaperParamsAtom),
    get(shaperScoreModeAtom),
    get(corneringSettingsAtom),
    get(analysisRangeAtom)
  )
);

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

export const historyModeAtom = atom<HistoryMode>('suggested_max_accel');

export const optimisationHistoryAtom = atom<OptimisationResult[]>([]);

export const analysisRangeAtom = atom(FREQUENCY_SLIDER_RANGE_HZ);
