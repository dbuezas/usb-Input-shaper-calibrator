import { atom } from 'jotai';
import { MAX_FREQUENCY_SLIDER, MIN_FREQUENCY_SLIDER } from '@/constants';

export type FrequencyRangeHz = [number, number];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const frequencyRangeAtom = atom<FrequencyRangeHz>([
  MIN_FREQUENCY_SLIDER,
  MAX_FREQUENCY_SLIDER,
]);

export const clampedFrequencyRangeAtom = atom<FrequencyRangeHz>((get) => {
  const raw = get(frequencyRangeAtom);
  const min = clamp(Number(raw[0]), MIN_FREQUENCY_SLIDER, MAX_FREQUENCY_SLIDER);
  const max = clamp(Number(raw[1]), MIN_FREQUENCY_SLIDER, MAX_FREQUENCY_SLIDER);
  return min <= max ? [min, max] : [max, min];
});

// Back-compat alias (was used as a global range earlier).
export const analysisFrequencyRangeAtom = frequencyRangeAtom;
export const clampedAnalysisFrequencyRangeAtom = clampedFrequencyRangeAtom;
