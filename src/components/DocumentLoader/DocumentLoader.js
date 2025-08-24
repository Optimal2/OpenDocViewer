/**
 * File: src/components/DocumentLoader/DocumentLoader.js
 *
 * OpenDocViewer — Orchestrates document fetching, type detection, paging, and rendering.
 *
 * MODES
 *   1) Pattern mode (legacy/demo): { folder, extension, endNumber }
 *   2) Explicit-list mode:        { sourceList: [{ url, ext?, fileIndex? }, ...] }
 *
 * PIPELINE (high level)
 *   - For each input entry → fetch bytes (ArrayBuffer)
 *   - Detect content type via `file-type` (buffer first, then blob fallback)
 *   - Decide execution path:
 *       • PDF/TIFF → push a single job to the main-thread renderer queue
 *       • Other images → push a single job to the worker queue
 *   - Schedule work:
 *       • Low-core devices (≤3 logical cores) → sequential scheduler; yields to UI between jobs
 *       • Others → batched, multi-worker processing via `batchHandler`
 *
 * PERFORMANCE & STABILITY NOTES
 *   - We reuse one ArrayBuffer per file (PDF/TIFF) to avoid N× buffer duplication for multi-page formats.
 *   - We transfer ArrayBuffers to workers when possible to reduce GC pressure.
 *   - We install per-fetch AbortControllers and abort them on unmount to avoid leaks.
 *   - We pre-insert lightweight placeholders so the UI can lay out while decoding occurs.
 *
 * IMPORTANT PROJECT GOTCHA (for future reviewers)
 *   - We intentionally import from the **root** 'file-type' package, NOT 'file-type/browser'.
 *     With `file-type` v21 the '/browser' subpath is not exported for bundlers and will break Vite builds.
 *     (See README for more context.)
 *
 * Provenance / baseline reference for prior version of this module: :contentReference[oaicite:0]{index=0}
 */

import { useEffect, useContext, useRef, useMemo, useCallback } from 'react';
import { ViewerContext } from '../../ViewerContext.jsx';
import logger from '../../LogController.js';
import { generateDocumentList, getTotalPages, getTiffMetadata } from './Utils.js';
import { createWorker, getNumberOfWorkers, handleWorkerMessage } from './WorkerHandler.js';
import { batchHandler } from './BatchHandler.js';
import { renderPDFInMainThread, renderTIFFInMainThread } from './MainThreadRenderer.js';
// Browser-safe: use file-type top-level ESM with Uint8Array/Blob
import { fileTypeFromBuffer, fileTypeFromBlob } from 'file-type';

/* ------------------------------------------------------------------------------------------------
 * Adaptive worker tuning
 * ------------------------------------------------------------------------------------------------ */

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

const isMobile = (() => {
  // Prefer UA-CH when available; fallback to a simple UA test.
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
 * @param {{ cpuBound?: boolean, ioHeavy?: boolean, desiredCap?: number }} [opts]
 */
function computeWorkerTuning({ cpuBound = true, ioHeavy = false, desiredCap } = {}) {
  const cores = Math.max(1, Number((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2));
  // Chromium-only; otherwise default
  const memGB = Number((typeof navigator !== 'undefined' && navigator.deviceMemory) || 4);

  const lowCore = cores <= 3; // 1–3 logical cores → sequential
  const leaveForMain = cores > 1 ? 1 : 0;

  // Hard cap to avoid oversubscription on quirky machines
  let hardCap = desiredCap ?? (isMobile ? 8 : 16);
  if (memGB <= 3) hardCap = Math.min(hardCap, isMobile ? 4 : 8);

  // Base: 1:1 with cores but leave one for the main thread
  const base = clamp(cores - leaveForMain, 1, hardCap);

  // CPU-bound → keep near 1:1; IO-heavy → allow slight oversubscription
  let maxWorkers = cpuBound ? base : clamp(Math.ceil(base * (ioHeavy ? 1.5 : 1.2)), 1, hardCap);

  if (lowCore) maxWorkers = 1; // strict sequential

  // BatchSize: Infinity = no splitting (more explicit than MAX_SAFE_INTEGER)
  const batchSize = lowCore ? Infinity : (cpuBound ? 24 : 64);

  return { maxWorkers, batchSize, lowCore };
}

// Default config for our workload (mostly CPU-bound image/PDF decoding)
const { maxWorkers, batchSize, lowCore } = computeWorkerTuning({ cpuBound: true });

// Toggle verbose TIFF metadata logging (costs a bit of CPU)
const enableMetadataLogging = false;

/* ------------------------------------------------------------------------------------------------
 * React component
 * ------------------------------------------------------------------------------------------------ */

/**
 * DocumentLoader — Loads and processes documents for rendering.
 *
 * @param {Object} props
 * @param {string} [props.folder]            Pattern mode: base folder/path for assets
 * @param {string} [props.extension]         Pattern mode: file extension (e.g., "png", "tiff")
 * @param {number} [props.endNumber]         Pattern mode: last page/file number (1..N)
 * @param {{ url:string, ext?:string, fileIndex?:number }[]} [props.sourceList]
 *        Explicit-list mode: ordered list of source items
 * @param {boolean} [props.sameBlob=true]    Reuse full-size blob URL for thumbnails when possible
 * @param {any} props.children               Render prop subtree (viewer UI)
 * @returns {JSX.Element}
 */
const DocumentLoader = ({ folder, extension, children, sameBlob = true, endNumber, sourceList }) => {
  const { insertPageAtIndex, setError, setWorkerCount } = useContext(ViewerContext);

  /** Idempotence & lifecycle guards */
  const hasStarted = useRef(false);
  const isMounted = useRef(true);

  /** Work queues */
  const jobQueue = useRef([]);           // single-image jobs (workers)
  const mainThreadJobQueue = useRef([]); // multi-page or fallback jobs (PDF/TIFF)
  const batchQueue = useRef([]);         // used by batchHandler

  /** Global page index across all inputs (for ViewerContext ordering) */
  const currentPageIndex = useRef(0);

  /** Track inflight fetches for cleanup on unmount */
  const fetchControllers = useRef(new Set());

  // Create workers ONCE (render-safe). Do NOT set state here.
  const imageWorkers = useMemo(() => {
    const numWorkers = getNumberOfWorkers(maxWorkers);
    logger.debug(`Using ${numWorkers} workers. (maxWorkers=${maxWorkers}, lowCore=${lowCore}, batchSize=${batchSize})`);
    return Array.from({ length: numWorkers }, () => createWorker());
  }, []);

  // Publish the number of workers AFTER first render (avoids React state-in-render warnings)
  useEffect(() => {
    setWorkerCount(imageWorkers.length);
  }, [imageWorkers.length, setWorkerCount]);

  // Preload placeholder images for better UX while decoding
  const preloadPlaceholderImage = useCallback((index) => {
    const placeholderImageUrl = 'placeholder.png';
    const placeholderPage = {
      fullSizeUrl: placeholderImageUrl,
      thumbnailUrl: placeholderImageUrl,
      loaded: false,
      status: 0,
      fileExtension: 'png',
      fileIndex: 0,
      pageIndex: 0,
    };
    logger.debug(`Preloading placeholder image for index ${index}`);
    insertPageAtIndex(placeholderPage, index);
  }, [insertPageAtIndex]);

  // Minimal failure placeholder insertion
  const handleFailedDocumentLoad = useCallback((url, fileIndex) => {
    logger.error(`Failed to load document at ${url}`);
    const failedPage = {
      fullSizeUrl: 'lost.png',
      thumbnailUrl: 'lost.png',
      loaded: false,
      status: -1,
      fileExtension: 'png',
      fileIndex,
      pageIndex: 0,
    };
    insertPageAtIndex(failedPage, currentPageIndex.current);
    currentPageIndex.current += 1;
  }, [insertPageAtIndex]);

  /**
   * Fetch + detect + enqueue a single document.
   * Uses `file-type` with buffer-first, then a blob-based fallback.
   */
  const loadDocumentAsync = useCallback(async (url, index) => {
    // Per-fetch controller
    const controller = new AbortController();
    fetchControllers.current.add(controller);

    try {
      logger.debug('Loading document', { url, index });

      const response = await fetch(url, { signal: controller.signal });
      logger.debug('Fetch response', { url, status: response.status });

      if (!response.ok) {
        throw new Error(`Failed to fetch document at ${url} with status ${response.status}`);
      }

      let arrayBuffer = await response.arrayBuffer();

      // Fetch completed successfully → remove controller
      fetchControllers.current.delete(controller);

      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        throw new Error(`Invalid or empty ArrayBuffer for document at ${url}`);
      }

      // Robust content-type detection (browser-safe)
      let fileType;
      try {
        // file-type expects Uint8Array for buffer-based detection
        fileType = await fileTypeFromBuffer(new Uint8Array(arrayBuffer));
      } catch {
        /* ignore and try fallback */
      }

      if (!fileType) {
        try {
          // Fallback path (works well in browsers)
          fileType = await fileTypeFromBlob(new Blob([arrayBuffer]));
        } catch {
          /* ignore; we’ll infer below */
        }
      }

      // Infer extension if signatures are unknown (e.g., some TIFFs/PDFs with odd headers)
      let fileExtension = fileType?.ext;
      if (!fileExtension) {
        // Try server header first
        const ct = (typeof response !== 'undefined' && response.headers?.get?.('content-type')) || '';
        if (/pdf/i.test(ct)) fileExtension = 'pdf';
        else if (/tiff?/i.test(ct)) fileExtension = 'tiff';
        else {
          // Last-ditch: guess from URL (may include querystring)
          const m = String(url).toLowerCase().match(/\.(pdf|tiff?|png|jpe?g|bmp|gif)(?:$|\?)/i);
          fileExtension = m ? m[1].toLowerCase() : null;
        }
      }

      if (!fileExtension) {
        throw new Error(`Unexpected file type for document at ${url}: unknown`);
      }

      const totalPages = await getTotalPages(arrayBuffer, fileExtension);
      logger.debug('Total pages detected', { totalPages });

      // Decide processing path
      if (fileExtension === 'pdf') {
        // Process PDF on main thread (reuse the original buffer)
        mainThreadJobQueue.current.push({
          arrayBuffer,
          fileExtension,
          index,
          pageStartIndex: 0,
          pagesInvolved: totalPages,
          allPagesStartingIndex: currentPageIndex.current,
        });
        arrayBuffer = null;
        currentPageIndex.current += totalPages;
      } else if (['tiff', 'tif'].includes(fileExtension)) {
        if (enableMetadataLogging) {
          const metadata = getTiffMetadata(arrayBuffer);
          logger.debug('TIFF metadata detected', { metadata });
        }
        // Process TIFF entirely on the main thread to avoid duplicating the buffer per page.
        const job = {
          arrayBuffer, // reuse one buffer
          fileExtension,
          index,
          pageStartIndex: 0,
          pagesInvolved: totalPages,
          allPagesStartingIndex: currentPageIndex.current,
        };
        mainThreadJobQueue.current.push(job);
        arrayBuffer = null;
        currentPageIndex.current += totalPages;
      } else {
        // Other single-image types (reuse original buffer so it can be transferred)
        const job = {
          arrayBuffer,
          fileExtension,
          index,
          pageStartIndex: 0,
          pagesInvolved: 1,
          allPagesStartingIndex: currentPageIndex.current,
        };
        logger.debug('Queueing job for image type', { job, currentPageIndex: currentPageIndex.current });
        jobQueue.current.push(job);
        arrayBuffer = null; // help GC
        currentPageIndex.current += 1;
      }
    } catch (error) {
      // Always remove controller on exit (including aborts)
      fetchControllers.current.delete(controller);

      // If unmounted or aborted, do nothing noisy
      if (error?.name === 'AbortError') {
        logger.debug('Fetch aborted', { url });
        return;
      }

      handleFailedDocumentLoad(url, index);
      if (isMounted.current) {
        setError(error.message);
        logger.error('Error loading document', { error: error.message });
      }
    }
  }, [setError, handleFailedDocumentLoad]);

  // Process batches of jobs using workers
  const processBatches = useCallback(() => {
    batchHandler(
      jobQueue,
      batchQueue,
      batchSize,
      imageWorkers,
      handleWorkerMessage,
      insertPageAtIndex,
      sameBlob,
      isMounted
    );
  }, [imageWorkers, sameBlob, insertPageAtIndex]);

  // Low-core sequential scheduler (1 job at a time; yield to UI between jobs)
  const processSequential = useCallback(() => {
    if (!isMounted.current) return;

    // 1) Worker job: send next to the single worker
    const next = jobQueue.current.shift();
    if (next) {
      const w = imageWorkers[0];
      if (!w) return;

      w.onmessage = (evt) => {
        handleWorkerMessage(evt, insertPageAtIndex, sameBlob, isMounted);
        // Give the main thread a breather before the next job
        setTimeout(processSequential, 0);
      };
      w.onerror = () => {
        // Fallback: TIFF in main thread; otherwise a placeholder
        if (['tiff', 'tif'].includes(next.fileExtension)) {
          renderTIFFInMainThread(next, insertPageAtIndex, sameBlob, isMounted)
            .then(() => setTimeout(processSequential, 0));
        } else {
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
            insertPageAtIndex,
            sameBlob,
            isMounted
          );
          setTimeout(processSequential, 0);
        }
      };

      const transfer = next?.arrayBuffer instanceof ArrayBuffer ? [next.arrayBuffer] : [];
      w.postMessage({ jobs: [next], fileExtension: next.fileExtension }, transfer);
      return; // wait for onmessage before proceeding
    }

    // 2) Drain main-thread jobs (PDF/TIFF) one at a time
    const mt = mainThreadJobQueue.current.shift();
    if (mt) {
      const run = mt.fileExtension === 'pdf' ? renderPDFInMainThread : renderTIFFInMainThread;
      run(mt, insertPageAtIndex, sameBlob, isMounted).then(() => setTimeout(processSequential, 0));
    }
  }, [imageWorkers, handleWorkerMessage, insertPageAtIndex, sameBlob]);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    const loadDocuments = async () => {
      // Insert the very first placeholder now so the UI can layout immediately.
      preloadPlaceholderImage(currentPageIndex.current);

      // Choose explicit-list or pattern
      let entries = [];
      if (Array.isArray(sourceList) && sourceList.length > 0) {
        entries = sourceList
          .map((it, i) => ({
            url: it?.url,
            fileIndex: typeof it?.fileIndex === 'number' ? it.fileIndex : i,
          }))
          .filter((e) => !!e.url);
        logger.debug('Using explicit sourceList', { count: entries.length });
      } else {
        const documentUrls = generateDocumentList(folder, extension, endNumber);
        entries = documentUrls.map((url, i) => ({ url, fileIndex: i }));
        logger.debug('Generated document URLs', { count: documentUrls.length });
      }

      try {
        // Fetch sequentially to avoid overwhelming the network in constrained environments.
        for (let i = 0; i < entries.length; i++) {
          const { url, fileIndex } = entries[i];
          logger.debug('Processing document URL', { url, index: fileIndex });
          await loadDocumentAsync(url, fileIndex);
        }

        // Backfill placeholders for any remaining pages
        for (let i = 1; i < currentPageIndex.current; i++) {
          preloadPlaceholderImage(i);
        }

        // Low-core: strictly sequential; otherwise: batched workers + drain main-thread queue
        if (lowCore) {
          processSequential();
        } else {
          processBatches();
          while (mainThreadJobQueue.current.length > 0) {
            const job = mainThreadJobQueue.current.shift();
            if (job.fileExtension === 'pdf') {
              await renderPDFInMainThread(job, insertPageAtIndex, sameBlob, isMounted);
            } else if (['tiff', 'tif'].includes(job.fileExtension)) {
              await renderTIFFInMainThread(job, insertPageAtIndex, sameBlob, isMounted);
            }
          }
        }
      } catch (error) {
        if (isMounted.current) {
          setError(error.message);
          logger.error('Error loading documents', { error: error.message });
        }
      }
    };

    loadDocuments();

    return () => {
      isMounted.current = false;

      // Abort any in-flight fetches
      fetchControllers.current.forEach((ctrl) => {
        try {
          ctrl.abort();
        } catch {}
      });
      fetchControllers.current.clear();

      // Terminate workers
      imageWorkers.forEach((worker) => worker.terminate());
    };
  }, [
    folder,
    extension,
    endNumber,
    sourceList,
    setError,
    imageWorkers,
    loadDocumentAsync,
    insertPageAtIndex,
    sameBlob,
    processBatches,
    processSequential,
    preloadPlaceholderImage,
  ]);

  return children;
};

export default DocumentLoader;
