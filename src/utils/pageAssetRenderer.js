// File: src/utils/pageAssetRenderer.js
/**
 * OpenDocViewer — hybrid page-asset renderer.
 *
 * The renderer keeps the modern temp-store / placeholder architecture from `main`, but routes raster
 * and TIFF work through dedicated workers when that is beneficial and supported. PDF rendering stays
 * on the pdf.js path.
 */

import { decode as decodeUTIF, decodeImage as decodeUTIFImage, toRGBA8 } from 'utif2';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { getDocumentLoadingConfig } from './documentLoadingConfig.js';
import { createPageAssetWorkerPool } from './pageAssetWorkerPool.js';

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

function canvasToBlob(canvas, mimeType = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas serialization failed'));
    }, mimeType, quality);
  });
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
    const t513 = getTagArray(ifd, 513);
    const t514 = getTagArray(ifd, 514);
    const t273 = getTagArray(ifd, 273);
    const t279 = getTagArray(ifd, 279);
    if (!t513 || !t514 || !t273 || !t279) return null;

    const tablesOffset = t513[0] >>> 0;
    const tablesLen = t514[0] >>> 0;
    if (!tablesLen) return null;

    const bytes = new Uint8Array(arrayBuffer);
    const parts = [bytes.subarray(tablesOffset, tablesOffset + tablesLen)];

    let totalScanLen = 0;
    for (let i = 0; i < t273.length && i < t279.length; i += 1) totalScanLen += (t279[i] >>> 0);
    const scanAll = new Uint8Array(totalScanLen);
    let cursor = 0;
    for (let i = 0; i < t273.length && i < t279.length; i += 1) {
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
    this.rebuildWorkerPool();
  }

  rebuildWorkerPool() {
    const current = this.workerPool;
    this.workerPool = null;
    if (current) void current.dispose?.();

    const backend = String(this.config.backend || 'hybrid-by-format').toLowerCase();
    if (backend === 'main-only') return;

    const workerCount = Math.max(0, Number(this.config.workerCount) || 0);
    if (workerCount <= 0) return;

    this.workerPool = createPageAssetWorkerPool({
      enabled: true,
      workerCount,
      useForTiff: this.config.useWorkersForTiff !== false,
      useForRasterImages: this.config.useWorkersForRasterImages !== false,
    });
  }

  updateConfig(nextConfig = {}) {
    const previousWorkerCount = this.getWorkerCount();
    this.config = {
      ...this.config,
      ...(nextConfig || {}),
    };
    const nextWorkerCount = Math.max(0, Number(this.config.workerCount) || 0);
    const shouldRebuild = previousWorkerCount !== nextWorkerCount
      || !this.workerPool
      || String(this.config.backend || '').toLowerCase() === 'main-only';
    if (shouldRebuild) this.rebuildWorkerPool();
  }

  getWorkerCount() {
    return Math.max(0, Number(this.workerPool?.getWorkerCount?.() || 0));
  }

  canRenderInWorker(fileExtension, variant) {
    return !!this.workerPool?.canRender?.(fileExtension, variant);
  }

  async dispose() {
    if (this.workerPool) {
      try { await this.workerPool.dispose?.(); } catch {}
      this.workerPool = null;
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
      const buffer = this.bufferCache.get(key);
      this.bufferCache.delete(key);
      this.bufferCache.set(key, buffer);
      return buffer;
    }

    const buffer = await this.tempStore.getArrayBuffer(key);
    if (!buffer) throw new Error(`Missing temp-store bytes for source ${key}`);
    this.bufferCache.set(key, buffer);
    while (this.bufferCache.size > Math.max(this.config.maxOpenPdfDocuments, this.config.maxOpenTiffDocuments) + 1) {
      const oldestKey = this.bufferCache.keys().next().value;
      this.bufferCache.delete(oldestKey);
    }
    return buffer;
  }

  async getPdfDocument(sourceKey) {
    const key = String(sourceKey || '');
    if (!this.pdfCache.has(key)) {
      const buffer = await this.getSourceBuffer(key);
      const loadingTask = pdfjsLib.getDocument({ data: buffer.slice(0) });
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
          rasterFullPageScale: Number(this.config.fullPageScale) || 1.5,
        });
      } catch (error) {
        if (!error?.fallbackMainThread) throw error;
      }
    }

    if (ext === 'pdf') {
      return this.renderPdfPage(descriptor, {
        variant,
        thumbnailMaxWidth: options?.thumbnailMaxWidth,
        thumbnailMaxHeight: options?.thumbnailMaxHeight,
      });
    }
    if (ext === 'tif' || ext === 'tiff') {
      return this.renderTiffPage(descriptor, {
        variant,
        thumbnailMaxWidth: options?.thumbnailMaxWidth,
        thumbnailMaxHeight: options?.thumbnailMaxHeight,
      });
    }
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
        : Math.max(0.5, Number(this.config.fullPageScale) || 1.5);
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
