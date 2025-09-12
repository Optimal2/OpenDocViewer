// File: src/components/DocumentLoader/DocumentLoader.js
/**
 * File: src/components/DocumentLoader/DocumentLoader.js
 *
 * OpenDocViewer — Orchestrates document fetching, type detection, paging, and rendering.
 *
 * MODES
 *   1) Pattern mode (legacy/demo): { folder, extension, endNumber }
 *   2) Explicit-list mode:        { sourceList: [{ url, ext, fileIndex }, ...] }
 *   3) Demo mode (new):           { demoMode, demoStrategy, demoCount, demoFormats }
 *
 * PIPELINE (high level)
 *   - For each input entry → fetch bytes (ArrayBuffer)
 *   - Detect content type via `file-type` (buffer first, then blob fallback)
 *   - Decide execution path:
 *       • PDF → push a single job to the main-thread renderer queue
 *       • TIFF → push a single job to the main-thread renderer queue (dev == build)
 *       • Other images → push a single job to the worker queue
 *   - Schedule work:
 *       • Low-core devices (≤3 logical cores) → sequential scheduler; yields to UI between jobs
 *       • Others → batched, multi-worker processing via `batchHandler`
 *
 * DESIGN GOTCHA
 *   - Import from the root 'file-type' package (not 'file-type/browser'); many bundlers don't expose that subpath.
 */

import { useEffect, useContext, useRef, useCallback } from 'react';
import { ViewerContext } from '../../ViewerContext.jsx';
import logger from '../../LogController.js';
import { generateDocumentList, generateDemoList, getTotalPages } from './Utils.js';
import { createWorker, getNumberOfWorkers, handleWorkerMessage } from './WorkerHandler.js';
import { batchHandler } from './BatchHandler.js';
import { renderPDFInMainThread, renderTIFFInMainThread } from './MainThreadRenderer.js';
import { fileTypeFromBuffer, fileTypeFromBlob } from 'file-type';

/* ------------------------------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------------------------------ */

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
 * @param {Object} props
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
  const { insertPageAtIndex, setError, setWorkerCount } = useContext(ViewerContext);

  /** Lifecycle guard (StrictMode-safe) */
  const isMounted = useRef(true);

  /** Trace counters (dev diagnostics) */
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

  /** Work queues */
  /** @type {React.MutableRefObject.<Array.<*>>} */ const jobQueue = useRef([]);           // worker jobs
  /** @type {React.MutableRefObject.<Array.<*>>} */ const mainThreadJobQueue = useRef([]); // PDF/TIFF fallbacks
  /** @type {React.MutableRefObject.<Array.<*>>} */ const batchQueue = useRef([]);

  /** Global page index across all inputs (for ViewerContext ordering) */
  const currentPageIndex = useRef(0);

  /** Track inflight fetches for cleanup on unmount */
  const fetchControllers = useRef(new Set());

  /** Worker pool lives per-effect run (StrictMode-safe) */
  const imageWorkersRef = useRef(/** @type {Worker[]} */([]));

  /** Start timer handle (so the "probe" pass can be neutralized cleanly) */
  const startTimerRef = useRef(/** @type {number|undefined} */(undefined));

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
    logger.info('Inserted page at index', { index: currentPageIndex.current - 1, ext: 'png', fileIndex, pageIndex: 0 });
  }, [insertPageAtIndex]);

  /** Quick ext inference from URL (no network). */
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
  }, [setError, handleFailedDocumentLoad, demoMode, insertAtIndex]);

  // Wrap worker handler and immediately drain any main-thread jobs the worker requested.
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

  // Process batches of jobs using workers
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

  // Low-core sequential scheduler
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

          if (lowCore) {
            setTimeout(processSequential, 0);
          } else {
            processBatches();
            setTimeout(drainMainThreadJobs, 0);
          }
        } catch (error) {
          if (isMounted.current) {
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

      fetchControllers.current.forEach((ctrl) => {
        try { ctrl.abort(); } catch {}
      });
      fetchControllers.current.clear();

      // Terminate this run's workers
      (imageWorkersRef.current || []).forEach((worker) => {
        try { worker.terminate(); } catch {}
      });
      imageWorkersRef.current = [];
      setWorkerCount(0);

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
  ]);

  return children;
};

export default DocumentLoader;
