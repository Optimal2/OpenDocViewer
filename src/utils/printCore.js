// File: src/utils/printCore.js
/**
 * File: src/utils/printCore.js
 *
 * OpenDocViewer — Print Core
 *
 * PURPOSE
 *   Core print routines used by the viewer:
 *     - Print current page (canvas or image, including canvas edits)
 *     - Print all pages
 *     - Print a selected range (ascending or descending)
 *     - Print an explicit sequence of pages
 *
 * NOTES
 *   - Printing is performed via a hidden <iframe> to avoid popup blockers.
 *   - When possible, we obtain data URLs from the imperative handle; otherwise
 *     we fall back to canvases/images currently in the DOM.
 *
 * HEADER OVERLAY
 *   When odvConfig.printHeader.enabled === true, this module injects a non-optional
 *   overlay band into the print DOM (top or bottom) for each printed page, according
 *   to printHeader.applyTo ("all" | "first" | "last"). The overlay is absolutely
 *   positioned and does NOT reflow content. Admins may customize its look using
 *   printHeader.css (string), which is injected as print-only CSS inside the print iframe.
 */

import logger from '../LogController.js';
import { renderSingleDocument, renderMultiDocument } from './printDom.js';
import { makeBaseTokenContext } from './printTemplate.js';
import { isSafeImageSrc } from './printSanitize.js';

/**
 * Options for single-page printing.
 * @typedef {Object} PrintOptions
 * @property {'auto'|'portrait'|'landscape'} [orientation='auto']  Page orientation for single-page print.
 * @property {number} [printDelayMs=0]                              Extra delay before print() after image load.
 * @property {{ current: HTMLElement|null }} [viewerContainerRef]   Optional viewer root for DOM fallbacks.
 * @property {string} [reason]                                      Optional reason text to propagate to header tokens.
 * @property {string} [forWhom]                                     Optional "for whom" text to propagate to header tokens.
 */

/**
 * A 1-based inclusive page range.
 * @typedef {Object} PageRange
 * @property {number} from
 * @property {number} to
 */

/**
 * Options for printing multiple pages (all/range/sequence).
 * @typedef {Object} PrintAllOptions
 * @property {number} [printDelayMs=0]
 * @property {{ current: HTMLElement|null }} [viewerContainerRef]
 * @property {PageRange} [pageRange]
 * @property {string} [reason]
 * @property {string} [forWhom]
 */

/**
 * Internal: candidate node for "largest visible" heuristics.
 * @typedef {Object} PrintCandidate
 * @property {(HTMLCanvasElement|HTMLImageElement)} node
 * @property {number} area
 */

/**
 * Print header config (runtime) consumed by the print overlay logic.
 * Using Closure-friendly optional properties (the trailing "=").
 * @typedef {Object} PrintHeaderCfg
 * @property {boolean=} enabled
 * @property {"top"|"bottom"=} position
 * @property {"all"|"first"|"last"=} applyTo
 * @property {string=} template
 * @property {string=} css
 */

/**
 * Return type for the hidden-iframe factory.
 * @typedef {Object} HiddenIframe
 * @property {HTMLIFrameElement} frame
 * @property {function(): void} cleanup
 */

/**
 * Return true if the element looks visible and measurable.
 * @param {Element} el
 * @returns {boolean}
 */
function isVisiblyMeasurable(el) {
  try {
    const rect = el.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
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
  if (tag === 'canvas') {
    const c = /** @type {HTMLCanvasElement} */ (el);
    try {
      const url = c.toDataURL('image/png');
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
    const i = /** @type {HTMLImageElement} */ (el);
    const url = i.currentSrc || i.src || '';
    if (typeof url === 'string' && url && isSafeImageSrc(url)) {
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
 * Resolve runtime ODV config injected at /public/odv.config.js.
 * Falls back gracefully if not present.
 * @returns {Object}
 */
function getODVConfig() {
  try {
    // __ODV_GET_CONFIG__ is a function in some deployments
    const f = /** @type {any} */ (window).__ODV_GET_CONFIG__;
    if (typeof f === 'function') {
      const v = f();
      if (v && typeof v === 'object') return v;
    }
  } catch {}
  try {
    const v = /** @type {any} */ (window).__ODV_CONFIG__;
    if (v && typeof v === 'object') return v;
  } catch {}
  return {};
}

/**
 * Attempt to resolve the currently active visual node to print.
 * Prefers the imperative handle, then falls back to DOM search in the viewer container.
 * @param {{ current: (DocumentRenderHandle|null) }} documentRenderRef
 * @param {{ current: HTMLElement|null }|undefined} viewerContainerRef
 * @returns {HTMLCanvasElement|HTMLImageElement|null}
 */
function resolveActiveNode(documentRenderRef, viewerContainerRef) {
  const viaHandle = documentRenderRef?.current?.getActiveCanvas?.();
  if (viaHandle) return viaHandle;

  const container = viewerContainerRef?.current;
  const pick = container ? pickLargestVisibleElement(container) : null;
  return pick || pickLargestVisibleElement(document);
}

/**
 * Create a hidden iframe and return the element plus a cleanup function.
 * @param {number} [cleanupDelayMs=2000]
 * @returns {HiddenIframe}
 */
function createHiddenIframe(cleanupDelayMs = 2000) {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  Object.assign(f.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
    visibility: 'hidden'
  });
  document.body.appendChild(f);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try { f.remove(); } catch {}
  };

  try { f.contentWindow?.addEventListener('afterprint', cleanup, { once: true }); } catch {}
  setTimeout(cleanup, Math.max(1000, cleanupDelayMs));

  return { frame: f, cleanup };
}

/**
 * Handles the print functionality for the CURRENT page/image.
 * Always uses hidden iframe printing (no popup).
 *
 * @param {{ current: (DocumentRenderHandle|null) }} documentRenderRef
 * @param {PrintOptions} [options]
 * @returns {void}
 */
export function handlePrint(documentRenderRef, options = {}) {
  logger.info('handlePrint invoked');

  const { orientation = 'auto', printDelayMs = 0, viewerContainerRef, reason = '', forWhom = '' } = options;

  const active = resolveActiveNode(documentRenderRef, viewerContainerRef);
  if (!active) {
    logger.error('Active element is not available for printing');
    return;
  }

  const { dataUrl, isCanvas } = getPrintableDataUrl(active);
  if (!dataUrl) {
    logger.error('Unable to derive printable data URL', { isCanvas });
    return;
  }

  let w = 0;
  let h = 0;
  try {
    if ((active.tagName || '').toLowerCase() === 'canvas') {
      w = /** @type {HTMLCanvasElement} */ (active).width || 0;
      h = /** @type {HTMLCanvasElement} */ (active).height || 0;
    } else {
      const img = /** @type {HTMLImageElement} */ (active);
      w = img.naturalWidth || img.getBoundingClientRect().width || 0;
      h = img.naturalHeight || img.getBoundingClientRect().height || 0;
    }
  } catch {}

  const pageOrientation = resolveOrientation(w, h, orientation);

  const odv = getODVConfig();
  const anyHandle = /** @type {*} */ (documentRenderRef?.current);
  const tokenContext = makeBaseTokenContext(anyHandle, reason, forWhom);

  const { frame } = createHiddenIframe(2000);
  const doc = frame.contentDocument || frame.contentWindow?.document;
  if (!doc) {
    logger.error('Failed to get iframe document for printing');
    return;
  }

  renderSingleDocument(doc, {
    dataUrl,
    orientation: pageOrientation,
    printDelayMs,
    printHeaderCfg: (odv && odv.printHeader) || {},
    tokenContext
  });
}

/**
 * Gather all printable data URLs from canvases/images within a container.
 * Order is DOM order (assumed to match page order).
 * @param {HTMLElement|Document} root
 * @returns {Array.<string>}
 */
function collectAllPrintableDataUrlsFromDom(root) {
  const nodes = (root || document).querySelectorAll?.('canvas, img');
  /** @type {Array.<string>} */
  const urls = [];
  nodes?.forEach((n) => {
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
  const anyHandle = /** @type {*} */ (documentRenderRef?.current);

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

  return collectAllPrintableDataUrlsFromDom(viewerContainerRef?.current || document);
}

/**
 * Print ALL pages/images visible in the viewer, one per page, single column.
 * If `options.pageRange` is provided, only that inclusive range is printed.
 * Descending ranges (e.g., 5→2) are supported.
 * Applies header overlay per config to the PRINTED sequence.
 *
 * @param {{ current: (DocumentRenderHandle|null) }} documentRenderRef
 * @param {PrintAllOptions} [options]
 * @returns {Promise.<void>}
 */
export async function handlePrintAll(documentRenderRef, options = {}) {
  logger.info('handlePrintAll invoked');

  const { printDelayMs = 0, viewerContainerRef, pageRange, reason = '', forWhom = '' } = options;

  const dataUrls = await resolveAllPageDataUrls(documentRenderRef, viewerContainerRef);
  if (!dataUrls.length) {
    logger.error('No printable pages found for Print All');
    return;
  }

  /** @type {Array.<string>} */
  let toPrint = dataUrls;

  if (pageRange && Number.isFinite(pageRange.from) && Number.isFinite(pageRange.to)) {
    const total = dataUrls.length;
    const rawFrom = Math.floor(pageRange.from);
    const rawTo = Math.floor(pageRange.to);
    const from = Math.max(1, Math.min(total, rawFrom));
    const to = Math.max(1, Math.min(total, rawTo));

    if (from <= to) {
      toPrint = dataUrls.slice(from - 1, to);
      logger.info('Printing selected page range (ascending)', { from, to, count: toPrint.length, total });
    } else {
      const seq = [];
      for (let n = from; n >= to; n--) seq.push(dataUrls[n - 1]);
      toPrint = seq;
      logger.info('Printing selected page range (descending)', { from, to, count: toPrint.length, total });
    }
  }

  const odv = getODVConfig();
  const anyHandle = /** @type {*} */ (documentRenderRef?.current);
  const tokenContext = makeBaseTokenContext(anyHandle, reason, forWhom);

  const { frame } = createHiddenIframe(Math.max(2500, 1000 + toPrint.length * 5));
  const doc = frame.contentDocument || frame.contentWindow?.document;
  if (!doc) {
    logger.error('Failed to get iframe document for printing');
    return;
  }

  renderMultiDocument(doc, {
    dataUrls: toPrint,
    printDelayMs,
    printHeaderCfg: (odv && odv.printHeader) || {},
    tokenContext
  });
}

/**
 * Print an explicit sequence of 1-based page indices.
 * Applies header overlay per config to the PRINTED sequence.
 *
 * @param {{ current: (DocumentRenderHandle|null) }} documentRenderRef
 * @param {Array.<number>} sequence
 * @param {PrintAllOptions} [options]
 * @returns {Promise.<void>}
 */
export async function handlePrintSequence(documentRenderRef, sequence, options = {}) {
  const { printDelayMs = 0, viewerContainerRef, reason = '', forWhom = '' } = options || {};

  const dataUrls = await resolveAllPageDataUrls(documentRenderRef, viewerContainerRef);
  if (!Array.isArray(sequence) || !sequence.length) {
    logger.error('handlePrintSequence: empty sequence');
    return;
  }
  if (!dataUrls.length) {
    logger.error('No printable pages found for sequence');
    return;
  }

  const total = dataUrls.length;
  /** @type {Array.<string>} */
  const toPrint = [];
  for (const n of sequence) {
    const idx = Math.floor(n) - 1;
    if (!Number.isFinite(n) || idx < 0 || idx >= total) {
      logger.error('handlePrintSequence: page out of range', { n, total });
      return;
    }
    toPrint.push(dataUrls[idx]);
  }

  const odv = getODVConfig();
  const anyHandle = /** @type {*} */ (documentRenderRef?.current);
  const tokenContext = makeBaseTokenContext(anyHandle, reason, forWhom);

  const { frame } = createHiddenIframe(Math.max(2500, 1000 + toPrint.length * 5));
  const doc = frame.contentDocument || frame.contentWindow?.document;
  if (!doc) {
    logger.error('Failed to get iframe document for printing');
    return;
  }

  renderMultiDocument(doc, {
    dataUrls: toPrint,
    printDelayMs,
    printHeaderCfg: (odv && odv.printHeader) || {},
    tokenContext
  });
}

/**
 * Convenience wrapper: range that can be ascending OR descending.
 * @param {{ current: (DocumentRenderHandle|null) }} documentRenderRef
 * @param {number} from
 * @param {number} to
 * @param {PrintAllOptions} [options]
 * @returns {Promise.<void>}
 */
export function handlePrintRange(documentRenderRef, from, to, options = {}) {
  return handlePrintAll(documentRenderRef, { ...(options || {}), pageRange: { from, to } });
}
