/**
 * File: src/components/DocumentLoader/WorkerHandler.js
 *
 * OpenDocViewer — Worker orchestration & message handling
 *
 * PURPOSE
 *   - Create image workers for off-main-thread rasterization/conversion.
 *   - Normalize and handle messages from workers, producing page entries for the viewer.
 *   - Provide a safe fallback path (main-thread TIFF render) if a worker reports errors.
 *   - Manage Blob URL lifetimes to prevent memory leaks.
 *
 * DESIGN NOTES
 *   - Worker path is resolved via `new URL(..., import.meta.url)` which Vite/Rollup/Webpack understand.
 *   - We avoid logging large payloads (blobs/arrays) — only counts and minimal info are logged.
 *   - Blob URLs are registered and revoked on `beforeunload` and `pagehide` to reduce leaks.
 *
 * IMPORTANT PROJECT GOTCHA (for future reviewers)
 *   - Elsewhere in the app we import from the **root** 'file-type' package, NOT 'file-type/browser'.
 *     With `file-type` v21 the '/browser' subpath is not exported for bundlers and will break Vite builds.
 *
 * Provenance / baseline for this module: :contentReference[oaicite:0]{index=0}
 */

import logger from '../../LogController.js';
import { renderTIFFInMainThread } from './MainThreadRenderer.js';
import { generateThumbnail } from './Utils.js';

/**
 * @typedef {Object} WorkerJob
 * @property {ArrayBuffer|Blob|undefined} [blob]          // optional blob produced by worker
 * @property {string|undefined} [fullSizeUrl]             // optional pre-made object URL
 * @property {number} fileIndex                           // original document index
 * @property {number} pageIndex                           // page within the file (0-based)
 * @property {number} allPagesIndex                       // global index in the flat page list
 * @property {string} fileExtension                       // 'png' | 'jpg' | 'pdf' | 'tif' | 'tiff' | ...
 * @property {number} [pagesInvolved]                     // for multi-page jobs (tiff/pdf)
 * @property {number} [pageStartIndex]                    // for multi-page jobs (tiff/pdf)
 * @property {boolean} [handleInMainThread]               // worker requests main-thread handling
 */

/**
 * @typedef {Object} WorkerMessage
 * @property {string} [error]
 * @property {WorkerJob[]} [jobs]
 * @property {WorkerJob} [job]
 * @property {boolean} [handleInMainThread]
 * @property {string} [fileExtension]
 */

/* ------------------------------------------------------------------------------------------------
 * Blob URL registry & cleanup
 * ------------------------------------------------------------------------------------------------ */

/** Create / get a global URL registry and install unload cleanup once. */
function addToUrlRegistry(url) {
  try {
    const w = /** @type {any} */ (globalThis);
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
      // Revoke on both lifecycle events for better coverage (mobile/tab bfcache cases).
      w.addEventListener('beforeunload', cleanup, { once: true });
      w.addEventListener('pagehide', cleanup, { once: true });
      w.__odv_url_cleanup_installed = true;
    }
  } catch {
    // non-fatal
  }
}

/* ------------------------------------------------------------------------------------------------
 * Worker creation & sizing
 * ------------------------------------------------------------------------------------------------ */

/**
 * Creates a new image worker (module worker).
 * Keep the path relative to this file; bundlers rewrite it at build time.
 * @returns {Worker}
 */
export const createWorker = () =>
  new Worker(new URL('../../workers/imageWorker.js', import.meta.url), { type: 'module' });

/**
 * Derive a safe number of workers based on device cores and a caller-provided cap.
 * SSR-safe: falls back when `navigator` is absent.
 *
 * @param {number} maxWorkers Upper bound decided by the caller.
 * @returns {number}
 */
export const getNumberOfWorkers = (maxWorkers) => {
  try {
    const cores = Math.max(1, Number((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4));
    return Math.min(cores, Math.max(1, Number(maxWorkers) || 1));
  } catch {
    return Math.max(1, Number(maxWorkers) || 1);
  }
};

/* ------------------------------------------------------------------------------------------------
 * Worker message handling
 * ------------------------------------------------------------------------------------------------ */

/**
 * Handle a message payload from an image worker and insert resulting page(s).
 *
 * CONTRACT
 *   - On success: { jobs: WorkerJob[] } where each job contains either:
 *       • `blob`  (we will create an object URL), or
 *       • `fullSizeUrl` (pre-made, e.g., from main-thread processing)
 *   - On error: { error: string, jobs?: WorkerJob[] } ; for TIFF jobs we invoke
 *                main-thread fallback rendering to avoid losing output entirely.
 *   - Fallback request: { handleInMainThread: true, job?: WorkerJob, jobs?: WorkerJob[] }
 *
 * @param {MessageEvent<WorkerMessage>} event
 * @param {(page: any, index: number) => void} insertPageAtIndex
 *        Callback from ViewerContext to place a page at a given global index.
 * @param {boolean} sameBlob
 *        If true, reuse the full-size blob URL for thumbnail (no extra canvas work).
 * @param {{ current: boolean }|{ current: any }} [isMounted]
 *        Optional ref flag — if present and false, handler becomes a no-op.
 * @returns {void}
 */
export const handleWorkerMessage = (event, insertPageAtIndex, sameBlob, isMounted) => {
  if (isMounted && isMounted.current === false) return;

  const { data } = event || {};
  /** @type {WorkerMessage} */
  const msg = data || {};

  // Avoid logging large payloads/blobs — only counts and flags
  logger.debug('Worker message received', {
    jobs: Array.isArray(msg.jobs) ? msg.jobs.length : 0,
    hasError: Boolean(msg.error),
    handleInMainThread: Boolean(msg.handleInMainThread),
  });

  /* ---------- 1) Error path: attempt main-thread fallback for TIFF  ---------- */
  if (msg.error) {
    logger.info('Worker reported error', { error: msg.error });

    const jobs = Array.isArray(msg.jobs) ? msg.jobs : [];
    jobs.forEach((job) => {
      if (isMounted && isMounted.current === false) return;
      job.handleInMainThread = true;
      if (['tiff', 'tif'].includes(String(job.fileExtension || '').toLowerCase())) {
        renderTIFFInMainThread(job, insertPageAtIndex, sameBlob, isMounted);
      }
    });
    return;
  }

  /* ---------- 2) Explicit main-thread handling request  ---------- */
  if (msg.handleInMainThread) {
    const maybeDo = (job) => {
      if (!job) return;
      if (isMounted && isMounted.current === false) return;
      if (['tiff', 'tif'].includes(String(job.fileExtension || '').toLowerCase())) {
        logger.debug('Main-thread TIFF processing requested', { jobIndex: job.allPagesIndex });
        renderTIFFInMainThread(job, insertPageAtIndex, sameBlob, isMounted);
      }
    };
    if (msg.job) maybeDo(msg.job);
    if (Array.isArray(msg.jobs)) msg.jobs.forEach(maybeDo);
    return;
  }

  /* ---------- 3) Success path: produce page entries  ---------- */
  if (!Array.isArray(msg.jobs) || msg.jobs.length === 0) {
    // Nothing to process — this can be valid for keep-alive worker pings.
    return;
  }

  msg.jobs.forEach(async (job) => {
    try {
      if (isMounted && isMounted.current === false) return;

      const fileExt = String(job.fileExtension || '').toLowerCase();
      const { fileIndex, pageIndex, allPagesIndex } = job;

      // Prefer URL from worker; otherwise, derive one from a Blob
      let fullSizeUrl = job.fullSizeUrl || null;
      if (!fullSizeUrl && job.blob instanceof Blob) {
        fullSizeUrl = URL.createObjectURL(job.blob);
        addToUrlRegistry(fullSizeUrl);
      }

      if (isMounted && isMounted.current === false) return;

      if (fullSizeUrl) {
        const page = {
          fullSizeUrl,
          thumbnailUrl: sameBlob
            ? fullSizeUrl
            : await generateThumbnail(fullSizeUrl, 200, 200),
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
        // No output — insert a failure placeholder so the UI remains consistent
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
        logger.debug('Inserting placeholder page', { allPagesIndex });
        if (isMounted && isMounted.current === false) return;
        insertPageAtIndex(placeholder, allPagesIndex);
      }
    } catch (e) {
      logger.error('handleWorkerMessage: per-job failure', { error: String(e?.message || e) });
    }
  });
};
