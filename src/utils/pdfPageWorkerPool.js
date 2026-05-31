// File: src/utils/pdfPageWorkerPool.js
/**
 * OpenDocViewer - PDF page-image worker pool.
 *
 * Keeps the experimental PDF-to-image worker mode isolated from the existing raster/TIFF worker
 * pool. The caller can safely fall back to the main-thread pdf.js path whenever this pool rejects.
 */

import logger from '../logging/systemLogger.js';
import PdfPageWorker from '../workers/pdfPageWorker.js?worker';

function normalizeErrorDetails(errorLike, phase = 'pool') {
  const error = errorLike?.error || errorLike;
  return {
    name: String(error?.name || errorLike?.type || 'Error'),
    message: String(error?.message || errorLike?.message || errorLike || 'Unknown PDF page worker error'),
    code: String(error?.code || errorLike?.code || ''),
    phase: String(error?.phase || errorLike?.phase || phase || 'pool'),
    stack: String(error?.stack || errorLike?.stack || ''),
    filename: String(errorLike?.filename || ''),
    lineno: Number(errorLike?.lineno || 0),
    colno: Number(errorLike?.colno || 0),
    fallbackMainThread: true,
  };
}

function attachErrorDetails(error, details) {
  error.fallbackMainThread = true;
  error.pdfWorkerDetails = details || normalizeErrorDetails(error);
  if (details?.code) error.code = details.code;
  if (details?.phase) error.phase = details.phase;
  return error;
}

function withWorkerHistory(details, lastWorkerError, workerCreationErrors) {
  return {
    ...details,
    lastWorkerError: lastWorkerError || null,
    workerCreationErrors: Array.isArray(workerCreationErrors) ? workerCreationErrors.slice(0, 4) : [],
  };
}

/**
 * @typedef {Object} PdfPageWorkerPoolOptions
 * @property {boolean=} enabled
 * @property {number=} workerCount
 * @property {number=} taskTimeoutMs
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
    this.taskTimeoutMs = Math.max(5000, Math.min(10 * 60 * 1000, Number(opts?.taskTimeoutMs) || 2 * 60 * 1000));

    /** @type {Array<PdfPageWorkerEntry>} */
    this.workers = [];
    /** @type {Map<number, { resolve:function(any):void, reject:function(*):void, slot:number, timeoutId:any }>} */
    this.pending = new Map();
    /** @type {Array<{ taskId:number, payload:Object, resolve:function(any):void, reject:function(*):void }>} */
    this.queue = [];
    this.taskId = 1;
    this.disposed = false;
    this.lastWorkerError = null;
    this.workerCreationErrors = [];
    this.pumpTimer = 0;

    for (let i = 0; i < this.workerCount; i += 1) {
      try {
        const worker = new PdfPageWorker({ type: 'module', name: `odv-pdf-page-worker-${i + 1}` });
        const slot = this.workers.length;
        this.workers.push({ worker, busy: false, activeTaskId: null, dead: false });
        worker.onmessage = (event) => this.handleMessage(slot, event);
        worker.onerror = (event) => this.handleError(slot, event?.error || event);
        worker.onmessageerror = (event) => this.handleError(slot, event);
      } catch (error) {
        const details = {
          ...normalizeErrorDetails(error, 'create-worker'),
          code: String(error?.code || 'pdf-worker-create-failed'),
          phase: 'create-worker',
        };
        this.lastWorkerError = details;
        this.workerCreationErrors.push(details);
        logger.warn('Failed to create PDF page worker', { error: details.message, details });
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

  createUnavailableError(message, code = 'no-compatible-pdf-worker') {
    return attachErrorDetails(new Error(message || 'No compatible PDF page worker is available'), withWorkerHistory({
      name: 'Error',
      message: message || 'No compatible PDF page worker is available',
      code,
      phase: 'queue',
      fallbackMainThread: true,
    }, this.lastWorkerError, this.workerCreationErrors));
  }

  renderAsset(payload) {
    if (!this.canRender()) {
      return Promise.reject(this.createUnavailableError('No compatible PDF page worker is available'));
    }

    return new Promise((resolve, reject) => {
      this.queue.push({ taskId: this.taskId++, payload, resolve, reject });
      this.pump();
    });
  }

  pump() {
    this.pumpTimer = 0;
    if (this.disposed) return;
    if (this.queue.length > 0 && this.getWorkerCount() <= 0) {
      this.rejectQueuedWithFallback('No compatible PDF page worker is available');
      return;
    }

    while (this.queue.length > 0) {
      const slot = this.workers.findIndex((entry) => entry && !entry.dead && !entry.busy);
      if (slot < 0) {
        if (this.getWorkerCount() <= 0) this.rejectQueuedWithFallback('No compatible PDF page worker is available');
        return;
      }

      const next = this.queue.shift();
      if (!next) return;
      const entry = this.workers[slot];
      entry.busy = true;
      entry.activeTaskId = next.taskId;
      const timeoutId = globalThis.setTimeout?.(() => {
        this.handleTimeout(next.taskId, slot);
      }, this.taskTimeoutMs);
      this.pending.set(next.taskId, { resolve: next.resolve, reject: next.reject, slot, timeoutId });

      try {
        entry.worker.postMessage({
          type: 'renderPdfPageAsset',
          taskId: next.taskId,
          payload: next.payload,
        });
      } catch (error) {
        this.clearPendingTimeout(next.taskId);
        this.pending.delete(next.taskId);
        entry.busy = false;
        entry.activeTaskId = null;
        entry.dead = true;
        try { entry.worker.terminate(); } catch {}
        this.workerCount = this.getWorkerCount();
        const details = {
          ...normalizeErrorDetails(error, 'post-message'),
          code: String(error?.code || 'pdf-worker-post-message-failed'),
          phase: 'post-message',
        };
        this.lastWorkerError = details;
        const nextError = attachErrorDetails(
          new Error(String(error?.message || error || 'Failed to post PDF worker message')),
          details
        );
        next.reject(nextError);
        if (this.workerCount <= 0) this.rejectQueuedWithFallback('No compatible PDF page worker is available');
      }
    }
  }

  schedulePump() {
    if (this.disposed || this.pumpTimer) return;
    this.pumpTimer = globalThis.setTimeout?.(() => {
      this.pumpTimer = 0;
      this.pump();
    }, 0) || 0;
  }

  clearPendingTimeout(taskId) {
    const pending = this.pending.get(taskId);
    if (pending?.timeoutId) {
      try { globalThis.clearTimeout?.(pending.timeoutId); } catch {}
      pending.timeoutId = null;
    }
  }

  rejectQueuedWithFallback(message) {
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) continue;
      next.reject(this.createUnavailableError(message || 'PDF page worker is unavailable', 'queued-pdf-worker-unavailable'));
    }
  }

  handleTimeout(taskId, slot) {
    const pending = this.pending.get(taskId);
    if (!pending) return;

    this.pending.delete(taskId);
    const entry = this.workers[slot];
    if (entry) {
      entry.busy = false;
      entry.activeTaskId = null;
      entry.dead = true;
      try { entry.worker.terminate(); } catch {}
    }

    this.workerCount = this.getWorkerCount();
    const details = {
      name: 'TimeoutError',
      message: 'PDF page worker timed out',
      code: 'pdf-worker-timeout',
      phase: 'render',
      fallbackMainThread: true,
    };
    this.lastWorkerError = details;
    const error = attachErrorDetails(new Error('PDF page worker timed out'), details);
    pending.reject(error);
    if (this.workerCount <= 0) this.rejectQueuedWithFallback('No compatible PDF page worker is available');
    this.schedulePump();
  }

  handleMessage(slot, event) {
    const data = event?.data || {};
    if (data?.type !== 'renderPdfPageAssetResult') return;

    const taskId = Number(data?.taskId || 0);
    const pending = this.pending.get(taskId);
    if (!pending) return;

    this.clearPendingTimeout(taskId);
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
      const details = data?.errorDetails && typeof data.errorDetails === 'object'
        ? {
            ...data.errorDetails,
            payloadSummary: data?.payloadSummary || null,
            fallbackMainThread: !!data?.fallbackMainThread,
          }
        : {
            name: 'Error',
            message: String(data?.error || 'PDF worker render failed'),
            code: '',
            phase: 'render',
            fallbackMainThread: !!data?.fallbackMainThread,
          };
      this.lastWorkerError = details;
      const error = attachErrorDetails(new Error(String(data?.error || details.message || 'PDF worker render failed')), details);
      error.fallbackMainThread = !!data?.fallbackMainThread;
      pending.reject(error);
    }

    this.schedulePump();
  }

  handleError(slot, errorLike) {
    const entry = this.workers[slot];
    const taskId = entry?.activeTaskId || 0;
    if (taskId) {
      const pending = this.pending.get(taskId);
      if (pending) {
        this.clearPendingTimeout(taskId);
        this.pending.delete(taskId);
        const details = {
          ...normalizeErrorDetails(errorLike, 'worker-error'),
          code: String(errorLike?.code || 'pdf-worker-runtime-error'),
          phase: 'worker-error',
        };
        this.lastWorkerError = details;
        const error = attachErrorDetails(
          new Error(String(errorLike?.message || errorLike || 'PDF page worker failed')),
          details
        );
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
    if (this.workerCount <= 0) this.rejectQueuedWithFallback('No compatible PDF page worker is available');
    logger.warn('PDF page worker terminated after an error', {
      remainingWorkers: this.workerCount,
      error: String(errorLike?.message || errorLike || 'unknown'),
    });
    this.schedulePump();
  }

  async dispose() {
    this.disposed = true;
    for (const pending of this.pending.values()) {
      if (pending?.timeoutId) {
        try { globalThis.clearTimeout?.(pending.timeoutId); } catch {}
      }
      const error = attachErrorDetails(new Error('PDF page worker pool disposed'), {
        name: 'Error',
        message: 'PDF page worker pool disposed',
        code: 'pdf-worker-pool-disposed',
        phase: 'dispose',
        fallbackMainThread: true,
      });
      pending.reject(error);
    }
    this.pending.clear();
    this.rejectQueuedWithFallback('PDF page worker pool disposed');
    if (this.pumpTimer) {
      try { globalThis.clearTimeout?.(this.pumpTimer); } catch {}
      this.pumpTimer = 0;
    }

    for (const entry of this.workers) {
      if (!entry?.worker) continue;
      try { entry.worker.terminate(); } catch {}
    }
    this.workers = [];
    this.workerCount = 0;
  }
}
