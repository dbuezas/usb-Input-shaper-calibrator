import { describe, expect, it } from 'vitest';
import { cornerCutMm, NO_SHAPER, simulateCorner, wallRippleMm } from './corner-sim';
import { computeMarlinShaperTaps } from './input-shaper';

const JD = { model: 'junction_deviation', value: 0.013 } as const;
const taps = (type: 'mzv' | 'zvd', fHz: number) =>
  computeMarlinShaperTaps({ type, fHz, zeta: 0.1, vtol: 0.05 }, 1000);

describe('simulateCorner', () => {
  it('a shaper on the resonance removes most of the wall wobble', () => {
    const none = wallRippleMm(simulateCorner(NO_SHAPER, 55, 5000, JD), 1);
    const zvd = wallRippleMm(simulateCorner(taps('zvd', 55.8), 55, 5000, JD), 1);
    expect(none).toBeGreaterThan(0.01);
    expect(zvd).toBeLessThan(none / 10);
  });

  it('a stronger shaper cuts the corner more', () => {
    const mzv = cornerCutMm(simulateCorner(taps('mzv', 62.8), 55, 5000, JD));
    const zvd = cornerCutMm(simulateCorner(taps('zvd', 55.8), 55, 5000, JD));
    expect(zvd).toBeGreaterThan(mzv);
  });

  it('cuts the corner more at higher acceleration', () => {
    const slow = cornerCutMm(simulateCorner(taps('zvd', 55.8), 55, 3000, JD));
    const fast = cornerCutMm(simulateCorner(taps('zvd', 55.8), 55, 10000, JD));
    expect(fast).toBeGreaterThan(slow);
  });
});
