// File: src/components/DocumentLoader/Utils.js
/**
 * File: src/components/DocumentLoader/Utils.js
 *
 * OpenDocViewer — Loader Utilities
 *
 * PURPOSE
 *   Helper utilities used by the DocumentLoader pipeline:
 *     • Build document URL lists (pattern mode)
 *     • Fetch as ArrayBuffer (with optional AbortSignal)
 *     • Page counting (PDF / TIFF)
 *     • Lightweight TIFF metadata extraction
 *     • Thumbnail generation for images
 *
 * DESIGN NOTES
 *   - pdf.js worker URL is wired via `?url` import; bundlers (Vite/Rollup/Webpack) rewrite it.
 *   - Avoid logging large arrays/blobs; prefer counts and small samples in logs.
 *   - Thumbnail generation falls back to a transparent 1×1 data URI to avoid blocking the UI.
 *
 * IMPORTANT PROJECT GOTCHA (for future reviewers)
 *   - In other modules we import from the **root** 'file-type' package, NOT 'file-type/browser'.
 *     With `file-type` v21 the '/browser' subpath is not exported and will break Vite builds.
 */

import logger from '../../LogController.js';
import { decode as decodeUTIF } from 'utif2';

// Use the same pdf.js API and worker that are bundled with the app
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

// Ensure API ↔ worker versions match
try {
  if (pdfjsLib?.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  }
} catch {
  // Non-fatal in SSR or odd environments
}

/** Tiny transparent PNG as a safe fallback when thumbnails cannot be produced. */
const TRANSPARENT_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAn8B9Wt3m1QAAAAASUVORK5CYII=';

/**
 * Generate a list of document URLs using a simple pattern: 001..NNN + extension.
 *
 * EXAMPLE
 *   generateDocumentList('assets/jpg', 'jpg', 3)
 *   // → ['assets/jpg/001.jpg','assets/jpg/002.jpg','assets/jpg/003.jpg']
 *
 * @param {string} folder          Base folder/path for assets (relative so <base href> is honored).
 * @param {string} extension       File extension (e.g., "jpg", "png", "tiff").
 * @param {number} [endNumber=300] Inclusive upper bound (1..N).
 * @returns {Array.<string>}       Ordered list of relative URLs.
 */
export const generateDocumentList = (folder, extension, endNumber = 300) => {
  const documents = [];
  for (let i = 1; i <= endNumber; i++) {
    const fileName = String(i).padStart(3, '0') + `.${extension}`;
    const filePath = `${folder}/${fileName}`; // relative path so virtual app roots work
    documents.push(filePath);
  }
  // Log only concise info (avoid dumping large arrays)
  logger.debug('Generated document list', {
    count: documents.length,
    sampleStart: documents[0],
    sampleEnd: documents[documents.length - 1],
  });
  return documents;
};

/**
 * Options for fetchAndArrayBuffer.
 * @typedef {Object} FetchOptions
 * @property {(AbortSignal|undefined)} signal
 */

/**
 * Fetch a resource and return its ArrayBuffer.
 *
 * @param {string} url                 Resource URL.
 * @param {FetchOptions} [opts]        Optional fetch options (AbortSignal supported).
 * @returns {Promise.<ArrayBuffer>}
 * @throws {Error} On non-2xx responses.
 */
export const fetchAndArrayBuffer = async (url, opts = {}) => {
  logger.debug('Fetching array buffer', { url });
  const res = await fetch(url, { signal: opts.signal });
  if (!res.ok) {
    throw new Error('Failed to fetch document at ' + url + ' (status ' + res.status + ')');
  }
  return res.arrayBuffer();
};

/**
 * Determine total pages for a given document by inspecting its buffer and type.
 *
 * SUPPORTED
 *   - PDF  → via pdf.js
 *   - TIFF → via utif2 (counts IFDs)
 *   - All others → 1
 *
 * @param {ArrayBuffer} arrayBuffer  Document bytes.
 * @param {string} fileExtension     File extension (case-insensitive).
 * @returns {Promise.<number>}       Total pages detected.
 */
export const getTotalPages = async (arrayBuffer, fileExtension) => {
  const fileExtLower = String(fileExtension || '').toLowerCase();

  if (fileExtLower === 'pdf') {
    const arrayBufferCopy = arrayBuffer.slice(0); // pdf.js will consume the bytes
    const pdf = await pdfjsLib.getDocument({ data: arrayBufferCopy }).promise;
    logger.debug('PDF document loaded', { numPages: pdf.numPages });
    return pdf.numPages;
  }

  if (fileExtLower === 'tiff' || fileExtLower === 'tif') {
    const ifds = decodeUTIF(arrayBuffer);
    const pages = Array.isArray(ifds) ? ifds.length : 1;
    logger.debug('TIFF document loaded', { numPages: pages });
    return pages;
  }

  return 1;
};

/**
 * Extract light-weight metadata from a TIFF buffer (best-effort).
 *
 * @param {ArrayBuffer} arrayBuffer
 * @returns {(Array.<Object>|'unknown')} List of per-page metadata objects, or 'unknown' if parsing fails.
 */
export const getTiffMetadata = (arrayBuffer) => {
  try {
    const ifds = decodeUTIF(arrayBuffer);
    const metadata = (Array.isArray(ifds) ? ifds : []).map((ifd) => {
      const compressionType = ifd['t259'] ? ifd['t259'][0] : 1; // default: no compression
      return {
        compressionType,
        photometricInterpretation: ifd['t262'] ? ifd['t262'][0] : 'unknown',
        bitsPerSample: ifd['t258'] ? ifd['t258'] : 'unknown',
        samplesPerPixel: ifd['t277'] ? ifd['t277'][0] : 'unknown',
        planarConfiguration: ifd['t284'] ? ifd['t284'][0] : 'unknown',
        extraSamples: ifd['t338'] ? ifd['t338'] : 'none',
      };
    });
    return metadata;
  } catch (error) {
    logger.error('Error getting TIFF metadata using UTIF2', { error: String(error?.message || error) });
    return 'unknown';
  }
};

/**
 * Create a small thumbnail data URL for a given image URL.
 * Falls back to a transparent 1×1 data URI if the image cannot be loaded
 * (CORS, network failures, tainted canvas, etc.).
 *
 * NOTE
 *   - If you serve cross-origin assets with proper CORS, you can set:
 *       img.crossOrigin = 'anonymous';
 *     prior to setting `img.src` to allow Canvas export.
 *
 * @param {string} imageUrl
 * @param {number} maxWidth
 * @param {number} maxHeight
 * @returns {Promise.<string>} Data URL (PNG) for the thumbnail (or a transparent fallback).
 */
export const generateThumbnail = (imageUrl, maxWidth, maxHeight) => {
  logger.debug('Generating thumbnail', { imageUrl });

  return new Promise((resolve) => {
    const img = new Image();
    // img.crossOrigin = 'anonymous'; // enable if your assets send proper CORS headers
    try { img.decoding = 'async'; } catch {}

    const resolveFallback = () => {
      logger.debug('Thumbnail generation fallback used', { imageUrl });
      resolve(TRANSPARENT_1x1); // or consider 'placeholder.png' as a themed fallback
    };

    img.onerror = resolveFallback;
    img.onload = () => {
      try {
        if (!img.width || !img.height) return resolveFallback();

        const aspect = img.width / img.height;
        let width = maxWidth;
        let height = maxHeight;

        if (img.width >= img.height) {
          height = Math.min(maxHeight, Math.floor(maxWidth / aspect));
          width = Math.floor(height * aspect);
        } else {
          width = Math.min(maxWidth, Math.floor(maxHeight * aspect));
          height = Math.floor(width / aspect);
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);

        const ctx = canvas.getContext('2d');
        if (!ctx) return resolveFallback();

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Export may throw on tainted canvas (CORS); catch and fallback.
        try {
          const dataUrl = canvas.toDataURL();
          resolve(dataUrl || TRANSPARENT_1x1);
        } catch {
          resolveFallback();
        }
      } catch {
        resolveFallback();
      }
    };

    img.src = imageUrl;
  });
};
