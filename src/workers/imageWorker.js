// File: src/workers/imageWorker.js
/* eslint-disable no-restricted-globals */
/**
 * OpenDocViewer — Image/ TIFF Worker
 *
 * PURPOSE
 *   - Decode and transcode document page sources off the main thread.
 *   - For TIFF: decode pages using `utif2`, paint to an OffscreenCanvas, and return PNG blobs.
 *   - For single-frame images (png/jpg/webp/gif/bmp): wrap incoming bytes in a Blob and return.
 *
 * DESIGN NOTES / GOTCHAS
 *   - This worker prefers OffscreenCanvas. If it's unavailable (older Safari/Firefox Workers),
 *     TIFF jobs are bounced back to the main thread (`handleInMainThread: true`) to avoid hard crashes.
 *   - We NEVER post large ArrayBuffers back to the main thread on failure; instead we send small
 *     descriptors so the main thread can decide what to do (e.g., load on main thread).
 *   - We reuse a single OffscreenCanvas between pages to reduce allocations when decoding TIFFs.
 *   - Result objects include `allPagesIndex` so the UI can place pages in the correct global order.
 *
 * PERFORMANCE HINTS
 *   - Creating a `Uint8ClampedArray` view over the TIFF RGBA buffer avoids an extra copy.
 *   - `convertToBlob` on OffscreenCanvas is async and keeps memory pressure lower than toDataURL.
 *
 * Provenance / source reference: :contentReference[oaicite:0]{index=0}
 */

/**
 * @typedef {Object} WorkerJob
 * @property {ArrayBuffer} arrayBuffer             Raw bytes for this file
 * @property {string}      fileExtension           Source file extension (e.g., 'pdf','tiff','png')
 * @property {number}      index                   Index of the source file within the batch
 * @property {(number|undefined)} pageStartIndex   For multi-page formats, first page in this slice (default 0)
 * @property {(number|undefined)} pagesInvolved    Number of pages to process from pageStartIndex (default 1)
 * @property {number}      allPagesStartingIndex   Global start index for output pages
 */

/**
 * @typedef {Object} WorkerResult
 * @property {(Blob|undefined)}   blob             Resulting raster image (PNG for TIFF, or original type)
 * @property {number}             fileIndex        Job's file index (1:1 with input)
 * @property {number}             pageIndex        Page number within the source file
 * @property {string}             fileExtension    Normalized extension of the produced blob
 * @property {number}             allPagesIndex    Global page index for placement
 * @property {(boolean|undefined)} handleInMainThread  True if worker cannot process (fallback hint)
 */

// --- Worker global -----------------------------------------------------------

/** @type {(ServiceWorkerGlobalScope|DedicatedWorkerGlobalScope|SharedWorkerGlobalScope|*)} */
const ctx = self;

// --- Shared OffscreenCanvas cache -------------------------------------------

/** @type {OffscreenCanvas|null} */
let sharedCanvas = null;
/** @type {OffscreenCanvasRenderingContext2D|null} */
let sharedCtx = null;

/**
 * Get (or create) a 2D rendering context backed by a shared OffscreenCanvas.
 * Returns null if OffscreenCanvas or 2D context are unsupported in this worker.
 * @param {number} w
 * @param {number} h
 * @returns {(OffscreenCanvasRenderingContext2D|null)}
 */
function getCanvas(w, h) {
  try {
    if (typeof OffscreenCanvas !== 'function') return null;
    if (!sharedCanvas || sharedCanvas.width !== w || sharedCanvas.height !== h) {
      sharedCanvas = new OffscreenCanvas(w, h);
      sharedCtx = sharedCanvas.getContext('2d');
    }
    return sharedCtx;
  } catch {
    return null;
  }
}

/**
 * Normalize an extension to a MIME type for Blob construction.
 * @param {string} ext
 * @returns {string}
 */
function mimeFromExt(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  if (e === 'png') return 'image/png';
  if (e === 'webp') return 'image/webp';
  if (e === 'gif') return 'image/gif';
  if (e === 'bmp') return 'image/bmp';
  if (e === 'tif' || e === 'tiff') return 'image/tiff';
  return `image/${e || 'octet-stream'}`;
}

/**
 * Post a "handle in main thread" result for each job (used when we lack capabilities).
 * @param {Array.<WorkerJob>} jobs
 * @param {string} fileExtension
 * @returns {void}
 */
function postMainThreadFallback(jobs, fileExtension) {
  const safeJobs = jobs.map((j) => ({
    fileIndex: j.index,
    pageIndex: j.pageStartIndex || 0,
    fileExtension,
    allPagesIndex: j.allPagesStartingIndex,
    handleInMainThread: true,
  }));
  ctx.postMessage({ jobs: safeJobs, fileExtension });
}

/**
 * Main message handler.
 * @param {MessageEvent} event
 * @returns {void}
 */
ctx.onmessage = async (event) => {
  const { jobs, fileExtension } = event.data || {};
  if (!Array.isArray(jobs) || jobs.length === 0) return;

  const fileExtLower = String(fileExtension || '').toLowerCase();

  try {
    const jobResults = [];

    if (fileExtLower === 'tiff' || fileExtLower === 'tif') {
      // TIFF needs canvas to re-encode to PNG. If unsupported, bounce to main thread.
      const can = getCanvas(1, 1);
      if (!can) {
        postMainThreadFallback(jobs, fileExtension || 'tiff');
        return;
      }
      await processTiff(jobs, jobResults);
    } else {
      await processImage(jobs, fileExtLower, jobResults);
    }

    ctx.postMessage({ jobs: jobResults, fileExtension });
  } catch (error) {
    // On any unexpected failure, avoid posting large buffers back.
    const safeJobs = jobs.map((j) => ({
      fileIndex: j.index,
      pageIndex: j.pageStartIndex || 0,
      fileExtension: j.fileExtension || fileExtension,
      allPagesIndex: j.allPagesStartingIndex,
      handleInMainThread: true,
    }));
    ctx.postMessage({ error: String(error?.message || error), jobs: safeJobs });
  }
};

// --- TIFF processing ---------------------------------------------------------

/**
 * Decode TIFF pages using utif2, draw to OffscreenCanvas, and return PNG blobs.
 * Falls back to main thread if utif2 cannot be imported at runtime.
 * @param {Array.<WorkerJob>} jobs
 * @param {Array.<WorkerResult>} jobResults
 * @returns {Promise.<void>}
 */
async function processTiff(jobs, jobResults) {
  let decode, toRGBA8, decodeImage;
  try {
    ({ decode, toRGBA8, decodeImage } = await import('utif2'));
  } catch (e) {
    // If the module isn't available in this environment, hand off to main thread.
    postMainThreadFallback(jobs, 'tiff');
    return;
  }

  for (const job of jobs) {
    try {
      const ifds = decode(job.arrayBuffer);

      const start = job.pageStartIndex || 0;
      const count = Math.max(1, job.pagesInvolved || 1);
      const end = Math.min(ifds.length, start + count);

      for (let i = start; i < end; i++) {
        const ifd = ifds[i];

        decodeImage(job.arrayBuffer, ifd);
        const rgba = toRGBA8(ifd); // Uint8Array (R,G,B,A)

        const w = ifd.width >>> 0;
        const h = ifd.height >>> 0;
        const ctx2d = getCanvas(w, h);
        if (!sharedCanvas || !ctx2d) {
          // Lost canvas or unsupported: bounce the rest to main thread.
          postMainThreadFallback([job], 'tiff');
          break;
        }

        // Paint decoded RGBA directly (no extra copy)
        const clamped = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
        const imageData = new ImageData(clamped, w, h);
        ctx2d.putImageData(imageData, 0, 0);

        // Prefer PNG for universal support (TIFF → PNG)
        let blob;
        try {
          blob = await sharedCanvas.convertToBlob({ type: 'image/png' });
        } catch {
          // Very old engines may not support convertToBlob; try a lossy fallback to JPEG.
          try {
            blob = await sharedCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
          } catch (e2) {
            // Give up and ask main thread to handle this page.
            postMainThreadFallback([job], 'tiff');
            break;
          }
        }

        jobResults.push({
          blob,
          fileIndex: job.index,
          pageIndex: i,
          fileExtension: 'tiff',
          allPagesIndex: job.allPagesStartingIndex + (i - start),
        });
      }
    } finally {
      // Help GC: drop large buffer reference ASAP
      job.arrayBuffer = null;
    }
  }
}

// --- Single-image processing -------------------------------------------------

/**
 * Wrap single-frame image bytes in a Blob (no decoding work needed here).
 * @param {Array.<WorkerJob>} jobs
 * @param {string} fileExtensionLower
 * @param {Array.<WorkerResult>} jobResults
 * @returns {Promise.<void>}
 */
async function processImage(jobs, fileExtensionLower, jobResults) {
  const mime = mimeFromExt(fileExtensionLower);

  for (const job of jobs) {
    try {
      const blob = new Blob([job.arrayBuffer], { type: mime });

      jobResults.push({
        blob,
        fileIndex: job.index,
        pageIndex: 0,
        fileExtension: fileExtensionLower,
        allPagesIndex: job.allPagesStartingIndex,
      });
    } finally {
      // Always drop the reference—even on failure—to reduce memory pressure.
      job.arrayBuffer = null;
    }
  }
}
/* eslint-enable no-restricted-globals */
