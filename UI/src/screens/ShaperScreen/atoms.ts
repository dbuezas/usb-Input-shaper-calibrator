import { atom } from 'jotai';
import { FIXED_SAMPLE_RATE } from '@/constants';
import {
  applyShaperToMagnitudeSpectrum,
  computeMarlinShaperTaps,
  flatnessScoreFromMagnitudeSpectrum,
  klipperScoreFromMagnitudeSpectrum,
  suggestedMaxAccel,
  type CorneringModel,
  type CorneringSettings,
  type InputShaperType,
  type ShaperParams,
  type ShaperScoreMode,
} from './input-shaper';
import { spectrogramMaxHoldAtom } from '../MeasureScreen/atoms';

export const shaperTypeAtom = atom<InputShaperType>('zvd');
export const shaperF0Atom = atom(55);
export const shaperZetaAtom = atom(0.1);
export const shaperVtolAtom = atom(0.1);
export const shaperScoreModeAtom = atom<ShaperScoreMode>('klipper');

export const corneringModelAtom = atom<CorneringModel>('scv');
export const corneringScvAtom = atom(5);
export const corneringJerkAtom = atom(10);
export const corneringJdAtom = atom(0.02);

export const corneringSettingsAtom = atom<CorneringSettings>((get) => {
  const model = get(corneringModelAtom);
  switch (model) {
    case 'scv':
      return { model: 'scv', scv: get(corneringScvAtom) };
    case 'jerk':
      return { model: 'jerk', jerk: get(corneringJerkAtom) };
    case 'junction_deviation':
      return { model: 'junction_deviation', junctionDeviation: get(corneringJdAtom) };
  }
});

const shaperParamsAtom = atom<ShaperParams>((get) => ({
  type: get(shaperTypeAtom),
  fHz: get(shaperF0Atom),
  zeta: get(shaperZetaAtom),
  vtol: get(shaperVtolAtom),
}));

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
  const maxBins = Math.min(shaped.length, Math.floor(200 / freqStepHz) + 1);

  let score: number;
  if (scoreMode === 'flatness') {
    score = flatnessScoreFromMagnitudeSpectrum(base, params);
  } else if (scoreMode === 'variation') {
    if (maxBins <= 1) return undefined;
    let tv = 0;
    let prev = shaped[0];
    for (let i = 1; i < maxBins; i++) {
      const next = shaped[i];
      tv += Math.abs(next - prev);
      prev = next;
    }
    score = tv;
  } else {
    score = klipperScoreFromMagnitudeSpectrum(base, params, cornering);
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
  const { a, t } = computeMarlinShaperTaps(get(shaperParamsAtom));
  const sumA = a.reduce((s, v) => s + v, 0);
  if (!Number.isFinite(sumA) || sumA === 0) return undefined;
  let centroid = 0;
  for (let i = 0; i < a.length; i++) centroid += (a[i] ?? 0) * (t[i] ?? 0);
  centroid /= sumA;
  return Number.isFinite(centroid) ? centroid : undefined;
});
