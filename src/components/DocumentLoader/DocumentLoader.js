// File: src/components/DocumentLoader/DocumentLoader.js
import { useEffect, useContext, useRef, useMemo, useCallback } from 'react';
import { ViewerContext } from '../../ViewerContext';
import logger from '../../LogController';
import { generateDocumentList, getTotalPages, getTiffMetadata } from './Utils';
import { createWorker, getNumberOfWorkers, handleWorkerMessage } from './WorkerHandler';
import { batchHandler } from './BatchHandler';
import { renderPDFInMainThread, renderTIFFInMainThread } from './MainThreadRenderer';
import { fileTypeFromBuffer } from 'file-type';

// -----------------------------
// Adaptiv worker-tuning
// -----------------------------
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const isMobile = (() => {
  // UA-CH om möjligt, annars enkel UA-test
  try {
    // @ts-ignore
    if (navigator?.userAgentData?.mobile != null) return navigator.userAgentData.mobile;
  } catch {}
  try {
    return /Android|iPhone|iPad|iPod/i.test(navigator?.userAgent || '');
  } catch { return false; }
})();

/**
 * Beräknar en bra startkonfiguration för workers + batchstorlek.
 * - ≤3 logiska kärnor: strikt sekventiellt (1 worker) och ingen splitting.
 * - Lämnar alltid 1 kärna åt UI när möjligt.
 * - Tar hänsyn till minne och mobil för hårda capar.
 */
function computeWorkerTuning({ cpuBound = true, ioHeavy = false, desiredCap } = {}) {
  const cores = Math.max(1, Number((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2));
  // deviceMemory finns i Chromium; annars fallback
  const memGB = Number((typeof navigator !== 'undefined' && navigator.deviceMemory) || 4);

  const lowCore = cores <= 3; // 1–3 kärnor: seriellt
  const leaveForMain = cores > 1 ? 1 : 0;

  // Hård cap för att undvika oversubscription och märkliga maskiner
  let hardCap = desiredCap ?? (isMobile ? 8 : 16);
  if (memGB <= 3) hardCap = Math.min(hardCap, isMobile ? 4 : 8);

  // Bas: 1:1 mot logiska kärnor men lämna 1 för UI
  const base = clamp(cores - leaveForMain, 1, hardCap);

  // CPU-bundet: håll dig nära 1:1. I/O: tillåt lite översubscription.
  let maxWorkers = cpuBound
    ? base
    : clamp(Math.ceil(base * (ioHeavy ? 1.5 : 1.2)), 1, hardCap);

  if (lowCore) maxWorkers = 1; // strikt sekventiellt

  // BatchSize: Infinity = ingen splitting (mer explicit än MAX_SAFE_INTEGER)
  const batchSize = lowCore ? Infinity : (cpuBound ? 24 : 64);

  return { maxWorkers, batchSize, lowCore };
}

// Konfig: CPU-bundet läge (bild/PDF m.m.); justera vid behov
const { maxWorkers, batchSize, lowCore } = computeWorkerTuning({ cpuBound: true });
// Toggle TIFF metadata logging
const enableMetadataLogging = false;

/**
 * DocumentLoader
 * Loads and processes documents for rendering.
 *
 * Props support two modes:
 *  - Pattern mode: { folder, extension, endNumber }
 *  - Explicit-list mode: { sourceList: [{ url, ext?, fileIndex? }, ...] }
 */
const DocumentLoader = ({ folder, extension, children, sameBlob, endNumber, sourceList }) => {
  const { insertPageAtIndex, setError, setWorkerCount } = useContext(ViewerContext);
  const hasStarted = useRef(false);
  const isMounted = useRef(true);
  const jobQueue = useRef([]);
  const mainThreadJobQueue = useRef([]);
  const batchQueue = useRef([]);
  const currentPageIndex = useRef(0);
  const fetchControllers = useRef(new Set());

  // Create workers ONCE (render-safe). Do NOT set state here.
  const imageWorkers = useMemo(() => {
    const numWorkers = getNumberOfWorkers(maxWorkers);
    logger.debug(`Using ${numWorkers} workers. (maxWorkers=${maxWorkers}, lowCore=${lowCore}, batchSize=${batchSize})`);
    return Array.from({ length: numWorkers }, () => createWorker());
  }, []);

  // Set workerCount AFTER render (fixes the React warning)
  useEffect(() => {
    setWorkerCount(imageWorkers.length);
  }, [imageWorkers.length, setWorkerCount]);

  // Preload placeholder images for better user experience
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

  // Handle failed document load
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

  // Load document asynchronously based on bytes (type-sniffed)
  const loadDocumentAsync = useCallback(async (url, index) => {	  
  // create controller per fetch
  const controller = new AbortController();
  fetchControllers.current.add(controller);

  try {
    logger.debug(`Loading document`, { url, index });
    const response = await fetch(url, { signal: controller.signal });
    logger.debug(`Fetch response`, { url, status: response.status });

    if (!response.ok) {
      throw new Error(`Failed to fetch document at ${url} with status ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    // fetch completed successfully — remove controller
    fetchControllers.current.delete(controller);

    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      throw new Error(`Invalid or empty ArrayBuffer for document at ${url}`);
    }

      // Verify file type using `file-type`
      const fileType = await fileTypeFromBuffer(arrayBuffer);
      if (!fileType) {
        throw new Error(`Unexpected file type for document at ${url}: unknown`);
      }

      const fileExtension = fileType.ext;
      const totalPages = await getTotalPages(arrayBuffer, fileExtension);
      logger.debug(`Total pages detected`, { totalPages });

      if (fileExtension === 'pdf') {
        // Process PDF on main thread
        mainThreadJobQueue.current.push({
          arrayBuffer: arrayBuffer.slice(0),
          fileExtension,
          index,
          pageStartIndex: 0,
          pagesInvolved: totalPages,
          allPagesStartingIndex: currentPageIndex.current,
        });
        currentPageIndex.current += totalPages;

      } else if (['tiff', 'tif'].includes(fileExtension)) {
        if (enableMetadataLogging) {
          const metadata = getTiffMetadata(arrayBuffer);
          logger.debug(`TIFF metadata detected`, { metadata });
        }
        for (let pageIndex = 0; pageIndex < totalPages; pageIndex += batchSize) {
          const pagesInvolved = Math.min(batchSize, totalPages - pageIndex);
          if (pagesInvolved > 0) {
            const job = {
              arrayBuffer: arrayBuffer.slice(0),
              fileExtension,
              index,
              pageStartIndex: pageIndex,
              pagesInvolved,
              allPagesStartingIndex: currentPageIndex.current,
            };
            logger.debug(`Queueing job`, { job, currentPageIndex: currentPageIndex.current });
            jobQueue.current.push(job);
            currentPageIndex.current += pagesInvolved;
          }
        }
      } else {
        // Other single-image types
        const job = {
          arrayBuffer: arrayBuffer.slice(0),
          fileExtension,
          index,
          pageStartIndex: 0,
          pagesInvolved: 1,
          allPagesStartingIndex: currentPageIndex.current,
        };
        logger.debug(`Queueing job for image type`, { job, currentPageIndex: currentPageIndex.current });
        jobQueue.current.push(job);
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
      logger.error(`Error loading document: ${error.message}`);
    }
  }
}, [setError, handleFailedDocumentLoad]);

  // Process batches of jobs using workers
  const processBatches = useCallback(() => {
    batchHandler(jobQueue, batchQueue, batchSize, imageWorkers, handleWorkerMessage, insertPageAtIndex, sameBlob, isMounted);
  }, [imageWorkers, sameBlob, insertPageAtIndex]);

  // NEW: Low-core sekventiell scheduler (1 jobb i taget; yield till UI mellan jobben)
  const processSequential = useCallback(() => {
    if (!isMounted.current) return;

    // 1) Vanliga jobb: skicka nästa till enda workern
    const next = jobQueue.current.shift();
    if (next) {
      const w = imageWorkers[0];
      if (!w) return;

      w.onmessage = (evt) => {
        handleWorkerMessage(evt, insertPageAtIndex, sameBlob, isMounted);
        // Ge huvudtråden andrum innan nästa jobb
        setTimeout(processSequential, 0);
      };
      w.onerror = () => {
        // Fallback: TIFF i main thread, annars placeholder
        if (['tiff', 'tif'].includes(next.fileExtension)) {
          renderTIFFInMainThread(next, insertPageAtIndex, sameBlob, isMounted)
            .then(() => setTimeout(processSequential, 0));
        } else {
          handleWorkerMessage(
            { data: { jobs: [{
              fullSizeUrl: null,
              fileIndex: next.index,
              pageIndex: next.pageStartIndex || 0,
              fileExtension: next.fileExtension,
              allPagesIndex: next.allPagesStartingIndex
            }] } },
            insertPageAtIndex,
            sameBlob,
            isMounted
          );
          setTimeout(processSequential, 0);
        }
      };

      const transfer = (next?.arrayBuffer instanceof ArrayBuffer) ? [next.arrayBuffer] : [];
	  w.postMessage({ jobs: [next], fileExtension: next.fileExtension }, transfer);
      return; // vänta på onmessage innan vi går vidare
    }

    // 2) Dränera main-thread-jobb (PDF/TIFF) ett i taget
    const mt = mainThreadJobQueue.current.shift();
    if (mt) {
      const run = (mt.fileExtension === 'pdf') ? renderPDFInMainThread : renderTIFFInMainThread;
      run(mt, insertPageAtIndex, sameBlob, isMounted)
        .then(() => setTimeout(processSequential, 0));
    }
  }, [imageWorkers, handleWorkerMessage, insertPageAtIndex, sameBlob]);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    const loadDocuments = async () => {
      preloadPlaceholderImage(currentPageIndex.current);

      // NEW: choose source list or pattern
      let entries = [];
      if (Array.isArray(sourceList) && sourceList.length > 0) {
        entries = sourceList.map((it, i) => ({
          url: it?.url,
          fileIndex: (typeof it?.fileIndex === 'number') ? it.fileIndex : i
        })).filter(e => !!e.url);
        logger.debug('Using explicit sourceList', { count: entries.length });
      } else {
        const documentUrls = generateDocumentList(folder, extension, endNumber);
        entries = documentUrls.map((url, i) => ({ url, fileIndex: i }));
        logger.debug('Generated document URLs', { count: documentUrls.length });
      }

      try {
        for (let i = 0; i < entries.length; i++) {
          const { url, fileIndex } = entries[i];
          logger.debug(`Processing document URL`, { url, index: fileIndex });
          await loadDocumentAsync(url, fileIndex);
        }

        for (let i = 1; i < currentPageIndex.current; i++) {
          preloadPlaceholderImage(i);
        }

        // Low-core: sekventiellt; annars parallellt
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
  // abort any in-flight fetches
  fetchControllers.current.forEach(ctrl => {
    try { ctrl.abort(); } catch {}
  });
  fetchControllers.current.clear();

  imageWorkers.forEach(worker => worker.terminate());
};
  }, [folder, extension, endNumber, sourceList, setError, imageWorkers,
      loadDocumentAsync, insertPageAtIndex, sameBlob, processBatches, processSequential,
      preloadPlaceholderImage]);

  return children;
};

export default DocumentLoader;
