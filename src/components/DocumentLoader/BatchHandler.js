// File: src/components/DocumentLoader/BatchHandler.js
/**
 * File: src/components/DocumentLoader/BatchHandler.js
 *
 * OpenDocViewer — Minimal, fair worker-batch scheduler
 *
 * PURPOSE
 *   Distribute image-decoding jobs across a pool of Web Workers without
 *   monopolizing the main thread. We intentionally keep batching simple:
 *     • Every job is turned into a single-job batch.
 *     • We only dispatch to idle workers during short “pump” passes.
 *     • Each worker completion schedules the next pump via setTimeout(…, 0)
 *       to yield back to the event loop (keeps UI responsive).
 *
 * DESIGN CHOICES
 *   - Simplicity over micro-optimizations: one job == one batch. This avoids the
 *     memory overhead of duplicating large ArrayBuffers across pages/jobs.
 *   - No tight while-loops: the pump is event-driven and breathes between passes.
 *   - Transferables: any ArrayBuffer on a job is transferred to the worker to
 *     reduce GC pressure and copies.
 *
 * IMPORTANT PROJECT GOTCHA (history)
 *   - Elsewhere in the project we import from the **root** 'file-type' package,
 *     NOT 'file-type/browser'. With `file-type` v21 the '/browser' subpath is
 *     not exported and will break Vite builds. This scheduler doesn’t use it,
 *     but the reminder here helps future reviewers keep things consistent.
 */

import logger from '../../LogController.js';

/**
 * A single decoding/rendering unit handed to a worker.
 * @typedef {Object} WorkerJob
 * @property {(ArrayBuffer|undefined)} arrayBuffer   Optional bytes to transfer
 * @property {string} fileExtension                  Detected extension (e.g., 'png'|'jpg'|'tif'|'pdf')
 * @property {number} index                          File index in the input list
 * @property {number} pageStartIndex                 First page index inside the file (0-based)
 * @property {number} pagesInvolved                  Number of pages represented by this job
 * @property {number} allPagesStartingIndex          Global page offset (into the flat viewer list)
 * @property {string=} sourceUrl                     Fallback URL (used by main-thread renderers)
 */

/**
 * A batch groups one or more jobs of the same file type.
 * @typedef {Object} Batch
 * @property {Array.<WorkerJob>} jobs
 * @property {string} fileExtension
 */

/**
 * Signature for the function that inserts a page record at a specific index.
 * @callback InsertPageAtIndex
 * @param {*} page
 * @param {number} index
 * @returns {void}
 */

/**
 * Handle a worker's message and insert results.
 * @callback WorkerMessageHandler
 * @param {MessageEvent} event
 * @param {InsertPageAtIndex} insertPageAtIndex
 * @param {boolean} sameBlob
 * @param {{ current: boolean }} [isMounted]
 * @returns {void}
 */

/** Small delay so the event loop can breathe between pumps (ms). */
const PUMP_DELAY_MS = 0;

/**
 * Schedule a short, fair distribution pass:
 *   - Assigns at most one batch per idle worker.
 *   - Installs onmessage/onerror handlers before dispatch.
 *   - When any worker completes, schedules the next pump tick.
 *
 * @param {Array.<Worker>} imageWorkers
 * @param {{ current: Array.<Batch> }} batchQueue
 * @param {WorkerMessageHandler} handleWorkerMessage
 * @param {InsertPageAtIndex} insertPageAtIndex
 * @param {boolean} sameBlob
 * @param {{ current: boolean }} [isMounted]
 */
function pump(
  imageWorkers,
  batchQueue,
  handleWorkerMessage,
  insertPageAtIndex,
  sameBlob,
  isMounted
) {
  if (isMounted && isMounted.current === false) return;
  if (!batchQueue?.current || batchQueue.current.length === 0) return;

  imageWorkers.forEach((worker) => {
    if (!batchQueue.current.length) return;
    // @ts-ignore - annotate a private busy flag onto the Worker instance
    if (worker.__busy) return;

    /** @type {(Batch|undefined)} */
    const batch = batchQueue.current.shift();
    if (!batch) return;

    // Mark busy before sending work; ensures single in-flight batch per worker.
    // @ts-ignore
    worker.__busy = true;

    // Install handlers before postMessage to avoid races.
    worker.onmessage = (event) => {
      try {
        handleWorkerMessage(event, insertPageAtIndex, sameBlob, isMounted);
      } finally {
        // @ts-ignore
        worker.__busy = false;
        // Schedule the next short pass; yield to the event loop first.
        setTimeout(
          () => pump(imageWorkers, batchQueue, handleWorkerMessage, insertPageAtIndex, sameBlob, isMounted),
          PUMP_DELAY_MS
        );
      }
    };

    worker.onerror = (err) => {
      try {
        // IMPORTANT:
        // If a worker fails to load/run (common in dev when the module URL can't be served),
        // we must *explicitly* request MAIN-THREAD processing for multi-page formats.
        // Otherwise the central handler will treat this as a “success with no blob”
        // and just insert placeholders.
        const jobs = (batch.jobs || []).map((j) => ({
          // Minimal set needed for main-thread renderers to proceed:
          fileIndex: j.index,
          pageIndex: j.pageStartIndex || 0,
          allPagesIndex: j.allPagesStartingIndex,
          fileExtension: j.fileExtension,
          // For PDFs/TIFFs the renderer will loop pages; keep these:
          pagesInvolved: j.pagesInvolved,
          pageStartIndex: j.pageStartIndex,
          // Buffers may be neutered because we transferred them; provide sourceUrl for refetch:
          sourceUrl: j.sourceUrl || null,
        }));

        logger.warn('Worker error; scheduling main-thread render for affected batch', {
          error: String(err?.message || err),
          jobs: jobs.length,
          ext: batch.fileExtension,
        });

        // Signal the central handler to route these to main-thread renderers.
        handleWorkerMessage(
          { data: { handleInMainThread: true, jobs, fileExtension: batch.fileExtension } },
          insertPageAtIndex,
          sameBlob,
          isMounted
        );
      } finally {
        // @ts-ignore
        worker.__busy = false;
        setTimeout(
          () => pump(imageWorkers, batchQueue, handleWorkerMessage, insertPageAtIndex, sameBlob, isMounted),
          PUMP_DELAY_MS
        );
      }
    };

    // Collect transferable ArrayBuffers to avoid structured clone overhead.
    /** @type {Array.<Transferable>} */
    const transfer = [];
    if (batch?.jobs) {
      for (const j of batch.jobs) {
        if (j?.arrayBuffer instanceof ArrayBuffer && j.arrayBuffer.byteLength) {
          transfer.push(j.arrayBuffer);
        }
      }
    }

    logger.debug('Dispatching batch to worker', {
      jobs: batch.jobs?.length || 0,
      ext: batch.fileExtension,
      transferables: transfer.length,
    });

    worker.postMessage(batch, transfer);
  });
}

/**
 * Batch scheduler entry point.
 *
 * NOTE ON BATCH SIZE:
 *   We deliberately ignore the passed `batchSize` and convert every job into a
 *   single-job batch. This avoids duplicating large ArrayBuffers for multi-page
 *   formats and keeps memory usage predictable. If you later introduce chunking,
 *   make sure to **slice** or **re-derive** buffer segments rather than copying.
 *
 * @param {{ current: Array.<WorkerJob> }} jobQueue
 * @param {{ current: Array.<Batch> }} batchQueue
 * @param {number} _batchSize                          // intentionally unused (see note above)
 * @param {Array.<Worker>} imageWorkers
 * @param {WorkerMessageHandler} handleWorkerMessage
 * @param {InsertPageAtIndex} insertPageAtIndex
 * @param {boolean} sameBlob
 * @param {{ current: boolean }} [isMounted]
 * @returns {void}
 */
export const batchHandler = (
  jobQueue,
  batchQueue,
  _batchSize, // ignored by design (see JSDoc)
  imageWorkers,
  handleWorkerMessage,
  insertPageAtIndex,
  sameBlob,
  isMounted
) => {
  // Move all pending jobs into the batchQueue as single-job batches.
  while (jobQueue.current.length > 0) {
    const job = jobQueue.current.shift();
    if (!job) continue;
    batchQueue.current.push({ jobs: [job], fileExtension: job.fileExtension });
  }

  logger.debug('BatchHandler: queued single-job batches', {
    queued: batchQueue.current.length,
  });

  // Start the first distribution pass.
  pump(imageWorkers, batchQueue, handleWorkerMessage, insertPageAtIndex, sameBlob, isMounted);
};
