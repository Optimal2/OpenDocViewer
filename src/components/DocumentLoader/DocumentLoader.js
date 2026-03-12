// File: src/components/DocumentLoader/DocumentLoader.js
/**
 * File: src/components/DocumentLoader/DocumentLoader.js
 *
 * Document loading orchestrator.
 *
 * Responsibilities:
 * - create the ordered list of source entries (pattern mode, explicit list, or demo list)
 * - fetch bytes and infer file type
 * - choose the correct execution path for each source
 *   - PDF: main thread
 *   - TIFF: main thread
 *   - raster image: worker pipeline
 * - insert normalized page entries into `ViewerContext` in stable page order
 *
 * Design boundaries:
 * - type normalization belongs in `documentLoaderUtils.js`
 * - worker lifecycle helpers belong in `workerHandler.js`
 * - batch scheduling belongs in `batchHandler.js`
 * - PDF/TIFF rasterization belongs in `mainThreadRenderer.js`
 */

import { useEffect, useContext, useRef, useCallback } from 'react';
import ViewerContext from '../../contexts/viewerContext.js';
import logger from '../../logging/systemLogger.js';
import { generateDocumentList, generateDemoList, getTotalPages } from './documentLoaderUtils.js';
import { createWorker, getNumberOfWorkers, handleWorkerMessage } from './workerHandler.js';
import { batchHandler } from './batchHandler.js';
import { renderPDFInMainThread, renderTIFFInMainThread } from './mainThreadRenderer.js';
import { fileTypeFromBuffer, fileTypeFromBlob } from 'file-type';

/* ------------------------------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------------------------------ */


/**
 * Props for {@link DocumentLoader}.
 * @typedef {Object} DocumentLoaderProps
 * @property {string=} folder Pattern-mode base folder/path for assets.
 * @property {string=} extension Pattern-mode extension such as `png` or `tiff`.
 * @property {number=} endNumber Pattern-mode upper bound for generated file numbers.
 * @property {Array.<DocumentSourceItem>=} sourceList Explicit ordered source list.
 * @property {boolean=} sameBlob Reuse full-size blob URLs for thumbnails when appropriate.
 * @property {boolean=} demoMode Enable generated/demo source entries.
 * @property {'repeat'|'mix'=} demoStrategy Strategy for demo source generation.
 * @property {number=} demoCount Number of demo entries to produce.
 * @property {Array.<string>=} demoFormats Demo formats to cycle through.
 * @property {*} children Viewer subtree rendered after loader orchestration is mounted.
 */

/**
 * Explicit-list item used by `sourceList`.
 * @typedef {Object} DocumentSourceItem
 * @property {string} url
 * @property {string=} ext
 * @property {number=} fileIndex
 */

/* ------------------------------------------------------------------------------------------------
 * Adaptive worker tuning
 * ------------------------------------------------------------------------------------------------ */

/**
 * Clamp a number into the inclusive range [lo, hi].
 * @param {number} n
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * Detect mobile-like environments to keep the default worker cap conservative on handheld devices.
 * This is a best-effort heuristic and not a hard capability check.
 *
 * @returns {boolean}
 */
const isMobile = (() => {
  try {
    // @ts-ignore
    if (navigator?.userAgentData?.mobile != null) return navigator.userAgentData.mobile;
  } catch {}
  try {
    return /Android|iPhone|iPad|iPod/i.test(navigator?.userAgent || '');
  } catch {
    return false;
  }
})();

/**
 * Compute a starting config for worker count and batch size.
 * - ≤3 logical cores → strictly sequential (1 worker) to preserve responsiveness.
 * - Always leave 1 core for the UI when possible.
 * - Constrain by device memory and mobile caps.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.cpuBound=true]
 * @param {boolean} [opts.ioHeavy=false]
 * @param {number}  [opts.desiredCap]
 * @returns {{ maxWorkers: number, batchSize: (number|Infinity), lowCore: boolean }}
 */
function computeWorkerTuning({ cpuBound = true, ioHeavy = false, desiredCap } = {}) {
  const cores = Math.max(1, Number((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2));
  const memGB = Number((typeof navigator !== 'undefined' && navigator.deviceMemory) || 4);

  const lowCore = cores <= 3;
  const leaveForMain = cores > 1 ? 1 : 0;

  let hardCap = desiredCap ?? (isMobile ? 8 : 16);
  if (memGB <= 3) hardCap = Math.min(hardCap, isMobile ? 4 : 8);

  const base = clamp(cores - leaveForMain, 1, hardCap);
  let maxWorkers = cpuBound ? base : clamp(Math.ceil(base * (ioHeavy ? 1.5 : 1.2)), 1, hardCap);
  if (lowCore) maxWorkers = 1;

  const batchSize = lowCore ? Infinity : (cpuBound ? 24 : 64);
  return { maxWorkers, batchSize, lowCore };
}

const { maxWorkers, batchSize, lowCore } = computeWorkerTuning({ cpuBound: true });

/* ------------------------------------------------------------------------------------------------
 * React component
 * ------------------------------------------------------------------------------------------------ */

/**
 * DocumentLoader — Loads and processes documents for rendering.
 *
 * The component is intentionally orchestration-heavy: it decides which loading path to use,
 * reserves stable page indexes, and fans work out to workers or main-thread renderers.
 *
 * @param {DocumentLoaderProps} props
 * @param {(string|undefined)} [props.folder]           Pattern mode: base folder/path for assets
 * @param {(string|undefined)} [props.extension]        Pattern mode: file extension (e.g., "png", "tiff")
 * @param {(number|undefined)} [props.endNumber]        Pattern mode: last page/file number (1..N)
 * @param {Array.<DocumentSourceItem>} [props.sourceList]
 *        Explicit-list mode: ordered list of source items
 * @param {(boolean|undefined)} [props.sameBlob=true]   Reuse full-size blob URL for thumbnails when possible
 * @param {(boolean|undefined)} [props.demoMode]        Demo mode: enable direct image insertion for simple formats
 * @param {"repeat"|"mix"}      [props.demoStrategy="repeat"] Demo strategy
 * @param {(number|undefined)}  [props.demoCount]       Demo count: number of entries to produce
 * @param {Array.<string>=}     [props.demoFormats]     Demo formats: default ['jpg','png','tif','pdf']
 * @param {*} props.children                             Render prop subtree (viewer UI)
 * @returns {*}
 */
const DocumentLoader = ({
  folder,
  extension,
  children,
  sameBlob = true,
  endNumber,
  sourceList,
  demoMode,
  demoStrategy = 'repeat',
  demoCount,
  demoFormats
}) => {
  const {
    insertPageAtIndex,
    setError,
    setWorkerCount,
    setLoadingRunActive,
    setPlannedPageCount,
  } = useContext(ViewerContext);

  /** Lifecycle guard so async work can stop cleanly on unmount or StrictMode remount. */
  const isMounted = useRef(true);

  /** Lightweight counters for tracing insert behavior during development and troubleshooting. */
  const insertsAttempted = useRef(0);
  const insertsAccepted = useRef(0);

  /** Lightweight run tracing to make StrictMode re-mounts obvious in logs. */
  const runId = useRef(
    (() => {
      try {
        const s = Math.random().toString(36).slice(2, 8);
        return `run_${Date.now().toString(36)}_${s}`;
      } catch {
        return `run_${Date.now()}`;
      }
    })()
  );

  /** Work queues separated by execution environment. */
  /** @type {React.MutableRefObject.<Array.<*>>} */ const jobQueue = useRef([]);           // worker jobs
  /** @type {React.MutableRefObject.<Array.<*>>} */ const mainThreadJobQueue = useRef([]); // PDF/TIFF fallbacks
  /** @type {React.MutableRefObject.<Array.<*>>} */ const batchQueue = useRef([]);

  /** Global page index across all inputs so inserted pages remain stable in viewer order. */
  const currentPageIndex = useRef(0);

  /** Track inflight fetches for cleanup on unmount */
  const fetchControllers = useRef(new Set());

  /** Worker pool lives per-effect run (StrictMode-safe) */
  const imageWorkersRef = useRef(/** @type {Worker[]} */([]));

  /** Start timer handle (so the "probe" pass can be neutralized cleanly) */
  const startTimerRef = useRef(/** @type {number|undefined} */(undefined));

  /**
   * Publish the currently planned page total to viewer context.
   * @param {number} count
   * @returns {void}
   */
  const publishPlannedPageCount = useCallback((count) => {
    const next = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    setPlannedPageCount(next);
  }, [setPlannedPageCount]);

  /**
   * Minimal failure placeholder insertion.
   * @param {string} url
   * @param {number} fileIndex
   * @returns {void}
   */
  const handleFailedDocumentLoad = useCallback((url, fileIndex) => {
    logger.error(`Failed to load document at ${url}`, { runId: runId.current });
    const failedPage = {
      fullSizeUrl: 'lost.png',
      thumbnailUrl: 'lost.png',
      loaded: false,
      status: -1,
      fileExtension: 'png',
      fileIndex,
      pageIndex: 0,
      runId: runId.current,
    };
    insertsAttempted.current += 1;
    insertPageAtIndex(failedPage, currentPageIndex.current);
    insertsAccepted.current += 1;
    currentPageIndex.current += 1;
    publishPlannedPageCount(currentPageIndex.current);
    logger.info('Inserted page at index', { index: currentPageIndex.current - 1, ext: 'png', fileIndex, pageIndex: 0 });
  }, [insertPageAtIndex, publishPlannedPageCount]);

  /**
   * Infer a file extension directly from a source URL without any network fetch.
   * Used only for the demo-mode fast path.
   *
   * @param {string} u
   * @returns {(string|null)}
   */
  const extFromUrl = (u) => {
    const m = String(u).toLowerCase().match(/\.(pdf|tiff?|png|jpe?g|bmp|gif)(?:$|\?)/i);
    return m ? m[1].toLowerCase() : null;
  };

  /** Insert wrapper (keeps counters/logging consistent). */
  const insertAtIndex = useCallback((page, index) => {
    insertsAttempted.current += 1;
    insertPageAtIndex(page, index);
    insertsAccepted.current += 1;
    logger.info('Inserted page at index', {
      index,
      ext: page?.fileExtension,
      fileIndex: page?.fileIndex,
      pageIndex: page?.pageIndex
    });
  }, [insertPageAtIndex]);

  /**
   * Drain and execute any queued main-thread jobs (PDF/TIFF) ASAP.
   * Ensures dev and build behave identically when workers request main-thread handling.
   */
  const drainMainThreadJobs = useCallback(async () => {
    logger.debug('Drain main-thread jobs: start', { runId: runId.current, queued: mainThreadJobQueue.current.length });
    while (isMounted.current && mainThreadJobQueue.current.length > 0) {
      /** @type {*} */
      const job = mainThreadJobQueue.current.shift();
      try {
        const run = job.fileExtension === 'pdf' ? renderPDFInMainThread : renderTIFFInMainThread;
        await run(job, insertAtIndex, sameBlob, isMounted);
      } catch (e) {
        logger.error('Main-thread render failed', { error: String(e?.message || e), runId: runId.current });
      }
    }
    logger.debug('Drain main-thread jobs: end', { runId: runId.current });
  }, [insertAtIndex, sameBlob]);

  /**
   * Fetch + detect + enqueue a single document, or directly insert for simple images in demo mode.
   *
   * @param {string} url
   * @param {number} index
   * @returns {Promise.<void>}
   */
  const loadDocumentAsync = useCallback(async (url, index) => {
    // Fast path: in demo mode, directly insert simple image formats (no workers needed).
    const urlExt = extFromUrl(url);
    if (demoMode && urlExt && !['pdf', 'tiff', 'tif'].includes(urlExt)) {
      const at = currentPageIndex.current;
      /** @type {*} */
      const page = {
        fullSizeUrl: url,
        thumbnailUrl: url,
        loaded: true,
        status: 1,
        fileExtension: urlExt,
        fileIndex: index,
        pageIndex: 0,
        runId: runId.current,
      };
      logger.debug('Reserve indices (simple image)', {
        fileIndex: index,
        ext: urlExt,
        at,
        pages: 1,
        runId: runId.current
      });

      currentPageIndex.current += 1;
      publishPlannedPageCount(currentPageIndex.current);
      insertAtIndex(page, at);
      return;
    }

    const controller = new AbortController();
    fetchControllers.current.add(controller);

    try {
      logger.debug('Loading document', { url, index, runId: runId.current });

      const response = await fetch(url, { signal: controller.signal });
      logger.debug('Fetch response', { url, status: response.status, runId: runId.current });

      if (!response.ok) {
        throw new Error(`Failed to fetch document at ${url} with status ${response.status}`);
      }

      let arrayBuffer = await response.arrayBuffer();

      fetchControllers.current.delete(controller);

      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        throw new Error(`Invalid or empty ArrayBuffer for document at ${url}`);
      }

      // Robust content-type detection (browser-safe)
      let fileType;
      try {
        fileType = await fileTypeFromBuffer(new Uint8Array(arrayBuffer));
      } catch {}
      if (!fileType) {
        try {
          fileType = await fileTypeFromBlob(new Blob([arrayBuffer]));
        } catch {}
      }

      // Infer extension if signatures are unknown
      let fileExtension = fileType?.ext;
      if (!fileExtension) {
        const ct = (typeof response !== 'undefined' && response.headers?.get?.('content-type')) || '';
        if (/pdf/i.test(ct)) fileExtension = 'pdf';
        else if (/tiff?/i.test(ct)) fileExtension = 'tiff';
        else {
          const m = String(url).toLowerCase().match(/\.(pdf|tiff?|png|jpe?g|bmp|gif)(?:$|\?)/i);
          fileExtension = m ? m[1].toLowerCase() : null;
        }
      }

      if (!fileExtension) {
        throw new Error(`Unexpected file type for document at ${url}: unknown`);
      }

      const totalPages = await getTotalPages(arrayBuffer, fileExtension);
      logger.debug('Total pages detected', { totalPages, url, runId: runId.current });

      // ✅ DEV == BUILD: always render multi-page formats on main thread
      if (fileExtension === 'pdf' || fileExtension === 'tiff' || fileExtension === 'tif') {
        const job = {
          runId: runId.current,
          arrayBuffer,
          sourceUrl: url,
          fileExtension,
          index,
          pageStartIndex: 0,
          pagesInvolved: totalPages,
          allPagesStartingIndex: currentPageIndex.current,
        };
        logger.debug('Reserve indices (multi-page MT)', {
          fileIndex: index,
          ext: fileExtension,
          start: job.allPagesStartingIndex,
          end: job.allPagesStartingIndex + totalPages - 1,
          pages: totalPages,
          runId: runId.current
        });

        mainThreadJobQueue.current.push(job);
        arrayBuffer = null;
        currentPageIndex.current += totalPages;
        publishPlannedPageCount(currentPageIndex.current);
        logger.debug('Routed multi-page document to main thread', { fileExtension, totalPages, runId: runId.current });
      } else {
        // Other single-image types → worker
        const job = {
          runId: runId.current,
          arrayBuffer,
          sourceUrl: url,
          fileExtension,
          index,
          pageStartIndex: 0,
          pagesInvolved: 1,
          allPagesStartingIndex: currentPageIndex.current,
        };
        logger.debug('Reserve indices (worker image)', {
          fileIndex: index,
          ext: fileExtension,
          at: job.allPagesStartingIndex,
          pages: 1,
          runId: runId.current
        });

        jobQueue.current.push(job);
        arrayBuffer = null;
        currentPageIndex.current += 1;
        publishPlannedPageCount(currentPageIndex.current);
      }
    } catch (error) {
      fetchControllers.current.delete(controller);

      if (error?.name === 'AbortError') {
        logger.debug('Fetch aborted', { url, runId: runId.current });
        return;
      }

      handleFailedDocumentLoad(url, index);
      if (isMounted.current) {
        setError(error.message);
        logger.error('Error loading document', { error: error.message, runId: runId.current });
      }
    }
  }, [setError, handleFailedDocumentLoad, demoMode, insertAtIndex, publishPlannedPageCount]);

  /**
   * Handle worker results and immediately drain any follow-up work that must occur on the main thread.
   *
   * @param {MessageEvent} evt
   * @returns {void}
   */
  const onWorkerMessage = useCallback(
    (evt) => {
      handleWorkerMessage(evt, insertAtIndex, sameBlob, isMounted, {
        renderPDFInMainThread,
        renderTIFFInMainThread,
        mainThreadJobQueueRef: mainThreadJobQueue,
      });
      if (mainThreadJobQueue.current.length > 0) {
        setTimeout(drainMainThreadJobs, 0);
      }
    },
    [insertAtIndex, sameBlob, drainMainThreadJobs]
  );

  /**
   * Start batched worker processing for the queued raster-image jobs.
   *
   * @returns {void}
   */
  const processBatches = useCallback(() => {
    batchHandler(
      jobQueue,
      batchQueue,
      batchSize,
      imageWorkersRef.current,
      onWorkerMessage,
      insertAtIndex,
      sameBlob,
      isMounted
    );
  }, [sameBlob, insertAtIndex, onWorkerMessage]);

  /**
   * Sequential fallback scheduler used on low-core devices where parallel workers would harm responsiveness.
   *
   * @returns {void}
   */
  const processSequential = useCallback(() => {
    if (!isMounted.current) return;

    const next = jobQueue.current.shift();
    if (next) {
      const w = imageWorkersRef.current[0];
      if (!w) return;

      w.onmessage = async (evt) => {
        handleWorkerMessage(evt, insertAtIndex, sameBlob, isMounted, {
          renderPDFInMainThread,
          renderTIFFInMainThread,
          mainThreadJobQueueRef: mainThreadJobQueue,
        });
        if (mainThreadJobQueue.current.length > 0) {
          setTimeout(drainMainThreadJobs, 0);
        }
        setTimeout(processSequential, 0);
      };
      w.onerror = async () => {
        handleWorkerMessage(
          {
            data: {
              jobs: [
                {
                  fullSizeUrl: null,
                  fileIndex: next.index,
                  pageIndex: next.pageStartIndex || 0,
                  fileExtension: next.fileExtension,
                  allPagesIndex: next.allPagesStartingIndex,
                },
              ],
            },
          },
          insertAtIndex,
          sameBlob,
          isMounted
        );
        if (mainThreadJobQueue.current.length > 0) {
          setTimeout(drainMainThreadJobs, 0);
        }
        setTimeout(processSequential, 0);
      };

      const transfer = next?.arrayBuffer instanceof ArrayBuffer ? [next.arrayBuffer] : [];
      w.postMessage({ jobs: [next], fileExtension: next.fileExtension }, transfer);
      return;
    }

    /** @type {*} */
    const mt = mainThreadJobQueue.current.shift();
    if (mt) {
      const run = mt.fileExtension === 'pdf' ? renderPDFInMainThread : renderTIFFInMainThread;
      run(mt, insertAtIndex, sameBlob, isMounted).then(() => setTimeout(processSequential, 0));
    }
  }, [insertAtIndex, sameBlob, drainMainThreadJobs]);

  useEffect(() => {
    const activeFetchControllers = new Set();
    fetchControllers.current = activeFetchControllers;

    // Fresh run token (helps trace StrictMode re-runs)
    try {
      runId.current = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    } catch {
      runId.current = `run_${Date.now()}`;
    }
    isMounted.current = true;
    insertsAttempted.current = 0;
    insertsAccepted.current = 0;

    // 🔧 STRICTMODE-ROBUST: Defer ALL heavy setup/scheduling to next tick.
    // In React dev StrictMode the first mount is immediately unmounted; by deferring,
    // the "probe" pass is cleaned up before any work runs, so no duplicates.
    startTimerRef.current = window.setTimeout(() => {
      if (!isMounted.current) {
        logger.debug('Start aborted (component already unmounted)', { runId: runId.current });
        return;
      }

      // Reset queues/counters for this run
      setLoadingRunActive(true);
      publishPlannedPageCount(0);
      jobQueue.current = [];
      mainThreadJobQueue.current = [];
      batchQueue.current = [];
      currentPageIndex.current = 0;

      // Create a fresh worker pool for THIS run
      const numWorkers = getNumberOfWorkers(maxWorkers);
      imageWorkersRef.current = Array.from({ length: numWorkers }, () => createWorker());
      setWorkerCount(imageWorkersRef.current.length);
      logger.debug(`Using ${numWorkers} workers. (maxWorkers=${maxWorkers}, lowCore=${lowCore}, batchSize=${batchSize})`, {
        runId: runId.current
      });

      /**
       * Resolve the active source strategy, enqueue every document, then hand execution off to the
       * worker or main-thread schedulers.
       *
       * @returns {Promise.<void>}
       */
      const loadDocuments = async () => {
        logger.info('DocumentLoader start', { runId: runId.current });

        let entries = [];
        if (Array.isArray(sourceList) && sourceList.length > 0) {
          entries = sourceList
            .map((it, i) => ({ url: it?.url, fileIndex: typeof it?.fileIndex === 'number' ? it.fileIndex : i }))
            .filter((e) => !!e.url);
          logger.debug('Using explicit sourceList', { count: entries.length, runId: runId.current });
        } else if (demoMode) {
          const demoUrls = generateDemoList({ strategy: demoStrategy, count: demoCount || 1, formats: demoFormats });
          entries = demoUrls.map((url, i) => ({ url, fileIndex: i }));
          logger.debug('Generated demo URLs', { count: demoUrls.length, strategy: demoStrategy, runId: runId.current });
        } else {
          const documentUrls = generateDocumentList(folder, extension, endNumber);
          entries = documentUrls.map((url, i) => ({ url, fileIndex: i }));
          logger.debug('Generated document URLs', { count: documentUrls.length, runId: runId.current });
        }

        try {
          logger.debug('Scheduling entries', { count: entries.length, runId: runId.current });
          for (let i = 0; i < entries.length; i++) {
            const { url, fileIndex } = entries[i];
            if (!isMounted.current) break;
            logger.debug('Processing document URL', { url, index: fileIndex, runId: runId.current });
            await loadDocumentAsync(url, fileIndex);
          }

          logger.debug('Scheduling complete', {
            runId: runId.current,
            pendingWorkerJobs: jobQueue.current.length,
            pendingMainThreadJobs: mainThreadJobQueue.current.length,
            totalPlannedPages: currentPageIndex.current
          });

          if (!isMounted.current) return;

          setLoadingRunActive(false);

          if (lowCore) {
            setTimeout(processSequential, 0);
          } else {
            processBatches();
            setTimeout(drainMainThreadJobs, 0);
          }
        } catch (error) {
          if (isMounted.current) {
            setLoadingRunActive(false);
            setError(error.message);
            logger.error('Error loading documents', { error: error.message, runId: runId.current });
          }
        }
      };

      loadDocuments();
    }, 0);

    return () => {
      isMounted.current = false;

      // Cancel deferred start if it hasn't executed yet (neutralizes StrictMode probe)
      if (startTimerRef.current != null) {
        try { clearTimeout(startTimerRef.current); } catch {}
        startTimerRef.current = undefined;
      }

      activeFetchControllers.forEach((ctrl) => {
        try { ctrl.abort(); } catch {}
      });
      activeFetchControllers.clear();
      if (fetchControllers.current === activeFetchControllers) {
        fetchControllers.current = new Set();
      }

      // Terminate this run's workers
      (imageWorkersRef.current || []).forEach((worker) => {
        try { worker.terminate(); } catch {}
      });
      imageWorkersRef.current = [];
      setWorkerCount(0);
      setLoadingRunActive(false);

      logger.info('DocumentLoader cleanup', {
        runId: runId.current,
        insertsAttempted: insertsAttempted.current,
        insertsAccepted: insertsAccepted.current,
        plannedTotal: currentPageIndex.current
      });
    };
  }, [
    folder,
    extension,
    endNumber,
    sourceList,
    demoMode,
    demoStrategy,
    demoCount,
    demoFormats,
    setError,
    loadDocumentAsync,
    insertAtIndex,
    sameBlob,
    processBatches,
    processSequential,
    drainMainThreadJobs,
    setWorkerCount,
    setLoadingRunActive,
    publishPlannedPageCount,
  ]);

  return children;
};

export default DocumentLoader;
