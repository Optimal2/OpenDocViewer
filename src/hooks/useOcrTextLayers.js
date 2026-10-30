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
 * viewer already rendered (`ensurePageAsset`), so no page is rasterised twice.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import logger from '../logging/systemLogger.js';
import { ocrPageKeyOf } from '../utils/ocrPageKey.js';

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
 * @param {number=} options.idleShutdownMs  Default OCR_IDLE_SHUTDOWN_MS.
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
  idleShutdownMs = OCR_IDLE_SHUTDOWN_MS,
}) {
  const [snapshot, setSnapshot] = useState({ pages: EMPTY_PAGES, engineFailure: null });
  const runtimeRef = useRef(/** @type {(Object|null)} */ (null));
  const allPagesRef = useRef(allPages);
  allPagesRef.current = allPages;
  const ensurePageAssetRef = useRef(ensurePageAsset);
  ensurePageAssetRef.current = ensurePageAsset;
  const readSourceRef = useRef(readSourceArrayBuffer);
  readSourceRef.current = readSourceArrayBuffer;
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
      // The image size comes from the fetched bytes themselves: the page entry's
      // realWidth/realHeight also track thumbnail commits and resolution boosts, so they may
      // describe other pixels than this blob. The page entry is only the fallback where
      // createImageBitmap does not exist.
      let width;
      let height;
      if (typeof createImageBitmap === 'function') {
        const bitmap = await createImageBitmap(blob);
        width = bitmap.width;
        height = bitmap.height;
        bitmap.close?.();
      } else {
        const page = allPagesRef.current?.[candidate.viewerIndex];
        width = Math.max(0, Number(page?.realWidth) || 0);
        height = Math.max(0, Number(page?.realHeight) || 0);
      }
      return { blob, width, height };
    };
    const queue = ocrModule.createOcrQueue({
      engine,
      cache,
      probeTextLayer: (sourceKey, pageIndex) => prober.probe(sourceKey, pageIndex),
      getPageImage,
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
    runtimeRef.current = { queue, prober };
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
    const order = ocrModule.planOcrWindow({ focusIndexes: focusPageIndexes, pageCount: pages.length });
    const candidates = [];
    for (const viewerIndex of order) {
      const page = pages[viewerIndex];
      // A page joins the window once its full-size render exists (the viewer's own prefetch
      // renders neighbours); a failed page is classified and skipped by the queue.
      if (!page || (Number(page.status) !== -1 && Number(page.fullSizeStatus) !== 1)) continue;
      const key = ocrPageKeyOf(page);
      if (!key) continue;
      candidates.push({ key, sourceKey: String(page.sourceKey), pageIndex: Number(page.pageIndex) || 0, viewerIndex, page });
    }
    runtime.queue.setWindow(candidates);
  }, [allPages, focusPageIndexes, ocrModule, ready]);

  return { ocrPages: snapshot.pages, ocrEngineFailure: snapshot.engineFailure };
}
