// File: src/workers/imageWorker.js
/**
 * OpenDocViewer — image / TIFF worker.
 *
 * The worker supports two protocols:
 * 1. legacy batch messages from the historical eager loader,
 * 2. the newer `renderPageAsset` protocol used by `pageAssetWorkerPool`.
 *
 * That lets the modern hybrid pipeline reuse the proven TIFF/raster worker code without breaking
 * older tooling or test harnesses that still speak the original batch format.
 */

/** @type {(ServiceWorkerGlobalScope|DedicatedWorkerGlobalScope|SharedWorkerGlobalScope|*)} */
const workerScope = self;

/** @type {(null|{ decode:function(ArrayBuffer):Array<any>, decodeImage:function(ArrayBuffer, any):void, toRGBA8:function(any):Uint8Array })} */
let utifModule = null;
/** @type {(Promise<any>|null)} */
let utifPromise = null;

// TIFF Tag 259 (Compression): value 34712 indicates JPEG 2000 compression. We route those pages
// back to the main-thread fallback because worker-side decode support is not reliable enough across
// the TIFF variants seen in production.
const COMPRESSION_JPEG2000 = 34712;
const MIN_THUMBNAIL_DIMENSION = 24;
const DEFAULT_THUMBNAIL_WIDTH = 220;
const DEFAULT_THUMBNAIL_HEIGHT = 310;

function normalizeThumbnailBound(value, fallback) {
  const numericValue = Number(value);
  const resolvedValue = Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback;
  return Math.max(MIN_THUMBNAIL_DIMENSION, resolvedValue);
}

/**
 * Creates an error that tells the caller this worker path is unsupported and should be retried on
 * the main thread. The custom `fallbackMainThread` flag is intentional: upstream code checks for
 * that marker to distinguish expected capability fallbacks from real hard failures.
 *
 * @param {string} message
 * @returns {Error}
 */
function createFallbackMainThreadError(message) {
  const error = new Error(message);
  error.fallbackMainThread = true;
  return error;
}

function createLocalCanvas(w, h) {
  try {
    if (typeof OffscreenCanvas !== 'function') return null;
    return new OffscreenCanvas(w, h);
  } catch {
    return null;
  }
}

function mimeFromExt(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  if (e === 'png') return 'image/png';
  if (e === 'webp') return 'image/webp';
  if (e === 'gif') return 'image/gif';
  if (e === 'bmp') return 'image/bmp';
  if (e === 'avif') return 'image/avif';
  if (e === 'tif' || e === 'tiff') return 'image/tiff';
  return `image/${e || 'octet-stream'}`;
}

function normalizeExtension(ext) {
  const value = String(ext || '').toLowerCase().replace(/^\./, '');
  if (value === 'jpeg') return 'jpg';
  if (value === 'tif') return 'tiff';
  return value;
}

function fitScale(width, height, maxWidth, maxHeight) {
  const numericWidth = Number(width);
  const numericHeight = Number(height);
  const numericMaxWidth = Number(maxWidth);
  const numericMaxHeight = Number(maxHeight);
  const safeWidth = Number.isFinite(numericWidth) && numericWidth > 0 ? numericWidth : 1;
  const safeHeight = Number.isFinite(numericHeight) && numericHeight > 0 ? numericHeight : 1;
  // Missing or non-positive max bounds are treated as "use the intrinsic dimension" so they do
  // not accidentally force the asset down to 1 px during worker-side scaling.
  const safeMaxWidth = Number.isFinite(numericMaxWidth) && numericMaxWidth > 0 ? numericMaxWidth : safeWidth;
  const safeMaxHeight = Number.isFinite(numericMaxHeight) && numericMaxHeight > 0 ? numericMaxHeight : safeHeight;
  return Math.min(1, safeMaxWidth / safeWidth, safeMaxHeight / safeHeight);
}

async function ensureUtif() {
  if (utifModule) return utifModule;
  if (!utifPromise) {
    utifPromise = import('utif2').then((mod) => {
      utifModule = mod;
      return mod;
    });
  }
  return utifPromise;
}

async function createBitmap(blob) {
  if (typeof createImageBitmap !== 'function') {
    throw createFallbackMainThreadError('createImageBitmap is unavailable in this worker');
  }
  return createImageBitmap(blob);
}

async function canvasToBlob(canvas, mimeType = 'image/png', quality) {
  if (!canvas || typeof canvas.convertToBlob !== 'function') {
    throw createFallbackMainThreadError('OffscreenCanvas.convertToBlob is unavailable in this worker');
  }
  return canvas.convertToBlob({ type: mimeType, quality });
}

async function scaleBlob(blob, maxWidth, maxHeight) {
  const bitmap = await createBitmap(blob);
  try {
    const scale = fitScale(bitmap.width, bitmap.height, maxWidth, maxHeight);
    const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
    const targetHeight = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = createLocalCanvas(targetWidth, targetHeight);
    if (!canvas) throw createFallbackMainThreadError('OffscreenCanvas is unavailable in this worker');
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw createFallbackMainThreadError('Failed to acquire OffscreenCanvas context');
    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    const outBlob = await canvasToBlob(canvas, 'image/png');
    return {
      blob: outBlob,
      width: targetWidth,
      height: targetHeight,
      mimeType: outBlob.type || 'image/png',
    };
  } finally {
    try { bitmap.close(); } catch {}
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

    const minLen = Math.min(t273.length, t279.length);
    let totalScanLen = 0;
    for (let i = 0; i < minLen; i += 1) totalScanLen += (t279[i] >>> 0);
    const scanAll = new Uint8Array(totalScanLen);
    let cursor = 0;
    for (let i = 0; i < minLen; i += 1) {
      const offset = t273[i] >>> 0;
      const len = t279[i] >>> 0;
      scanAll.set(bytes.subarray(offset, offset + len), cursor);
      cursor += len;
    }
    parts.push(scanAll);

    let totalLen = 0;
    for (const part of parts) totalLen += part.byteLength;
    const out = new Uint8Array(totalLen);
    let outOffset = 0;
    for (const part of parts) {
      out.set(part, outOffset);
      outOffset += part.byteLength;
    }

    return new Blob([out], { type: 'image/jpeg' });
  } catch {
    return null;
  }
}

async function renderRasterAsset(sourceBlob, fileExtension, variant, thumbnailMaxWidth, thumbnailMaxHeight) {
  const ext = normalizeExtension(fileExtension);
  const maxThumbnailWidth = normalizeThumbnailBound(thumbnailMaxWidth, DEFAULT_THUMBNAIL_WIDTH);
  const maxThumbnailHeight = normalizeThumbnailBound(thumbnailMaxHeight, DEFAULT_THUMBNAIL_HEIGHT);
  if (variant === 'full') {
    // Intentional decode: the worker still needs trustworthy intrinsic dimensions for layout/math
    // metadata, and the Blob alone does not expose width/height in a cross-format way.
    const bitmap = await createBitmap(sourceBlob);
    try {
      return {
        blob: sourceBlob,
        width: Math.max(1, bitmap.width || 1),
        height: Math.max(1, bitmap.height || 1),
        mimeType: sourceBlob.type || mimeFromExt(ext),
      };
    } finally {
      try { bitmap.close(); } catch {}
    }
  }

  return scaleBlob(
    sourceBlob,
    maxThumbnailWidth,
    maxThumbnailHeight
  );
}

async function renderTiffAsset(sourceBlob, pageIndex, variant, thumbnailMaxWidth, thumbnailMaxHeight) {
  const maxThumbnailWidth = normalizeThumbnailBound(thumbnailMaxWidth, DEFAULT_THUMBNAIL_WIDTH);
  const maxThumbnailHeight = normalizeThumbnailBound(thumbnailMaxHeight, DEFAULT_THUMBNAIL_HEIGHT);
  const { decode, decodeImage, toRGBA8 } = await ensureUtif();
  const arrayBuffer = await sourceBlob.arrayBuffer();
  const ifds = decode(arrayBuffer);
  const ifd = ifds[Math.max(0, Number(pageIndex) || 0)];
  if (!ifd) throw new Error(`Missing TIFF page ${pageIndex}`);

  const compressionArr = getTagArray(ifd, 259);
  const compression = compressionArr && compressionArr.length ? (compressionArr[0] >>> 0) : 0;
  if (compression === COMPRESSION_JPEG2000) {
    throw createFallbackMainThreadError(`TIFF JPEG 2000 compression (type ${COMPRESSION_JPEG2000}) requires main-thread fallback`);
  }

  if (compression === 6) {
    const jpegBlob = buildOjpegJpeg(arrayBuffer, ifd);
    if (jpegBlob) {
      if (variant === 'full') {
        return {
          blob: jpegBlob,
          width: Math.max(1, Number(ifd.width) || 1),
          height: Math.max(1, Number(ifd.height) || 1),
          mimeType: 'image/jpeg',
        };
      }
      return scaleBlob(
        jpegBlob,
        maxThumbnailWidth,
        maxThumbnailHeight
      );
    }
  }

  decodeImage(arrayBuffer, ifd);
  const rgba = toRGBA8(ifd);
  const width = Math.max(1, ifd.width >>> 0);
  const height = Math.max(1, ifd.height >>> 0);
  const canvas = createLocalCanvas(width, height);
  if (!canvas) {
    throw createFallbackMainThreadError('OffscreenCanvas is unavailable for TIFF rendering');
  }

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) {
    throw createFallbackMainThreadError('Failed to acquire OffscreenCanvas context for TIFF rendering');
  }

  // Intentional zero-copy view over the UTIF RGBA buffer. The worker does not mutate `rgba` after
  // ImageData creation, so avoiding a defensive copy keeps TIFF rendering faster and lowers peak
  // memory pressure for large pages. The named view makes that ownership assumption explicit.
  const clampedRgbaView = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  const imageData = new ImageData(clampedRgbaView, width, height);
  ctx.putImageData(imageData, 0, 0);

  if (variant === 'full') {
    const blob = await canvasToBlob(canvas, 'image/png');
    return {
      blob,
      width,
      height,
      mimeType: blob.type || 'image/png',
    };
  }

  const targetScale = fitScale(width, height, maxThumbnailWidth, maxThumbnailHeight);
  const scaledWidth = Math.max(1, Math.round(width * targetScale));
  const scaledHeight = Math.max(1, Math.round(height * targetScale));
  const scaledCanvas = createLocalCanvas(scaledWidth, scaledHeight);
  if (!scaledCanvas) {
    throw createFallbackMainThreadError('OffscreenCanvas is unavailable for TIFF thumbnail rendering');
  }
  const scaledCtx = scaledCanvas.getContext('2d', { alpha: true });
  if (!scaledCtx) {
    throw createFallbackMainThreadError('Failed to acquire OffscreenCanvas context for TIFF thumbnail rendering');
  }
  scaledCtx.drawImage(canvas, 0, 0, scaledWidth, scaledHeight);
  const outBlob = await canvasToBlob(scaledCanvas, 'image/png');
  return {
    blob: outBlob,
    width: scaledWidth,
    height: scaledHeight,
    mimeType: outBlob.type || 'image/png',
  };
}

async function renderPageAssetPayload(payload) {
  const ext = normalizeExtension(payload?.fileExtension);
  const variant = String(payload?.variant || 'full').toLowerCase() === 'thumbnail' ? 'thumbnail' : 'full';
  const sourceBlob = payload?.sourceBlob;
  if (!(sourceBlob instanceof Blob)) throw new Error('Worker payload is missing sourceBlob');

  if (ext === 'tiff') {
    return renderTiffAsset(
      sourceBlob,
      Math.max(0, Number(payload?.pageIndex) || 0),
      variant,
      payload?.thumbnailMaxWidth,
      payload?.thumbnailMaxHeight
    );
  }

  return renderRasterAsset(
    sourceBlob,
    ext,
    variant,
    payload?.thumbnailMaxWidth,
    payload?.thumbnailMaxHeight
  );
}

function postMainThreadFallback(jobs, fileExtension) {
  const safeJobs = jobs.map((job) => ({
    fileIndex: job.index,
    pageIndex: job.pageStartIndex || 0,
    pageStartIndex: job.pageStartIndex || 0,
    pagesInvolved: job.pagesInvolved || 1,
    fileExtension,
    allPagesIndex: job.allPagesStartingIndex,
    handleInMainThread: true,
    sourceUrl: job.sourceUrl || null,
  }));
  workerScope.postMessage({ jobs: safeJobs, fileExtension, handleInMainThread: true });
}

async function processTiff(jobs, jobResults) {
  let decode;
  try {
    ({ decode } = await ensureUtif());
  } catch {
    postMainThreadFallback(jobs, 'tiff');
    return;
  }

  for (const job of jobs) {
    try {
      const ifds = decode(job.arrayBuffer);
      const start = Math.max(0, Number(job.pageStartIndex) || 0);
      const count = Math.max(1, Number(job.pagesInvolved) || 1);
      const end = Math.min(ifds.length, start + count);

      let requiresMainThread = false;
      for (let i = start; i < end; i += 1) {
        const compArr = getTagArray(ifds[i], 259);
        const comp = compArr && compArr.length ? (compArr[0] >>> 0) : 0;
        if (comp === COMPRESSION_JPEG2000) {
          requiresMainThread = true;
          break;
        }
      }
      if (requiresMainThread) {
        postMainThreadFallback([job], 'tiff');
        continue;
      }

      for (let i = start; i < end; i += 1) {
        try {
          const blob = new Blob([job.arrayBuffer], { type: 'image/tiff' });
          const rendered = await renderTiffAsset(blob, i, 'full');
          jobResults.push({
            blob: rendered.blob,
            fileIndex: job.index,
            pageIndex: i,
            fileExtension: 'tiff',
            allPagesIndex: job.allPagesStartingIndex + (i - start),
            sourceUrl: job.sourceUrl || null,
          });
        } catch (error) {
          if (error?.fallbackMainThread) {
            postMainThreadFallback([job], 'tiff');
            break;
          }
          throw error;
        }
      }
    } finally {
      job.arrayBuffer = null;
    }
  }
}

async function processImage(jobs, fileExtensionLower, jobResults) {
  const mimeType = mimeFromExt(fileExtensionLower);
  for (const job of jobs) {
    try {
      const blob = new Blob([job.arrayBuffer], { type: mimeType });
      jobResults.push({
        blob,
        fileIndex: job.index,
        pageIndex: 0,
        fileExtension: fileExtensionLower,
        allPagesIndex: job.allPagesStartingIndex,
        sourceUrl: job.sourceUrl || null,
      });
    } finally {
      job.arrayBuffer = null;
    }
  }
}

async function handleLegacyBatchMessage(event) {
  const { jobs, fileExtension } = event.data || {};
  if (!Array.isArray(jobs) || jobs.length === 0) return;

  const fileExtLower = normalizeExtension(fileExtension);
  try {
    const jobResults = [];
    if (fileExtLower === 'tiff') await processTiff(jobs, jobResults);
    else await processImage(jobs, fileExtLower, jobResults);
    workerScope.postMessage({ jobs: jobResults, fileExtension });
  } catch (error) {
    const safeJobs = jobs.map((job) => ({
      fileIndex: job.index,
      pageIndex: job.pageStartIndex || 0,
      pageStartIndex: job.pageStartIndex || 0,
      pagesInvolved: job.pagesInvolved || 1,
      fileExtension: job.fileExtension || fileExtension,
      allPagesIndex: job.allPagesStartingIndex,
      handleInMainThread: true,
      sourceUrl: job.sourceUrl || null,
    }));
    workerScope.postMessage({
      error: String(error?.message || error),
      jobs: safeJobs,
      handleInMainThread: true,
    });
  }
}

async function handleRenderPageAssetMessage(data) {
  const taskId = Number(data?.taskId || 0);
  try {
    const rendered = await renderPageAssetPayload(data?.payload || {});
    workerScope.postMessage({
      type: 'renderPageAssetResult',
      taskId,
      ok: true,
      blob: rendered.blob,
      width: rendered.width,
      height: rendered.height,
      mimeType: rendered.mimeType,
    });
  } catch (error) {
    workerScope.postMessage({
      type: 'renderPageAssetResult',
      taskId,
      ok: false,
      error: String(error?.message || error),
      fallbackMainThread: !!error?.fallbackMainThread,
    });
  }
}

workerScope.onmessage = async (event) => {
  const data = event?.data || {};
  if (data?.type === 'renderPageAsset') {
    await handleRenderPageAssetMessage(data);
    return;
  }
  await handleLegacyBatchMessage(event);
};
