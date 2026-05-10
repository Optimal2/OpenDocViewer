// File: src/utils/pdfWorkerDispatcher.js
/**
 * OpenDocViewer - generated PDF worker dispatcher.
 *
 * The dispatcher splits larger generated-PDF jobs into page batches, renders the
 * batches in PDF workers, and then reduces the partial PDFs in merge-worker rounds.
 */

import PdfWorker from '../workers/pdfWorker.js?worker';
import PdfMergeWorker from '../workers/pdfMergeWorker.js?worker';

const MIN_AUTO_BATCH_SIZE = 5;
const MAX_AUTO_BATCH_SIZE = 40;
const TARGET_BATCHES_PER_WORKER = 2;
const PARTIAL_GENERATION_PROGRESS_RATIO = 0.9;

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
 * @property {boolean=} partialMergeEnabled Enables multi-worker partial PDF generation and merge reduction.
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
 * Split pages into worker tasks. Callers can disable partial batches to force
 * one full-document worker task when they want the simpler single-worker path.
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
 * @param {AbortSignal|undefined} signal
 * @returns {void}
 */
function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error('PDF generation was cancelled.');
  error.name = 'AbortError';
  throw error;
}

/**
 * Run async work with a small in-process dispatcher. The index claim is deliberately
 * synchronous and contains no await points, so each worker loop claims a unique task
 * before yielding back to the event loop.
 * @template T,U
 * @param {Array<T>} items
 * @param {number} concurrency
 * @param {function(T, number, number): Promise<U>} runItem
 * @param {AbortSignal|undefined} signal
 * @returns {Promise<Array<U>>}
 */
async function runLimitedTasks(items, concurrency, runItem, signal) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const workerCount = Math.max(1, Math.min(list.length, Math.floor(Number(concurrency) || 1)));
  const results = new Array(list.length);
  let nextIndex = 0;

  const runLoop = async (workerSlot) => {
    while (true) {
      throwIfAborted(signal);
      const itemIndex = nextIndex;
      nextIndex += 1;
      if (itemIndex >= list.length) return;
      results[itemIndex] = await runItem(list[itemIndex], itemIndex, workerSlot);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, (_, workerSlot) => runLoop(workerSlot)));
  return results;
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
 * @param {Function} PdfMergeWorkerCtor
 * @param {Array<Blob>} blobs
 * @param {AbortSignal|undefined} signal
 * @param {function(Object):void} onProgress
 * @param {number} workerIndex
 * @param {Object} context
 * @returns {Promise<Blob>}
 */
function runPdfMergeWorkerTask(PdfMergeWorkerCtor, blobs, signal, onProgress, workerIndex, context) {
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
      worker = new PdfMergeWorkerCtor({ type: 'module', name: `odv-pdf-merge-worker-${workerIndex + 1}` });
      signal?.addEventListener?.('abort', onAbort, { once: true });
      worker.onmessage = (event) => {
        const data = event?.data || {};
        if (data.type === 'progress') {
          onProgress({ ...context, ...(data.event || {}), phase: 'merging' });
          return;
        }
        if (data.type === 'result') {
          if (data.blob instanceof Blob) {
            settle(resolve, data.blob);
            return;
          }
          settle(reject, new Error('PDF merge worker completed without returning a PDF blob.'));
          return;
        }
        if (data.type === 'error') {
          settle(reject, new Error(String(data.error || 'PDF merge worker failed.')));
        }
      };
      worker.onerror = (event) => {
        settle(reject, new Error(String(event?.message || event?.error?.message || 'PDF merge worker crashed.')));
      };
      worker.postMessage({ type: 'mergePdfs', job: { blobs, ...context } });
    } catch (error) {
      settle(reject, error);
    }
  });
}

/**
 * @param {PdfWorkerBatch} batch
 * @param {Object} args
 * @param {PdfWorkerPlan} workerPlan
 * @returns {Object}
 */
function createBatchJob(batch, args, workerPlan) {
  const start = batch.startPageIndex;
  const end = start + batch.pageCount;
  return {
    urls: args.urls.slice(start, end),
    pagePlans: args.pagePlans.slice(start, end),
    pdfCfg: args.pdfCfg || {},
    watermarkEnabled: args.watermarkEnabled !== false,
    watermarkAssetSrc: args.watermarkAssetSrc || '',
    workerPlan: {
      ...workerPlan,
      batch,
      overallPageCount: args.urls.length,
    },
  };
}

/**
 * @param {Object} event
 * @returns {number}
 */
function progressValueFromWorkerEvent(event) {
  const raw = Number(event?.progressValue);
  if (Number.isFinite(raw)) return raw;
  const current = Number(event?.current);
  return Number.isFinite(current) ? current : 0;
}

/**
 * @param {Array<number>} progressByBatch
 * @returns {number}
 */
function sumProgress(progressByBatch) {
  return progressByBatch.reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
}

/**
 * @param {Array<Blob>} initialParts
 * @param {PdfWorkerPlan} workerPlan
 * @param {AbortSignal|undefined} signal
 * @param {function(Object):void} onProgress
 * @returns {Promise<Blob>}
 */
async function mergePdfBlobsWithWorkers(initialParts, workerPlan, signal, onProgress) {
  let parts = Array.isArray(initialParts) ? initialParts.filter((blob) => blob instanceof Blob) : [];
  if (!parts.length) throw new Error('No partial PDFs were available for merge.');
  if (parts.length === 1) return parts[0];

  const totalPages = Math.max(1, Number(workerPlan?.overallPageCount) || 1);
  const mergeTotal = Math.max(1, parts.length - 1);
  let mergeCompleted = 0;
  let roundIndex = 0;

  const reportMergeProgress = () => {
    const ratio = Math.max(0, Math.min(1, mergeCompleted / mergeTotal));
    onProgress({
      phase: 'merging',
      current: totalPages,
      progressValue: totalPages * (PARTIAL_GENERATION_PROGRESS_RATIO
        + ((1 - PARTIAL_GENERATION_PROGRESS_RATIO) * ratio)),
      total: totalPages,
      mergeCurrent: mergeCompleted,
      mergeTotal,
      mergeRound: roundIndex + 1,
      partialCount: parts.length,
    });
  };

  reportMergeProgress();

  while (parts.length > 1) {
    throwIfAborted(signal);
    const nextParts = new Array(Math.ceil(parts.length / 2));
    const mergeTasks = [];

    for (let index = 0; index < parts.length; index += 2) {
      const nextIndex = index / 2;
      const first = parts[index];
      const second = parts[index + 1];
      if (second instanceof Blob) {
        mergeTasks.push({
          nextIndex,
          blobs: [first, second],
          roundIndex,
          pairIndex: mergeTasks.length,
        });
      } else {
        nextParts[nextIndex] = first;
      }
    }

    await runLimitedTasks(
      mergeTasks,
      workerPlan.workerCount,
      async (task, _taskIndex, workerSlot) => {
        const blob = await runPdfMergeWorkerTask(
          PdfMergeWorker,
          task.blobs,
          signal,
          (event) => {
            const ratio = Math.max(0, Math.min(1, mergeCompleted / mergeTotal));
            onProgress({
              ...event,
              current: totalPages,
              progressValue: totalPages * (PARTIAL_GENERATION_PROGRESS_RATIO
                + ((1 - PARTIAL_GENERATION_PROGRESS_RATIO) * ratio)),
              total: totalPages,
              mergeCurrent: mergeCompleted,
              mergeTotal,
              mergeRound: roundIndex + 1,
            });
          },
          workerSlot,
          {
            roundIndex: task.roundIndex,
            pairIndex: task.pairIndex,
            mergeCurrent: mergeCompleted,
            mergeTotal,
          }
        );
        nextParts[task.nextIndex] = blob;
        mergeCompleted += 1;
        reportMergeProgress();
        return blob;
      },
      signal
    );

    parts = nextParts;
    roundIndex += 1;
  }

  reportMergeProgress();
  return parts[0];
}

/**
 * Dispatch generated-PDF work to the worker layer. With partial merge enabled,
 * page batches are rendered in parallel and then merged pairwise in worker rounds.
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
  const workerPlan = {
    ...(args?.workerPlan || {}),
    overallPageCount: urls.length,
  };
  const batches = planPdfWorkerBatches(
    urls.length,
    workerPlan.workerCount,
    workerPlan.batchSize,
    workerPlan.partialMergeEnabled === true
  );

  if (batches.length <= 0) throw new Error('No pages were available for generated PDF output.');

  const onProgress = args?.onProgress || (() => {});
  if (batches.length === 1) {
    return runPdfWorkerTask(PdfWorker, createBatchJob(batches[0], { ...args, urls, pagePlans }, workerPlan), args?.signal, onProgress, 0);
  }

  const progressByBatch = new Array(batches.length).fill(0);
  const reportBatchProgress = (batch, event) => {
    const localProgress = Math.max(0, Math.min(batch.pageCount, progressValueFromWorkerEvent(event)));
    progressByBatch[batch.batchIndex] = Math.max(progressByBatch[batch.batchIndex], localProgress);
    const aggregateProgress = sumProgress(progressByBatch);
    const page = Math.max(0, Number(event?.page) || 0);
    onProgress({
      ...event,
      current: Math.max(0, Math.min(urls.length, Math.floor(aggregateProgress))),
      progressValue: urls.length * PARTIAL_GENERATION_PROGRESS_RATIO * (aggregateProgress / Math.max(1, urls.length)),
      page: page > 0 ? batch.startPageIndex + page : 0,
      total: urls.length,
      batchIndex: batch.batchIndex,
      batchCount: batches.length,
    });
  };

  const partialBlobs = await runLimitedTasks(
    batches,
    workerPlan.workerCount,
    (batch, _batchIndex, workerSlot) => runPdfWorkerTask(
      PdfWorker,
      createBatchJob(batch, { ...args, urls, pagePlans }, workerPlan),
      args?.signal,
      (event) => reportBatchProgress(batch, event),
      workerSlot
    ),
    args?.signal
  );

  return mergePdfBlobsWithWorkers(partialBlobs, workerPlan, args?.signal, onProgress);
}
