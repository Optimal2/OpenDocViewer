// File: src/ocr/boost.js
/**
 * OpenDocViewer — the OCR boost control: full throttle while the user is idle.
 *
 * The viewer runs OCR in one mode with two states. While the user interacts, the cautious
 * state applies: the automatic worker count of `ocr.workerPolicy` (the cores less one, at most
 * eight), which the boost benchmark showed to keep the page responsive. When nothing has
 * happened for a while (no input, or the tab is hidden, or a search over the whole document is
 * waiting for pages), the boosted state may use more of the machine, and this module decides
 * how much: it climbs through a few levels and measures at each one whether the engines still
 * get the cores they need, instead of guessing from a thread count, since a browser reports
 * logical threads only and the measurements say that physical cores govern (a 24-thread client
 * with twelve cores stopped paying off at eight to twelve workers, an 18-core client without
 * SMT scaled to eighteen).
 *
 * The levels (planOcrBoostLevels): the climb starts at the larger of the cautious count and
 * half the threads, and goes to the maximum in three steps of equal size (the distance divided
 * by three, rounded up; the last step is clipped to the maximum). The maximum is the thread
 * count bounded by the memory budget and by `ocr.boost.maxWorkerCount`.
 *
 * The yardstick (createOcrBoostController): a reference page, small and always the same, is
 * recognised once at the cautious level while the engines work (the baseline) and once more
 * after every step. The recognition's own wall time (`recognizeMs` of engine.js, without the
 * worker's start or the wait for a free engine) rises when the engines share cores. When it
 * rises by more than `slowdownFraction` (a quarter by default) the level before is restored and
 * the climb ends there: more workers would still raise the total throughput for a while, but
 * each one would bring less and cost the same memory. A later idle period starts at the level
 * found, with one probe to confirm it. The first input ends the boosted state at once: the
 * ceiling goes back to the cautious count, the engines above it finish their page and are
 * released (enginePool.js resize), and a probe still running is ignored.
 *
 * This module is pure: it is handed `apply` (set the pool's ceiling and the queue's pages in
 * flight) and `probe` (recognise the reference page, resolve its recognizeMs) by
 * hooks/useOcrTextLayers.js, which also owns the triggers. Part of the lazy OCR chunk.
 */

/** Steps of the climb from the starting level to the maximum. */
export const OCR_BOOST_STEPS = 3;

/** How much longer the reference recognition may take before the climb stops (a quarter). */
export const DEFAULT_OCR_BOOST_SLOWDOWN_FRACTION = 0.25;

/** The states of the control (see `inspect`). */
export const OCR_BOOST_STATE = Object.freeze({
  /** The cautious count applies. */
  CAUTIOUS: 'cautious',
  /** Climbing: a level has been applied and its probe is under way. */
  RISING: 'rising',
  /** The climb ended; the level found applies until the next input. */
  BOOSTED: 'boosted',
});

/**
 * The levels of the climb, in order, above the cautious count.
 *
 * @param {Object} inputs
 * @param {number} inputs.cautious  The cautious worker count (the floor).
 * @param {number} inputs.threads  `navigator.hardwareConcurrency`; 0 when unknown.
 * @param {number} inputs.max  The most workers the boost may use (threads bounded by memory and
 *   the configured ceiling).
 * @param {number=} inputs.steps  Default OCR_BOOST_STEPS.
 * @returns {Array<number>}  Empty when the maximum is not above the cautious count.
 */
export function planOcrBoostLevels({ cautious, threads, max, steps = OCR_BOOST_STEPS }) {
  const floor = Math.max(1, Math.floor(Number(cautious)) || 1);
  const ceiling = Math.floor(Number(max)) || 0;
  if (ceiling <= floor) return [];
  const half = Math.ceil((Math.max(0, Math.floor(Number(threads)) || 0)) / 2);
  const start = Math.min(ceiling, Math.max(floor, half));
  const levels = [];
  if (start > floor) levels.push(start);
  const stepCount = Math.max(1, Math.floor(Number(steps)) || 1);
  const step = Math.max(1, Math.ceil((ceiling - start) / stepCount));
  for (let level = start + step; level < ceiling; level += step) levels.push(level);
  if (levels[levels.length - 1] !== ceiling) levels.push(ceiling);
  return levels;
}

/**
 * @typedef {Object} OcrBoostProbe
 * @property {number} level  The worker count the reference page was recognised under.
 * @property {number} ms  Its recognizeMs.
 * @property {boolean} slow  True when it exceeded the baseline by more than the fraction.
 */

/**
 * @typedef {Object} OcrBoostController
 * @property {function(string=): Promise<void>} engage  Start the climb (no-op while not
 *   cautious); the reason is logged. Resolves when the climb has settled or was cancelled;
 *   never rejects.
 * @property {function(string=): void} disengage  Back to the cautious count at once.
 * @property {function(): number} level  The count applied right now.
 * @property {function(): { state: string, level: number, cautious: number, levels: Array<number>, baselineMs: (number|null), probes: Array<OcrBoostProbe>, settledLevel: (number|null) }} inspect
 */

/**
 * @param {Object} options
 * @param {number} options.cautious  The cautious worker count.
 * @param {Array<number>} options.levels  planOcrBoostLevels.
 * @param {function(number): void} options.apply  Make `count` the pool's ceiling and the
 *   queue's pages in flight.
 * @param {function(): Promise<number>} options.probe  Recognise the reference page, resolve its
 *   recognizeMs. A rejection ends the climb at the level before.
 * @param {number=} options.slowdownFraction  Default DEFAULT_OCR_BOOST_SLOWDOWN_FRACTION.
 * @param {function(number): boolean=} options.hasRoom  Asked before each level: false when
 *   fewer pages are waiting than that many engines could take, which ends the climb at the
 *   level before (engines without a page would measure nothing and hold memory for nothing).
 * @param {function(Object): void=} options.onChange  Called with `inspect()` after every change
 *   of state or level (the viewer shows and logs it).
 * @param {{ debug: Function, warn: Function }=} options.log
 * @returns {OcrBoostController}
 */
export function createOcrBoostController({
  cautious,
  levels,
  apply,
  probe,
  slowdownFraction = DEFAULT_OCR_BOOST_SLOWDOWN_FRACTION,
  hasRoom = null,
  onChange = null,
  log = { debug() {}, warn() {} },
}) {
  if (typeof apply !== 'function' || typeof probe !== 'function') throw new Error('OCR boost control needs apply and probe');
  const floor = Math.max(1, Math.floor(Number(cautious)) || 1);
  const plan = Object.freeze((Array.isArray(levels) ? levels : []).filter((level) => Number.isInteger(level) && level > floor));
  const fraction = Number.isFinite(Number(slowdownFraction)) && Number(slowdownFraction) > 0 ? Number(slowdownFraction) : DEFAULT_OCR_BOOST_SLOWDOWN_FRACTION;

  let state = OCR_BOOST_STATE.CAUTIOUS;
  let current = floor;
  /** @type {(number|null)} */
  let baselineMs = null;
  /** @type {Array<OcrBoostProbe>} */
  let probes = [];
  /** @type {(number|null)} The level a climb settled at; the next climb starts there. */
  let settledLevel = null;
  // Bumped by disengage(): a climb that began under an older generation stops acting.
  let generation = 0;

  function inspect() {
    return { state, level: current, cautious: floor, levels: [...plan], baselineMs, probes: [...probes], settledLevel };
  }

  function changed() {
    if (typeof onChange !== 'function') return;
    try {
      onChange(inspect());
    } catch (error) {
      log.warn('OCR boost listener failed', { error: String(error?.message || error) });
    }
  }

  function set(count) {
    current = count;
    apply(count);
    changed();
  }

  /** The level below `level` in the plan, or the cautious count. */
  function levelBelow(level) {
    const lower = plan.filter((candidate) => candidate < level);
    return lower.length ? lower[lower.length - 1] : floor;
  }

  async function engage(reason = 'idle') {
    if (state !== OCR_BOOST_STATE.CAUTIOUS || plan.length === 0) return;
    const myGeneration = generation;
    state = OCR_BOOST_STATE.RISING;
    probes = [];
    log.debug('OCR boost starting', { reason, cautious: floor, levels: [...plan], settledLevel });
    changed();
    let reached = floor;
    let baseline;
    try {
      baseline = await probe();
    } catch (error) {
      if (myGeneration !== generation) return;
      // No yardstick (the engine failed, or was terminated): stay cautious, so the next trigger
      // may try again.
      log.debug('OCR boost baseline failed; staying cautious', { error: String(error?.message || error) });
      state = OCR_BOOST_STATE.CAUTIOUS;
      changed();
      return;
    }
    if (myGeneration !== generation) return;
    baselineMs = Math.max(1, Number(baseline) || 1);
    // True once a level has been measured (or its probe failed): only then does this climb say
    // anything about where to settle. A climb that ends before, for want of pages, leaves the
    // level remembered from an earlier climb alone.
    let measured = false;
    try {
      // A climb that settled before jumps to its level and confirms it with one probe.
      const candidates = settledLevel !== null && plan.includes(settledLevel) ? [settledLevel] : plan;
      for (const level of candidates) {
        if (typeof hasRoom === 'function' && !hasRoom(level)) {
          log.debug('OCR boost stops below a level without pages for it', { level, reached });
          break;
        }
        set(level);
        reached = level;
        const ms = Number(await probe());
        if (myGeneration !== generation) return;
        const slow = !(ms <= baselineMs * (1 + fraction));
        probes.push({ level, ms, slow });
        measured = true;
        if (slow) {
          reached = levelBelow(level);
          set(reached);
          break;
        }
      }
    } catch (error) {
      if (myGeneration !== generation) return;
      // The reference page could not be recognised (the engine failed, or was terminated):
      // stay where the climb was before this level.
      log.debug('OCR boost probe failed; staying at the level before', { error: String(error?.message || error) });
      measured = true;
      if (reached !== floor) {
        reached = levelBelow(reached);
        set(reached);
      }
    }
    if (measured) settledLevel = reached > floor ? reached : null;
    state = OCR_BOOST_STATE.BOOSTED;
    log.debug('OCR boost settled', { level: reached, baselineMs, probes: [...probes] });
    changed();
  }

  function disengage(reason = 'input') {
    generation += 1;
    if (state === OCR_BOOST_STATE.CAUTIOUS) return;
    state = OCR_BOOST_STATE.CAUTIOUS;
    set(floor);
    log.debug('OCR boost ended', { reason, settledLevel });
  }

  return {
    engage,
    disengage,
    level: () => current,
    inspect,
  };
}
