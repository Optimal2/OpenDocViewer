// File: src/ocr/__tests__/boost.test.js
/**
 * The boost control: the levels of the climb from the measured plan (start at the larger of
 * the cautious count and half the threads, three steps to the maximum), and the controller's
 * climb against a probe: baseline, a probe per level, back one level when the reference page
 * slows by more than the fraction, a remembered level on the next climb, input ends it at once
 * and a late probe result is ignored, a failing probe stays at the level before, a failing
 * baseline stays cautious, and a level without pages for it ends the climb.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OCR_BOOST_SLOWDOWN_FRACTION, OCR_BOOST_STATE, OCR_BOOST_STEPS, createOcrBoostController, planOcrBoostLevels,
} from '../boost.js';

describe('planOcrBoostLevels', () => {
  it('starts at half the threads and takes three steps to the maximum, the last one clipped', () => {
    // Linus's client: 24 threads, cautious 8, maximum 24: 12, then +4: 16, 20, 24.
    expect(planOcrBoostLevels({ cautious: 8, threads: 24, max: 24 })).toEqual([12, 16, 20, 24]);
    // 18 cores: cautious 8, start 9, (18-9)/3 = 3: 12, 15, 18.
    expect(planOcrBoostLevels({ cautious: 8, threads: 18, max: 18 })).toEqual([9, 12, 15, 18]);
    // Uneven distance rounds the step up and clips the last level: 9 -> 20 is 11, steps of 4.
    expect(planOcrBoostLevels({ cautious: 8, threads: 18, max: 20 })).toEqual([9, 13, 17, 20]);
  });

  it('starts at the cautious count when half the threads is not above it', () => {
    // A four-core client: cautious 3, half is 2, maximum 4: one level.
    expect(planOcrBoostLevels({ cautious: 3, threads: 4, max: 4 })).toEqual([4]);
    // Dual core: cautious 1, maximum 2.
    expect(planOcrBoostLevels({ cautious: 1, threads: 2, max: 2 })).toEqual([2]);
    // Cautious 7 on eight threads, maximum 8.
    expect(planOcrBoostLevels({ cautious: 7, threads: 8, max: 8 })).toEqual([8]);
  });

  it('is empty when the maximum is not above the cautious count, and bounds the start by the maximum', () => {
    expect(planOcrBoostLevels({ cautious: 7, threads: 8, max: 7 })).toEqual([]);
    expect(planOcrBoostLevels({ cautious: 1, threads: 0, max: 1 })).toEqual([]);
    expect(planOcrBoostLevels({ cautious: 4, threads: 64, max: 10 })).toEqual([10]);
    // The memory bound holds the maximum below half the threads: one level, the maximum.
    expect(planOcrBoostLevels({ cautious: 7, threads: 24, max: 9 })).toEqual([9]);
  });

  it('takes the step count from the argument, defaulting to three', () => {
    expect(OCR_BOOST_STEPS).toBe(3);
    expect(planOcrBoostLevels({ cautious: 8, threads: 24, max: 24, steps: 1 })).toEqual([12, 24]);
    expect(planOcrBoostLevels({ cautious: 8, threads: 24, max: 24, steps: 6 })).toEqual([12, 14, 16, 18, 20, 22, 24]);
  });
});

/** A probe the test answers one call at a time, in order. */
function makeProbe() {
  const pending = [];
  const probe = vi.fn(() => new Promise((resolve, reject) => { pending.push({ resolve, reject }); }));
  return {
    probe,
    pending,
    answer(ms) { pending.shift().resolve(ms); },
    fail(error) { pending.shift().reject(error); },
  };
}

const flush = async (rounds = 10) => {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
};

function makeController(overrides = {}) {
  const apply = vi.fn();
  const probe = makeProbe();
  const log = { debug: vi.fn(), warn: vi.fn() };
  const controller = createOcrBoostController({
    cautious: 8, levels: [12, 16, 20, 24], apply, probe: probe.probe, log, ...overrides,
  });
  return { controller, apply, probe, log };
}

describe('createOcrBoostController', () => {
  it('starts cautious, applies nothing until engaged, and needs apply and probe', () => {
    const { controller, apply } = makeController();
    expect(controller.inspect()).toEqual({
      state: OCR_BOOST_STATE.CAUTIOUS, level: 8, cautious: 8, levels: [12, 16, 20, 24], baselineMs: null, probes: [], settledLevel: null,
    });
    expect(controller.level()).toBe(8);
    expect(apply).not.toHaveBeenCalled();
    expect(DEFAULT_OCR_BOOST_SLOWDOWN_FRACTION).toBe(0.25);
    expect(() => createOcrBoostController({ cautious: 1, levels: [2], apply: vi.fn() })).toThrow(/apply and probe/);
  });

  it('climbs level by level while the reference page keeps its time, and settles at the maximum', async () => {
    const { controller, apply, probe } = makeController();
    const climb = controller.engage();
    await flush();
    // The baseline is measured at the cautious level, before any level is applied.
    expect(probe.probe).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    probe.answer(2000);
    await flush();
    expect(apply).toHaveBeenLastCalledWith(12);
    expect(controller.inspect().state).toBe(OCR_BOOST_STATE.RISING);
    probe.answer(2100);
    await flush();
    expect(apply).toHaveBeenLastCalledWith(16);
    probe.answer(2300);
    await flush();
    expect(apply).toHaveBeenLastCalledWith(20);
    probe.answer(2450);
    await flush();
    expect(apply).toHaveBeenLastCalledWith(24);
    // Exactly a quarter slower is still within the fraction.
    probe.answer(2500);
    await climb;
    expect(controller.inspect()).toMatchObject({ state: OCR_BOOST_STATE.BOOSTED, level: 24, baselineMs: 2000, settledLevel: 24 });
    expect(controller.inspect().probes).toEqual([
      { level: 12, ms: 2100, slow: false }, { level: 16, ms: 2300, slow: false }, { level: 20, ms: 2450, slow: false }, { level: 24, ms: 2500, slow: false },
    ]);
    expect(apply.mock.calls.map(([count]) => count)).toEqual([12, 16, 20, 24]);
  });

  it('goes back one level and stops when the reference page slows by more than the fraction', async () => {
    const { controller, apply, probe, log } = makeController();
    const climb = controller.engage();
    await flush();
    probe.answer(2000);
    await flush();
    probe.answer(2200); // 12: fine
    await flush();
    probe.answer(2600); // 16: 30 % slower
    await climb;
    expect(apply.mock.calls.map(([count]) => count)).toEqual([12, 16, 12]);
    expect(controller.inspect()).toMatchObject({ state: OCR_BOOST_STATE.BOOSTED, level: 12, settledLevel: 12 });
    expect(controller.inspect().probes).toEqual([{ level: 12, ms: 2200, slow: false }, { level: 16, ms: 2600, slow: true }]);
    expect(log.debug).toHaveBeenCalledWith('OCR boost settled', expect.objectContaining({ level: 12 }));
  });

  it('falls back to the cautious count when the first level is already too slow, and remembers no level', async () => {
    const { controller, apply, probe } = makeController();
    const climb = controller.engage();
    await flush();
    probe.answer(1000);
    await flush();
    probe.answer(1300);
    await climb;
    expect(apply.mock.calls.map(([count]) => count)).toEqual([12, 8]);
    expect(controller.inspect()).toMatchObject({ state: OCR_BOOST_STATE.BOOSTED, level: 8, settledLevel: null });
    // The next climb starts from the plan again (nothing was remembered).
    controller.disengage();
    const again = controller.engage();
    await flush();
    probe.answer(1000);
    await flush();
    expect(apply).toHaveBeenLastCalledWith(12);
    probe.answer(1000);
    await flush();
    expect(apply).toHaveBeenLastCalledWith(16);
    controller.disengage();
    probe.answer(1000); // the probe of level 16, ignored after the input
    await again;
    expect(controller.inspect()).toMatchObject({ state: OCR_BOOST_STATE.CAUTIOUS, level: 8 });
  });

  it('jumps to the remembered level on the next climb and confirms it with one probe', async () => {
    const { controller, apply, probe } = makeController();
    const first = controller.engage();
    await flush();
    probe.answer(2000);
    await flush();
    probe.answer(2100);
    await flush();
    probe.answer(2700); // 16 too slow -> settles at 12
    await first;
    controller.disengage('input');
    expect(apply).toHaveBeenLastCalledWith(8);
    expect(controller.inspect()).toMatchObject({ state: OCR_BOOST_STATE.CAUTIOUS, level: 8, settledLevel: 12 });

    apply.mockClear();
    const second = controller.engage();
    await flush();
    probe.answer(2000);
    await flush();
    expect(apply.mock.calls.map(([count]) => count)).toEqual([12]);
    probe.answer(2050);
    await second;
    expect(controller.inspect()).toMatchObject({ state: OCR_BOOST_STATE.BOOSTED, level: 12, settledLevel: 12 });
    expect(probe.probe).toHaveBeenCalledTimes(5);
  });

  it('drops to the level below when the remembered level has become too slow', async () => {
    const { controller, apply, probe } = makeController();
    const first = controller.engage();
    await flush();
    probe.answer(2000);
    await flush();
    probe.answer(2100); // 12
    await flush();
    probe.answer(2200); // 16
    await flush();
    probe.answer(3000); // 20 too slow -> 16
    await first;
    expect(controller.inspect().settledLevel).toBe(16);
    controller.disengage();
    apply.mockClear();
    const second = controller.engage();
    await flush();
    probe.answer(2000);
    await flush();
    probe.answer(2900); // 16 now too slow
    await second;
    expect(apply.mock.calls.map(([count]) => count)).toEqual([16, 12]);
    expect(controller.inspect()).toMatchObject({ level: 12, settledLevel: 12 });
  });

  it('ends at once on input: back to the cautious count, and a probe that answers later changes nothing', async () => {
    const { controller, apply, probe, log } = makeController();
    const climb = controller.engage();
    await flush();
    probe.answer(2000);
    await flush();
    expect(apply).toHaveBeenLastCalledWith(12);
    controller.disengage('input');
    expect(apply).toHaveBeenLastCalledWith(8);
    expect(controller.inspect()).toMatchObject({ state: OCR_BOOST_STATE.CAUTIOUS, level: 8 });
    apply.mockClear();
    probe.answer(2050); // the probe of level 12, arriving after the input
    await climb;
    expect(apply).not.toHaveBeenCalled();
    expect(controller.inspect()).toMatchObject({ state: OCR_BOOST_STATE.CAUTIOUS, level: 8, settledLevel: null });
    expect(log.debug).toHaveBeenCalledWith('OCR boost ended', { reason: 'input', settledLevel: null });
    // Disengaging while cautious is a no-op.
    controller.disengage();
    expect(apply).not.toHaveBeenCalled();
  });

  it('ignores engage while rising or boosted', async () => {
    const { controller, probe } = makeController();
    const climb = controller.engage();
    await flush();
    void controller.engage();
    await flush();
    expect(probe.probe).toHaveBeenCalledTimes(1);
    probe.answer(2000);
    await flush();
    probe.answer(2000);
    await flush();
    probe.answer(2000);
    await flush();
    probe.answer(2000);
    await flush();
    probe.answer(2000);
    await climb;
    await controller.engage();
    expect(probe.probe).toHaveBeenCalledTimes(5);
  });

  it('stays at the level before when a probe fails, and stays cautious when the baseline fails so the next trigger may try again', async () => {
    const { controller, apply, probe, log } = makeController();
    const climb = controller.engage();
    await flush();
    probe.answer(2000);
    await flush();
    probe.answer(2100); // 12
    await flush();
    probe.fail(new Error('OCR engine was terminated')); // 16: the probe's engine was dropped
    await climb;
    expect(apply.mock.calls.map(([count]) => count)).toEqual([12, 16, 12]);
    expect(controller.inspect()).toMatchObject({ state: OCR_BOOST_STATE.BOOSTED, level: 12, settledLevel: 12 });
    expect(log.debug).toHaveBeenCalledWith('OCR boost probe failed; staying at the level before', expect.any(Object));

    const failing = makeController();
    const noClimb = failing.controller.engage();
    await flush();
    failing.probe.fail(new Error('no engine'));
    await noClimb;
    expect(failing.apply).not.toHaveBeenCalled();
    expect(failing.controller.inspect()).toMatchObject({ state: OCR_BOOST_STATE.CAUTIOUS, level: 8, settledLevel: null, baselineMs: null });
    expect(failing.log.debug).toHaveBeenCalledWith('OCR boost baseline failed; staying cautious', { error: 'no engine' });
    // Cautious again: a later trigger starts a new climb.
    const retry = failing.controller.engage();
    await flush();
    expect(failing.probe.probe).toHaveBeenCalledTimes(2);
    failing.probe.answer(1000);
    await flush();
    expect(failing.apply).toHaveBeenLastCalledWith(12);
    failing.controller.disengage();
    failing.probe.answer(1000);
    await retry;
  });

  it('ends the climb below a level that has no pages for it, and settles at the level before', async () => {
    const hasRoom = vi.fn((level) => level <= 16);
    const { controller, apply, probe, log } = makeController({ hasRoom });
    const climb = controller.engage();
    await flush();
    probe.answer(2000);
    await flush();
    probe.answer(2050); // 12
    await flush();
    probe.answer(2100); // 16
    await climb;
    expect(hasRoom.mock.calls.map(([level]) => level)).toEqual([12, 16, 20]);
    expect(apply.mock.calls.map(([count]) => count)).toEqual([12, 16]);
    expect(controller.inspect()).toMatchObject({ state: OCR_BOOST_STATE.BOOSTED, level: 16, settledLevel: 16 });
    expect(log.debug).toHaveBeenCalledWith('OCR boost stops below a level without pages for it', { level: 20, reached: 16 });
    // No room even for the first level: boosted at the cautious count, nothing applied.
    const cramped = makeController({ hasRoom: () => false });
    const noRoom = cramped.controller.engage();
    await flush();
    cramped.probe.answer(2000);
    await noRoom;
    expect(cramped.apply).not.toHaveBeenCalled();
    expect(cramped.controller.inspect()).toMatchObject({ state: OCR_BOOST_STATE.BOOSTED, level: 8, settledLevel: null });
  });

  it('does nothing without levels, and drops levels that are not above the cautious count', async () => {
    const idle = makeController({ levels: [] });
    await idle.controller.engage();
    expect(idle.probe.probe).not.toHaveBeenCalled();
    expect(idle.controller.inspect().state).toBe(OCR_BOOST_STATE.CAUTIOUS);
    const filtered = makeController({ levels: [4, 8, 8.5, '12', 12] });
    expect(filtered.controller.inspect().levels).toEqual([12]);
  });

  it('keeps the remembered level when a later climb finds no pages for it and so measures nothing', async () => {
    let room = true;
    const { controller, apply, probe } = makeController({ levels: [12, 16], hasRoom: () => room });
    const first = controller.engage();
    await flush();
    probe.answer(2000);
    await flush();
    probe.answer(2050); // 12
    await flush();
    probe.answer(2100); // 16
    await first;
    expect(controller.inspect().settledLevel).toBe(16);
    controller.disengage();
    // The next idle period has too few pages waiting: nothing is applied or measured.
    room = false;
    apply.mockClear();
    const second = controller.engage();
    await flush();
    probe.answer(2000);
    await second;
    expect(apply).not.toHaveBeenCalled();
    expect(controller.inspect()).toMatchObject({ state: OCR_BOOST_STATE.BOOSTED, level: 8, settledLevel: 16, probes: [] });
  });

  it('reports every change of state or level to onChange, and survives a listener that throws', async () => {
    const onChange = vi.fn();
    const { controller, probe, log } = makeController({ levels: [12, 16], onChange });
    const climb = controller.engage('search');
    await flush();
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ state: OCR_BOOST_STATE.RISING, level: 8 }));
    expect(log.debug).toHaveBeenCalledWith('OCR boost starting', expect.objectContaining({ reason: 'search' }));
    probe.answer(2000);
    await flush();
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ state: OCR_BOOST_STATE.RISING, level: 12 }));
    probe.answer(2000);
    await flush();
    probe.answer(2000);
    await climb;
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ state: OCR_BOOST_STATE.BOOSTED, level: 16, settledLevel: 16 }));
    onChange.mockImplementation(() => { throw new Error('listener broke'); });
    controller.disengage('input');
    expect(controller.level()).toBe(8);
    expect(log.warn).toHaveBeenCalledWith('OCR boost listener failed', { error: 'listener broke' });
  });

  it('takes the slowdown fraction from the options', async () => {
    const { controller, apply, probe } = makeController({ levels: [12], slowdownFraction: 0.1 });
    const climb = controller.engage();
    await flush();
    probe.answer(1000);
    await flush();
    probe.answer(1150); // 15 % slower: too slow at a tenth
    await climb;
    expect(apply.mock.calls.map(([count]) => count)).toEqual([12, 8]);
  });
});
