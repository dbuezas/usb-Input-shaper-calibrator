import { atom } from 'jotai';

/** Sensor axis currently being measured; also the default axis for the G-code output. */
export const measureAxisAtom = atom<'x' | 'y' | 'z'>('x');
export const spectrogramMaxHoldAtom = atom<Float32Array>(new Float32Array());
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
