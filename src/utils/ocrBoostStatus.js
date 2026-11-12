// File: src/utils/ocrBoostStatus.js
/**
 * What the toolbar says about the OCR boost (components/DocumentToolbar/OcrSearchBar.jsx): one
 * key per situation with its English fallback text (public/locales/<lng>/common.json,
 * `ocr.boost`), the number of engines to name, the figure of the badge shown while the boost
 * runs, and the step that proved too slow when the climb ended on one.
 *
 * The input is the boost control's state as the OCR hook exposes it (`ocrBoost`, the `inspect()`
 * of src/ocr/boost.js): null without a boost, which yields null here, so with `ocr.boost` off
 * (the default) the toolbar shows and says nothing about it. The badge matters because a
 * tooltip cannot show the boosted state: moving the pointer to the button is input, and input
 * ends the boost. The tooltip therefore tells what the last climb found, the badge what runs now.
 */

/** Keys of `ocr.boost` and their English fallbacks. */
export const OCR_BOOST_FALLBACK = Object.freeze({
  ready: 'Idle boost: ready',
  starting: 'Boost: measuring the starting point',
  rising: 'Boost: trying {engines} engines',
  boosted: 'Boost: {engines} engines',
  held: 'Boost tried: no gain over the cautious count',
  noRoom: 'Boost: too few pages waiting for more engines',
  interrupted: 'Boost interrupted at {engines} engines',
  last: 'Last boost: {engines} engines',
  slow: '{level} engines took {percent} % longer',
});

/**
 * @typedef {Object} OcrBoostDescription
 * @property {string} key  One of OCR_BOOST_FALLBACK's keys except `slow`: `ready`, `starting`,
 *   `rising`, `boosted`, `held` (the first level was too slow), `noRoom` (too few pages waiting
 *   for a climb), `interrupted` (input ended a climb that had found no limit yet) or `last`.
 * @property {(number|null)} engines  The engine count the text names, or null when it names none.
 * @property {(number|null)} badge  The engine count to show beside the status while the boost
 *   runs above the cautious count; null otherwise.
 * @property {({ level: number, percent: number }|null)} slow  The level the last climb gave up
 *   on and how much longer the reference page took there than at the cautious count.
 */

/**
 * @param {(Object|null|undefined)} boost  `ocrBoost` of the viewer context.
 * @returns {(OcrBoostDescription|null)}  Null without a boost (off, or no room for one).
 */
export function describeOcrBoost(boost) {
  if (!boost || !Array.isArray(boost.levels) || boost.levels.length === 0) return null;
  const cautious = Math.max(1, Math.floor(Number(boost.cautious)) || 1);
  const level = Math.max(cautious, Math.floor(Number(boost.level)) || cautious);
  const probes = Array.isArray(boost.probes) ? boost.probes : [];
  const settled = Number.isInteger(boost.settledLevel) && boost.settledLevel > cautious ? boost.settledLevel : null;

  let slow = null;
  const lastProbe = probes.length > 0 ? probes[probes.length - 1] : null;
  const baseline = Number(boost.baselineMs);
  if (lastProbe?.slow === true && Number.isFinite(Number(lastProbe.ms)) && baseline > 0) {
    slow = { level: Number(lastProbe.level), percent: Math.round((Number(lastProbe.ms) / baseline - 1) * 100) };
  }

  if (boost.state === 'rising') {
    return level > cautious
      ? { key: 'rising', engines: level, badge: level, slow: null }
      : { key: 'starting', engines: null, badge: null, slow: null };
  }
  if (boost.state === 'boosted') {
    if (level > cautious) return { key: 'boosted', engines: level, badge: level, slow };
    // Settled at the cautious count: the first level was too slow, or the climb never began
    // for want of pages (or of a working probe), which is not the same finding.
    return slow
      ? { key: 'held', engines: null, badge: null, slow }
      : { key: 'noRoom', engines: null, badge: null, slow: null };
  }
  // Cautious: what the last climb found, if there was one.
  if (settled !== null) return { key: 'last', engines: settled, badge: null, slow };
  if (slow) return { key: 'held', engines: null, badge: null, slow };
  // Input ended a climb whose levels so far were all fine: it found no limit, it was interrupted.
  if (lastProbe && Number.isFinite(Number(lastProbe.level))) {
    return { key: 'interrupted', engines: Number(lastProbe.level), badge: null, slow: null };
  }
  return { key: 'ready', engines: null, badge: null, slow: null };
}
