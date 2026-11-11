// File: src/hooks/useOcrTextLayers.js
/**
 * Runs OCR for the pages near the viewer's focus and exposes the outcomes per page.
 *
 * The hook is inert until the OCR module has arrived (useOcrModule.js hands it over only when
 * `ocr.enabled` is the literal true), so on the default code path it holds an empty map and
 * creates nothing. With the module it builds one engine (or a pool sized for the client by
 * `ocr.workerCount` and `ocr.workerPolicy`, which recognises as many pages at a time as are
 * pending and the pool allows), one in-memory result cache, one PDF
 * text prober and one page queue for the session; feeds the queue the window around the focus
 * pages (src/ocr/window.js) every time the pages or the focus change; pauses it while the viewer
 * says so (print PDF preparation, hard memory pressure); drops a document's outcomes when the
 * document leaves; and terminates the worker after a minute without work so its WebAssembly
 * memory is released (the next page starts it again). Recognition input is the page image the
 * viewer already rendered (`ensurePageAsset`), so no page is rasterised twice; the module's
 * prepareOcrImage measures it and removes ruling lines on a private copy that is released right
 * after (the displayed image and printing are never touched), in the module's preparation
 * worker, which the hook ends on unmount (src/ocr/imagePreparer.js). With `ocr.speech.autoDetectLanguage`
 * on (the default) each finished page's text is given a language guess among the viewer's OCR
 * languages (src/ocr/detectLanguage.js), which read-aloud and the text layer's
 * `lang` use; the guess is one pass over the page's words.
 *
 * With `ocr.boost.enabled` (off by default) the hook also owns the boost's triggers: the engine
 * is then always a pool, and a boost control (src/ocr/boost.js) may raise its ceiling above the
 * cautious count while the user is idle. The ways in are the configured triggers: no input for
 * `idleAfterMs` (pointer, keys, wheel and touch on the window), a hidden tab, and the toolbar's
 * search over the whole document waiting for pages (`searchOpen`); each applies only while
 * more pages are pending than the cautious count can take. The first input ends the boosted
 * state at once, and so does the end of the work. The control measures with a small synthetic
 * reference page (src/ocr/referencePage.js), drawn once; where none can be drawn, or where
 * `ocr.workerCount` is set by hand, or where the client has no room above the cautious count,
 * there is no boost and nothing listens. The state is exposed as `ocrBoost`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import logger from '../logging/systemLogger.js';
import { ocrPageKeyOf } from '../utils/ocrPageKey.js';
import {
  getOcrLanguages, isOcrBoostEnabled, isOcrWholeDocumentEnabled, isSpeechLanguageAutoDetectEnabled, normalizeOcrBoostConfig,
} from '../utils/runtimeConfig.js';
import { speechLanguagesForOcr } from '../utils/ocrLanguageCodes.js';

/** Idle time after which the OCR worker is terminated to free its memory. */
export const OCR_IDLE_SHUTDOWN_MS = 60000;

/** Window events that count as input for the boost: they end the boosted state and restart the idle clock. */
export const OCR_BOOST_ACTIVITY_EVENTS = Object.freeze(['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']);

/** @returns {(Object|null)} The boost configuration when the boost is on, else null. */
function readBoostConfig() {
  return isOcrBoostEnabled() ? normalizeOcrBoostConfig() : null;
}

/** @returns {number} `navigator.hardwareConcurrency`, or 0 when unknown. */
function reportedThreads() {
  return typeof navigator !== 'undefined' ? Math.max(0, Math.floor(Number(navigator.hardwareConcurrency)) || 0) : 0;
}

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
 * @param {boolean=} options.searchOpen  True while the toolbar's search over the whole document
 *   is open with a term: one of the boost's ways in. Default false.
 * @param {(Object|null)=} options.boost  The boost configuration (runtimeConfig.js
 *   normalizeOcrBoostConfig), or null for no boost; default from the runtime configuration.
 * @param {number=} options.hardwareThreads  Logical threads the boost may plan with; default
 *   `navigator.hardwareConcurrency`.
 * @returns {{ ocrPages: Object<string, Object>, ocrEngineFailure: (string|null), ocrBoost: (Object|null) }}
 *   `ocrPages` maps utils/ocrPageKey.js keys to outcomes (`status` done/skipped/failed with
 *   text, words and image size, or a transient queued/probing/recognizing state). `ocrBoost`
 *   is the boost control's state (`inspect()` of src/ocr/boost.js), or null without a boost.
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
  searchOpen = false,
  boost = readBoostConfig(),
  hardwareThreads = reportedThreads(),
}) {
  const [snapshot, setSnapshot] = useState({ pages: EMPTY_PAGES, engineFailure: null });
  const [boostState, setBoostState] = useState(/** @type {(Object|null)} */ (null));
  const runtimeRef = useRef(/** @type {(Object|null)} */ (null));
  /** The boost control and its triggers while the boost is on: `{ controller, onPlanned, detach }`. */
  const boostRef = useRef(/** @type {(Object|null)} */ (null));
  /** What the last window plan decided, for the boost to read and to restore. */
  const planRef = useRef({ concurrency: 1, pending: 0 });
  const pausedRef = useRef(Boolean(paused) || !ready);
  pausedRef.current = Boolean(paused) || !ready;
  const searchOpenRef = useRef(Boolean(searchOpen));
  searchOpenRef.current = Boolean(searchOpen);
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
    // One engine, or a pool behind the same interface sized for the client (a manual
    // `ocr.workerCount`, or the automatic plan's capacity from cores and memory); the queue runs
    // up to that many pages at a time, lowered to what the pending pages warrant each time the
    // window is planned (resolveOcrConcurrency), since an engine the queue never reaches is
    // never started.
    // With the boost on the engine is always a pool, which the boost control resizes.
    const boostWanted = Boolean(boost?.enabled) && typeof ocrModule.createOcrBoostController === 'function';
    const { engine, setup, workerCount } = ocrModule.createConfiguredOcrEngine(undefined, boostWanted ? { pool: true } : {});
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
      concurrency: Math.max(1, Math.floor(Number(workerCount)) || 1),
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
        // The work is done: nothing to boost for until more pages come.
        boostRef.current?.controller.disengage('done');
        clearIdleTimer();
        idleTimerRef.current = setTimeout(() => {
          idleTimerRef.current = null;
          if (!active || queue.isBusy()) return;
          void queue.releaseEngineIfIdle();
          void prober.releaseAll();
        }, Math.max(0, Number(idleShutdownMs) || 0));
      },
    });
    runtimeRef.current = { queue, prober, cache, setup, workerCount };
    if (boostWanted) {
      const cautious = Math.max(1, Math.floor(Number(workerCount)) || 1);
      const plan = setup?.workerPlan;
      if (plan && plan.automatic === false) {
        logger.debug('OCR boost is off: ocr.workerCount is set by hand', { workerCount: cautious });
      } else if (typeof engine.resize !== 'function') {
        logger.debug('OCR boost is off: the engine is not a pool');
      } else {
        const memoryCap = Number.isFinite(Number(plan?.caps?.memory)) ? Number(plan.caps.memory) : Infinity;
        const max = Math.min(hardwareThreads, memoryCap, boost.maxWorkerCount);
        const levels = ocrModule.planOcrBoostLevels({ cautious, threads: hardwareThreads, max });
        if (levels.length === 0) {
          logger.debug('OCR boost has no room above the cautious count', { cautious, threads: hardwareThreads, memoryCap, maxWorkerCount: boost.maxWorkerCount });
        } else {
          // The reference page is drawn once; without a canvas there is no yardstick and no boost.
          void Promise.resolve(ocrModule.createOcrReferencePage()).then((referencePage) => {
            if (!active) return;
            if (!referencePage) {
              logger.debug('OCR boost is off: no canvas for the reference page');
              return;
            }
            boostRef.current = attachBoost({
              ocrModule, engine, queue, cautious, levels, referencePage, config: boost, planRef, pausedRef, searchOpenRef,
              onChange: (next) => { if (active) setBoostState(next); },
            });
            setBoostState(boostRef.current.controller.inspect());
          }, (error) => {
            logger.debug('OCR boost is off: the reference page could not be drawn', { error: String(error?.message || error) });
          });
        }
      }
    }
    return () => {
      active = false;
      clearIdleTimer();
      runtimeRef.current = null;
      boostRef.current?.detach();
      boostRef.current = null;
      setBoostState(null);
      queue.dispose();
      void prober.releaseAll();
      // The preparation worker is shared by the module; nothing uses it once the queue is gone.
      ocrModule.disposeOcrImagePreparer?.();
      setSnapshot({ pages: EMPTY_PAGES, engineFailure: null });
    };
  }, [boost, clearIdleTimer, hardwareThreads, idleShutdownMs, ocrModule]);

  // The search over the whole document is one of the ways in; it also ends when the search closes.
  useEffect(() => {
    const control = boostRef.current;
    if (!control) return;
    if (searchOpen) control.onPlanned();
    else control.controller.disengage('search closed');
  }, [searchOpen]);

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
    // Pages in flight for what is still to do: a short window does not start engines it cannot
    // feed, the whole document gets the pool's capacity. Set together with the plan, so the
    // limit never pumps the old plan.
    let concurrency;
    const pending = candidates.filter((entry) => !runtime.cache.has(entry.key)).length;
    if (typeof ocrModule.resolveOcrConcurrency === 'function') {
      concurrency = ocrModule.resolveOcrConcurrency(pending, runtime.setup);
    }
    planRef.current = { concurrency: Math.max(1, Math.floor(Number(concurrency ?? runtime.workerCount)) || 1), pending };
    // While boosted, the boost's level is the limit; the plan's figure is restored with the cautious count.
    const level = boostRef.current?.controller.level() ?? 0;
    runtime.queue.setWindow(candidates, { concurrency: level > runtime.workerCount ? level : concurrency });
    boostRef.current?.onPlanned();
  }, [allPages, focusPageIndexes, ocrModule, ready, wholeDocument]);

  return { ocrPages: snapshot.pages, ocrEngineFailure: snapshot.engineFailure, ocrBoost: boostState };
}

/**
 * Create the boost control and its triggers for one runtime.
 *
 * @param {Object} inputs
 * @returns {{ controller: Object, onPlanned: function(): void, detach: function(): void }}
 */
function attachBoost({ ocrModule, engine, queue, cautious, levels, referencePage, config, planRef, pausedRef, searchOpenRef, onChange }) {
  const controller = ocrModule.createOcrBoostController({
    cautious,
    levels,
    slowdownFraction: config.slowdownFraction,
    log: logger,
    onChange,
    // The pool's ceiling and the queue's pages in flight follow the level; back at the cautious
    // count the queue gets what the last window plan decided for the pending pages.
    apply: (count) => {
      engine.resize(count);
      queue.setConcurrency(count > cautious ? count : planRef.current.concurrency);
    },
    // The reference page on whichever engine is free: its own recognition time, without the
    // wait for the engine or the engine's start (engine.js recognizeMs).
    probe: () => Promise.resolve(engine.recognize(referencePage)).then((result) => Number(result?.recognizeMs)),
  });
  const triggers = config.triggers;
  let idleTimer = null;
  const clearIdle = () => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };
  // Worth boosting only while more pages are pending than the cautious count can take at once.
  const hasWork = () => !pausedRef.current && planRef.current.pending > cautious;
  const tryEngage = (reason) => {
    if (!hasWork()) return;
    void controller.engage(reason);
  };
  const armIdle = () => {
    clearIdle();
    if (!triggers.idle) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      tryEngage('idle');
    }, Math.max(0, Number(config.idleAfterMs) || 0));
  };
  const onActivity = () => {
    controller.disengage('input');
    armIdle();
  };
  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      if (triggers.hidden) tryEngage('hidden');
    } else {
      armIdle();
    }
  };
  const listenerOptions = { passive: true, capture: true };
  if (typeof window !== 'undefined') {
    for (const type of OCR_BOOST_ACTIVITY_EVENTS) window.addEventListener(type, onActivity, listenerOptions);
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  armIdle();
  return {
    controller,
    /** After a window plan (or a search opening): the search's way in, while it waits for pages. */
    onPlanned() {
      if (triggers.search && searchOpenRef.current) tryEngage('search');
    },
    detach() {
      clearIdle();
      if (typeof window !== 'undefined') {
        for (const type of OCR_BOOST_ACTIVITY_EVENTS) window.removeEventListener(type, onActivity, listenerOptions);
      }
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      controller.disengage('unmount');
    },
  };
}
