// File: src/components/DocumentLoader/DocumentLoader.js
/**
 * File: src/components/DocumentLoader/DocumentLoader.js
 *
 * OpenDocViewer — Orchestrates document fetching, type detection, paging, and rendering.
 *
 * MODES
 *   1) Pattern mode (legacy/demo): { folder, extension, endNumber }
 *   2) Explicit-list mode:        { sourceList: [{ url, ext, fileIndex }, ...] }
 *
 * PIPELINE (high level)
 *   - For each input entry → fetch bytes (ArrayBuffer)
 *   - Detect content type via `file-type` (buffer first, then blob fallback)
 *   - Decide execution path:
 *       • PDF → push a single job to the main-thread renderer queue
 *       • TIFF → prefer WORKERS for most cases; special types (e.g., OJPEG handled or JP2K→main thread)
 *       • Other images → push a single job to the worker queue
 *   - Schedule work:
 *       • Low-core devices (≤3 logical cores) → sequential scheduler; yields to UI between jobs
 *       • Others → batched, multi-worker processing via `batchHandler`
 *
 * PERFORMANCE & STABILITY NOTES
 *   - We reuse one ArrayBuffer per file when possible to reduce GC pressure.
 *   - TIFF goes to workers by default. The worker can post `handleInMainThread: true`
 *     for rare edge cases. We now explicitly route TIFF **Compression=34712 (JPEG 2000)** to
 *     the main thread to avoid worker stalls.
 *   - We install per-fetch AbortControllers and abort them on unmount to avoid leaks.
 *   - We pre-insert lightweight placeholders so the UI can lay out while decoding occurs.
 *
 * IMPORTANT PROJECT GOTCHA (for future reviewers)
 *   - We intentionally import from the **root** 'file-type' package, NOT 'file-type/browser'.
 *     With `file-type` v21 the '/browser' subpath is not exported for bundlers and will break Vite builds.
 *     (See README for more context.)
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
 * Types
 * ------------------------------------------------------------------------------------------------ */

/**
 * Explicit-list item used by `sourceList`.
 * Closure/JSDoc: optional properties use the `name=` syntax in @property blocks.
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
 * @param {{ cpuBound: (boolean|undefined), ioHeavy: (boolean|undefined), desiredCap: (number|undefined) }} [opts]
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

// Default config for our workload (mostly CPU-bound image/PDF decoding)
const { maxWorkers, batchSize, lowCore } = computeWorkerTuning({ cpuBound: true });

/* ------------------------------------------------------------------------------------------------
 * TIFF compression peek (minimal parser — no full decode)
 * ------------------------------------------------------------------------------------------------ */

/**
 * Read Compression (259) values from up to `maxIfds` IFDs in a TIFF buffer.
 * Only the tag headers are parsed; no strip/tile decoding.
 *
 * @param {ArrayBuffer} buf
 * @param {number=} maxIfds
 * @returns {Array.<number>}
 */
function peekTiffCompressions(buf, maxIfds = 64) {
  try {
    const u8 = new Uint8Array(buf);
    if (u8.length < 8) return [];
    const le = u8[0] === 0x49 && u8[1] === 0x49; // 'II'
    const be = u8[0] === 0x4D && u8[1] === 0x4D; // 'MM'
    if (!le && !be) return [];
    const dv = new DataView(buf);
    const get16 = (o) => (le ? dv.getUint16(o, true) : dv.getUint16(o, false));
    const get32 = (o) => (le ? dv.getUint32(o, true) : dv.getUint32(o, false));

    const magic = get16(2);
    if (magic !== 42 && magic !== 43) return []; // 42=TIFF, 43=BigTIFF (we only read first IFD for BigTIFF)
    let offset = get32(4);
    const out = [];
    let loops = 0;
    while (offset && loops < maxIfds && offset + 2 <= u8.length) {
      loops++;
      const count = get16(offset);
      const base = offset + 2;
      if (base + count * 12 + 4 > u8.length) break;
      let compression = null;
      for (let i = 0; i < count; i++) {
        const entry = base + i * 12;
        const tag = get16(entry + 0);
        if (tag === 259) {
          // type = SHORT/LONG (we only need the value when count==1 and fits in 4 bytes)
          const type = get16(entry + 2);
          const cnt = get32(entry + 4);
          const valOff = entry + 8;
          if (cnt === 1) {
            if (type === 3) {
              // SHORT stored in low 2 bytes of value field
              compression = le ? dv.getUint16(valOff, true) : dv.getUint16(valOff, false);
            } else if (type === 4) {
              compression = get32(valOff);
            }
          }
        }
      }
      if (compression != null) out.push(compression);
      offset = get32(base + count * 12); // next IFD
    }
    return out;
  } catch {
    return [];
  }
}

// Known problematic compression codes for browser workers (route to main thread)
const COMPRESSION_JPEG2000 = 34712;

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
 * @param {*} props.children                             Render prop subtree (viewer UI)
 * @returns {*}
 */
const DocumentLoader = ({ folder, extension, children, sameBlob = true, endNumber, sourceList }) => {
  const { insertPageAtIndex, setError, setWorkerCount } = useContext(ViewerContext);

  /** Idempotence & lifecycle guards */
  const hasStarted = useRef(false);
  const isMounted = useRef(true);

  /** Work queues */
  /** @type {React.MutableRefObject.<Array.<*>>} */ const jobQueue = useRef([]);           // single-image & TIFF jobs (workers)
  /** @type {React.MutableRefObject.<Array.<*>>} */ const mainThreadJobQueue = useRef([]); // multi-page or fallback jobs (PDF / special TIFF)
  /** @type {React.MutableRefObject.<Array.<*>>} */ const batchQueue = useRef([]);         // used by batchHandler

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
  /**
   * Insert a placeholder page at a global index.
   * @param {number} index
   * @returns {void}
   */
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
  /**
   * @param {string} url
   * @param {number} fileIndex
   * @returns {void}
   */
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
   *
   * @param {string} url
   * @param {number} index
   * @returns {Promise.<void>}
   */
  const loadDocumentAsync = useCallback(async (url, index) => {
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
      logger.debug('Total pages detected', { totalPages, url });

      // Decide processing path
      if (fileExtension === 'pdf') {
        // PDFs always on main thread for now
        mainThreadJobQueue.current.push({
          arrayBuffer,
          sourceUrl: url,
          fileExtension,
          index,
          pageStartIndex: 0,
          pagesInvolved: totalPages,
          allPagesStartingIndex: currentPageIndex.current,
        });
        arrayBuffer = null;
        currentPageIndex.current += totalPages;
      } else if (['tiff', 'tif'].includes(fileExtension)) {
        // TIFF: prefer workers, except for known-problematic compressions (e.g., 34712 = JPEG 2000)
        const compCodes = peekTiffCompressions(arrayBuffer);
        const hasJpeg2000 = compCodes.includes(COMPRESSION_JPEG2000);

        if (hasJpeg2000) {
          logger.debug('Routing TIFF (JPEG 2000 compression) to main thread', { url, index, compCodes });
          mainThreadJobQueue.current.push({
            arrayBuffer,
            sourceUrl: url,
            fileExtension,
            index,
            pageStartIndex: 0,
            pagesInvolved: totalPages,
            allPagesStartingIndex: currentPageIndex.current,
          });
          arrayBuffer = null;
          currentPageIndex.current += totalPages;
        } else {
          const job = {
            arrayBuffer, // transferred to worker
            sourceUrl: url,
            fileExtension,
            index,
            pageStartIndex: 0,
            pagesInvolved: totalPages,
            allPagesStartingIndex: currentPageIndex.current,
          };
          logger.debug('Queueing TIFF job for worker', { index, totalPages, start: currentPageIndex.current, compCodes });
          jobQueue.current.push(job);
          arrayBuffer = null; // help GC
          currentPageIndex.current += totalPages;
        }
      } else {
        // Other single-image types → worker
        const job = {
          arrayBuffer,
          sourceUrl: url,
          fileExtension,
          index,
          pageStartIndex: 0,
          pagesInvolved: 1,
          allPagesStartingIndex: currentPageIndex.current,
        };
        logger.debug('Queueing job for image type', { job: { fileExtension, index }, currentPageIndex: currentPageIndex.current });
        jobQueue.current.push(job);
        arrayBuffer = null;
        currentPageIndex.current += 1;
      }
    } catch (error) {
      fetchControllers.current.delete(controller);

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

  // Low-core sequential scheduler
  const processSequential = useCallback(() => {
    if (!isMounted.current) return;

    const next = jobQueue.current.shift();
    if (next) {
      const w = imageWorkers[0];
      if (!w) return;

      w.onmessage = (evt) => {
        handleWorkerMessage(evt, insertPageAtIndex, sameBlob, isMounted, {
          renderPDFInMainThread,
          renderTIFFInMainThread,
          mainThreadJobQueueRef: mainThreadJobQueue,
        });
        setTimeout(processSequential, 0);
      };
      w.onerror = () => {
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
      return;
    }

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
      preloadPlaceholderImage(currentPageIndex.current);

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
        for (let i = 0; i < entries.length; i++) {
          const { url, fileIndex } = entries[i];
          logger.debug('Processing document URL', { url, index: fileIndex });
          await loadDocumentAsync(url, fileIndex);
        }

        for (let i = 1; i < currentPageIndex.current; i++) {
          preloadPlaceholderImage(i);
        }

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

      fetchControllers.current.forEach((ctrl) => {
        try {
          ctrl.abort();
        } catch {}
      });
      fetchControllers.current.clear();

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
