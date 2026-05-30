// File: src/utils/pdfPageWorkerPool.js
/**
 * OpenDocViewer - PDF page-image worker pool.
 *
 * Keeps the experimental PDF-to-image worker mode isolated from the existing raster/TIFF worker
 * pool. The caller can safely fall back to the main-thread pdf.js path whenever this pool rejects.
 */

import logger from '../logging/systemLogger.js';
import PdfPageWorker from '../workers/pdfPageWorker.js?worker';

/**
 * @typedef {Object} PdfPageWorkerPoolOptions
 * @property {boolean=} enabled
 * @property {number=} workerCount
 */

/**
 * @typedef {Object} PdfPageWorkerEntry
 * @property {Worker} worker
 * @property {boolean} busy
 * @property {(number|null)} activeTaskId
 * @property {boolean} dead
 */

export function createPdfPageWorkerPool(opts = {}) {
  return new PdfPageWorkerPool(opts);
}

export class PdfPageWorkerPool {
  /**
   * @param {PdfPageWorkerPoolOptions=} opts
   */
  constructor(opts = {}) {
    this.enabled = opts?.enabled !== false;
    this.workerCount = this.enabled ? Math.max(0, Number(opts?.workerCount) || 0) : 0;

    /** @type {Array<PdfPageWorkerEntry>} */
    this.workers = [];
    /** @type {Map<number, { resolve:function(any):void, reject:function(*):void, slot:number }>} */
    this.pending = new Map();
    /** @type {Array<{ taskId:number, payload:Object, resolve:function(any):void, reject:function(*):void }>} */
    this.queue = [];
    this.taskId = 1;
    this.disposed = false;

    for (let i = 0; i < this.workerCount; i += 1) {
      try {
        const worker = new PdfPageWorker({ type: 'module', name: `odv-pdf-page-worker-${i + 1}` });
        const slot = this.workers.length;
        this.workers.push({ worker, busy: false, activeTaskId: null, dead: false });
        worker.onmessage = (event) => this.handleMessage(slot, event);
        worker.onerror = (event) => this.handleError(slot, event?.error || event);
        worker.onmessageerror = (event) => this.handleError(slot, event);
      } catch (error) {
        logger.warn('Failed to create PDF page worker', { error: String(error?.message || error) });
      }
    }

    this.workerCount = this.workers.length;
  }

  getWorkerCount() {
    return this.workers.filter((entry) => entry && !entry.dead).length;
  }

  canRender() {
    return !this.disposed && this.workerCount > 0;
  }

  renderAsset(payload) {
    if (!this.canRender()) {
      const error = new Error('No compatible PDF page worker is available');
      error.fallbackMainThread = true;
      return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
      this.queue.push({ taskId: this.taskId++, payload, resolve, reject });
      this.pump();
    });
  }

  pump() {
    if (this.disposed) return;
    while (this.queue.length > 0) {
      const slot = this.workers.findIndex((entry) => entry && !entry.dead && !entry.busy);
      if (slot < 0) return;

      const next = this.queue.shift();
      if (!next) return;
      const entry = this.workers[slot];
      entry.busy = true;
      entry.activeTaskId = next.taskId;
      this.pending.set(next.taskId, { resolve: next.resolve, reject: next.reject, slot });

      try {
        entry.worker.postMessage({
          type: 'renderPdfPageAsset',
          taskId: next.taskId,
          payload: next.payload,
        });
      } catch (error) {
        this.pending.delete(next.taskId);
        entry.busy = false;
        entry.activeTaskId = null;
        const nextError = new Error(String(error?.message || error || 'Failed to post PDF worker message'));
        nextError.fallbackMainThread = true;
        next.reject(nextError);
      }
    }
  }

  handleMessage(slot, event) {
    const data = event?.data || {};
    if (data?.type !== 'renderPdfPageAssetResult') return;

    const taskId = Number(data?.taskId || 0);
    const pending = this.pending.get(taskId);
    if (!pending) return;

    this.pending.delete(taskId);
    const entry = this.workers[slot];
    if (entry) {
      entry.busy = false;
      entry.activeTaskId = null;
    }

    if (data?.ok) {
      pending.resolve({
        blob: data.blob,
        width: Math.max(1, Number(data.width) || 1),
        height: Math.max(1, Number(data.height) || 1),
        mimeType: String(data.mimeType || data.blob?.type || 'image/png'),
      });
    } else {
      const error = new Error(String(data?.error || 'PDF worker render failed'));
      error.fallbackMainThread = !!data?.fallbackMainThread;
      pending.reject(error);
    }

    this.pump();
  }

  handleError(slot, errorLike) {
    const entry = this.workers[slot];
    const taskId = entry?.activeTaskId || 0;
    if (taskId) {
      const pending = this.pending.get(taskId);
      if (pending) {
        this.pending.delete(taskId);
        const error = new Error(String(errorLike?.message || errorLike || 'PDF page worker failed'));
        error.fallbackMainThread = true;
        pending.reject(error);
      }
    }

    if (entry) {
      entry.busy = false;
      entry.activeTaskId = null;
      entry.dead = true;
      try { entry.worker.terminate(); } catch {}
    }

    this.workerCount = this.getWorkerCount();
    logger.warn('PDF page worker terminated after an error', {
      remainingWorkers: this.workerCount,
      error: String(errorLike?.message || errorLike || 'unknown'),
    });
    this.pump();
  }

  async dispose() {
    this.disposed = true;
    for (const pending of this.pending.values()) {
      const error = new Error('PDF page worker pool disposed');
      error.fallbackMainThread = true;
      pending.reject(error);
    }
    this.pending.clear();
    this.queue.length = 0;

    for (const entry of this.workers) {
      if (!entry?.worker) continue;
      try { entry.worker.terminate(); } catch {}
    }
    this.workers = [];
    this.workerCount = 0;
  }
}
