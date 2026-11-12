// File: src/hooks/useDocumentLoadSettled.js
/**
 * OpenDocViewer — has the document finished loading, as far as OCR is concerned?
 *
 * OCR waits for the load: the user must be able to see the document before anything else, and
 * the loader's and renderer's workers must have the machine until then
 * (hooks/useOcrTextLayers.js pauses its queue while this hook says "not settled"). Two things
 * make "the load" harder to name than it sounds:
 *
 * - The loader's run (`loadingRunActive`) ends when the sources are fetched and analysed, but
 *   the pages that were not rendered during the run are rendered right after it, by the same
 *   workers. That tail belongs to the load.
 * - "Every page is rendered" cannot be the test either. In the memory modes full-size images
 *   are evicted and rendered again for as long as the viewer is open, so at any moment some
 *   page is not rendered, and a test on the current state would never pass.
 *
 * So the load is settled when the run is over and every page has been rendered (or has failed)
 * at least once: the first pass. What is evicted afterwards does not unsettle it. A pass that
 * stops making progress (a page that never renders and never fails) settles after `stallMs`
 * without a newly rendered page, so OCR is never held back for good. A new run unsettles it,
 * and so does a new document session (the page list emptied).
 *
 * With `enabled` false (OCR off, the default) the hook does nothing and reports settled.
 */
import { useEffect, useRef, useState } from 'react';

/** After the run, how long without a newly rendered page before the load counts as settled anyway. */
export const DOCUMENT_LOAD_STALL_MS = 20000;

/** @param {*} page @returns {string} */
function pageKeyOf(page) {
  return `${String(page?.sourceKey ?? '')}\u001f${Number(page?.pageIndex) || 0}`;
}

/** Rendered at full size, or failed: either way nothing more is coming for this page. */
function hasBeenShown(page) {
  return !!page && (Number(page.fullSizeStatus) === 1 || Number(page.fullSizeStatus) === -1 || Number(page.status) === -1);
}

/**
 * @param {Object} options
 * @param {boolean} options.enabled  False: do nothing, report settled.
 * @param {Array<Object>} options.pages  The viewer's pages.
 * @param {boolean} options.loadingRunActive  The loader's run.
 * @param {number=} options.stallMs  Default DOCUMENT_LOAD_STALL_MS.
 * @returns {boolean}  True once the load is settled.
 */
export default function useDocumentLoadSettled({ enabled, pages, loadingRunActive, stallMs = DOCUMENT_LOAD_STALL_MS }) {
  const [settled, setSettled] = useState(!enabled);
  /** Keys of the pages rendered (or failed) at least once in this session. */
  const seenRef = useRef(/** @type {Set<string>} */ (new Set()));
  const timerRef = useRef(/** @type {*} */ (null));

  useEffect(() => {
    if (!enabled) return undefined;
    const clearTimer = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    const list = Array.isArray(pages) ? pages : [];
    if (list.length === 0) {
      // A new session, or nothing loaded yet: nothing seen, and settled unless a run is under way.
      seenRef.current = new Set();
      clearTimer();
      setSettled(!loadingRunActive);
      return undefined;
    }
    const seen = seenRef.current;
    let grew = false;
    let allSeen = true;
    for (const page of list) {
      const key = pageKeyOf(page);
      if (seen.has(key)) continue;
      if (hasBeenShown(page)) {
        seen.add(key);
        grew = true;
      } else {
        allSeen = false;
      }
    }
    if (loadingRunActive) {
      clearTimer();
      setSettled(false);
      return undefined;
    }
    if (allSeen) {
      clearTimer();
      setSettled(true);
      return undefined;
    }
    // The run is over and pages are still to be rendered: wait for them, but not for ever.
    if (grew || timerRef.current === null) {
      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setSettled(true);
      }, Math.max(0, Number(stallMs) || 0));
    }
    return undefined;
  }, [enabled, loadingRunActive, pages, stallMs]);

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  return enabled ? settled : true;
}
