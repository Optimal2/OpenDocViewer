// File: src/utils/printCore.js
/**
 * File: src/utils/printCore.js
 *
 * Core print coordinator for the frontend.
 *
 * Responsibilities:
 * - gather printable surfaces or source URLs for the requested print mode
 * - render printable DOM into a hidden iframe
 * - apply optional print-header overlays and token substitution
 * - trigger printing and clean up the iframe afterwards
 *
 * Lower-level DOM generation lives in `printDom.js`, while parsing/token helpers live in the dedicated
 * `printParse.js` and `printTemplate.js` modules.
 */

import logger from '../logging/systemLogger.js';
import { renderSingleDocument, renderMultiDocument } from './printDom.js';
import { makeBaseTokenContext } from './printTemplate.js';
import { isSafeImageSrc } from './printSanitize.js';

// Hidden print-iframe cleanup timing (milliseconds). Kept near the top so maintainers can tune print cleanup without hunting for call-site literals.
const DEFAULT_IFRAME_CLEANUP_MS = 2000;
const MIN_MULTI_PAGE_CLEANUP_MS = 2500;
const BASE_MULTI_PAGE_CLEANUP_MS = 1000;
const PER_PAGE_CLEANUP_MS = 5;

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
 * @property {number=} heightPx
 * @property {(string|Object.<string,string>)=} template
 * @property {string=} css
 */

/**
 * Return type for the hidden-iframe factory.
 * @typedef {Object} HiddenIframe
 * @property {HTMLIFrameElement} frame
 * @property {function(): void} cleanup
 */

/**
 * Check whether a candidate element is both present in layout and not hidden by basic CSS visibility.
 * This is used before selecting DOM fallbacks for printing.
 *
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
 * Read runtime configuration from the globals populated by `public/odv.config.js`.
 * The function is intentionally tolerant so print actions can still proceed when no config is present.
 *
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
 * Create the temporary hidden iframe used as the print document host.
 *
 * The iframe is removed on `afterprint` when possible and also via a timeout fallback so abandoned
 * print dialogs do not leave detached iframes behind.
 *
 * @param {number} [cleanupDelayMs=DEFAULT_IFRAME_CLEANUP_MS]
 * @returns {HiddenIframe}
 */
function createHiddenIframe(cleanupDelayMs = DEFAULT_IFRAME_CLEANUP_MS) {
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

  const { frame } = createHiddenIframe(DEFAULT_IFRAME_CLEANUP_MS);
  const doc = frame.contentDocument || frame.contentWindow?.document;
  if (!doc) {
    logger.error('Failed to get iframe document for printing');
    return;
  }

  renderSingleDocument(doc, {
    dataUrl,
    orientation: pageOrientation,
    printDelayMs,
    printHeaderCfg: odv.printHeader || {},
    tokenContext
  });
}

/**
 * Collect printable image sources from the DOM as a fallback when the renderer handle cannot provide
 * an explicit all-pages list.
 *
 * @param {HTMLElement|Document} root
 * @returns {Array<string>}
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
 * Resolve all printable page URLs, preferring the renderer's imperative API and falling back to DOM inspection.
 *
 * @param {{ current: (DocumentRenderHandle|null) }} documentRenderRef
 * @param {{ current: HTMLElement|null }|undefined} viewerContainerRef
 * @returns {Promise<Array<string>>}
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
 * Print all available pages in viewer order.
 *
 * If `options.pageRange` is provided, only that inclusive range is printed. Descending ranges
 * (for example `5 → 2`) are supported and keep the requested order.
 *
 * @param {{ current: (DocumentRenderHandle|null) }} documentRenderRef
 * @param {PrintAllOptions} [options]
 * @returns {Promise<void>}
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

  const { frame } = createHiddenIframe(
    Math.max(
      MIN_MULTI_PAGE_CLEANUP_MS,
      BASE_MULTI_PAGE_CLEANUP_MS + toPrint.length * PER_PAGE_CLEANUP_MS
    )
  );
  const doc = frame.contentDocument || frame.contentWindow?.document;
  if (!doc) {
    logger.error('Failed to get iframe document for printing');
    return;
  }

  renderMultiDocument(doc, {
    dataUrls: toPrint,
    printDelayMs,
    printHeaderCfg: odv.printHeader || {},
    tokenContext
  });
}

/**
 * Print an explicit page sequence such as `3,1,2`.
 *
 * @param {{ current: (DocumentRenderHandle|null) }} documentRenderRef
 * @param {Array<number>} sequence
 * @param {PrintAllOptions} [options]
 * @returns {Promise<void>}
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

  const { frame } = createHiddenIframe(
    Math.max(
      MIN_MULTI_PAGE_CLEANUP_MS,
      BASE_MULTI_PAGE_CLEANUP_MS + toPrint.length * PER_PAGE_CLEANUP_MS
    )
  );
  const doc = frame.contentDocument || frame.contentWindow?.document;
  if (!doc) {
    logger.error('Failed to get iframe document for printing');
    return;
  }

  renderMultiDocument(doc, {
    dataUrls: toPrint,
    printDelayMs,
    printHeaderCfg: odv.printHeader || {},
    tokenContext
  });
}

/**
 * Print an inclusive page range.
 *
 * This is a thin wrapper over `handlePrintAll()` that injects `options.pageRange`, so it has the
 * same async return type as the underlying multi-page print path.
 *
 * @param {{ current: (DocumentRenderHandle|null) }} documentRenderRef
 * @param {number} from
 * @param {number} to
 * @param {PrintAllOptions} [options]
 * @returns {Promise<void>}
 */
export function handlePrintRange(documentRenderRef, from, to, options = {}) {
  return handlePrintAll(documentRenderRef, { ...(options || {}), pageRange: { from, to } });
}