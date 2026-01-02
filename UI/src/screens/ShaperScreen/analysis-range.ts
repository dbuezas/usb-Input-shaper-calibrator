import { atom } from 'jotai';
import { MAX_FREQUENCY_SLIDER, MIN_FREQUENCY_SLIDER } from '@/constants';

export type FrequencyRangeHz = [number, number];

export const analysisRangeAtom = atom<FrequencyRangeHz>([
  MIN_FREQUENCY_SLIDER,
  MAX_FREQUENCY_SLIDER,
]);
