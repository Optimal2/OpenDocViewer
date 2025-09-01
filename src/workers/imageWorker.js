// File: src/workers/imageWorker.js
/* eslint-disable no-restricted-globals */
/**
 * OpenDocViewer — Image/ TIFF Worker
 *
 * PURPOSE
 *   - Decode and transcode document page sources off the main thread.
 *   - For TIFF:
 *       * Fast path for legacy OJPEG (Compression=6): extract embedded JPEG and return as Blob
 *         (no RGBA decode, no canvas).
 *       * Otherwise: decode pages using `utif2`, paint to an OffscreenCanvas, and return PNG blobs.
 *   - For single-frame images (png/jpg/webp/gif/bmp): wrap incoming bytes in a Blob and return.
 *
 * DESIGN NOTES / GOTCHAS
 *   - We prefer OffscreenCanvas for non-OJPEG TIFF pages. If it's unavailable (older Safari/Firefox
 *     Workers), non-OJPEG TIFF jobs are bounced back to the main thread (`handleInMainThread: true`)
 *     to avoid crashes. OJPEG pages do not require a canvas and are handled in-worker.
 *   - We NEVER post large ArrayBuffers back to the main thread on failure; instead we send small
 *     descriptors so the main thread can decide what to do (e.g., load on main thread).
 *   - We reuse a single OffscreenCanvas between pages to reduce allocations when decoding TIFFs.
 *   - Result objects include `allPagesIndex` so the UI can place pages in the correct global order.
 *
 * PERFORMANCE HINTS
 *   - For OJPEG we avoid any pixel expansion: we simply concatenate the tables (t513/t514) + scan
 *     strips (t273/t279) to form a standard JPEG stream—very fast and memory-light.
 *   - Creating a `Uint8ClampedArray` over the TIFF RGBA buffer avoids an extra copy.
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
 * @property {(string|undefined)} sourceUrl        Optional original URL (for main-thread refetch)
 */

/**
 * @typedef {Object} WorkerResult
 * @property {(Blob|undefined)}   blob             Resulting raster image (PNG for TIFF, or original type)
 * @property {number}             fileIndex        Job's file index (1:1 with input)
 * @property {number}             pageIndex        Page number within the source file
 * @property {string}             fileExtension    Normalized extension of the produced blob
 * @property {number}             allPagesIndex    Global page index for placement
 * @property {(boolean|undefined)} handleInMainThread  True if worker cannot process (fallback hint)
 * @property {(string|undefined)}  sourceUrl       Optional original URL (for main-thread refetch)
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
    if (!sharedCanvas) {
      sharedCanvas = new OffscreenCanvas(w, h);
      sharedCtx = sharedCanvas.getContext('2d');
    } else if (sharedCanvas.width !== w || sharedCanvas.height !== h) {
      sharedCanvas.width = w;
      sharedCanvas.height = h;
      if (!sharedCtx) sharedCtx = sharedCanvas.getContext('2d');
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
    pageStartIndex: j.pageStartIndex || 0,
    pagesInvolved: j.pagesInvolved || 1,
    fileExtension,
    allPagesIndex: j.allPagesStartingIndex,
    handleInMainThread: true,
    sourceUrl: j.sourceUrl || null,
  }));
  ctx.postMessage({ jobs: safeJobs, fileExtension, handleInMainThread: true });
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
      // Let the TIFF handler decide per-page whether we need OffscreenCanvas.
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
      pageStartIndex: j.pageStartIndex || 0,
      pagesInvolved: j.pagesInvolved || 1,
      fileExtension: j.fileExtension || fileExtension,
      allPagesIndex: j.allPagesStartingIndex,
      handleInMainThread: true,
      sourceUrl: j.sourceUrl || null,
    }));
    ctx.postMessage({ error: String(error?.message || error), jobs: safeJobs, handleInMainThread: true });
  }
};

// --- TIFF helpers ------------------------------------------------------------

/**
 * Safely read a TIFF tag array from a utif2 IFD object.
 * utif2 exposes numeric tags as `t<id>` (e.g., t259 for Compression).
 * @param {any} ifd
 * @param {number} tagId
 * @returns {(Array<number>|undefined)}
 */
function getTagArray(ifd, tagId) {
  const key = 't' + tagId;
  const v = ifd && ifd[key];
  if (!v) return undefined;
  // Ensure it's an array
  return Array.isArray(v) ? v : [v];
}

/**
 * Build a standard JPEG Blob from an OJPEG (old-style JPEG-in-TIFF) IFD by
 * concatenating the tables (`JPEGInterchangeFormat`/`Length`: t513/t514) with
 * the entropy-coded scan strips (`StripOffsets`/`StripByteCounts`: t273/t279).
 *
 * @param {ArrayBuffer} arrayBuffer
 * @param {any} ifd
 * @returns {(Blob|null)} Blob of type 'image/jpeg' or null if reconstruction is not possible
 */
function buildOjpegJpeg(arrayBuffer, ifd) {
  try {
    const t513 = getTagArray(ifd, 513); // JPEGInterchangeFormat (offset to tables)
    const t514 = getTagArray(ifd, 514); // JPEGInterchangeFormatLength
    const t273 = getTagArray(ifd, 273); // StripOffsets (scan data offsets)
    const t279 = getTagArray(ifd, 279); // StripByteCounts (scan data lengths)

    if (!t513 || !t514 || !t273 || !t279) return null;

    const tablesOffset = t513[0] >>> 0;
    const tablesLen = t514[0] >>> 0;
    if (!tablesLen) return null;

    const u8 = new Uint8Array(arrayBuffer);
    const parts = [];

    // Tables (SOI + APP0(JFIF) + DQT/DHT/SOF0 ... up to but not including SOS)
    parts.push(u8.subarray(tablesOffset, tablesOffset + tablesLen));

    // Concatenate all strips (these typically start at SOS and end with EOI on last strip)
    let totalScanLen = 0;
    for (let i = 0; i < t273.length && i < t279.length; i++) {
      totalScanLen += (t279[i] >>> 0);
    }
    const scanAll = new Uint8Array(totalScanLen);
    let cursor = 0;
    for (let i = 0; i < t273.length && i < t279.length; i++) {
      const off = t273[i] >>> 0;
      const len = t279[i] >>> 0;
      scanAll.set(u8.subarray(off, off + len), cursor);
      cursor += len;
    }
    parts.push(scanAll);

    // Join into one buffer
    let totalLen = 0;
    for (const p of parts) totalLen += p.byteLength;
    const out = new Uint8Array(totalLen);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.byteLength;
    }

    return new Blob([out], { type: 'image/jpeg' });
  } catch {
    return null;
  }
}

// Known-problematic compression codes — route to main thread immediately.
const COMPRESSION_JPEG2000 = 34712;

// --- TIFF processing ---------------------------------------------------------

/**
 * Decode TIFF pages using utif2, with an OJPEG fast path that extracts JPEG
 * directly (no RGBA decode). Falls back to main thread when OffscreenCanvas
 * is unavailable for non-OJPEG pages or when utif2 isn't present.
 *
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

      // Pre-scan: if any page uses JPEG 2000 compression (34712), route to main thread.
      let needsMainThread = false;
      for (let i = start; i < end; i++) {
        const compArr = getTagArray(ifds[i], 259);
        const comp = compArr && compArr.length ? (compArr[0] >>> 0) : 0;
        if (comp === COMPRESSION_JPEG2000) {
          needsMainThread = true;
          break;
        }
      }
      if (needsMainThread) {
        postMainThreadFallback([job], 'tiff');
        // Drop reference to reduce memory pressure
        job.arrayBuffer = null;
        continue;
      }

      for (let i = start; i < end; i++) {
        const ifd = ifds[i];

        // Detect OJPEG (Compression=6) and attempt ultra-light rewrap to JPEG.
        const compressionArr = getTagArray(ifd, 259);
        const compression = compressionArr && compressionArr.length ? (compressionArr[0] >>> 0) : 0;

        if (compression === 6) {
          // OJPEG path — no canvas needed.
          const jpegBlob = buildOjpegJpeg(job.arrayBuffer, ifd);
          if (jpegBlob) {
            jobResults.push({
              blob: jpegBlob,
              fileIndex: job.index,
              pageIndex: i,
              fileExtension: 'tiff', // Keep 'tiff' to align with UI expectations
              allPagesIndex: job.allPagesStartingIndex + (i - start),
              sourceUrl: job.sourceUrl || null,
            });
            continue; // Next page
          }
          // If rewrap failed, fall through to RGBA decode path.
        }

        // Non-OJPEG or OJPEG rewrap failed → use RGBA decode (needs OffscreenCanvas).
        decodeImage(job.arrayBuffer, ifd);
        const rgba = toRGBA8(ifd); // Uint8Array (R,G,B,A)

        const w = (ifd.width >>> 0) || 0;
        const h = (ifd.height >>> 0) || 0;

        const ctx2d = getCanvas(w, h);
        if (!sharedCanvas || !ctx2d) {
          // No canvas support in worker: bounce the remainder of this job to main thread.
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
          sourceUrl: job.sourceUrl || null,
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
        sourceUrl: job.sourceUrl || null,
      });
    } finally {
      // Always drop the reference—even on failure—to reduce memory pressure.
      job.arrayBuffer = null;
    }
  }
}
/* eslint-enable no-restricted-globals */
