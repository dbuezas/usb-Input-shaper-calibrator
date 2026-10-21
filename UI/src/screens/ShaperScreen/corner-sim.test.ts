import { describe, expect, it } from 'vitest';
import { ACTUAL_RESOLUTION } from '@/constants';
import {
  cornerCutMm,
  NO_SHAPER,
  resonanceFromSpectrum,
  simulateCorner,
  wallRippleMm,
} from './corner-sim';
import { computeMarlinShaperTaps } from './input-shaper';

const JD = { model: 'junction_deviation', value: 0.013 } as const;
const R55 = { peakHz: 55, zeta: 0.1, measured: true };
const taps = (type: 'mzv' | 'zvd', fHz: number) =>
  computeMarlinShaperTaps({ type, fHz, zeta: 0.1, vtol: 0.05 }, 1000);

describe('simulateCorner', () => {
  it('a shaper on the resonance removes most of the wall wobble', () => {
    const none = wallRippleMm(simulateCorner(NO_SHAPER, R55, 5000, JD), 1);
    const zvd = wallRippleMm(simulateCorner(taps('zvd', 55.8), R55, 5000, JD), 1);
    expect(none).toBeGreaterThan(0.01);
    expect(zvd).toBeLessThan(none / 10);
  });

  it('a stronger shaper cuts the corner more', () => {
    const mzv = cornerCutMm(simulateCorner(taps('mzv', 62.8), R55, 5000, JD));
    const zvd = cornerCutMm(simulateCorner(taps('zvd', 55.8), R55, 5000, JD));
    expect(zvd).toBeGreaterThan(mzv);
  });

  it('cuts the corner more at higher acceleration', () => {
    const slow = cornerCutMm(simulateCorner(taps('zvd', 55.8), R55, 3000, JD));
    const fast = cornerCutMm(simulateCorner(taps('zvd', 55.8), R55, 10000, JD));
    expect(fast).toBeGreaterThan(slow);
  });
});

describe('resonanceFromSpectrum', () => {
  // A mass-spring resonance with quality factor q (ζ = 1 / 2q) on a small noise floor.
  const spectrum = (peakHz: number, q: number) => {
    const mags = new Float32Array(2048);
    for (let i = 0; i < mags.length; i++) {
      const r = (i * ACTUAL_RESOLUTION) / peakHz;
      mags[i] = 1 / Math.sqrt((1 - r * r) ** 2 + (r / q) ** 2) + 0.05;
    }
    return mags;
  };

  it.each([4, 8, 15])('measures the damping of a Q=%i peak', (q) => {
    const r = resonanceFromSpectrum(spectrum(55, q));
    expect(r.measured).toBe(true);
    expect(r.zeta).toBeGreaterThan(0.85 / (2 * q));
    expect(r.zeta).toBeLessThan(1.15 / (2 * q));
  });

  it('falls back to the default damping without a peak', () => {
    expect(resonanceFromSpectrum(new Float32Array(2048)).measured).toBe(false);
  });
});
