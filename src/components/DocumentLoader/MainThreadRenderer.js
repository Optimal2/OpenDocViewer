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
 *   - Uses the same pdf.js version and worker artifact that are bundled at build time,
 *     wired via `?url` so Vite/Rollup resolve the correct asset.
 *   - Object URLs created here are registered in a shared global registry and revoked
 *     on `beforeunload`/`pagehide` to minimize leaks between navigations.
 *   - For consistency with the worker pipeline, the PDF path reports its results
 *     via `handleWorkerMessage(...)`, while the TIFF path inserts pages directly.
 *
 * IMPORTANT PROJECT GOTCHA (for future reviewers)
 *   - Elsewhere in the app we import from the **root** 'file-type' package, NOT
 *     'file-type/browser'. With `file-type` v21 the '/browser' subpath is not exported
 *     for bundlers and will break Vite builds. See README “Design notes & gotchas”.
 *
 * Provenance / baseline reference for prior version of this file: :contentReference[oaicite:0]{index=0}
 */

import logger from '../../LogController.js';
import { decode as decodeUTIF, decodeImage as decodeUTIFImage, toRGBA8 } from 'utif2';
import { generateThumbnail } from './Utils.js';
import { handleWorkerMessage } from './WorkerHandler.js';

// Import the matching pdf.js API and resolve the worker URL from the same package version
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

/**
 * @typedef {Object} RenderJob
 * @property {ArrayBuffer} arrayBuffer
 * @property {number} index
 * @property {number} pageStartIndex
 * @property {number} pagesInvolved
 * @property {number} allPagesStartingIndex
 * @property {string} fileExtension
 * @property {number} [pageIndex] // used in error paths
 */

/** @typedef {(page:any, index:number) => void} InsertPageAtIndex */

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

function addToUrlRegistry(url) {
  try { globalThis.__odv_url_registry?.add(url); } catch {}
}

/* ------------------------------------------------------------------------------------------------
 * PDF — main-thread renderer
 * ------------------------------------------------------------------------------------------------ */

/**
 * Render PDF pages on the main thread and forward results via the standard worker-message handler.
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
    // Ensure the worker matches the API version that was bundled
    try {
      if (pdfjsLib?.GlobalWorkerOptions) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      }
    } catch {
      // non-fatal in SSR/odd envs
    }

    const pdf = await pdfjsLib.getDocument({ data: job.arrayBuffer.slice(0) }).promise;

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

      logger.debug('Main-thread PDF page rasterized', {
        pdfPage: i,
        fileIndex: job.index,
        allPagesIndex: job.allPagesStartingIndex + (i - 1 - job.pageStartIndex),
      });

      // Re-use the worker message pathway so thumbnails and page insertion are uniform
      handleWorkerMessage(
        {
          data: {
            jobs: [
              {
                fullSizeUrl: url,
                fileIndex: job.index,
                pageIndex: i - 1,
                fileExtension: 'pdf',
                allPagesIndex: job.allPagesStartingIndex + (i - 1 - job.pageStartIndex),
              },
            ],
          },
        },
        insertPageAtIndex,
        sameBlob,
        isMounted
      );
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
 * TIFF — main-thread renderer
 * ------------------------------------------------------------------------------------------------ */

/**
 * Render TIFF pages on the main thread and insert results directly.
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
    const ifds = decodeUTIF(job.arrayBuffer);

    const start = job.pageStartIndex;
    const end = Math.min(job.pageStartIndex + job.pagesInvolved, ifds.length);

    for (let i = start; i < end; i++) {
      if (isMounted && isMounted.current === false) return;

      const ifd = ifds[i];

      // Decode the target IFD to RGBA8
      decodeUTIFImage(job.arrayBuffer, ifd);
      const rgba = toRGBA8(ifd);

      // Paint onto a canvas
      const canvas = document.createElement('canvas');
      canvas.width = ifd.width;
      canvas.height = ifd.height;

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not obtain 2D context for TIFF canvas');

      const imageData = ctx.createImageData(ifd.width, ifd.height);
      imageData.data.set(rgba);
      ctx.putImageData(imageData, 0, 0);

      // Export to Blob → URL
      const blob = await new Promise((resolve) => canvas.toBlob(resolve));
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
