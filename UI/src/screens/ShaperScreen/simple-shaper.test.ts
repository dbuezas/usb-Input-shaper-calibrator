import { describe, expect, it } from 'vitest';
import { ACTUAL_RESOLUTION } from '@/constants';
import { computeMarlinShaperTaps } from './input-shaper';
import { PRIORITY_ORDER, rankShapers } from './simple-shaper';

// One resonance at `peakHz` (quality factor 8) on a small noise floor.
const spectrum = (peakHz: number) => {
  const mags = new Float32Array(2048);
  for (let i = 0; i < mags.length; i++) {
    const r = (i * ACTUAL_RESOLUTION) / peakHz;
    mags[i] = 1 / Math.sqrt((1 - r * r) ** 2 + (r / 8) ** 2) + 0.05;
  }
  return mags;
};
const JD = { model: 'junction_deviation', value: 0.013 } as const;
const rank = (priority: (typeof PRIORITY_ORDER)[number]) =>
  rankShapers(spectrum(55), priority, JD, 1000);

describe('rankShapers', () => {
  it('returns one row per shaper, recommendation first and within the limit', () => {
    const rows = rank('balanced');
    expect(new Set(rows.map((r) => r.params.type)).size).toBe(8);
    expect(rows[0].meetsTarget).toBe(true);
    expect(rows[0].ringing).toBeLessThanOrEqual(0.07);
    for (const r of rows.filter((r) => r.meetsTarget))
      expect(r.maxAccel).toBeLessThanOrEqual(rows[0].maxAccel);
  });

  it('trades acceleration for less ringing from fast to clean', () => {
    const [fast, balanced, clean] = PRIORITY_ORDER.map((p) => rank(p)[0]);
    expect(fast.maxAccel).toBeGreaterThanOrEqual(balanced.maxAccel);
    expect(balanced.maxAccel).toBeGreaterThanOrEqual(clean.maxAccel);
    expect(clean.ringing).toBeLessThanOrEqual(balanced.ringing);
    expect(clean.roundingMm).toBeGreaterThanOrEqual(fast.roundingMm);
  });

  it('moves wide-notch shapers above the peak to round corners less', () => {
    const ei = rank('balanced').find((r) => r.params.type === '2hei')!;
    expect(ei.fEffHz).toBeGreaterThan(55 * 1.2);
  });

  it('gives f0 values that Marlin really runs (rounded to FTM_FS samples)', () => {
    for (const r of rank('balanced'))
      expect(computeMarlinShaperTaps(r.params, 1000).fEffHz).toBeCloseTo(r.fEffHz, 6);
  });

  it('returns nothing without a measurement', () => {
    expect(rankShapers(new Float32Array(), 'balanced', JD, 1000)).toEqual([]);
  });
});
