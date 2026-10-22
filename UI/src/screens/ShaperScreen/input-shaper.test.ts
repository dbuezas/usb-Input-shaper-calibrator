import { describe, expect, it } from 'vitest';
import { ALL_SHAPER_TYPES, computeMarlinShaperTaps } from './input-shaper';
import { estimateShaperVals } from './shaper-scores/klipper';

// Remaining vibration of a resonance with damping `zeta` at the shaper's own (effective) frequency.
const leftAtF0 = (type: (typeof ALL_SHAPER_TYPES)[number], zeta: number) => {
  const taps = computeMarlinShaperTaps({ type, fHz: 50, zeta, vtol: 0.05 }, 1000);
  return estimateShaperVals(taps.a, taps.t, zeta, [taps.fEffHz])[0];
};

describe('computeMarlinShaperTaps', () => {
  it.each([0, 0.1, 0.25])('MZV cancels a resonance at f0 with damping %f', (zeta) => {
    expect(leftAtF0('mzv', zeta)).toBeLessThan(1e-6);
  });

  it.each(['zv', 'zvd', 'zvdd', 'zvddd'] as const)('%s cancels a resonance at f0', (type) => {
    expect(leftAtF0(type, 0.1)).toBeLessThan(1e-6);
  });

  it('gains add up to 1 for every shaper', () => {
    for (const type of ALL_SHAPER_TYPES) {
      const { a } = computeMarlinShaperTaps({ type, fHz: 50, zeta: 0.1, vtol: 0.05 }, 1000);
      expect(a.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
    }
  });
});
