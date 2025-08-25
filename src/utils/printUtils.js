// File: src/utils/printUtils.js
/**
 * File: src/utils/printUtils.js
 *
 * OpenDocViewer — Print Utilities
 *
 * PURPOSE
 *   Print the currently active visual element (canvas or image) from the document viewer
 *   and (optionally) print ALL pages in order.
 *
 *   This version avoids popup blockers entirely by always rendering the print
 *   markup into a hidden <iframe> and invoking print() there. It waits for image
 *   resources to load before printing, and it cleans up the iframe afterwards.
 *
 * API STABILITY
 *   - `handlePrint(documentRenderRef, options?)`
 *   - `handlePrintAll(documentRenderRef, options?)`
 *   - `handlePrintRange(documentRenderRef, from, to, options?)`  // convenience API
 *   - `options.viewerContainerRef` (optional) helps locate current/all pages if the
 *     imperative handle cannot provide a node (e.g., images vs. canvases).
 *   - If available, an imperative handle method named `exportAllPagesAsDataUrls()`
 *     or `getAllPrintableDataUrls()` will be used to fetch data URLs for *every*
 *     page; otherwise we fall back to what is currently present in the DOM.
 */

import logger from '../LogController.js';

/**
 * @typedef {Object} PrintOptions
 * @property {'auto'|'portrait'|'landscape'} [orientation='auto']  Page orientation for single-page print.
 * @property {number} [printDelayMs=0]                              Extra delay before print() after image load.
 * @property {{ current: HTMLElement|null }} [viewerContainerRef]   Optional viewer root for DOM fallbacks.
 */

/**
 * A 1-based inclusive page range.
 * @typedef {Object} PageRange
 * @property {number} from
 * @property {number} to
 */

/**
 * Options for printing multiple pages.
 * @typedef {Object} PrintAllOptions
 * @property {number} [printDelayMs=0]
 * @property {{ current: HTMLElement|null }} [viewerContainerRef]
 * @property {PageRange} [pageRange]  Optional range (1-based, inclusive). If omitted, prints all pages.
 */

/**
 * Internal: candidate node for "largest visible" heuristics.
 * @typedef {Object} PrintCandidate
 * @property {(HTMLCanvasElement|HTMLImageElement)} node
 * @property {number} area
 */

/**
 * Return true if the element looks visible and measurable.
 * @param {Element} el
 * @returns {boolean}
 */
function isVisiblyMeasurable(el) {
  try {
    const rect = el.getBoundingClientRect?.();
    if (!rect) return false;
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle?.(el);
    if (!style) return true;
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  } catch {
    return false;
  }
}

/**
 * Best-effort: pick the largest visible <canvas> or <img> inside a container (or document).
 * @param {HTMLElement|Document} root
 * @returns {HTMLCanvasElement|HTMLImageElement|null}
 */
function pickLargestVisibleElement(root) {
  const scope = /** @type {Document|HTMLElement} */ (root || document);
  const nodes = scope.querySelectorAll?.('canvas, img');
  if (!nodes || nodes.length === 0) return null;

  /** @type {Array.<PrintCandidate>} */
  const candidates = [];
  nodes.forEach((n) => {
    if (isVisiblyMeasurable(n)) {
      const r = n.getBoundingClientRect();
      candidates.push({ node: /** @type {any} */ (n), area: r.width * r.height });
    }
  });
  candidates.sort((a, b) => b.area - a.area);
  return candidates.length ? candidates[0].node : null;
}

/**
 * Safely derive a printable data URL from an element that is either a <canvas> or an <img>.
 * If the canvas is tainted (cross-origin), `toDataURL()` will throw; we detect and fallback.
 *
 * @param {HTMLCanvasElement|HTMLImageElement} el
 * @returns {{ dataUrl: (string|null), isCanvas: boolean }}
 */
function getPrintableDataUrl(el) {
  const tag = (el?.tagName || '').toLowerCase();
  const isCanvas = tag === 'canvas';

  if (isCanvas) {
    const canvas = /** @type {HTMLCanvasElement} */ (el);
    try {
      const url = canvas.toDataURL('image/png');
      if (typeof url === 'string' && url.startsWith('data:image')) {
        return { dataUrl: url, isCanvas: true };
      }
    } catch (e) {
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
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 'portrait';
  }
  return width > height ? 'landscape' : 'portrait';
}

/**
 * Create a minimal, print-ready HTML document string embedding a single raster image.
 * @param {string} dataUrl
 * @param {'portrait'|'landscape'} orientation
 * @param {number} printDelayMs
 * @returns {string}
 */
function buildPrintHtml(dataUrl, orientation, printDelayMs) {
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
    '    function go(){ try { window.print(); } catch(e){} }' +
    '    var delay = ' + Math.max(0, Number(printDelayMs) || 0) + ';' +
    '    var img = document.getElementById("__odv_print_image__");' +
    '    if (img && img.complete) { setTimeout(go, delay); }' +
    '    else if (img) {' +
    '      img.addEventListener("load", function(){ setTimeout(go, delay); }, { once: true });' +
    '    }' +
    '  })();' +
    '</script>' +
    '</body>' +
    '</html>'
  );
}

/**
 * Build a multi-page print HTML with one image per page, single column, page breaks between items.
 * @param {Array.<string>} dataUrls
 * @param {number} printDelayMs
 * @returns {string}
 */
function buildPrintAllHtml(dataUrls, printDelayMs) {
  const imgs = dataUrls
    .map((src, i) => {
      const last = i === dataUrls.length - 1;
      return (
        '<div class="page' + (last ? ' last' : '') + '">' +
        '<img alt="Page ' + (i + 1) + '" src="' + src + '" />' +
        '</div>'
      );
    })
    .join('');

  return (
    '<!DOCTYPE html>' +
    '<html>' +
    '<head>' +
    '<meta charset="utf-8">' +
    '<title>Print All</title>' +
    '<style>' +
    'html, body { margin: 0; padding: 0; background: #fff; }' +
    '.page { break-after: page; -webkit-break-after: page; page-break-after: always; }' +
    '.page.last { break-after: auto; -webkit-break-after: auto; page-break-after: auto; }' +
    '.page img { display: block; width: 100vw; height: auto; }' +
    '@media print {' +
    '  @page { margin: 0; }' +
    '  .page img { width: 100%; max-width: 100%; height: auto; }' +
    '}' +
    '</style>' +
    '</head>' +
    '<body>' +
    imgs +
    '<script>' +
    '  (function(){' +
    '    var delay = ' + Math.max(0, Number(printDelayMs) || 0) + ';' +
    '    var imgs = Array.prototype.slice.call(document.images || []);' +
    '    function loaded(img){ return img.complete && (typeof img.naturalWidth === "undefined" || img.naturalWidth > 0); }' +
    '    function whenAllLoaded(list, cb){' +
    '      var remaining = list.length;' +
    '      if (remaining === 0) return cb();' +
    '      list.forEach(function(img){' +
    '        if (loaded(img)) { if (--remaining === 0) cb(); return; }' +
    '        img.addEventListener("load", function(){ if (--remaining === 0) cb(); }, { once: true });' +
    '        img.addEventListener("error", function(){ if (--remaining === 0) cb(); }, { once: true });' +
    '      });' +
    '    }' +
    '    whenAllLoaded(imgs, function(){ setTimeout(function(){ try { window.print(); } catch(e){} }, delay); });' +
    '  })();' +
    '</script>' +
    '</body>' +
    '</html>'
  );
}

/**
 * Attempt to resolve the currently active visual node to print.
 * Prefers the imperative handle, then falls back to DOM search in the viewer container.
 * @param {{ current: (DocumentRenderHandle|null) }} documentRenderRef
 * @param {{ current: HTMLElement|null }|undefined} viewerContainerRef
 * @returns {HTMLCanvasElement|HTMLImageElement|null}
 */
function resolveActiveNode(documentRenderRef, viewerContainerRef) {
  // Primary: imperative handle, if it exists.
  const viaHandle = documentRenderRef?.current?.getActiveCanvas?.();
  if (viaHandle) return viaHandle;

  // Fallback: search the viewer container for the largest visible canvas/img.
  const container = viewerContainerRef?.current;
  if (container) {
    const pick = pickLargestVisibleElement(container);
    if (pick) return pick;
  }

  // Last resort: search the whole document (avoid picking toolbar icons via size heuristic).
  return pickLargestVisibleElement(document);
}

/**
 * Render HTML into a hidden iframe and let it call window.print() internally.
 * Cleans up the iframe after printing (best-effort), with a timeout fallback.
 *
 * @param {string} html
 * @param {number} [cleanupDelayMs=2000]
 * @returns {HTMLIFrameElement}
 */
function printViaHiddenIframe(html, cleanupDelayMs = 2000) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';

  // Append early to ensure contentWindow is available.
  document.body.appendChild(iframe);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      iframe.remove();
    } catch {}
  };

  try {
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      logger.error('Failed to get iframe document for printing');
      cleanup();
      return iframe;
    }
    doc.open();
    doc.write(html);
    doc.close();

    // Try to cleanup when the iframe window reports printing finished.
    try {
      const cw = iframe.contentWindow;
      if (cw) {
        cw.addEventListener('afterprint', cleanup, { once: true });
      }
    } catch {}

    // Fallback cleanup in case afterprint does not fire.
    setTimeout(cleanup, Math.max(1000, cleanupDelayMs));
  } catch (e) {
    logger.error('Error writing to print iframe', { error: String(e?.message || e) });
    cleanup();
  }

  return iframe;
}

/**
 * Handles the print functionality for the CURRENT page/image.
 *
 * Always uses hidden iframe printing (no popup).
 *
 * @param {{ current: (DocumentRenderHandle|null) }} documentRenderRef
 *        Reference to the document render component (should expose getActiveCanvas()).*
 * @param {PrintOptions} [options]
 * @returns {void}
 */
export function handlePrint(documentRenderRef, options = {}) {
  logger.info('handlePrint invoked');

  const {
    orientation = 'auto',
    printDelayMs = 0,
    viewerContainerRef,
  } = options;

  const activeElement = resolveActiveNode(documentRenderRef, viewerContainerRef);
  if (!activeElement) {
    logger.error('Active element is not available for printing');
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
      const img = /** @type {HTMLImageElement} */ (activeElement);
      width = Number(img.naturalWidth || img.getBoundingClientRect().width || 0);
      height = Number(img.naturalHeight || img.getBoundingClientRect().height || 0);
    }
  } catch {
    // ignore; resolver will default
  }

  const pageOrientation = resolveOrientation(width, height, orientation);

  // Build and print in a hidden iframe.
  const html = buildPrintHtml(dataUrl, pageOrientation, printDelayMs);
  printViaHiddenIframe(html, 2000);
}

/**
 * Gather all printable data URLs from canvases/images within a container.
 * Order is DOM order (assumed to match page order).
 * @param {HTMLElement|Document} root
 * @returns {Array.<string>}
 */
function collectAllPrintableDataUrlsFromDom(root) {
  const scope = /** @type {Document|HTMLElement} */ (root || document);
  const nodes = scope.querySelectorAll?.('canvas, img');
  /** @type {Array.<string>} */
  const urls = [];
  nodes.forEach((n) => {
    if (!isVisiblyMeasurable(n)) return;
    const { dataUrl } = getPrintableDataUrl(/** @type {any} */ (n));
    if (dataUrl) urls.push(dataUrl);
  });
  return urls;
}

/**
 * Try to obtain data URLs for *every* page via the imperative handle if available.
 * Falls back to currently rendered nodes in the DOM.
 *
 * @param {{ current: (DocumentRenderHandle|null) }} documentRenderRef
 * @param {{ current: HTMLElement|null }|undefined} viewerContainerRef
 * @returns {Promise.<Array.<string>>}
 */
async function resolveAllPageDataUrls(documentRenderRef, viewerContainerRef) {
  const handle = documentRenderRef?.current;

  // Preferred: explicit export method returning an array of data URLs.
  /** @type {any} */
  const anyHandle = handle;
  try {
    if (anyHandle && typeof anyHandle.exportAllPagesAsDataUrls === 'function') {
      const arr = await anyHandle.exportAllPagesAsDataUrls();
      if (Array.isArray(arr) && arr.length) return arr.filter((s) => typeof s === 'string' && s);
    }
  } catch (e) {
    logger.warn('exportAllPagesAsDataUrls() failed; falling back to DOM', { error: String(e?.message || e) });
  }

  try {
    if (anyHandle && typeof anyHandle.getAllPrintableDataUrls === 'function') {
      const arr = await anyHandle.getAllPrintableDataUrls();
      if (Array.isArray(arr) && arr.length) return arr.filter((s) => typeof s === 'string' && s);
    }
  } catch (e) {
    logger.warn('getAllPrintableDataUrls() failed; falling back to DOM', { error: String(e?.message || e) });
  }

  // Fallback: whatever is currently rendered in the viewer container.
  const container = viewerContainerRef?.current || document;
  const urls = collectAllPrintableDataUrlsFromDom(container);
  return urls;
}

/**
 * Print ALL pages/images visible in the viewer, one per page, single column.
 *
 * Always uses hidden iframe printing (no popup).
 * If the imperative handle exposes `exportAllPagesAsDataUrls()` or
 * `getAllPrintableDataUrls()`, this will print *all* pages. Otherwise,
 * it will print whichever canvases/images are currently rendered in the DOM.
 *
 * If `options.pageRange` is provided, only that inclusive range is printed.
 *
 * @param {{ current: (DocumentRenderHandle|null) }} documentRenderRef
 * @param {PrintAllOptions} [options]
 * @returns {Promise.<void>}
 */
export async function handlePrintAll(documentRenderRef, options = {}) {
  logger.info('handlePrintAll invoked');

  const {
    printDelayMs = 0,
    viewerContainerRef,
    pageRange,
  } = options;

  const dataUrls = await resolveAllPageDataUrls(documentRenderRef, viewerContainerRef);

  if (!dataUrls.length) {
    logger.error('No printable pages found for Print All');
    return;
  }

  /** @type {Array.<string>} */
  let toPrint = dataUrls;

  if (pageRange && Number.isFinite(pageRange.from) && Number.isFinite(pageRange.to)) {
    // Clamp to 1..N and ensure from <= to
    const total = dataUrls.length;
    const from = Math.max(1, Math.min(total, Math.floor(pageRange.from)));
    const to = Math.max(1, Math.min(total, Math.floor(pageRange.to)));
    if (from > to) {
      logger.error('Invalid page range: from > to', { from, to, total });
      return;
    }
    // Convert to 0-based slice [from-1, to)
    toPrint = dataUrls.slice(from - 1, to);
    logger.info('Printing selected page range', { from, to, count: toPrint.length, total });
  }

  const html = buildPrintAllHtml(toPrint, printDelayMs);
  printViaHiddenIframe(html, Math.max(2500, 1000 + toPrint.length * 5)); // longer cleanup for many pages
}

/**
 * Convenience API to print a specific inclusive page range (1-based).
 * Only `printDelayMs` and `viewerContainerRef` from options are used; any provided
 * `pageRange` value is ignored because this function computes it from `from`/`to`.
 *
 * @param {{ current: (DocumentRenderHandle|null) }} documentRenderRef
 * @param {number} from
 * @param {number} to
 * @param {PrintAllOptions} [options]
 * @returns {Promise.<void>}
 */
export function handlePrintRange(documentRenderRef, from, to, options = {}) {
  /** @type {PrintAllOptions} */
  const merged = {
    ...(options || {}),
    pageRange: { from, to },
  };
  return handlePrintAll(documentRenderRef, merged);
}

// Backward-compatible default export
export default { handlePrint, handlePrintAll, handlePrintRange };
