/**
 * File: src/components/DocumentLoader/WorkerHandler.js
 *
 * OpenDocViewer — Worker orchestration & message handling
 *
 * PURPOSE
 *   - Create image workers for off-main-thread rasterization/conversion.
 *   - Normalize and handle messages from workers, producing page entries for the viewer.
 *   - Provide a safe fallback path (main-thread render) if a worker reports errors
 *     or explicitly requests main-thread handling.
 *   - Manage Blob URL lifetimes to prevent memory leaks.
 *
 * DESIGN NOTES
 *   - Worker path is resolved via Vite’s `?worker`, which produces a concrete worker
 *     bundle in both dev and production builds (fixes MIME/text/html dev failures).
 *   - Dev and production builds use the same logic/code paths.
 *   - We avoid logging large payloads (blobs/arrays) — only counts and minimal info are logged.
 *   - Blob URLs are registered and revoked on `beforeunload` and `pagehide` to reduce leaks.
 *
 * IMPORTANT PROJECT GOTCHA
 *   - Elsewhere in the app we import from the **root** 'file-type' package, NOT 'file-type/browser'.
 */

import logger from '../../LogController.js';
import {
  renderTIFFInMainThread as importedRenderTIFFInMainThread,
  renderPDFInMainThread as importedRenderPDFInMainThread,
} from './MainThreadRenderer.js';
import { generateThumbnail } from './Utils.js';

/**
 * ✅ IMPORTANT:
 * The worker file physically resides in `src/workers/imageWorker.js`.
 * Use a relative import from this module's folder and Vite’s `?worker`
 * so that **dev and build behave identically**.
 */
import ImageWorker from '../../workers/imageWorker.js?worker';

/**
 * A single job/result entry communicated between worker and main thread.
 * @typedef {Object} WorkerJob
 * @property {Blob} [blob]
 * @property {string} [fullSizeUrl]
 * @property {number} fileIndex
 * @property {number} pageIndex
 * @property {number} allPagesIndex
 * @property {string} fileExtension
 * @property {number} [pagesInvolved]
 * @property {number} [pageStartIndex]
 * @property {boolean} [handleInMainThread]
 */

/**
 * Worker → main message envelope.
 * @typedef {Object} WorkerMessage
 * @property {string} [error]
 * @property {Array.<WorkerJob>} [jobs]
 * @property {WorkerJob} [job]
 * @property {boolean} [handleInMainThread]
 * @property {string} [fileExtension]
 */

/**
 * Signature for inserting a page structure into the viewer at a specific index.
 * @callback InsertPageAtIndex
 * @param {*} page
 * @param {number} index
 * @returns {void}
 */

/**
 * Options passed to the handler to coordinate main-thread rendering.
 * @typedef {Object} HandleOpts
 * @property {{ current: Array<WorkerJob> }} [mainThreadJobQueueRef]
 * @property {Function} [renderPDFInMainThread]
 * @property {Function} [renderTIFFInMainThread]
 */

/* ------------------------------------------------------------------------------------------------
 * Worker creation & sizing (exported)
 * ------------------------------------------------------------------------------------------------ */

/**
 * Create a new image worker instance.
 * Uses Vite’s `?worker` import so dev and prod behave identically.
 *
 * @returns {Worker}
 */
export function createWorker() {
  /** @type {Worker} */
  // @ts-ignore - older TS libs may not know the 'name' option.
  const w = new ImageWorker({ type: 'module', name: 'odv-image-worker' });
  // @ts-ignore - internal busy flag used by the batch scheduler
  w.__busy = false;
  return w;
}

/**
 * Decide how many workers to spawn, leaving one logical core for the UI when possible.
 *
 * @param {number} [maxDesired=1]
 * @returns {number}
 */
export function getNumberOfWorkers(maxDesired = 1) {
  let cores = 2;
  try {
    cores = Math.max(1, Number(navigator?.hardwareConcurrency || 2));
  } catch {}
  const leaveForMain = cores > 1 ? 1 : 0;
  const hard = Math.max(1, cores - leaveForMain);
  const n = Math.max(1, Math.min(hard, Math.max(1, Number(maxDesired) || 1)));
  logger.debug('getNumberOfWorkers decision', { cores, leaveForMain, hard, maxDesired, chosen: n });
  return n;
}

/* ------------------------------------------------------------------------------------------------
 * Blob URL lifetime management
 * ------------------------------------------------------------------------------------------------ */

/** Create / get a global URL registry and install unload cleanup once. */
function addToUrlRegistry(url) {
  try {
    const w = /** @type {*} */ (globalThis);
    if (!w.__odv_url_registry) w.__odv_url_registry = new Set();
    w.__odv_url_registry.add(url);

    if (!w.__odv_url_cleanup_installed && typeof w.addEventListener === 'function') {
      const cleanup = () => {
        try {
          for (const u of w.__odv_url_registry) {
            try { URL.revokeObjectURL(u); } catch {}
          }
        } finally {
          try { w.__odv_url_registry.clear(); } catch {}
        }
      };
      w.addEventListener('beforeunload', cleanup, { once: true });
      w.addEventListener('pagehide', cleanup, { once: true });
      w.__odv_url_cleanup_installed = true;
    }
  } catch {
    // non-fatal
  }
}

/* ------------------------------------------------------------------------------------------------
 * Main-thread scheduling helper
 * ------------------------------------------------------------------------------------------------ */

/**
 * Decide how to schedule/execute a main-thread render job based on options:
 *  - If a queue ref is provided → push the job to the queue (deferred execution).
 *  - Else → execute immediately with the appropriate renderer.
 *
 * @param {WorkerJob} job
 * @param {InsertPageAtIndex} insertPageAtIndex
 * @param {boolean} sameBlob
 * @param {{ current: boolean }} [isMounted]
 * @param {HandleOpts} [opts]
 * @returns {void}
 */
function scheduleMainThread(job, insertPageAtIndex, sameBlob, isMounted, opts) {
  const fileExt = String(job.fileExtension || '').toLowerCase();
  const qref = opts && opts.mainThreadJobQueueRef;
  const renderTIFF = (opts && opts.renderTIFFInMainThread) || importedRenderTIFFInMainThread;
  const renderPDF  = (opts && opts.renderPDFInMainThread)  || importedRenderPDFInMainThread;

  if (qref && qref.current && Array.isArray(qref.current)) {
    qref.current.push(job);
    return;
  }

  if (['tiff', 'tif'].includes(fileExt)) {
    renderTIFF(job, insertPageAtIndex, sameBlob, isMounted);
  } else if (fileExt === 'pdf') {
    renderPDF(job, insertPageAtIndex, sameBlob, isMounted);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Worker message handler (exported)
 * ------------------------------------------------------------------------------------------------ */

/**
 * Handle a message payload from an image worker and insert resulting page(s).
 *
 * @param {MessageEvent} event
 * @param {InsertPageAtIndex} insertPageAtIndex
 * @param {boolean} sameBlob
 * @param {{ current: boolean }} [isMounted]
 * @param {HandleOpts} [opts]
 * @returns {void}
 */
export const handleWorkerMessage = (event, insertPageAtIndex, sameBlob, isMounted, opts) => {
  if (isMounted && isMounted.current === false) return;

  const { data } = event || {};
  /** @type {WorkerMessage} */
  const msg = data || {};

  logger.debug('Worker message received', {
    jobs: Array.isArray(msg.jobs) ? msg.jobs.length : 0,
    hasError: Boolean(msg.error),
    handleInMainThread: Boolean(msg.handleInMainThread),
  });

  // Error path: let PDFs/TIFFs fall back to main-thread; others get placeholders.
  if (msg.error) {
    logger.info('Worker reported error', { error: msg.error });
    const jobs = Array.isArray(msg.jobs) ? msg.jobs : [];
    jobs.forEach((job) => {
      if (isMounted && isMounted.current === false) return;
      job.handleInMainThread = true;
      const ext = String(job.fileExtension || '').toLowerCase();
      if (['tiff', 'tif', 'pdf'].includes(ext)) {
        scheduleMainThread(job, insertPageAtIndex, sameBlob, isMounted, opts);
      } else {
        const placeholder = {
          fullSizeUrl: 'placeholder.png',
          thumbnailUrl: 'placeholder.png',
          loaded: false,
          status: -1,
          fileExtension: ext,
          fileIndex: job.fileIndex,
          pageIndex: job.pageIndex,
          allPagesIndex: job.allPagesIndex,
        };
        insertPageAtIndex(placeholder, job.allPagesIndex);
      }
    });
    return;
  }

  // Worker can explicitly request main-thread handling (e.g., unsupported codec).
  if (msg.handleInMainThread) {
    const maybeDo = (job) => {
      if (!job) return;
      if (isMounted && isMounted.current === false) return;
      const ext = String(job.fileExtension || '').toLowerCase();
      if (['tiff', 'tif', 'pdf'].includes(ext)) {
        logger.debug('Main-thread processing requested by worker', {
          allPagesIndex: job.allPagesIndex,
          ext,
        });
        scheduleMainThread(job, insertPageAtIndex, sameBlob, isMounted, opts);
      }
    };
    if (msg.job) maybeDo(msg.job);
    if (Array.isArray(msg.jobs)) msg.jobs.forEach(maybeDo);
    return;
  }

  if (!Array.isArray(msg.jobs) || msg.jobs.length === 0) {
    return;
  }

  // Normal success path: insert each rendered page (or placeholder if missing blob/url).
  msg.jobs.forEach(async (job) => {
    try {
      if (isMounted && isMounted.current === false) return;

      const fileExt = String(job.fileExtension || '').toLowerCase();
      const { fileIndex, pageIndex, allPagesIndex } = job;

      let fullSizeUrl = job.fullSizeUrl || null;
      if (!fullSizeUrl && job.blob instanceof Blob) {
        fullSizeUrl = URL.createObjectURL(job.blob);
        addToUrlRegistry(fullSizeUrl);
      }

      if (isMounted && isMounted.current === false) return;

      if (fullSizeUrl) {
        const page = {
          fullSizeUrl,
          thumbnailUrl: sameBlob ? fullSizeUrl : await generateThumbnail(fullSizeUrl, 200, 200),
          loaded: true,
          status: 1,
          fileExtension: fileExt,
          fileIndex,
          pageIndex,
          allPagesIndex,
        };
        logger.debug('Inserting rendered page', { allPagesIndex });
        if (isMounted && isMounted.current === false) return;
        insertPageAtIndex(page, allPagesIndex);
      } else {
        const placeholder = {
          fullSizeUrl: 'placeholder.png',
          thumbnailUrl: 'placeholder.png',
          loaded: false,
          status: -1,
          fileExtension: fileExt,
          fileIndex,
          pageIndex,
          allPagesIndex,
        };
        logger.debug('Inserting placeholder page (no fullSizeUrl/blob)', { allPagesIndex });
        if (isMounted && isMounted.current === false) return;
        insertPageAtIndex(placeholder, allPagesIndex);
      }
    } catch (e) {
      logger.error('handleWorkerMessage: per-job failure', { error: String(e?.message || e) });
    }
  });
};
