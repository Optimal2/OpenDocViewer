// File: src/workers/pdfPageWorker.js
/**
 * OpenDocViewer - PDF page image worker.
 *
 * This worker is intentionally separate from the raster/TIFF worker so ordinary image rendering
 * does not load pdf.js. It renders one PDF page into an image blob for the modern page-asset
 * pipeline and reports a main-thread fallback when worker-side PDF rendering is not supported.
 */

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';

const workerScope = self;
const MIN_THUMBNAIL_DIMENSION = 24;
const DEFAULT_THUMBNAIL_WIDTH = 220;
const DEFAULT_THUMBNAIL_HEIGHT = 310;

/** @type {Map<string, { loadingTask:any, promise:Promise<any>, dispose:function():Promise<void> }>} */
const pdfCache = new Map();

function createFallbackMainThreadError(message) {
  const error = new Error(message);
  error.fallbackMainThread = true;
  return error;
}

function fitScale(width, height, maxWidth, maxHeight) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const safeMaxWidth = Math.max(1, Number(maxWidth) || safeWidth);
  const safeMaxHeight = Math.max(1, Number(maxHeight) || safeHeight);
  return Math.min(1, safeMaxWidth / safeWidth, safeMaxHeight / safeHeight);
}

function normalizeThumbnailBound(value, fallback) {
  const numericValue = Number(value);
  const resolvedValue = Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback;
  return Math.max(MIN_THUMBNAIL_DIMENSION, resolvedValue);
}

function setLru(map, key, value, limit) {
  map.delete(key);
  map.set(key, value);
  while (map.size > Math.max(1, Number(limit) || 1)) {
    const oldestKey = map.keys().next().value;
    const oldest = map.get(oldestKey);
    map.delete(oldestKey);
    try { void oldest?.dispose?.(); } catch {}
  }
}

function touchLru(map, key, limit) {
  if (!map.has(key)) return;
  const value = map.get(key);
  setLru(map, key, value, limit);
}

function createLocalCanvas(width, height) {
  try {
    if (typeof OffscreenCanvas !== 'function') return null;
    return new OffscreenCanvas(width, height);
  } catch {
    return null;
  }
}

async function canvasToBlob(canvas) {
  if (!canvas || typeof canvas.convertToBlob !== 'function') {
    throw createFallbackMainThreadError('OffscreenCanvas.convertToBlob is unavailable for PDF worker rendering');
  }
  return canvas.convertToBlob({ type: 'image/png' });
}

async function getPdfDocument(sourceBlob, sourceKey, maxOpenPdfDocuments) {
  const key = String(sourceKey || '').trim();
  if (!key) throw createFallbackMainThreadError('PDF worker payload is missing a sourceKey');

  if (!pdfCache.has(key)) {
    const buffer = await sourceBlob.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({
      data: buffer,
      disableWorker: true,
    });
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
    setLru(pdfCache, key, entry, maxOpenPdfDocuments);
  }

  touchLru(pdfCache, key, maxOpenPdfDocuments);
  return pdfCache.get(key).promise;
}

async function renderPdfPageAsset(payload) {
  if (!(payload?.sourceBlob instanceof Blob)) {
    throw createFallbackMainThreadError('PDF worker payload is missing sourceBlob');
  }
  const variant = String(payload?.variant || 'full').toLowerCase() === 'thumbnail' ? 'thumbnail' : 'full';
  const maxOpenPdfDocuments = Math.max(1, Number(payload?.maxOpenPdfDocuments) || 1);
  const pdf = await getPdfDocument(payload.sourceBlob, payload.sourceKey, maxOpenPdfDocuments);
  const pageNumber = Math.max(1, Math.floor(Number(payload?.pageIndex) || 0) + 1);
  const page = await pdf.getPage(pageNumber);

  try {
    const baseViewport = page.getViewport({ scale: 1 });
    const targetScale = variant === 'thumbnail'
      ? fitScale(
          baseViewport.width,
          baseViewport.height,
          normalizeThumbnailBound(payload?.thumbnailMaxWidth, DEFAULT_THUMBNAIL_WIDTH),
          normalizeThumbnailBound(payload?.thumbnailMaxHeight, DEFAULT_THUMBNAIL_HEIGHT)
        )
      : Math.max(0.5, Number(payload?.fullPageScale) || 2.0);
    const viewport = page.getViewport({ scale: targetScale });
    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));
    const canvas = createLocalCanvas(width, height);
    if (!canvas) {
      throw createFallbackMainThreadError('OffscreenCanvas is unavailable for PDF worker rendering');
    }
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw createFallbackMainThreadError('Failed to acquire OffscreenCanvas context for PDF worker rendering');
    }

    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await canvasToBlob(canvas);
    return {
      blob,
      width,
      height,
      mimeType: blob.type || 'image/png',
    };
  } finally {
    try { page.cleanup(); } catch {}
  }
}

workerScope.onmessage = async (event) => {
  const data = event?.data || {};
  if (data?.type !== 'renderPdfPageAsset') return;
  const taskId = Number(data?.taskId || 0);

  try {
    const rendered = await renderPdfPageAsset(data?.payload || {});
    workerScope.postMessage({
      type: 'renderPdfPageAssetResult',
      taskId,
      ok: true,
      blob: rendered.blob,
      width: rendered.width,
      height: rendered.height,
      mimeType: rendered.mimeType,
    });
  } catch (error) {
    workerScope.postMessage({
      type: 'renderPdfPageAssetResult',
      taskId,
      ok: false,
      error: String(error?.message || error),
      fallbackMainThread: true,
    });
  }
};
