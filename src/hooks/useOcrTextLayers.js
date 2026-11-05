// File: src/hooks/useOcrTextLayers.js
/**
 * Runs OCR for the pages near the viewer's focus and exposes the outcomes per page.
 *
 * The hook is inert until the OCR module has arrived (useOcrModule.js hands it over only when
 * `ocr.enabled` is the literal true), so on the default code path it holds an empty map and
 * creates nothing. With the module it builds one engine, one in-memory result cache, one PDF
 * text prober and one page queue for the session; feeds the queue the window around the focus
 * pages (src/ocr/window.js) every time the pages or the focus change; pauses it while the viewer
 * says so (print PDF preparation, hard memory pressure); drops a document's outcomes when the
 * document leaves; and terminates the worker after a minute without work so its WebAssembly
 * memory is released (the next page starts it again). Recognition input is the page image the
 * viewer already rendered (`ensurePageAsset`), so no page is rasterised twice; the module's
 * prepareOcrImage measures it and removes ruling lines on a private copy that is released right
 * after (the displayed image and printing are never touched). With `ocr.speech.autoDetectLanguage`
 * on (the default) each finished page's text is given a language guess among the viewer's OCR
 * languages (src/ocr/detectLanguage.js), which read-aloud and the text layer's
 * `lang` use; the guess is one pass over the page's words.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import logger from '../logging/systemLogger.js';
import { ocrPageKeyOf } from '../utils/ocrPageKey.js';
import { getOcrLanguages, isOcrWholeDocumentEnabled, isSpeechLanguageAutoDetectEnabled } from '../utils/runtimeConfig.js';
import { speechLanguagesForOcr } from '../utils/ocrLanguageCodes.js';

/** Idle time after which the OCR worker is terminated to free its memory. */
export const OCR_IDLE_SHUTDOWN_MS = 60000;

const EMPTY_PAGES = Object.freeze({});

/**
 * @param {Object} options
 * @param {(Object|null)} options.ocrModule  The loaded OCR module, or null while OCR is off.
 * @param {Array<Object>} options.allPages  Viewer pages.
 * @param {Array<number>} options.focusPageIndexes  Indexes into allPages: displayed page first.
 * @param {boolean} options.ready  True once the first page is shown; nothing runs before.
 * @param {boolean} options.paused  True while the viewer wants no new OCR work started.
 * @param {function(string): Promise<(ArrayBuffer|null)>} options.readSourceArrayBuffer
 * @param {function(number, string): Promise<(string|null)>} options.ensurePageAsset
 *   `(pageIndex, 'full')` to the rendered page's object URL.
 * @param {(function(number, string): void|null)=} options.releasePageAsset  `(pageIndex, url)`
 *   drops that render of the page again; called for a page rendered only for OCR (beyond the
 *   window) once its bytes are in hand, so the whole document does not pile up renders. The
 *   URL names the render, so a newer one is left alone. Optional.
 * @param {number=} options.idleShutdownMs  Default OCR_IDLE_SHUTDOWN_MS.
 * @param {boolean=} options.wholeDocument  Queue the rest of the document after the window
 *   (`ocr.recognizeWholeDocument`); default from the runtime configuration. The outcome cache
 *   is then bounded by the page count, so no planned page's outcome is dropped and recognised
 *   again.
 * @returns {{ ocrPages: Object<string, Object>, ocrEngineFailure: (string|null) }}
 *   `ocrPages` maps utils/ocrPageKey.js keys to outcomes (`status` done/skipped/failed with
 *   text, words and image size, or a transient queued/probing/recognizing state).
 */
export default function useOcrTextLayers({
  ocrModule,
  allPages,
  focusPageIndexes,
  ready,
  paused,
  readSourceArrayBuffer,
  ensurePageAsset,
  releasePageAsset = null,
  idleShutdownMs = OCR_IDLE_SHUTDOWN_MS,
  wholeDocument = isOcrWholeDocumentEnabled(),
}) {
  const [snapshot, setSnapshot] = useState({ pages: EMPTY_PAGES, engineFailure: null });
  const runtimeRef = useRef(/** @type {(Object|null)} */ (null));
  const allPagesRef = useRef(allPages);
  allPagesRef.current = allPages;
  const ensurePageAssetRef = useRef(ensurePageAsset);
  ensurePageAssetRef.current = ensurePageAsset;
  const readSourceRef = useRef(readSourceArrayBuffer);
  readSourceRef.current = readSourceArrayBuffer;
  const releasePageAssetRef = useRef(releasePageAsset);
  releasePageAssetRef.current = releasePageAsset;
  /** Viewer indexes of the current window (focus pages and neighbours): never released. */
  const windowIndexesRef = useRef(/** @type {Set<number>} */ (new Set()));
  const idleTimerRef = useRef(/** @type {*} */ (null));

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  // One runtime per module arrival: engine, cache, prober and queue live until unmount.
  useEffect(() => {
    if (!ocrModule) return undefined;
    let active = true;
    const cache = ocrModule.createOcrResultCache();
    const { engine } = ocrModule.createConfiguredOcrEngine();
    const prober = ocrModule.createPdfTextProber({
      readSourceArrayBuffer: (sourceKey) => readSourceRef.current(sourceKey),
    });
    const getPageImage = async (candidate) => {
      const url = await ensurePageAssetRef.current(candidate.viewerIndex, 'full');
      if (!url) throw new Error('Page image is unavailable');
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Page image could not be read (${response.status})`);
      const blob = await response.blob();
      // A page rendered only for OCR (beyond the window, the whole document asked for) is
      // released again as soon as its bytes are in hand, so a long document does not pile up
      // hundreds of page renders; a page the user has reached meanwhile is left to the viewer.
      if (candidate.renderedForOcr && !windowIndexesRef.current.has(candidate.viewerIndex)) {
        // The URL names the render to drop: a newer one (the viewer re-rendered meanwhile) stays.
        try { releasePageAssetRef.current?.(candidate.viewerIndex, url); } catch { /* the viewer keeps it */ }
      }
      // prepareOcrImage measures the fetched bytes themselves and removes ruling lines on a
      // private copy (the displayed image is never touched). The page entry's
      // realWidth/realHeight also track thumbnail commits and resolution boosts, so they may
      // describe other pixels than this blob: they are only the fallback where the browser
      // cannot decode the image.
      const page = allPagesRef.current?.[candidate.viewerIndex];
      return ocrModule.prepareOcrImage(blob, {
        fallbackSize: { width: Math.max(0, Number(page?.realWidth) || 0), height: Math.max(0, Number(page?.realHeight) || 0) },
      });
    };
    // The language guess chooses among the OCR languages only (what the viewer can recognise
    // and the reading-language menu offers); off when the site turned it off.
    const languageCandidates = isSpeechLanguageAutoDetectEnabled() ? speechLanguagesForOcr(getOcrLanguages()) : [];
    const detectLanguage = languageCandidates.length > 0 && typeof ocrModule.detectTextLanguage === 'function'
      ? (outcome) => ocrModule.detectTextLanguage((outcome.words || []).map((word) => word?.text), languageCandidates).language
      : null;
    const queue = ocrModule.createOcrQueue({
      engine,
      cache,
      probeTextLayer: (sourceKey, pageIndex) => prober.probe(sourceKey, pageIndex),
      getPageImage,
      detectLanguage,
      log: logger,
      onChange: (next) => {
        if (active) setSnapshot({ pages: next.pages, engineFailure: next.engineFailure });
      },
      onBusy: clearIdleTimer,
      onIdle: () => {
        clearIdleTimer();
        idleTimerRef.current = setTimeout(() => {
          idleTimerRef.current = null;
          if (!active || queue.isBusy()) return;
          void queue.releaseEngineIfIdle();
          void prober.releaseAll();
        }, Math.max(0, Number(idleShutdownMs) || 0));
      },
    });
    runtimeRef.current = { queue, prober, cache };
    return () => {
      active = false;
      clearIdleTimer();
      runtimeRef.current = null;
      queue.dispose();
      void prober.releaseAll();
      setSnapshot({ pages: EMPTY_PAGES, engineFailure: null });
    };
  }, [clearIdleTimer, idleShutdownMs, ocrModule]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.queue.setPaused(Boolean(paused) || !ready);
  }, [ocrModule, paused, ready]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const pages = Array.isArray(allPages) ? allPages : [];
    const sourceKeys = new Set();
    for (const page of pages) {
      const sourceKey = String(page?.sourceKey || '');
      if (sourceKey) sourceKeys.add(sourceKey);
    }
    runtime.queue.retainSources(sourceKeys);
    void runtime.prober.retainSources(sourceKeys);
    if (!ready) return;
    const windowOrder = ocrModule.planOcrWindow({ focusIndexes: focusPageIndexes, pageCount: pages.length });
    windowIndexesRef.current = new Set(windowOrder);
    const order = wholeDocument
      ? ocrModule.planOcrWindow({ focusIndexes: focusPageIndexes, pageCount: pages.length, wholeDocument: true })
      : windowOrder;
    // With the whole document planned, every page's outcome must stay cached while it is
    // planned, or the queue would recognise an evicted page again, without end.
    if (wholeDocument && typeof runtime.cache?.setLimit === 'function') runtime.cache.setLimit(pages.length);
    const candidates = [];
    for (const [position, viewerIndex] of order.entries()) {
      const page = pages[viewerIndex];
      if (!page) continue;
      // A page of the window joins the queue once its full-size render exists (the viewer's own
      // prefetch renders neighbours); a failed page is classified and skipped by the queue. A page
      // beyond the window (the whole document asked for) joins once it is loaded: the queue has
      // it rendered on demand through ensurePageAsset, like a page the viewer has not shown, and
      // released again once its bytes are read (`renderedForOcr`).
      const inWindow = position < windowOrder.length;
      if (Number(page.status) !== -1 && (inWindow ? Number(page.fullSizeStatus) !== 1 : Number(page.status) !== 1)) continue;
      const key = ocrPageKeyOf(page);
      if (!key) continue;
      candidates.push({
        key,
        sourceKey: String(page.sourceKey),
        pageIndex: Number(page.pageIndex) || 0,
        viewerIndex,
        page,
        renderedForOcr: !inWindow && Number(page.fullSizeStatus) !== 1,
      });
    }
    runtime.queue.setWindow(candidates);
  }, [allPages, focusPageIndexes, ocrModule, ready, wholeDocument]);

  return { ocrPages: snapshot.pages, ocrEngineFailure: snapshot.engineFailure };
}
