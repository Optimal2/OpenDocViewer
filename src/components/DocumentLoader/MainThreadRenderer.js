// File: src/components/DocumentLoader/MainThreadRenderer.js
/**
 * File: src/components/DocumentLoader/MainThreadRenderer.js
 *
 * OpenDocViewer — Main-thread renderers for PDF & TIFF
 *
 * PURPOSE
 *   Render multi-page formats (PDF/TIFF) on the main thread when necessary
 *   (e.g., worker fallback, low-core devices, or when explicitly configured).
 *
 * DESIGN NOTES
 *   - Uses the same pdf.js version and worker artifact that are bundled at build time.
 *     To behave IDENTICALLY in dev and build, we set a single worker script URL:
 *       pdfjsLib.GlobalWorkerOptions.workerSrc = <resolved-url>
 *   - Object URLs created here are registered in a shared global registry and revoked
 *     on `beforeunload`/`pagehide` to minimize leaks between navigations.
 *   - ⚠️ Important: this module no longer imports `handleWorkerMessage` to avoid
 *     a circular dependency with WorkerHandler in dev/HMR. It inserts pages directly.
 */

import logger from '../../LogController.js';
import { decode as decodeUTIF, decodeImage as decodeUTIFImage, toRGBA8 } from 'utif2';
import { generateThumbnail } from './Utils.js';

// Import the matching pdf.js API and resolve the worker URL from the same package version
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import pdfWorkerJsUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

/**
 * Render job passed to the main-thread renderer.
 * @typedef {Object} RenderJob
 * @property {ArrayBuffer} arrayBuffer
 * @property {string=} sourceUrl
 * @property {number} index
 * @property {number} pageStartIndex
 * @property {number} pagesInvolved
 * @property {number} allPagesStartingIndex
 * @property {string} fileExtension
 * @property {number=} pageIndex // used in error paths
 */

/**
 * Signature for inserting a page structure into the page list at an index.
 * @typedef {function(*, number): void} InsertPageAtIndex
 */

/* ------------------------------------------------------------------------------------------------
 * Global URL registry + unload cleanup to prevent memory leaks
 * ------------------------------------------------------------------------------------------------ */

(function installUrlCleanup(w) {
  try {
    if (!w.__odv_url_registry) w.__odv_url_registry = new Set();
    if (!w.__odv_url_cleanup_installed && typeof w.addEventListener === 'function') {
      const cleanup = () => {
        try {
          for (const u of w.__odv_url_registry) {
            try { URL.revokeObjectURL(u); } catch {}
          }
        } finally {
          try { w.__odv_url_registry.clear(); } catch {}
        }
      };
      w.addEventListener('beforeunload', cleanup, { once: true });
      w.addEventListener('pagehide', cleanup, { once: true });
      w.__odv_url_cleanup_installed = true;
    }
  } catch {
    // ignore
  }
})(globalThis);

/**
 * Track a created object URL so it can be revoked later.
 * @param {string} url
 * @returns {void}
 */
function addToUrlRegistry(url) {
  try { globalThis.__odv_url_registry?.add(url); } catch {}
}

/* ------------------------------------------------------------------------------------------------
 * PDF — main-thread renderer
 * ------------------------------------------------------------------------------------------------ */

/** One-time init of pdf.js classic worker script URL (dev == build). */
let __pdfWorkerInitialized = false;

/**
 * Ensure a pdf.js worker is ready for this runtime.
 * Uses a single worker script URL so dev and build behave identically.
 * @returns {void}
 */
function ensurePdfWorker() {
  try {
    if (!pdfjsLib?.GlobalWorkerOptions || __pdfWorkerInitialized) return;
    // Ensure the worker matches the API version that was bundled
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerJsUrl;
    __pdfWorkerInitialized = true;
    logger.debug('pdf.js workerSrc set (legacy ESM worker)', { workerSrc: pdfWorkerJsUrl });
  } catch (e) {
    // Non-fatal: pdf.js can render on main thread, but performance will be lower.
    logger.warn('Failed to set pdf.js workerSrc; falling back to main-thread rendering', {
      error: String(e?.message || e),
    });
  }
}

/**
 * Render PDF pages on the main thread and INSERT THEM DIRECTLY.
 *
 * @param {RenderJob} job
 * @param {InsertPageAtIndex} insertPageAtIndex
 * @param {boolean} sameBlob
 * @param {{ current: boolean }} [isMounted]
 * @returns {Promise<void>}
 */
export const renderPDFInMainThread = async (job, insertPageAtIndex, sameBlob, isMounted) => {
  if (isMounted && isMounted.current === false) return;

  try {
    // Initialize (or reuse) the pdf.js worker (identical in dev/build).
    ensurePdfWorker();

    // If we were scheduled without bytes, fetch them using sourceUrl.
    let dataBuffer = job.arrayBuffer;
    if ((!dataBuffer || dataBuffer.byteLength === 0) && job.sourceUrl) {
      const resp = await fetch(job.sourceUrl);
      if (!resp.ok) throw new Error('Failed to fetch PDF for main-thread render');
      dataBuffer = await resp.arrayBuffer();
    }

    const pdf = await pdfjsLib.getDocument({ data: dataBuffer.slice(0) }).promise;

    // pdf.getPage(...) is 1-based; translate (pageStartIndex .. +pagesInvolved-1) → (1..N)
    const first = job.pageStartIndex + 1;
    const last = Math.min(job.pageStartIndex + job.pagesInvolved, pdf.numPages);

    for (let i = first; i <= last; i++) {
      if (isMounted && isMounted.current === false) return;

      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not obtain 2D context for PDF canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);

      await page.render({ canvasContext: ctx, viewport }).promise;

      // Yield to the event loop to keep the UI responsive on low-core machines
      await new Promise((r) => setTimeout(r, 0));
      if (isMounted && isMounted.current === false) return;

      // Convert the rendered canvas to a Blob → object URL
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Failed to create blob from PDF canvas');

      const url = URL.createObjectURL(blob);
      addToUrlRegistry(url);

      const at = job.allPagesStartingIndex + (i - 1 - job.pageStartIndex);
      const thumbUrl = sameBlob ? url : await generateThumbnail(url, 200, 200);

      // INSERT DIRECTLY (no call back into WorkerHandler to avoid cyc import)
      insertPageAtIndex(
        {
          fullSizeUrl: url,
          thumbnailUrl: thumbUrl,
          loaded: true,
          status: 1,
          fileExtension: 'pdf',
          fileIndex: job.index,
          pageIndex: i - 1,
          allPagesIndex: at,
        },
        at
      );

      logger.debug('Main-thread PDF page rasterized', {
        pdfPage: i,
        fileIndex: job.index,
        allPagesIndex: at,
      });
    }
  } catch (error) {
    if (isMounted && isMounted.current === false) return;

    const idx =
      typeof job.pageIndex === 'number'
        ? job.pageIndex
        : job.pageStartIndex; // best-effort when pageIndex is not supplied

    const at = job.allPagesStartingIndex + (idx - job.pageStartIndex);
    const placeholderImageUrl = 'placeholder.png';

    logger.error('Error processing PDF in main thread', { error: String(error?.message || error) });

    insertPageAtIndex(
      {
        fullSizeUrl: placeholderImageUrl,
        thumbnailUrl: placeholderImageUrl,
        loaded: false,
        status: -1,
        fileExtension: job.fileExtension,
        fileIndex: job.index,
        pageIndex: idx,
        allPagesIndex: at,
      },
      at
    );
  }
};

/* ------------------------------------------------------------------------------------------------
 * TIFF — main-thread renderer (with ultra-light OJPEG fallback)
 * ------------------------------------------------------------------------------------------------ */

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

    // Tables blob (SOI + APP0(JFIF) + DQT/DHT/SOF0 ... up to SOS)
    parts.push(u8.subarray(tablesOffset, tablesOffset + tablesLen));

    // Concatenate all strips (usually single-strip; support multi-strip just in case)
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

/**
 * Render TIFF pages on the main thread with an ultra-light OJPEG fast path:
 * - If Compression=6 (old-style JPEG-in-TIFF), reconstruct a standard JPEG stream
 *   by concatenating the JFIF/tables blob with the scan strips and use that directly.
 * - Otherwise, decode to RGBA via utif2 and paint to a canvas (export as PNG).
 *
 * @param {RenderJob} job
 * @param {InsertPageAtIndex} insertPageAtIndex
 * @param {boolean} sameBlob
 * @param {{ current: boolean }} [isMounted]
 * @returns {Promise<void>}
 */
export const renderTIFFInMainThread = async (job, insertPageAtIndex, sameBlob, isMounted) => {
  if (isMounted && isMounted.current === false) return;

  try {
    // If we were scheduled without bytes, fetch them using sourceUrl.
    let buffer = job.arrayBuffer;
    if ((!buffer || buffer.byteLength === 0) && job.sourceUrl) {
      const resp = await fetch(job.sourceUrl);
      if (!resp.ok) throw new Error('Failed to fetch TIFF for main-thread render');
      buffer = await resp.arrayBuffer();
      // Keep for downstream functions that may rely on job.arrayBuffer
      job.arrayBuffer = buffer;
    }

    const ifds = decodeUTIF(buffer);

    const start = job.pageStartIndex;
    const end = Math.min(job.pageStartIndex + job.pagesInvolved, ifds.length);

    for (let i = start; i < end; i++) {
      if (isMounted && isMounted.current === false) return;

      const ifd = ifds[i];

      // 1) Ultra-light OJPEG path: Compression == 6
      const compressionArr = getTagArray(ifd, 259);
      const compression = compressionArr && compressionArr.length ? (compressionArr[0] >>> 0) : 0;

      if (compression === 6) {
        try {
          const jpegBlob = buildOjpegJpeg(buffer, ifd);
          if (jpegBlob) {
            const url = URL.createObjectURL(jpegBlob);
            addToUrlRegistry(url);

            const at = job.allPagesStartingIndex + (i - job.pageStartIndex);
            const thumbUrl = sameBlob ? url : await generateThumbnail(url, 200, 200);

            insertPageAtIndex(
              {
                fullSizeUrl: url,
                thumbnailUrl: thumbUrl,
                loaded: true,
                status: 1,
                fileExtension: 'tiff',
                fileIndex: job.index,
                pageIndex: i,
                allPagesIndex: at,
              },
              at
            );

            logger.debug('TIFF OJPEG rewrap used (main thread)', {
              pageIndex: i,
              fileIndex: job.index,
              allPagesIndex: at,
            });

            // Small yield to keep UI responsive on long runs
            if ((i - start) % 2 === 1) await new Promise((r) => setTimeout(r, 0));
            continue; // Next page
          }
        } catch (e) {
          // If rewrap failed, fall through to RGBA decode
          logger.warn('OJPEG rewrap failed; falling back to RGBA decode', {
            pageIndex: i,
            fileIndex: job.index,
            error: String(e?.message || e),
          });
        }
      }

      // 2) Standard path — decode the target IFD to RGBA8, paint to canvas, export PNG
      try {
        decodeUTIFImage(buffer, ifd);
        const rgba = toRGBA8(ifd);

        // Paint onto a canvas
        const canvas = document.createElement('canvas');
        canvas.width = ifd.width >>> 0;
        canvas.height = ifd.height >>> 0;

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not obtain 2D context for TIFF canvas');

        const imageData = ctx.createImageData(canvas.width, canvas.height);
        imageData.data.set(rgba);
        ctx.putImageData(imageData, 0, 0);

        // Export to Blob → URL (prefer PNG)
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('Failed to create blob from TIFF canvas');

        const url = URL.createObjectURL(blob);
        addToUrlRegistry(url);

        if (isMounted && isMounted.current === false) return;

        // Generate (or reuse) a thumbnail
        const thumbUrl = sameBlob ? url : await generateThumbnail(url, 200, 200);

        // Insert page
        const at = job.allPagesStartingIndex + (i - job.pageStartIndex);
        insertPageAtIndex(
          {
            fullSizeUrl: url,
            thumbnailUrl: thumbUrl,
            loaded: true,
            status: 1,
            fileExtension: 'tiff',
            fileIndex: job.index,
            pageIndex: i,
            allPagesIndex: at,
          },
          at
        );
      } catch (perPageError) {
        // Per-page failure should not abort the whole job — insert placeholder and continue.
        const at = job.allPagesStartingIndex + (i - job.pageStartIndex);
        const placeholderImageUrl = 'placeholder.png';

        logger.warn('TIFF page failed to decode on main thread; inserting placeholder', {
          pageIndex: i,
          fileIndex: job.index,
          error: String(perPageError?.message || perPageError),
        });

        insertPageAtIndex(
          {
            fullSizeUrl: placeholderImageUrl,
            thumbnailUrl: placeholderImageUrl,
            loaded: false,
            status: -1,
            fileExtension: job.fileExtension,
            fileIndex: job.index,
            pageIndex: i,
            allPagesIndex: at,
          },
          at
        );
      }

      // Small yields help on low-core machines during long TIFF batches
      if ((i - start) % 2 === 1) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  } catch (error) {
    if (isMounted && isMounted.current === false) return;

    const idx =
      typeof job.pageIndex === 'number'
        ? job.pageIndex
        : job.pageStartIndex;

    const at = job.allPagesStartingIndex + (idx - job.pageStartIndex);
    const placeholderImageUrl = 'placeholder.png';

    logger.error('Error processing TIFF in main thread', { error: String(error?.message || error) });

    insertPageAtIndex(
      {
        fullSizeUrl: placeholderImageUrl,
        thumbnailUrl: placeholderImageUrl,
        loaded: false,
        status: -1,
        fileExtension: job.fileExtension,
        fileIndex: job.index,
        pageIndex: idx,
        allPagesIndex: at,
      },
      at
    );
  }
};
