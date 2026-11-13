// File: src/utils/ocrProgress.js
/**
 * How long the pages still waiting for OCR will take, for the toolbar's tooltip
 * (components/DocumentToolbar/OcrSearchBar.jsx): an estimate from the pace of the pages that
 * were finished lately, and the text that says it (public/locales/<lng>/common.json,
 * `ocr.progress`).
 *
 * The pace is measured between finished pages only. The first page seen to finish is the
 * starting point, so the time before it (the document loading, the engine starting) is not
 * counted as slow recognition, and the pages looked at are those finished within the last
 * OCR_PROGRESS_WINDOW_MS (at least the last few, on a slow client), so the estimate follows the
 * number of workers as it changes: more of them while the user is idle (`ocr.boost`), fewer
 * again at the first input. There is no estimate before OCR_PROGRESS_MIN_PAGES pages have been
 * finished since the starting point, none when nothing waits, and none when no page has been
 * finished for the length of the window (OCR paused, or stuck): a figure from a pace that no
 * longer holds would be worse than none. For the same reason a page finished more than a
 * window after the one before it is a new starting point: the time between them was a pause
 * (a print being prepared, another document loading), not a pace, and counted as one it would
 * give an estimate many times too long.
 *
 * It is an estimate and is worded as one. The caller counts the pages the engine recognised:
 * a PDF page with its own text is done without the engine, at once, and counted it would make
 * the pace look many times better than the scanned pages after it will be. The pages waiting
 * may still hold such pages, so the estimate errs on the long side for a mixed document.
 */

/** Finished pages older than this say nothing about the pace now. */
export const OCR_PROGRESS_WINDOW_MS = 60000;
/** Pages that must have been finished since the starting point before a pace is trusted. */
export const OCR_PROGRESS_MIN_PAGES = 3;
/** Measurements kept however old they are, so a slow client still gets a pace. */
const MIN_SAMPLES = 4;

/** Keys of `ocr.progress` and their English fallbacks. */
export const OCR_PROGRESS_FALLBACK = Object.freeze({
  underMinute: 'less than a minute left',
  minutes: 'about {minutes} min left',
  hours: 'about {hours} h {minutes} min left',
});

/**
 * @param {Object=} options
 * @param {number=} options.windowMs  Default OCR_PROGRESS_WINDOW_MS.
 * @param {number=} options.minPages  Default OCR_PROGRESS_MIN_PAGES.
 * @param {function(): number=} options.now  Clock in milliseconds; default Date.now.
 * @returns {{ record: function(number): void, remainingMs: function(number): (number|null), expiresInMs: function(): (number|null) }}
 */
export function createOcrProgressEstimator({ windowMs = OCR_PROGRESS_WINDOW_MS, minPages = OCR_PROGRESS_MIN_PAGES, now = Date.now } = {}) {
  /** @type {Array<{ at: number, done: number }>} */
  let samples = [];
  let lastDone = null;
  return {
    /**
     * Tell the estimator how many pages are finished now. Call it whenever the count may have
     * changed; a count that did not grow is no measurement, and one that shrank is another
     * document, which starts the measuring again.
     *
     * @param {number} done
     */
    record(done) {
      const count = Math.max(0, Math.floor(Number(done)) || 0);
      if (lastDone === null) {
        // The count the toolbar starts with: pages finished before it looked are no pace.
        lastDone = count;
        return;
      }
      if (count < lastDone) samples = [];
      if (count > lastDone) {
        const at = now();
        // More than a window since the page before: a pause, and this page starts the measuring.
        if (samples.length > 0 && at - samples[samples.length - 1].at > windowMs) samples = [];
        samples.push({ at, done: count });
        while (samples.length > MIN_SAMPLES && at - samples[0].at > windowMs) samples.shift();
      }
      lastDone = count;
    },
    /**
     * @param {number} pending  Pages still waiting for OCR.
     * @returns {(number|null)}  Milliseconds, or null when there is nothing to say.
     */
    remainingMs(pending) {
      const waiting = Math.max(0, Math.floor(Number(pending)) || 0);
      if (waiting === 0 || samples.length < 2) return null;
      const first = samples[0];
      const last = samples[samples.length - 1];
      const pages = last.done - first.done;
      const elapsed = last.at - first.at;
      if (pages < minPages || !(elapsed > 0)) return null;
      if (now() - last.at > windowMs) return null;
      return (waiting * elapsed) / pages;
    },
    /**
     * @returns {(number|null)}  Milliseconds until the last finished page is a window old and
     *   the pace no longer holds; null without a finished page.
     */
    expiresInMs() {
      if (samples.length === 0) return null;
      return Math.max(0, windowMs - (now() - samples[samples.length - 1].at));
    },
  };
}

/**
 * The words for an estimate: which `ocr.progress` key, and its figures. Under a minute is said
 * as that; above it the minutes are rounded up, so the user is not promised less than is left.
 *
 * @param {(number|null)} remainingMs
 * @returns {({ key: string, minutes: (number|undefined), hours: (number|undefined) }|null)}
 */
export function describeOcrTimeLeft(remainingMs) {
  if (typeof remainingMs !== 'number' || !Number.isFinite(remainingMs) || remainingMs < 0) return null;
  if (remainingMs < 60000) return { key: 'underMinute' };
  const minutes = Math.ceil(remainingMs / 60000);
  if (minutes < 60) return { key: 'minutes', minutes };
  return { key: 'hours', hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}
