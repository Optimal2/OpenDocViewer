/**
 * File: src/utils/printUtils.js
 *
 * OpenDocViewer — Print Utilities
 *
 * PURPOSE
 *   Print the currently active visual element (canvas or image) from the document viewer
 *   in a way that is robust across browsers:
 *     - Supports both <canvas> and <img> sources (TIFF pages are rasterized upstream).
 *     - Waits for the print image to finish loading before calling `window.print()`
 *       to avoid blank pages.
 *     - Uses @page size (portrait/landscape) based on current element dimensions.
 *     - Falls back gracefully when `toDataURL()` is blocked (tainted canvas).
 *
 * API STABILITY
 *   - The exported signature remains backward compatible.
 *   - Optional `options` parameter allows future tuning without breaking callers.
 *
 * LOGGING
 *   - Uses the project logger with concise, structured entries.
 *
 * GOTCHA (project-wide reminder):
 *   - Elsewhere we import from 'file-type' (root), **not** 'file-type/browser', because v21
 *     does not export that subpath for bundlers and it breaks the Vite build.
 *
 * Provenance / current baseline for this file: :contentReference[oaicite:0]{index=0}
 */

import logger from '../LogController';

/**
 * @typedef {Object} PrintOptions
 * @property {'auto'|'portrait'|'landscape'} [orientation='auto']  Page orientation. 'auto' uses element aspect.
 * @property {number} [openWidth=900]                               Popup width (hint for some UAs).
 * @property {number} [openHeight=700]                              Popup height (hint for some UAs).
 * @property {number} [printDelayMs=0]                              Extra delay before print() after image load.
 * @property {boolean} [closeAfterPrint=true]                       Attempt to close the popup after printing.
 */

/**
 * Safely derive a printable data URL from an element that is either a <canvas> or an <img>.
 * If the canvas is tainted (cross-origin), `toDataURL()` will throw; we detect and fallback.
 *
 * @param {HTMLCanvasElement|HTMLImageElement} el
 * @returns {{ dataUrl: string | null, isCanvas: boolean }}
 */
function getPrintableDataUrl(el) {
  const tag = (el?.tagName || '').toLowerCase();
  const isCanvas = tag === 'canvas';

  if (isCanvas) {
    const canvas = /** @type {HTMLCanvasElement} */ (el);
    try {
      // Prefer PNG for lossless print output; browsers ignore alpha on white paper.
      const url = canvas.toDataURL('image/png');
      if (typeof url === 'string' && url.startsWith('data:image')) {
        return { dataUrl: url, isCanvas: true };
      }
    } catch (e) {
      // Tainted canvas or unsupported; fall through to error handling below.
      logger.warn('Canvas toDataURL failed (tainted or unsupported)', { error: String(e?.message || e) });
      return { dataUrl: null, isCanvas: true };
    }
    return { dataUrl: null, isCanvas: true };
  }

  if (tag === 'img') {
    const img = /** @type {HTMLImageElement} */ (el);
    const url = img.currentSrc || img.src || '';
    if (typeof url === 'string' && url) {
      return { dataUrl: url, isCanvas: false };
    }
    return { dataUrl: null, isCanvas: false };
  }

  return { dataUrl: null, isCanvas: false };
}

/**
 * Compute page orientation from dimensions when options.orientation === 'auto'.
 * @param {number} width
 * @param {number} height
 * @param {'auto'|'portrait'|'landscape'} requested
 * @returns {'portrait'|'landscape'}
 */
function resolveOrientation(width, height, requested) {
  if (requested && requested !== 'auto') return requested;
  // Fallback if size is unknown: portrait
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 'portrait';
  }
  return width > height ? 'landscape' : 'portrait';
}

/**
 * Create a minimal, print-ready HTML document string embedding the raster image.
 * @param {string} dataUrl
 * @param {'portrait'|'landscape'} orientation
 * @returns {string}
 */
function buildPrintHtml(dataUrl, orientation) {
  // NOTE: We keep inline CSS minimal to avoid UA quirks. The image fits within the printable area.
  return (
    '<!DOCTYPE html>' +
    '<html>' +
    '<head>' +
    '<meta charset="utf-8">' +
    '<title>Print</title>' +
    '<style>' +
    '@media print {' +
    '  @page { size: ' + orientation + '; margin: 0; }' +
    '  html, body { height: 100%; }' +
    '  body { margin: 0; display: flex; align-items: center; justify-content: center; }' +
    '  img { max-width: 100vw; max-height: 100vh; width: auto; height: auto; }' +
    '}' +
    'html, body { margin: 0; padding: 0; height: 100%; background: #fff; }' +
    'body { display: flex; align-items: center; justify-content: center; }' +
    'img { max-width: 100vw; max-height: 100vh; width: auto; height: auto; }' +
    '</style>' +
    '</head>' +
    '<body>' +
    '<img id="__odv_print_image__" alt="Printable Document" src="' + dataUrl + '" />' +
    '<script>' +
    '  (function(){' +
    '    var img = document.getElementById("__odv_print_image__");' +
    '    function go(){ try { window.focus(); window.print(); } catch(e){} }' +
    '    if (img && img.complete) { setTimeout(go, 0); }' +
    '    else if (img) { img.addEventListener("load", function(){ setTimeout(go, 0); }, { once: true }); }' +
    '  })();' +
    '</script>' +
    '</body>' +
    '</html>'
  );
}

/**
 * Handles the print functionality for the document viewer.
 *
 * This function:
 *  - Resolves the active visual element via `documentRenderRef.current.getActiveCanvas()`.
 *  - Derives a printable data URL (from canvas or image).
 *  - Opens a lightweight popup, injects print markup, waits for load, and triggers print.
 *  - Optionally closes the popup afterward.
 *
 * @param {{ current: { getActiveCanvas: () => (HTMLCanvasElement|HTMLImageElement|null) } | null }} documentRenderRef
 *        Reference to the document render component (must expose getActiveCanvas()).
 * @param {PrintOptions} [options]
 * @returns {void}
 */
export function handlePrint(documentRenderRef, options = {}) {
  logger.info('handlePrint invoked');

  const {
    orientation = 'auto',
    openWidth = 900,
    openHeight = 700,
    printDelayMs = 0,
    closeAfterPrint = true,
  } = options;

  if (!documentRenderRef || !documentRenderRef.current) {
    logger.error('documentRenderRef is not available');
    return;
  }

  const activeElement = documentRenderRef.current.getActiveCanvas();
  if (!activeElement) {
    logger.error('Active element is not available');
    return;
  }

  // Determine output data URL
  const { dataUrl, isCanvas } = getPrintableDataUrl(activeElement);
  if (!dataUrl) {
    logger.error('Unable to derive printable data URL', { isCanvas });
    return;
  }

  // Compute orientation hint
  let width = 0;
  let height = 0;
  try {
    if (isCanvas) {
      const c = /** @type {HTMLCanvasElement} */ (activeElement);
      width = Number(c.width || 0);
      height = Number(c.height || 0);
    } else {
      // For images, prefer visual box when natural size is unavailable
      const img = /** @type {HTMLImageElement} */ (activeElement);
      width = Number(img.naturalWidth || img.getBoundingClientRect().width || 0);
      height = Number(img.naturalHeight || img.getBoundingClientRect().height || 0);
    }
  } catch {
    // ignore dimension errors; fallback in resolver
  }

  const pageOrientation = resolveOrientation(width, height, orientation);

  // Build document and open popup. Some browsers block popups without user gesture.
  const specs = `noopener,noreferrer,width=${openWidth},height=${openHeight}`;
  const printWin = window.open('', '_blank', specs);

  if (!printWin) {
    logger.error('Failed to open print window (popup blocked?)');
    return;
  }

  logger.info('Print window opened', { orientation: pageOrientation, isCanvas, width, height });

  const html = buildPrintHtml(dataUrl, pageOrientation);

  // Write and close the document to trigger load
  try {
    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
  } catch (e) {
    logger.error('Failed to write print document', { error: String(e?.message || e) });
    try { printWin.close(); } catch {}
    return;
  }

  // Optional extra delay after image onload (for slower engines/printers)
  if (printDelayMs > 0) {
    try {
      const timerScript = `
        (function(){
          var img = document.getElementById('__odv_print_image__');
          function go(){ setTimeout(function(){ try { window.print(); } catch(e){} }, ${Math.max(0, printDelayMs)}); }
          if (img && img.complete) { go(); }
          else if (img) { img.addEventListener('load', go, { once: true }); }
        })();
      `;
      printWin.eval?.(timerScript); // Non-standard; best effort, ignored if CSP blocks eval
    } catch {
      // ignore—base script already calls print on load
    }
  }

  if (closeAfterPrint) {
    // Best-effort close after a short delay to avoid interrupting native dialogs.
    setTimeout(() => {
      try { printWin.close(); } catch {}
      logger.info('Print window closed');
    }, Math.max(700, printDelayMs + 400));
  }
}

// Backward-compatible default export (named export is preferred)
export default { handlePrint };
