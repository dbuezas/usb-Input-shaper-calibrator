import { atom, type Getter } from 'jotai';
import { FREQUENCY_SLIDER_RANGE_HZ } from '@/constants';
import {
  computeShaperResponse,
  type CorneringSettings,
  type ShaperParams,
  computeMarlinShaperTaps,
  applyShaperToMagnitudeSpectrumFromTaps,
  computeDelayCentroidSecondsFromTaps,
  type ShaperTaps,
} from './input-shaper';
import { spectrogramMaxHoldAtom } from '../MeasureScreen/atoms';
import { suggestedMaxAccelFromTaps } from './shaper-scores/klipper';
import type { OptimisationResult } from './shaper-optimiser.worker';
import { scoreCandidateFromTaps, type ShaperScoreMode } from './shaper-scores';

export const shaperPreviewParamsAtom = atom<ShaperParams>();
export const selectedShaperParamsAtom = atom<ShaperParams>({
  type: 'zv',
  fHz: 55,
  zeta: 0.1,
  vtol: 0.1,
});

export const shaperParamsAtom = atom(
  (get) => get(shaperPreviewParamsAtom) ?? get(selectedShaperParamsAtom),
  (_get, set, value: ShaperParams | ((old: ShaperParams) => ShaperParams)) =>
    set(selectedShaperParamsAtom, value)
);

export const shaperScoreModeAtom = atom<ShaperScoreMode>('klipper');

export const corneringSettingsAtom = atom<CorneringSettings>({ model: 'jerk', value: 10 });

export const shaperTapsAtom = atom((get) => computeMarlinShaperTaps(get(shaperParamsAtom)));

export const shapedSpectrumAtom = atom((get) =>
  applyShaperToMagnitudeSpectrumFromTaps(get(shaperTapsAtom), get(spectrogramMaxHoldAtom))
);

export const shaperResponseAtom = atom((get) =>
  computeShaperResponse(get(shaperParamsAtom), FREQUENCY_SLIDER_RANGE_HZ)
);

const getShaperStats = (get: Getter, taps: ShaperTaps) => {
  const corneringSettings = get(corneringSettingsAtom);
  const score = scoreCandidateFromTaps(
    get(spectrogramMaxHoldAtom),
    taps,
    get(shaperScoreModeAtom),
    corneringSettings,
    get(analysisRangeAtom)
  );
  const maxAccel = suggestedMaxAccelFromTaps(taps, corneringSettings);
  const delay = computeDelayCentroidSecondsFromTaps(taps);
  return { score, maxAccel, delay };
};

export const previewStatsAtom = atom((get) => {
  const params = get(shaperPreviewParamsAtom);
  if (!params) return undefined;
  return getShaperStats(get, computeMarlinShaperTaps(params));
});

export const shaperStatsAtom = atom((get) => {
  return getShaperStats(get, computeMarlinShaperTaps(get(shaperParamsAtom)));
});
export const selectedParamsStatsAtom = atom((get) => {
  return getShaperStats(get, computeMarlinShaperTaps(get(selectedShaperParamsAtom)));
});

export type HistoryMode = 'centroid_ms' | 'suggested_max_accel';

export const historyModeAtom = atom<HistoryMode>('suggested_max_accel');

export const optimisationHistoryAtom = atom<OptimisationResult[]>([]);

export const analysisRangeAtom = atom(FREQUENCY_SLIDER_RANGE_HZ);
