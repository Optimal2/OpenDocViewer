// File: src/utils/pdfWorkerDispatcher.js
/**
 * OpenDocViewer - generated PDF worker dispatcher.
 *
 * The dispatcher splits larger generated-PDF jobs into page batches, renders the
 * batches in PDF workers, then merges the completed partial PDFs in one pass.
 */

import PdfWorker from '../workers/pdfWorker.js?worker';

const SINGLE_BATCH_MAX_PAGE_COUNT = 180;
const DEFAULT_TARGET_PAGES_PER_PDF_WORKER = 150;
const HIGH_CORE_TARGET_PAGES_PER_PDF_WORKER = 75;
const HIGH_CORE_PAGE_COUNT_THRESHOLD = 240;
const HIGH_CORE_WORKER_COUNT_THRESHOLD = 16;
const MAX_AUTO_BATCH_COUNT = 10;
const BATCH_LIBRARY_JOB_UNITS = 1;
const BATCH_FINALIZE_JOB_UNITS = 1;

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
 * @property {boolean=} partialMergeEnabled Enables multi-worker partial PDF generation and final merge.
 * @property {'auto'|'single'|'pairwise'=} mergeMode Legacy benchmark/config field; runtime merge is single-pass.
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
 * Pick a conservative future batch size from a pages-per-worker target.
 * Browser-side PDF generation has a large fixed cost per partial PDF: every
 * batch loads jsPDF, creates a PDF object, and later participates in one final
 * merge. Benchmarks showed that 100-page jobs should stay in one worker, 300
 * pages prefer about two large jobs on 6-core clients, and high-core clients can
 * benefit from four smaller-but-still-substantial jobs. Auto therefore targets
 * useful page chunks instead of trying to keep every logical core busy.
 * @param {number} pageCount
 * @param {number} workerCount
 * @returns {number}
 */
export function resolveAutoPdfWorkerBatchSize(pageCount, workerCount) {
  const safePageCount = Math.max(1, Math.floor(Number(pageCount) || 1));
  const safeWorkerCount = Math.max(1, Math.floor(Number(workerCount) || 1));
  if (safeWorkerCount <= 1 || safePageCount <= SINGLE_BATCH_MAX_PAGE_COUNT) return safePageCount;

  const targetPagesPerWorker = safeWorkerCount >= HIGH_CORE_WORKER_COUNT_THRESHOLD
    && safePageCount >= HIGH_CORE_PAGE_COUNT_THRESHOLD
    ? HIGH_CORE_TARGET_PAGES_PER_PDF_WORKER
    : DEFAULT_TARGET_PAGES_PER_PDF_WORKER;
  const targetBatchCount = clampInteger(
    Math.ceil(safePageCount / targetPagesPerWorker),
    1,
    Math.min(safeWorkerCount, MAX_AUTO_BATCH_COUNT)
  );
  return Math.max(1, Math.ceil(safePageCount / targetBatchCount));
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
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

/**
 * @param {PdfWorkerBatch} batch
 * @returns {number}
 */
function countBatchJobUnits(batch) {
  return BATCH_LIBRARY_JOB_UNITS
    + Math.max(0, Number(batch?.pageCount) || 0)
    + Math.max(0, Number(batch?.pageCount) || 0)
    + BATCH_FINALIZE_JOB_UNITS;
}

/**
 * @param {Array<PdfWorkerBatch>} batches
 * @returns {{batchUnits:number,totalUnits:number,mergeUnits:number}}
 */
function createPdfProgressPlan(batches) {
  const list = Array.isArray(batches) ? batches : [];
  const batchUnits = list.reduce((sum, batch) => sum + countBatchJobUnits(batch), 0);
  const mergeUnits = list.length > 1 ? list.length : 0;
  return {
    batchUnits,
    mergeUnits,
    totalUnits: Math.max(1, batchUnits + mergeUnits),
  };
}

/**
 * Convert worker phases to deterministic job units:
 * - 1 unit for loading the PDF engine per batch
 * - 1 unit per loaded page image
 * - 1 unit per generated page
 * - 1 unit for finalizing each partial PDF
 * @param {PdfWorkerBatch} batch
 * @param {Object} event
 * @returns {number}
 */
function batchProgressUnitsFromEvent(batch, event) {
  const pageCount = Math.max(0, Number(batch?.pageCount) || 0);
  const phase = String(event?.phase || '');
  if (phase === 'loading-library') return 0;
  if (phase === 'loading-images') {
    return BATCH_LIBRARY_JOB_UNITS + clampNumber(event?.current, 0, pageCount);
  }
  if (phase === 'generating' || phase === 'generating-page') {
    return BATCH_LIBRARY_JOB_UNITS
      + pageCount
      + clampNumber(progressValueFromWorkerEvent(event), 0, pageCount);
  }
  if (phase === 'finalizing') {
    return BATCH_LIBRARY_JOB_UNITS + pageCount + pageCount;
  }
  if (phase === 'done') {
    return countBatchJobUnits(batch);
  }
  return clampNumber(event?.current, 0, countBatchJobUnits(batch));
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
 * @param {Array<Blob>} parts
 * @param {{batchUnits:number,totalUnits:number,mergeUnits:number}} progressPlan
 * @param {AbortSignal|undefined} signal
 * @param {function(Object):void} onProgress
 * @returns {Promise<Blob>}
 */
async function mergePdfBlobsSinglePass(parts, progressPlan, signal, onProgress) {
  const mergeTotal = Math.max(1, progressPlan.mergeUnits);
  const reportMergeProgress = (mergeProgress) => {
    const completed = progressPlan.batchUnits + Math.max(0, Math.min(mergeTotal, mergeProgress));
    onProgress({
      phase: 'merging',
      current: Math.floor(completed),
      progressValue: completed,
      total: progressPlan.totalUnits,
      mergeCurrent: Math.floor(mergeProgress),
      mergeTotal,
      mergeRound: 1,
      partialCount: parts.length,
    });
  };

  reportMergeProgress(0);
  const { PDFDocument } = await import('pdf-lib');
  const target = await PDFDocument.create();
  for (let index = 0; index < parts.length; index += 1) {
    throwIfAborted(signal);
    const blob = parts[index];
    if (!(blob instanceof Blob)) throw new Error(`PDF merge input ${index + 1} was not a Blob.`);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const source = await PDFDocument.load(bytes);
    const pages = await target.copyPages(source, source.getPageIndices());
    pages.forEach((page) => target.addPage(page));
    reportMergeProgress(index + 1);
  }
  throwIfAborted(signal);
  const mergedBytes = await target.save({ useObjectStreams: true });
  reportMergeProgress(mergeTotal);
  return new Blob([mergedBytes], { type: 'application/pdf' });
}

/**
 * @param {Array<Blob>} initialParts
 * @param {{batchUnits:number,totalUnits:number,mergeUnits:number}} progressPlan
 * @param {AbortSignal|undefined} signal
 * @param {function(Object):void} onProgress
 * @returns {Promise<Blob>}
 */
async function mergePdfBlobs(initialParts, progressPlan, signal, onProgress) {
  const parts = Array.isArray(initialParts) ? initialParts.filter((blob) => blob instanceof Blob) : [];
  if (!parts.length) throw new Error('No partial PDFs were available for merge.');
  if (parts.length === 1) return parts[0];
  return mergePdfBlobsSinglePass(parts, progressPlan, signal, onProgress);
}

/**
 * Dispatch generated-PDF work to the worker layer. With partial merge enabled,
 * page batches are rendered in parallel and then merged in one final pass.
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
  workerPlan.workerCount = Math.max(1, Math.min(
    Math.floor(Number(workerPlan.workerCount) || 1),
    batches.length
  ));

  const onProgress = args?.onProgress || (() => {});
  const progressPlan = createPdfProgressPlan(batches);
  const progressByBatch = new Array(batches.length).fill(0);
  const reportBatchProgress = (batch, event) => {
    const localProgress = batchProgressUnitsFromEvent(batch, event);
    progressByBatch[batch.batchIndex] = Math.max(progressByBatch[batch.batchIndex], localProgress);
    const aggregateProgress = sumProgress(progressByBatch);
    const page = Math.max(0, Number(event?.page) || 0);
    const localTotal = Math.max(1, Number(event?.total) || batch.pageCount || 1);
    onProgress({
      ...event,
      current: Math.max(0, Math.min(progressPlan.totalUnits, Math.floor(aggregateProgress))),
      progressValue: Math.max(0, Math.min(progressPlan.totalUnits, aggregateProgress)),
      page: page > 0 ? batch.startPageIndex + page : 0,
      localCurrent: clampNumber(event?.current, 0, localTotal),
      localTotal,
      batchStartPageIndex: batch.startPageIndex,
      batchPageCount: batch.pageCount,
      total: progressPlan.totalUnits,
      batchIndex: batch.batchIndex,
      batchCount: batches.length,
    });
  };

  if (batches.length === 1) {
    return runPdfWorkerTask(
      PdfWorker,
      createBatchJob(batches[0], { ...args, urls, pagePlans }, workerPlan),
      args?.signal,
      (event) => reportBatchProgress(batches[0], event),
      0
    );
  }

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

  return mergePdfBlobs(partialBlobs, progressPlan, args?.signal, onProgress);
}
