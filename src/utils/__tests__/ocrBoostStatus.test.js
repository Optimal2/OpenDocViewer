// File: src/utils/__tests__/ocrBoostStatus.test.js
/**
 * What the toolbar says about the OCR boost: nothing without one; ready before the first climb;
 * the starting point being measured; the level being tried and the level kept, each with a
 * badge; what the last climb found once input has ended it; and the step that proved too slow.
 */
import { describe, expect, it, vi } from 'vitest';
import { OCR_BOOST_FALLBACK, describeOcrBoost } from '../ocrBoostStatus.js';
import { createOcrBoostController } from '../../ocr/boost.js';

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
    // While climbing nothing is reported as too slow, whatever the probes hold.
    expect(describeOcrBoost(state({ state: 'rising', level: 16, baselineMs: 2000, probes: [{ level: 12, ms: 2900, slow: true }] })).slow).toBeNull();
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
    for (const key of ['ready', 'starting', 'rising', 'boosted', 'held', 'noRoom', 'interrupted', 'last', 'slow']) {
      expect(typeof OCR_BOOST_FALLBACK[key]).toBe('string');
    }
    expect(Object.isFrozen(OCR_BOOST_FALLBACK)).toBe(true);
  });
});

describe('describeOcrBoost against the real boost control', () => {
  const flush = async () => { for (let index = 0; index < 10; index += 1) await Promise.resolve(); };

  /** The real control with a probe the test answers; `describe()` reads its live state. */
  function control(options = {}) {
    const pending = [];
    const controller = createOcrBoostController({
      cautious: 8,
      levels: [12, 16, 20, 24],
      apply: vi.fn(),
      probe: () => new Promise((resolve, reject) => { pending.push({ resolve, reject }); }),
      ...options,
    });
    return {
      controller,
      answer: async (ms) => { pending.shift().resolve(ms); await flush(); },
      fail: async () => { pending.shift().reject(new Error('probe failed')); await flush(); },
      describe: () => describeOcrBoost(controller.inspect()),
    };
  }

  it('walks ready, starting, rising, boosted and last through a climb that stops on a slow step', async () => {
    const boost = control();
    expect(boost.describe().key).toBe('ready');
    const climb = boost.controller.engage();
    await flush();
    expect(boost.describe()).toMatchObject({ key: 'starting', badge: null });
    await boost.answer(1000);
    expect(boost.describe()).toMatchObject({ key: 'rising', engines: 12, badge: 12 });
    await boost.answer(1050);
    expect(boost.describe()).toMatchObject({ key: 'rising', engines: 16, badge: 16 });
    await boost.answer(1400);
    await climb;
    expect(boost.describe()).toEqual({ key: 'boosted', engines: 12, badge: 12, slow: { level: 16, percent: 40 } });
    boost.controller.disengage();
    expect(boost.describe()).toEqual({ key: 'last', engines: 12, badge: null, slow: { level: 16, percent: 40 } });
  });

  it('says interrupted, not "no gain", when input ends a climb whose levels so far were fine', async () => {
    const boost = control();
    const climb = boost.controller.engage();
    await flush();
    await boost.answer(1000);
    await boost.answer(1050); // 12: fine; the probe of 16 is under way
    boost.controller.disengage('input');
    expect(boost.describe()).toEqual({ key: 'interrupted', engines: 12, badge: null, slow: null });
    await boost.answer(1100);
    await climb;
    expect(boost.describe().key).toBe('interrupted');
    // Input before any level was measured leaves it ready.
    const early = control();
    const second = early.controller.engage();
    await flush();
    early.controller.disengage('input');
    await early.answer(1000);
    await second;
    expect(early.describe().key).toBe('ready');
  });

  it('says no gain only when the first level was measured too slow, during the idle period and after it', async () => {
    const boost = control();
    const climb = boost.controller.engage();
    await flush();
    await boost.answer(1000);
    await boost.answer(1300);
    await climb;
    expect(boost.describe()).toEqual({ key: 'held', engines: null, badge: null, slow: { level: 12, percent: 30 } });
    boost.controller.disengage();
    expect(boost.describe()).toEqual({ key: 'held', engines: null, badge: null, slow: { level: 12, percent: 30 } });
  });

  it('says too few pages when the climb never began for want of them, and ready again after input', async () => {
    const boost = control({ hasRoom: () => false });
    const climb = boost.controller.engage();
    await flush();
    await boost.answer(1000);
    await climb;
    expect(boost.describe()).toEqual({ key: 'noRoom', engines: null, badge: null, slow: null });
    boost.controller.disengage();
    expect(boost.describe().key).toBe('ready');
  });

  it('keeps telling the last level found when a later climb has no pages for it', async () => {
    let room = true;
    const boost = control({ levels: [12], hasRoom: () => room });
    const first = boost.controller.engage();
    await flush();
    await boost.answer(1000);
    await boost.answer(1050);
    await first;
    boost.controller.disengage();
    expect(boost.describe()).toMatchObject({ key: 'last', engines: 12 });
    room = false;
    const second = boost.controller.engage();
    await flush();
    await boost.answer(1000);
    await second;
    expect(boost.describe().key).toBe('noRoom');
    boost.controller.disengage();
    expect(boost.describe()).toMatchObject({ key: 'last', engines: 12 });
  });

  it('says ready after a failed baseline and too few pages after a failed first probe, never no gain', async () => {
    const baseline = control();
    const first = baseline.controller.engage();
    await flush();
    await baseline.fail();
    await first;
    expect(baseline.describe().key).toBe('ready');

    const probe = control();
    const second = probe.controller.engage();
    await flush();
    await probe.answer(1000);
    await probe.fail();
    await second;
    expect(probe.describe()).toEqual({ key: 'noRoom', engines: null, badge: null, slow: null });
  });
});
