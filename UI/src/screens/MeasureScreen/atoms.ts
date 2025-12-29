import { atom } from 'jotai';

export const spectrogramMaxHoldAtom = atom<number[]>([]);
export const welchPsdMaxHoldAtom = atom<number[]>([]);
export const peakAtom = atom<number>();
export const historicPeakAtom = atom<number>();

export const peakFrequencyAtom = atom((get) => {
  const peak = get(peakAtom);
  return peak ? peak.toFixed(1) : '';
});

export const historicPeakFrequencyAtom = atom((get) => {
  const peak = get(historicPeakAtom);
  return peak ? peak.toFixed(1) : '';
});
