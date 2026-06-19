// File: src/utils/pageAssetRenderer.js
/**
 * OpenDocViewer — hybrid page-asset renderer.
 *
 * The renderer keeps the modern temp-store / placeholder architecture from `main`, but routes raster
 * and TIFF work through dedicated workers when that is beneficial and supported. PDF rendering stays
 * on the stable main-thread pdf.js path by default, with an opt-in page-image worker mode.
 */

import { decode as decodeUTIF, decodeImage as decodeUTIFImage, toRGBA8 } from 'utif2';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { getDocumentLoadingConfig, resolvePdfRenderConfigForPageCount } from './documentLoadingConfig.js';
import { createPageAssetWorkerPool } from './pageAssetWorkerPool.js';
import { createPdfPageWorkerPool } from './pdfPageWorkerPool.js';
import { withPdfJsDocumentOptions } from './pdfjsDocumentOptions.js';

const MAX_FALLBACK_REASON_SAMPLES = 12;

try {
  if (pdfjsLib?.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  }
} catch {
  // Ignore worker-less environments.
}

/**
 * @typedef {Object} PageAssetRendererOptions
 * @property {*} tempStore
 * @property {Object=} config
 */

/**
 * @typedef {Object} PageAssetDescriptor
 * @property {string} sourceKey
 * @property {string} fileExtension
 * @property {number} fileIndex
 * @property {number} pageIndex
 */

/**
 * @typedef {Object} RenderPageAssetOptions
 * @property {'full'|'thumbnail'} variant
 * @property {number=} thumbnailMaxWidth
 * @property {number=} thumbnailMaxHeight
 * @property {number=} fullPageScale
 */

function fitScale(width, height, maxWidth, maxHeight) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const safeMaxWidth = Math.max(1, Number(maxWidth) || safeWidth);
  const safeMaxHeight = Math.max(1, Number(maxHeight) || safeHeight);
  return Math.min(1, safeMaxWidth / safeWidth, safeMaxHeight / safeHeight);
}

function setLru(map, key, value, limit) {
  map.delete(key);
  map.set(key, value);
  while (map.size > Math.max(1, Number(limit) || 1)) {
    const oldestKey = map.keys().next().value;
    const oldest = map.get(oldestKey);
    map.delete(oldestKey);
    try { oldest?.dispose?.(); } catch {}
  }
}

function touchLru(map, key, limit) {
  if (!map.has(key)) return;
  const value = map.get(key);
  setLru(map, key, value, limit);
}

function partitionContiguous(items, partitionCount) {
  const list = Array.isArray(items) ? items : [];
  const count = Math.max(1, Math.min(list.length || 1, Math.floor(Number(partitionCount) || 1)));
  const partitions = [];
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    const remainingItems = list.length - cursor;
    const remainingPartitions = count - index;
    const size = Math.ceil(remainingItems / remainingPartitions);
    partitions.push(list.slice(cursor, cursor + size));
    cursor += size;
  }
  return partitions.filter((partition) => partition.length > 0);
}

function canvasToBlob(canvas, mimeType = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas serialization failed'));
    }, mimeType, quality);
  });
}

function normalizeFallbackDetails(error) {
  const details = error?.pdfWorkerDetails && typeof error.pdfWorkerDetails === 'object'
    ? error.pdfWorkerDetails
    : null;
  return {
    name: String(details?.name || error?.name || 'Error'),
    message: String(details?.message || error?.message || error || 'Unknown PDF worker fallback'),
    code: String(details?.code || error?.code || ''),
    phase: String(details?.phase || error?.phase || ''),
    stack: String(details?.stack || error?.stack || ''),
    filename: String(details?.filename || ''),
    lineno: Number(details?.lineno || 0),
    colno: Number(details?.colno || 0),
    environment: details?.environment || null,
    payloadSummary: details?.payloadSummary || null,
    lastWorkerError: details?.lastWorkerError || null,
    workerCreationErrors: Array.isArray(details?.workerCreationErrors)
      ? details.workerCreationErrors.slice()
      : [],
  };
}

async function loadBlobForDrawing(blob) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return {
      width: bitmap.width,
      height: bitmap.height,
      drawToCanvas(canvas) {
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) throw new Error('Unable to acquire canvas context');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      },
      close() {
        try { bitmap.close(); } catch {}
      },
    };
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      try { img.decoding = 'async'; } catch {}
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load blob image'));
      img.src = objectUrl;
    });

    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      drawToCanvas(canvas) {
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) throw new Error('Unable to acquire canvas context');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      },
      close() {},
    };
  } finally {
    try { URL.revokeObjectURL(objectUrl); } catch {}
  }
}

async function scaleBlob(blob, maxWidth, maxHeight) {
  const loaded = await loadBlobForDrawing(blob);
  try {
    const scale = fitScale(loaded.width, loaded.height, maxWidth, maxHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(loaded.width * scale));
    canvas.height = Math.max(1, Math.round(loaded.height * scale));
    loaded.drawToCanvas(canvas);
    return {
      blob: await canvasToBlob(canvas, 'image/png'),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    loaded.close();
  }
}

function getTagArray(ifd, tagId) {
  const key = `t${tagId}`;
  const value = ifd && ifd[key];
  if (!value) return undefined;
  return Array.isArray(value) ? value : [value];
}

function buildOjpegJpeg(arrayBuffer, ifd) {
  try {
    const byteLength = Number(arrayBuffer?.byteLength) || 0;
    const t513 = getTagArray(ifd, 513);
    const t514 = getTagArray(ifd, 514);
    const t273 = getTagArray(ifd, 273);
    const t279 = getTagArray(ifd, 279);
    if (!t513 || !t514 || !t273 || !t279) return null;

    const tablesOffset = t513[0] >>> 0;
    const tablesLen = t514[0] >>> 0;
    if (!tablesLen) return null;
    if (tablesOffset > byteLength || tablesLen > (byteLength - tablesOffset)) return null;

    const bytes = new Uint8Array(arrayBuffer);
    const parts = [bytes.subarray(tablesOffset, tablesOffset + tablesLen)];

    const stripCount = Math.min(t273.length, t279.length);
    if (stripCount <= 0) return null;
    let totalScanLen = 0;
    for (let i = 0; i < stripCount; i += 1) {
      const off = t273[i] >>> 0;
      const len = t279[i] >>> 0;
      if (off > byteLength || len > (byteLength - off)) return null;
      totalScanLen += len;
      if (totalScanLen > 512 * 1024 * 1024) return null;
    }
    const scanAll = new Uint8Array(totalScanLen);
    let cursor = 0;
    for (let i = 0; i < stripCount; i += 1) {
      const off = t273[i] >>> 0;
      const len = t279[i] >>> 0;
      scanAll.set(bytes.subarray(off, off + len), cursor);
      cursor += len;
    }
    parts.push(scanAll);

    let totalLen = 0;
    for (const part of parts) totalLen += part.byteLength;
    const out = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.byteLength;
    }

    return new Blob([out], { type: 'image/jpeg' });
  } catch {
    return null;
  }
}

export function createPageAssetRenderer(opts) {
  return new PageAssetRenderer(opts);
}

export class PageAssetRenderer {
  constructor({ tempStore, config = {} }) {
    const normalized = getDocumentLoadingConfig();
    this.tempStore = tempStore;
    this.config = {
      ...normalized.render,
      ...(config || {}),
    };

    this.bufferCache = new Map();
    this.pdfCache = new Map();
    this.tiffCache = new Map();
    this.workerPool = null;
    this.pdfWorkerPool = null;
    this.renderStats = {
      workerAssetCount: 0,
      workerFallbackCount: 0,
      pdfWorkerCount: 0,
      pdfWorkerFallbackCount: 0,
      pdfWorkerFallbackReasons: {},
      pdfWorkerFallbackSamples: [],
      mainPdfCount: 0,
      mainTiffCount: 0,
      mainImageCount: 0,
    };
    this.rebuildWorkerPool();
  }

  getEffectiveRenderConfig() {
    return resolvePdfRenderConfigForPageCount(
      this.config,
      Math.max(0, Number(this.config.pdfPageCount || this.config.pdfWorkerResolvedPageCount) || 0)
    );
  }

  getWorkerPoolSignature(config = this.config) {
    const effective = resolvePdfRenderConfigForPageCount(
      config,
      Math.max(0, Number(config?.pdfPageCount || config?.pdfWorkerResolvedPageCount) || 0)
    );
    return {
      backend: String(effective.backend || 'hybrid-by-format').toLowerCase(),
      workerCount: Math.max(0, Number(effective.workerCount) || 0),
      pdfWorkerCount: Math.max(0, Number(effective.pdfWorkerCount) || 0),
      useWorkersForTiff: effective.useWorkersForTiff !== false,
      useWorkersForRasterImages: effective.useWorkersForRasterImages !== false,
      pdfToImageMode: String(effective.pdfToImageMode || 'main-thread').toLowerCase(),
      pdfWorkerTaskTimeoutMs: Math.max(0, Number(effective.pdfWorkerTaskTimeoutMs) || 0),
    };
  }

  rebuildWorkerPool() {
    const current = this.workerPool;
    const currentPdf = this.pdfWorkerPool;
    this.workerPool = null;
    this.pdfWorkerPool = null;
    if (current) void current.dispose?.();
    if (currentPdf) void currentPdf.dispose?.();

    const effective = this.getEffectiveRenderConfig();
    const backend = String(effective.backend || 'hybrid-by-format').toLowerCase();
    if (backend === 'main-only') return;

    const workerCount = Math.max(0, Number(effective.workerCount) || 0);
    const pdfWorkerCount = Math.max(0, Number(effective.pdfWorkerCount) || 0);
    if (workerCount <= 0 && pdfWorkerCount <= 0) return;

    const useForTiff = effective.useWorkersForTiff !== false;
    const useForRasterImages = effective.useWorkersForRasterImages !== false;
    if (workerCount > 0 && (useForTiff || useForRasterImages)) {
      this.workerPool = createPageAssetWorkerPool({
        enabled: true,
        workerCount,
        useForTiff,
        useForRasterImages,
      });
    }

    if (String(effective.pdfToImageMode || 'main-thread').toLowerCase() === 'worker' && pdfWorkerCount > 0) {
      this.pdfWorkerPool = createPdfPageWorkerPool({
        enabled: true,
        workerCount: pdfWorkerCount,
        taskTimeoutMs: effective.pdfWorkerTaskTimeoutMs,
      });
    }
  }

  updateConfig(nextConfig = {}) {
    const previousSignature = this.getWorkerPoolSignature();
    this.config = {
      ...this.config,
      ...(nextConfig || {}),
    };
    const nextSignature = this.getWorkerPoolSignature();
    const shouldRebuild = previousSignature.backend !== nextSignature.backend
      || previousSignature.workerCount !== nextSignature.workerCount
      || previousSignature.pdfWorkerCount !== nextSignature.pdfWorkerCount
      || previousSignature.useWorkersForTiff !== nextSignature.useWorkersForTiff
      || previousSignature.useWorkersForRasterImages !== nextSignature.useWorkersForRasterImages
      || previousSignature.pdfToImageMode !== nextSignature.pdfToImageMode
      || previousSignature.pdfWorkerTaskTimeoutMs !== nextSignature.pdfWorkerTaskTimeoutMs;
    if (shouldRebuild) this.rebuildWorkerPool();
  }

  getWorkerCount() {
    return Math.max(
      0,
      Number(this.workerPool?.getWorkerCount?.() || 0),
      Number(this.pdfWorkerPool?.getWorkerCount?.() || 0)
    );
  }

  getPdfWorkerCount() {
    return Math.max(0, Number(this.pdfWorkerPool?.getWorkerCount?.() || 0));
  }

  getStats() {
    return {
      ...this.renderStats,
      pdfWorkerFallbackReasons: { ...this.renderStats.pdfWorkerFallbackReasons },
      pdfWorkerFallbackSamples: this.renderStats.pdfWorkerFallbackSamples.slice(),
      activeWorkerCount: this.getWorkerCount(),
      activePdfWorkerCount: Number(this.pdfWorkerPool?.getWorkerCount?.() || 0),
      activePageAssetWorkerCount: Number(this.workerPool?.getWorkerCount?.() || 0),
    };
  }

  canRenderInWorker(fileExtension, variant) {
    return !!this.workerPool?.canRender?.(fileExtension, variant);
  }

  getBufferCacheLimit() {
    const pdfLimit = Math.max(0, Number(this.config.maxOpenPdfDocuments) || 0);
    const tiffLimit = Math.max(0, Number(this.config.maxOpenTiffDocuments) || 0);
    return Math.max(1, pdfLimit + tiffLimit + 1);
  }

  async dispose() {
    if (this.workerPool) {
      try { await this.workerPool.dispose?.(); } catch {}
      this.workerPool = null;
    }
    if (this.pdfWorkerPool) {
      try { await this.pdfWorkerPool.dispose?.(); } catch {}
      this.pdfWorkerPool = null;
    }

    for (const entry of this.pdfCache.values()) {
      try {
        const doc = await entry.promise;
        await doc?.destroy?.();
      } catch {}
      try { await entry.loadingTask?.destroy?.(); } catch {}
    }
    this.pdfCache.clear();
    this.tiffCache.clear();
    this.bufferCache.clear();
  }

  async getSourceBuffer(sourceKey) {
    const key = String(sourceKey || '');
    if (this.bufferCache.has(key)) {
      touchLru(this.bufferCache, key, this.getBufferCacheLimit());
      return this.bufferCache.get(key);
    }

    const buffer = await this.tempStore.getArrayBuffer(key);
    if (!buffer) throw new Error(`Missing temp-store bytes for source ${key}`);
    setLru(this.bufferCache, key, buffer, this.getBufferCacheLimit());
    return buffer;
  }

  async getPdfDocument(sourceKey) {
    const key = String(sourceKey || '');
    if (!this.pdfCache.has(key)) {
      const buffer = await this.getSourceBuffer(key);
      const loadingTask = pdfjsLib.getDocument(withPdfJsDocumentOptions({ data: buffer.slice(0) }));
      const entry = {
        loadingTask,
        promise: loadingTask.promise,
        async dispose() {
          try {
            const doc = await loadingTask.promise;
            await doc?.destroy?.();
          } catch {}
          try { await loadingTask.destroy?.(); } catch {}
        },
      };
      setLru(this.pdfCache, key, entry, this.config.maxOpenPdfDocuments);
    }
    touchLru(this.pdfCache, key, this.config.maxOpenPdfDocuments);
    return this.pdfCache.get(key).promise;
  }

  async getTiffDocument(sourceKey) {
    const key = String(sourceKey || '');
    if (!this.tiffCache.has(key)) {
      const buffer = await this.getSourceBuffer(key);
      const ifds = decodeUTIF(buffer);
      setLru(this.tiffCache, key, { buffer, ifds, dispose() {} }, this.config.maxOpenTiffDocuments);
    }
    touchLru(this.tiffCache, key, this.config.maxOpenTiffDocuments);
    const entry = this.tiffCache.get(key);
    return { buffer: entry.buffer, ifds: entry.ifds };
  }

  shouldTryWorker(fileExtension, variant) {
    const ext = String(fileExtension || '').toLowerCase();
    const backend = String(this.config.backend || 'hybrid-by-format').toLowerCase();
    if (backend === 'main-only') return false;
    if (!this.workerPool) return false;
    if (ext === 'pdf') return false;
    return this.canRenderInWorker(ext, variant);
  }

  shouldTryPdfWorker() {
    const effective = this.getEffectiveRenderConfig();
    const backend = String(effective.backend || 'hybrid-by-format').toLowerCase();
    if (backend === 'main-only') return false;
    if (String(effective.pdfToImageMode || 'main-thread').toLowerCase() !== 'worker') return false;
    return !!this.pdfWorkerPool?.canRender?.();
  }

  canRenderPdfInWorker() {
    return this.shouldTryPdfWorker();
  }

  canRenderPdfBatchInWorker() {
    return this.shouldTryPdfWorker() && typeof this.pdfWorkerPool?.renderBatch === 'function';
  }

  recordPdfWorkerFallback(error, descriptor, variant) {
    const details = normalizeFallbackDetails(error);
    const reasonKey = details.code || details.message || 'unknown-pdf-worker-fallback';
    this.renderStats.pdfWorkerFallbackReasons[reasonKey] = (
      Number(this.renderStats.pdfWorkerFallbackReasons[reasonKey]) || 0
    ) + 1;

    if (this.renderStats.pdfWorkerFallbackSamples.length >= MAX_FALLBACK_REASON_SAMPLES) return;
    this.renderStats.pdfWorkerFallbackSamples.push({
      reasonKey,
      ...details,
      pageIndex: Math.max(0, Number(descriptor?.pageIndex) || 0),
      originalPageIndex: Number.isFinite(descriptor?.originalPageIndex)
        ? Math.max(0, Number(descriptor.originalPageIndex))
        : undefined,
      sourceKeyPresent: !!descriptor?.sourceKey,
      variant,
    });
  }

  /**
   * Render a PDF page set through the PDF worker pool as one partitioned batch.
   *
   * The caller owns page-state commits. This method only turns descriptors into worker payloads,
   * reports each item as soon as its worker finishes, and returns an aggregate summary. Missing
   * source blobs and worker-side failures are surfaced as item failures so the caller can fall back
   * to the normal per-page path without losing page order.
   *
   * @param {Array<*>} descriptors
   * @param {Object=} options
   * @returns {Promise<{ results:Array<*>, summary:{ itemCount:number, successCount:number, errorCount:number } }>}
   */
  async renderPdfPageAssetBatch(descriptors, options = {}) {
    const variant = options?.variant === 'thumbnail' ? 'thumbnail' : 'full';
    if (!this.canRenderPdfBatchInWorker()) {
      const error = this.pdfWorkerPool?.createUnavailableError?.('No compatible PDF page worker is available')
        || new Error('No compatible PDF page worker is available');
      throw error;
    }

    const safeDescriptors = Array.isArray(descriptors) ? descriptors : [];
    if (!safeDescriptors.length) {
      return { results: [], summary: { itemCount: 0, successCount: 0, errorCount: 0 } };
    }

    const sourceBlobCache = new Map();
    const batchItems = [];
    for (let index = 0; index < safeDescriptors.length; index += 1) {
      const descriptor = safeDescriptors[index] || {};
      const sourceKey = String(descriptor?.sourceKey || '');
      if (!sourceBlobCache.has(sourceKey)) {
        sourceBlobCache.set(sourceKey, await this.tempStore.getBlob(sourceKey));
      }
      const sourceBlob = sourceBlobCache.get(sourceKey);
      if (!sourceBlob) {
        batchItems.push({
          itemId: index,
          missingSource: true,
          payload: {
            sourceKey,
            pageIndex: Math.max(0, Number(descriptor?.pageIndex) || 0),
          },
        });
        continue;
      }

      batchItems.push({
        itemId: index,
        payload: {
          sourceBlob,
          sourceKey,
          pageIndex: Math.max(0, Number(descriptor?.pageIndex) || 0),
          variant,
          thumbnailMaxWidth: options?.thumbnailMaxWidth,
          thumbnailMaxHeight: options?.thumbnailMaxHeight,
          fullPageScale: Number(options?.fullPageScale) || Number(this.config.fullPageScale) || 2.0,
          maxOpenPdfDocuments: Number(this.config.maxOpenPdfDocuments) || 16,
        },
      });
    }

    const results = new Array(safeDescriptors.length);
    const workerCount = Math.max(1, Number(this.pdfWorkerPool?.getWorkerCount?.() || 0) || 1);
    const rendersPerWorker = Math.max(1, Math.min(8, Math.floor(Number(options?.rendersPerWorker) || 1)));
    const onItemResult = (result, slot) => {
      const itemId = Math.max(0, Number(result?.itemId) || 0);
      const descriptor = safeDescriptors[itemId] || {};
      const normalized = result?.ok
        ? {
            ok: true,
            itemId,
            descriptor,
            blob: result.blob,
            width: Math.max(1, Number(result.width) || 1),
            height: Math.max(1, Number(result.height) || 1),
            mimeType: String(result.mimeType || result.blob?.type || 'image/png'),
            durationMs: Math.max(0, Number(result.durationMs) || 0),
            workerSlot: Number(slot),
          }
        : {
            ok: false,
            itemId,
            descriptor,
            durationMs: Math.max(0, Number(result?.durationMs) || 0),
            error: String(result?.error || 'PDF worker batch item failed'),
            errorDetails: result?.errorDetails || null,
            fallbackMainThread: !!result?.fallbackMainThread,
            workerSlot: Number(slot),
          };
      results[itemId] = normalized;
      if (normalized.ok) {
        this.renderStats.pdfWorkerCount += 1;
      } else {
        this.renderStats.pdfWorkerFallbackCount += 1;
        const error = new Error(normalized.error);
        error.fallbackMainThread = !!normalized.fallbackMainThread;
        error.pdfWorkerDetails = normalized.errorDetails || null;
        this.recordPdfWorkerFallback(error, descriptor, variant);
      }
      try { options?.onItemResult?.(normalized, slot); } catch {}
    };

    for (const item of batchItems) {
      if (!item.missingSource) continue;
      onItemResult({
        itemId: item.itemId,
        ok: false,
        error: `Missing source blob for PDF batch render ${item.payload.sourceKey}`,
        durationMs: 0,
      }, -1);
    }

    const runnableItems = batchItems.filter((item) => !item.missingSource);
    const partitions = partitionContiguous(runnableItems, workerCount);
    const summaries = await Promise.all(partitions.map((partition) => this.pdfWorkerPool.renderBatch(partition, {
      concurrency: rendersPerWorker,
      onItemResult,
    })));

    return {
      results,
      summary: summaries.reduce((acc, item) => ({
        itemCount: acc.itemCount + Math.max(0, Number(item?.summary?.itemCount ?? item?.itemCount) || 0),
        successCount: acc.successCount + Math.max(0, Number(item?.summary?.successCount ?? item?.successCount) || 0),
        errorCount: acc.errorCount + Math.max(0, Number(item?.summary?.errorCount ?? item?.errorCount) || 0),
      }), { itemCount: 0, successCount: 0, errorCount: 0 }),
    };
  }

  /**
   * Render one requested page asset. Worker routing is decided per page/source file.
   * A PDF or fallback TIFF does not force unrelated raster files onto the main thread;
   * only the current asset falls back when its own worker path is unavailable.
   *
   * @param {PageDescriptor} descriptor
   * @param {RenderPageAssetOptions} options
   * @returns {Promise<RenderedAsset>}
   */
  async renderPageAsset(descriptor, options) {
    const variant = options?.variant === 'thumbnail' ? 'thumbnail' : 'full';
    const ext = String(descriptor?.fileExtension || '').toLowerCase();

    if (this.shouldTryWorker(ext, variant)) {
      try {
        const sourceBlob = await this.tempStore.getBlob(descriptor.sourceKey);
        if (!sourceBlob) throw new Error(`Missing source blob for worker render ${descriptor.sourceKey}`);
        return await this.workerPool.renderAsset({
          sourceBlob,
          fileExtension: ext,
          pageIndex: Math.max(0, Number(descriptor?.pageIndex) || 0),
          variant,
          thumbnailMaxWidth: options?.thumbnailMaxWidth,
          thumbnailMaxHeight: options?.thumbnailMaxHeight,
          rasterFullPageScale: Number(this.config.fullPageScale) || 2.0,
        }).then((result) => {
          this.renderStats.workerAssetCount += 1;
          return result;
        });
      } catch (error) {
        this.renderStats.workerFallbackCount += 1;
        if (!error?.fallbackMainThread) throw error;
      }
    }

    if (ext === 'pdf') {
      if (this.shouldTryPdfWorker()) {
        try {
          const sourceBlob = await this.tempStore.getBlob(descriptor.sourceKey);
          if (sourceBlob) {
            return await this.pdfWorkerPool.renderAsset({
              sourceBlob,
              sourceKey: String(descriptor?.sourceKey || ''),
              pageIndex: Math.max(0, Number(descriptor?.pageIndex) || 0),
              variant,
              thumbnailMaxWidth: options?.thumbnailMaxWidth,
              thumbnailMaxHeight: options?.thumbnailMaxHeight,
              fullPageScale: Number(options?.fullPageScale) || Number(this.config.fullPageScale) || 2.0,
              maxOpenPdfDocuments: Number(this.config.maxOpenPdfDocuments) || 16,
            }).then((result) => {
              this.renderStats.pdfWorkerCount += 1;
              return result;
            });
          }
        } catch (error) {
          this.renderStats.pdfWorkerFallbackCount += 1;
          this.recordPdfWorkerFallback(error, descriptor, variant);
          // Experimental PDF worker rendering must never make PDF display less reliable than the
          // proven main-thread path. Any worker-side failure is retried below with the existing path.
        }
      }
      this.renderStats.mainPdfCount += 1;
      return this.renderPdfPage(descriptor, {
        variant,
        thumbnailMaxWidth: options?.thumbnailMaxWidth,
        thumbnailMaxHeight: options?.thumbnailMaxHeight,
        fullPageScale: options?.fullPageScale,
      });
    }
    if (ext === 'tif' || ext === 'tiff') {
      this.renderStats.mainTiffCount += 1;
      return this.renderTiffPage(descriptor, {
        variant,
        thumbnailMaxWidth: options?.thumbnailMaxWidth,
        thumbnailMaxHeight: options?.thumbnailMaxHeight,
      });
    }
    this.renderStats.mainImageCount += 1;
    return this.renderImagePage(descriptor, {
      variant,
      thumbnailMaxWidth: options?.thumbnailMaxWidth,
      thumbnailMaxHeight: options?.thumbnailMaxHeight,
    });
  }

  async renderImagePage(descriptor, options) {
    const blob = await this.tempStore.getBlob(descriptor.sourceKey);
    if (!blob) throw new Error(`Missing source blob for image ${descriptor.sourceKey}`);

    if (options.variant === 'full') {
      const decoded = await loadBlobForDrawing(blob);
      try {
        return {
          blob,
          width: decoded.width,
          height: decoded.height,
          mimeType: blob.type || 'application/octet-stream',
        };
      } finally {
        decoded.close();
      }
    }

    const thumb = await scaleBlob(
      blob,
      Math.max(24, Number(options.thumbnailMaxWidth) || this.config.thumbnailMaxWidth),
      Math.max(24, Number(options.thumbnailMaxHeight) || this.config.thumbnailMaxHeight)
    );

    return {
      blob: thumb.blob,
      width: thumb.width,
      height: thumb.height,
      mimeType: thumb.blob.type || 'image/png',
    };
  }

  async renderPdfPage(descriptor, options) {
    const pdf = await this.getPdfDocument(descriptor.sourceKey);
    const pageNumber = Number(descriptor.pageIndex || 0) + 1;
    const page = await pdf.getPage(pageNumber);

    try {
      const baseViewport = page.getViewport({ scale: 1 });
      const targetScale = options.variant === 'thumbnail'
        ? fitScale(
            baseViewport.width,
            baseViewport.height,
            Math.max(24, Number(options.thumbnailMaxWidth) || this.config.thumbnailMaxWidth),
            Math.max(24, Number(options.thumbnailMaxHeight) || this.config.thumbnailMaxHeight)
          )
        : Math.max(0.5, Number(options.fullPageScale) || Number(this.config.fullPageScale) || 2.0);
      const viewport = page.getViewport({ scale: targetScale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Unable to acquire PDF render canvas context');

      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await canvasToBlob(canvas, 'image/png');
      return {
        blob,
        width: canvas.width,
        height: canvas.height,
        mimeType: 'image/png',
      };
    } finally {
      try { page.cleanup(); } catch {}
    }
  }

  async renderTiffPage(descriptor, options) {
    const tiff = await this.getTiffDocument(descriptor.sourceKey);
    const ifd = tiff.ifds[Math.max(0, Number(descriptor.pageIndex) || 0)];
    if (!ifd) throw new Error(`Missing TIFF page ${descriptor.pageIndex} for ${descriptor.sourceKey}`);

    const compressionArr = getTagArray(ifd, 259);
    const compression = compressionArr && compressionArr.length ? (compressionArr[0] >>> 0) : 0;
    if (compression === 6) {
      const jpegBlob = buildOjpegJpeg(tiff.buffer, ifd);
      if (jpegBlob) {
        if (options.variant === 'full') {
          const decoded = await loadBlobForDrawing(jpegBlob);
          try {
            return {
              blob: jpegBlob,
              width: decoded.width,
              height: decoded.height,
              mimeType: 'image/jpeg',
            };
          } finally {
            decoded.close();
          }
        }

        const thumb = await scaleBlob(
          jpegBlob,
          Math.max(24, Number(options.thumbnailMaxWidth) || this.config.thumbnailMaxWidth),
          Math.max(24, Number(options.thumbnailMaxHeight) || this.config.thumbnailMaxHeight)
        );
        return {
          blob: thumb.blob,
          width: thumb.width,
          height: thumb.height,
          mimeType: thumb.blob.type || 'image/png',
        };
      }
    }

    decodeUTIFImage(tiff.buffer, ifd);
    const rgba = toRGBA8(ifd);
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = Math.max(1, ifd.width >>> 0);
    sourceCanvas.height = Math.max(1, ifd.height >>> 0);

    const ctx = sourceCanvas.getContext('2d');
    if (!ctx) throw new Error('Unable to acquire TIFF render canvas context');
    const imageData = ctx.createImageData(sourceCanvas.width, sourceCanvas.height);
    imageData.data.set(rgba);
    ctx.putImageData(imageData, 0, 0);

    if (options.variant === 'full') {
      const blob = await canvasToBlob(sourceCanvas, 'image/png');
      return {
        blob,
        width: sourceCanvas.width,
        height: sourceCanvas.height,
        mimeType: 'image/png',
      };
    }

    const scale = fitScale(
      sourceCanvas.width,
      sourceCanvas.height,
      Math.max(24, Number(options.thumbnailMaxWidth) || this.config.thumbnailMaxWidth),
      Math.max(24, Number(options.thumbnailMaxHeight) || this.config.thumbnailMaxHeight)
    );
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = Math.max(1, Math.round(sourceCanvas.width * scale));
    thumbCanvas.height = Math.max(1, Math.round(sourceCanvas.height * scale));
    const thumbCtx = thumbCanvas.getContext('2d');
    if (!thumbCtx) throw new Error('Unable to acquire TIFF thumbnail canvas context');
    thumbCtx.drawImage(sourceCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
    const thumbBlob = await canvasToBlob(thumbCanvas, 'image/png');
    return {
      blob: thumbBlob,
      width: thumbCanvas.width,
      height: thumbCanvas.height,
      mimeType: thumbBlob.type || 'image/png',
    };
  }
}
