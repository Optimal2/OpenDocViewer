// File: src/utils/pdfWorkerDispatcher.js
/**
 * OpenDocViewer - generated PDF worker dispatcher.
 *
 * The first worker-backed PDF implementation uses one worker for the full document.
 * This dispatcher keeps the task planning separate from printPdf.js so future PDF
 * merge support can enable multiple page batches without changing the toolbar flow.
 */

import PdfWorker from '../workers/pdfWorker.js?worker';

const MIN_AUTO_BATCH_SIZE = 5;
const MAX_AUTO_BATCH_SIZE = 40;
const TARGET_BATCHES_PER_WORKER = 2;

/**
 * @typedef {Object} PdfWorkerBatch
 * @property {number} batchIndex
 * @property {number} startPageIndex
 * @property {number} pageCount
 */

/**
 * @typedef {Object} PdfWorkerPlan
 * @property {boolean} enabled
 * @property {number} workerCount Number of workers currently allowed to run.
 * @property {number} desiredWorkerCount Hardware-based worker count requested by config/runtime.
 * @property {number} batchSize Preferred page count per future partial-PDF task.
 * @property {number} pageThreshold Minimum total page count before worker PDF generation is used.
 * @property {number} imageLoadConcurrency Image fetch/decode concurrency inside each PDF worker task.
 * @property {boolean=} partialMergeEnabled Future switch for multi-worker partial PDF generation.
 */

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clampInteger(value, min, max) {
  const numeric = Math.floor(Number(value) || 0);
  return Math.max(min, Math.min(max, numeric));
}

/**
 * Pick a conservative future batch size. Too-small batches create too many PDFs to
 * merge; too-large batches underuse available cores. This aims for roughly two
 * batches per worker while keeping ordinary large jobs in a 5..40 page range.
 * @param {number} pageCount
 * @param {number} workerCount
 * @returns {number}
 */
export function resolveAutoPdfWorkerBatchSize(pageCount, workerCount) {
  const safePageCount = Math.max(1, Math.floor(Number(pageCount) || 1));
  const safeWorkerCount = Math.max(1, Math.floor(Number(workerCount) || 1));
  const targetBatchCount = Math.max(1, safeWorkerCount * TARGET_BATCHES_PER_WORKER);
  return clampInteger(Math.ceil(safePageCount / targetBatchCount), MIN_AUTO_BATCH_SIZE, MAX_AUTO_BATCH_SIZE);
}

/**
 * Split pages into future worker tasks. Until partial PDF merge is implemented,
 * callers pass allowPartialBatches=false and receive one full-document batch.
 * @param {number} pageCount
 * @param {number} workerCount
 * @param {number} batchSize
 * @param {boolean=} allowPartialBatches
 * @returns {Array<PdfWorkerBatch>}
 */
export function planPdfWorkerBatches(pageCount, workerCount, batchSize, allowPartialBatches = false) {
  const safePageCount = Math.max(0, Math.floor(Number(pageCount) || 0));
  if (safePageCount <= 0) return [];
  if (!allowPartialBatches) {
    return [{ batchIndex: 0, startPageIndex: 0, pageCount: safePageCount }];
  }

  const effectiveBatchSize = Math.max(1, Math.floor(Number(batchSize) || resolveAutoPdfWorkerBatchSize(safePageCount, workerCount)));
  const batches = [];
  for (let startPageIndex = 0; startPageIndex < safePageCount; startPageIndex += effectiveBatchSize) {
    batches.push({
      batchIndex: batches.length,
      startPageIndex,
      pageCount: Math.min(effectiveBatchSize, safePageCount - startPageIndex),
    });
  }
  return batches;
}

/**
 * @param {Function} PdfWorkerCtor
 * @param {Object} job
 * @param {AbortSignal|undefined} signal
 * @param {function(Object):void} onProgress
 * @param {number} workerIndex
 * @returns {Promise<Blob>}
 */
function runPdfWorkerTask(PdfWorkerCtor, job, signal, onProgress, workerIndex) {
  return new Promise((resolve, reject) => {
    let settled = false;
    /** @type {Worker|null} */
    let worker = null;
    const cleanup = () => {
      try { signal?.removeEventListener?.('abort', onAbort); } catch {}
      try { worker?.terminate?.(); } catch {}
      worker = null;
    };
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const onAbort = () => {
      const error = new Error('PDF generation was cancelled.');
      error.name = 'AbortError';
      settle(reject, error);
    };

    try {
      worker = new PdfWorkerCtor({ type: 'module', name: `odv-pdf-worker-${workerIndex + 1}` });
      signal?.addEventListener?.('abort', onAbort, { once: true });
      worker.onmessage = (event) => {
        const data = event?.data || {};
        if (data.type === 'progress') {
          onProgress(data.event || {});
          return;
        }
        if (data.type === 'result') {
          if (data.blob instanceof Blob) {
            settle(resolve, data.blob);
            return;
          }
          settle(reject, new Error('PDF worker completed without returning a PDF blob.'));
          return;
        }
        if (data.type === 'error') {
          settle(reject, new Error(String(data.error || 'PDF worker failed.')));
        }
      };
      worker.onerror = (event) => {
        settle(reject, new Error(String(event?.message || event?.error?.message || 'PDF worker crashed.')));
      };
      worker.postMessage({ type: 'createPdf', job });
    } catch (error) {
      settle(reject, error);
    }
  });
}

/**
 * Dispatch generated-PDF work to the worker layer. The dispatcher already plans
 * page batches, but it requires a single full-document batch until merge support
 * is added.
 * @param {Object} args
 * @param {Array<string>} args.urls
 * @param {Array<Object>} args.pagePlans
 * @param {Object} args.pdfCfg
 * @param {boolean} args.watermarkEnabled
 * @param {string} args.watermarkAssetSrc
 * @param {PdfWorkerPlan} args.workerPlan
 * @param {AbortSignal=} args.signal
 * @param {function(Object):void} args.onProgress
 * @returns {Promise<Blob>}
 */
export async function createPdfWithWorkerDispatcher(args) {
  const urls = Array.isArray(args?.urls) ? args.urls : [];
  const pagePlans = Array.isArray(args?.pagePlans) ? args.pagePlans : [];
  const workerPlan = args?.workerPlan || {};
  const batches = planPdfWorkerBatches(
    urls.length,
    workerPlan.workerCount,
    workerPlan.batchSize,
    workerPlan.partialMergeEnabled === true
  );

  if (batches.length !== 1) {
    throw new Error('Parallel PDF worker batches require PDF merge support, which is not enabled yet.');
  }

  const batch = batches[0];
  const start = batch.startPageIndex;
  const end = start + batch.pageCount;
  const job = {
    urls: urls.slice(start, end),
    pagePlans: pagePlans.slice(start, end),
    pdfCfg: args?.pdfCfg || {},
    watermarkEnabled: args?.watermarkEnabled !== false,
    watermarkAssetSrc: args?.watermarkAssetSrc || '',
    workerPlan: {
      ...workerPlan,
      batch,
      overallPageCount: urls.length,
    },
  };

  return runPdfWorkerTask(PdfWorker, job, args?.signal, args?.onProgress || (() => {}), 0);
}
