// File: src/utils/pageAssetWorkerPool.js
/**
 * OpenDocViewer — Page-asset worker pool.
 *
 * Offloads TIFF and raster-image background rendering work to dedicated workers when the runtime supports it.
 */

import logger from '../logging/systemLogger.js';
import ImageWorker from '../workers/imageWorker.js?worker';

/**
 * @typedef {Object} PageAssetWorkerPoolOptions
 * @property {boolean=} enabled
 * @property {number=} workerCount
 * @property {boolean=} useForTiff
 * @property {boolean=} useForRasterImages
 */

/**
 * @typedef {Object} PageAssetWorkerEntry
 * @property {Worker} worker
 * @property {boolean} busy
 * @property {(number|null)} activeTaskId
 * @property {boolean} dead
 */

/**
 * @typedef {Object} PendingWorkerTask
 * @property {function(any):void} resolve
 * @property {function(*):void} reject
 * @property {number} slot
 */

/**
 * @typedef {Object} WorkerTaskInput
 * @property {string} fileExtension
 * @property {number} pageIndex
 * @property {'full'|'thumbnail'} variant
 * @property {Blob} sourceBlob
 * @property {number=} thumbnailMaxWidth
 * @property {number=} thumbnailMaxHeight
 * @property {number=} rasterFullPageScale
 */

/**
 * @param {Object=} opts
 * @returns {PageAssetWorkerPool}
 */
export function createPageAssetWorkerPool(opts = {}) {
  return new PageAssetWorkerPool(opts);
}

/**
 * @param {string} fileExtension
 * @returns {boolean}
 */
function isRasterExt(fileExtension) {
  const ext = String(fileExtension || '').toLowerCase();
  return ext === 'jpg'
    || ext === 'jpeg'
    || ext === 'png'
    || ext === 'gif'
    || ext === 'webp'
    || ext === 'bmp'
    || ext === 'avif';
}

export class PageAssetWorkerPool {
  /**
   * @param {PageAssetWorkerPoolOptions=} opts
   */
  constructor(opts = {}) {
    this.enabled = opts?.enabled !== false;
    this.useForTiff = opts?.useForTiff !== false;
    this.useForRasterImages = opts?.useForRasterImages !== false;
    this.workerCount = this.enabled ? Math.max(0, Number(opts?.workerCount) || 0) : 0;

    /** @type {Array<PageAssetWorkerEntry>} */
    this.workers = [];
    /** @type {Map<number, PendingWorkerTask>} */
    this.pending = new Map();
    /** @type {Array<{ taskId:number, payload:WorkerTaskInput, resolve:function(any):void, reject:function(*):void }>} */
    this.queue = [];
    this.taskId = 1;
    this.disposed = false;

    for (let i = 0; i < this.workerCount; i += 1) {
      try {
        const worker = new ImageWorker({ type: 'module', name: `odv-page-asset-worker-${i + 1}` });
        const slot = this.workers.length;
        this.workers.push({ worker, busy: false, activeTaskId: null, dead: false });
        worker.onmessage = (event) => this.handleMessage(slot, event);
        worker.onerror = (event) => this.handleError(slot, event?.error || event);
        worker.onmessageerror = (event) => this.handleError(slot, event);
      } catch (error) {
        logger.warn('Failed to create page asset worker', { error: String(error?.message || error) });
      }
    }

    this.workerCount = this.workers.length;
  }

  /**
   * @returns {number}
   */
  getWorkerCount() {
    return this.workers.filter((entry) => entry && !entry.dead).length;
  }

  /**
   * @param {string} fileExtension
   * @param {'full'|'thumbnail'} variant
   * @returns {boolean}
   */
  canRender(fileExtension, variant) {
    if (this.disposed || this.workerCount <= 0) return false;
    const ext = String(fileExtension || '').toLowerCase();
    if ((ext === 'tif' || ext === 'tiff') && this.useForTiff) return true;
    if (isRasterExt(ext) && this.useForRasterImages && (variant === 'thumbnail' || variant === 'full')) return true;
    return false;
  }

  /**
   * @param {WorkerTaskInput} payload
   * @returns {Promise<{ blob:Blob, width:number, height:number, mimeType:string }>}
   */
  renderAsset(payload) {
    if (!this.canRender(payload?.fileExtension, payload?.variant === 'thumbnail' ? 'thumbnail' : 'full')) {
      const error = new Error('No compatible page-asset worker is available');
      error.fallbackMainThread = true;
      return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
      this.queue.push({ taskId: this.taskId++, payload, resolve, reject });
      this.pump();
    });
  }

  /**
   * @returns {void}
   */
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
          type: 'renderPageAsset',
          taskId: next.taskId,
          payload: next.payload,
        });
      } catch (error) {
        this.pending.delete(next.taskId);
        entry.busy = false;
        entry.activeTaskId = null;
        const nextError = new Error(String(error?.message || error || 'Failed to post worker message'));
        nextError.fallbackMainThread = true;
        next.reject(nextError);
      }
    }
  }

  /**
   * @param {number} slot
   * @param {MessageEvent} event
   * @returns {void}
   */
  handleMessage(slot, event) {
    const data = event?.data || {};
    if (data?.type !== 'renderPageAssetResult') return;

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
        mimeType: String(data.mimeType || data.blob?.type || 'application/octet-stream'),
      });
    } else {
      const error = new Error(String(data?.error || 'Worker render failed'));
      error.fallbackMainThread = !!data?.fallbackMainThread;
      pending.reject(error);
    }

    this.pump();
  }

  /**
   * @param {number} slot
   * @param {*} errorLike
   * @returns {void}
   */
  handleError(slot, errorLike) {
    const entry = this.workers[slot];
    const taskId = entry?.activeTaskId || 0;
    if (taskId) {
      const pending = this.pending.get(taskId);
      if (pending) {
        this.pending.delete(taskId);
        const error = new Error(String(errorLike?.message || errorLike || 'Page asset worker failed'));
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
    logger.warn('Page asset worker terminated after an error', {
      remainingWorkers: this.workerCount,
      error: String(errorLike?.message || errorLike || 'unknown'),
    });
    this.pump();
  }

  /**
   * @returns {Promise<void>}
   */
  async dispose() {
    this.disposed = true;
    for (const pending of this.pending.values()) {
      const error = new Error('Page asset worker pool disposed');
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
