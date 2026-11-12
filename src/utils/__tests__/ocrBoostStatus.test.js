// File: src/utils/__tests__/ocrBoostStatus.test.js
/**
 * What the toolbar says about the OCR boost: nothing without one; ready before the first climb;
 * the starting point being measured; the level being tried and the level kept, each with a
 * badge; what the last climb found once input has ended it; and the step that proved too slow.
 */
import { describe, expect, it } from 'vitest';
import { OCR_BOOST_FALLBACK, describeOcrBoost } from '../ocrBoostStatus.js';

const state = (overrides = {}) => ({
  state: 'cautious', level: 8, cautious: 8, levels: [12, 16, 20, 24], baselineMs: null, probes: [], settledLevel: null, ...overrides,
});

describe('describeOcrBoost', () => {
  it('is null without a boost: off, no state yet, or no level above the cautious count', () => {
    expect(describeOcrBoost(null)).toBeNull();
    expect(describeOcrBoost(undefined)).toBeNull();
    expect(describeOcrBoost({})).toBeNull();
    expect(describeOcrBoost(state({ levels: [] }))).toBeNull();
  });

  it('is ready before the first climb, with no badge', () => {
    expect(describeOcrBoost(state())).toEqual({ key: 'ready', engines: null, badge: null, slow: null });
  });

  it('says the starting point is measured while the baseline probe runs, then names the level tried with a badge', () => {
    expect(describeOcrBoost(state({ state: 'rising' }))).toEqual({ key: 'starting', engines: null, badge: null, slow: null });
    expect(describeOcrBoost(state({ state: 'rising', level: 12, baselineMs: 2000 }))).toEqual({ key: 'rising', engines: 12, badge: 12, slow: null });
    // A slow probe from an earlier climb is not this climb's news.
    expect(describeOcrBoost(state({ state: 'rising', level: 16, baselineMs: 2000, probes: [{ level: 12, ms: 2100, slow: false }] })).slow).toBeNull();
  });

  it('names the level kept with a badge, and the step that proved too slow', () => {
    const settled = state({
      state: 'boosted', level: 12, baselineMs: 2000, settledLevel: 12,
      probes: [{ level: 12, ms: 2200, slow: false }, { level: 16, ms: 2620, slow: true }],
    });
    expect(describeOcrBoost(settled)).toEqual({ key: 'boosted', engines: 12, badge: 12, slow: { level: 16, percent: 31 } });
    // Climbed to the top without a slow step: nothing to explain.
    expect(describeOcrBoost(state({ state: 'boosted', level: 24, baselineMs: 2000, settledLevel: 24, probes: [{ level: 24, ms: 2400, slow: false }] })))
      .toEqual({ key: 'boosted', engines: 24, badge: 24, slow: null });
  });

  it('says there was no gain when the first level was already too slow, during the idle period and after it', () => {
    const held = state({ state: 'boosted', baselineMs: 1000, probes: [{ level: 12, ms: 1300, slow: true }] });
    expect(describeOcrBoost(held)).toEqual({ key: 'held', engines: null, badge: null, slow: { level: 12, percent: 30 } });
    expect(describeOcrBoost({ ...held, state: 'cautious' })).toEqual({ key: 'held', engines: null, badge: null, slow: { level: 12, percent: 30 } });
  });

  it('tells what the last climb found once input has ended it, without a badge', () => {
    const after = state({ baselineMs: 2000, settledLevel: 12, probes: [{ level: 12, ms: 2200, slow: false }, { level: 16, ms: 2620, slow: true }] });
    expect(describeOcrBoost(after)).toEqual({ key: 'last', engines: 12, badge: null, slow: { level: 16, percent: 31 } });
  });

  it('leaves the slow step out when the probe failed rather than measured, and survives odd input', () => {
    const failed = state({ state: 'boosted', level: 12, baselineMs: 2000, settledLevel: 12, probes: [{ level: 12, ms: 2100, slow: false }, { level: 16, ms: NaN, slow: true }] });
    expect(describeOcrBoost(failed).slow).toBeNull();
    expect(describeOcrBoost(state({ level: 'x', cautious: 0, probes: null, settledLevel: 1 }))).toEqual({ key: 'ready', engines: null, badge: null, slow: null });
  });

  it('has an English fallback for every key it can return, and for the slow step', () => {
    for (const key of ['ready', 'starting', 'rising', 'boosted', 'held', 'last', 'slow']) {
      expect(typeof OCR_BOOST_FALLBACK[key]).toBe('string');
    }
    expect(Object.isFrozen(OCR_BOOST_FALLBACK)).toBe(true);
  });
});
