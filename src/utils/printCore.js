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
import { normalizeCompareTransform, selectCompareTransform, splitTransformRotation } from './compareTransform.js';
import { clampOverlayOpacity, getOverlayBottomTarget } from './compareOverlay.js';
import { clampCurtainPosition } from './compareCurtain.js';

// Hidden print-iframe cleanup timing (milliseconds). Kept near the top so maintainers can tune print cleanup without hunting for call-site literals.
const DEFAULT_IFRAME_CLEANUP_MS = 2000;
const MIN_MULTI_PAGE_CLEANUP_MS = 2500;
const BASE_MULTI_PAGE_CLEANUP_MS = 1000;
const PER_PAGE_CLEANUP_MS = 5;

function resolveIframeCleanupDelay(baseMs, printDelayMs = 0) {
  const delayMs = Number(printDelayMs) || 0;
  return Math.max(baseMs, baseMs + delayMs + 500);
}

function normalizePageContexts(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Options for single-page printing.
 * @typedef {Object} PrintOptions
 * @property {'auto'|'portrait'|'landscape'} [orientation='auto']  Page orientation for single-page print.
 * @property {number} [printDelayMs=0]                              Extra delay before print() after image load.
 * @property {{ current: HTMLElement|null }} [viewerContainerRef]   Optional viewer root for DOM fallbacks.
 * @property {string} [reason]                                      Optional reason text to propagate to header tokens.
 * @property {string} [forWhom]                                     Optional "for whom" text to propagate to header tokens.
 * @property {string} [printFormat]                                 Optional print format marker text for header/watermark output.
 * @property {Object} [reasonSelection]                              Structured details for the selected print reason.
 * @property {Object} [printFormatSelection]                         Structured details for the selected print format marker.
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
 * @property {string} [forWhom]                                     Optional "for whom" text to propagate to header tokens.
 * @property {string} [printFormat]                                 Optional print format marker text for header/watermark output.
 * @property {Object} [reasonSelection]                              Structured details for the selected print reason.
 * @property {Object} [printFormatSelection]                         Structured details for the selected print format marker.
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
  const viaHandle = resolvePrintableSurface(documentRenderRef);
  // A failed fine-geometry export must not silently fall back to untransformed DOM content.
  if (typeof documentRenderRef?.current?.getPrintableSurface === 'function') return viaHandle || null;
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
 * @param {function(): void} [onCleanup] Optional hook run when the iframe is cleaned up (afterprint or timeout fallback).
 * @returns {HiddenIframe}
 */
function createHiddenIframe(cleanupDelayMs = DEFAULT_IFRAME_CLEANUP_MS, onCleanup) {
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
    if (typeof onCleanup === 'function') { try { onCleanup(); } catch {} }
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

  const { orientation = 'auto', printDelayMs = 0, viewerContainerRef, reason = '', forWhom = '', printFormat = '', reasonSelection = null, printFormatSelection = null, bundle = null, pageContexts = [] } = options;

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

  // A live <img> blob URL can be superseded (and revoked) while the print is
  // still consuming it. Lease it for the duration of the print; canvas pages
  // snapshot to a data URL above and need no lease.
  const leasedSurfaceUrl = !isCanvas && leaseSurfaceBlobUrl(documentRenderRef, dataUrl)
    ? dataUrl
    : null;

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

  // The iframe cleanup owns the surface lease once installed. Until then a
  // throw (for example from makeBaseTokenContext) must release it here.
  let iframeOwnsLease = false;
  try {
    const odv = getODVConfig();
    const anyHandle = /** @type {*} */ (documentRenderRef?.current);
    const tokenContext = makeBaseTokenContext(anyHandle, reason, forWhom, printFormat, { bundle, reasonSelection, printFormatSelection });

    const { frame, cleanup } = createHiddenIframe(
      resolveIframeCleanupDelay(DEFAULT_IFRAME_CLEANUP_MS, printDelayMs),
      leasedSurfaceUrl ? () => releasePrintableDataUrls(documentRenderRef, [leasedSurfaceUrl]) : undefined
    );
    iframeOwnsLease = true;
    const doc = frame.contentDocument || frame.contentWindow?.document;
    if (!doc) {
      logger.error('Failed to get iframe document for printing');
      cleanup();
      return;
    }

    renderSingleDocument(doc, {
      dataUrl,
      orientation: pageOrientation,
      printDelayMs,
      printHeaderCfg: odv.printHeader || {},
      printFooterCfg: odv.printFooter || {},
      printFormatCfg: odv.print?.format || {},
      tokenContext,
      pageContexts: normalizePageContexts(pageContexts).slice(0, 1)
    });
  } finally {
    if (leasedSurfaceUrl && !iframeOwnsLease) releasePrintableDataUrls(documentRenderRef, [leasedSurfaceUrl]);
  }
}

/**
 * Print both currently visible compare panes as a two-page print job.
 *
 * The helper intentionally prints the currently rendered surfaces instead of the raw session assets
 * so transient per-pane adjustments (rotation / brightness / contrast) are preserved in the output.
 *
 * @param {{ current: (DocumentRenderHandle|null) }} primaryRenderRef
 * @param {{ current: (DocumentRenderHandle|null) }} compareRenderRef
 * @param {PrintOptions} [options]
 * @returns {void}
 */
export function handlePrintCurrentComparison(primaryRenderRef, compareRenderRef, options = {}) {
  logger.info('handlePrintCurrentComparison invoked');

  const { printDelayMs = 0, reason = '', forWhom = '', printFormat = '', reasonSelection = null, printFormatSelection = null, bundle = null, pageContexts = [] } = options;
  const primaryNode = resolvePrintableSurface(primaryRenderRef);
  const compareNode = resolvePrintableSurface(compareRenderRef);
  if (!primaryNode || !compareNode) {
    logger.error('Compare print requested without two active render surfaces');
    return;
  }

  const primaryData = getPrintableDataUrl(primaryNode);
  const compareData = getPrintableDataUrl(compareNode);
  const dataUrls = [primaryData.dataUrl, compareData.dataUrl].filter((value) => typeof value === 'string' && value);
  if (dataUrls.length !== 2) {
    logger.error('Unable to derive printable data URLs for both compare panes');
    return;
  }

  // Lease each live pane blob URL for the duration of the print (see handlePrint).
  const leasedPrimaryUrl = !primaryData.isCanvas && leaseSurfaceBlobUrl(primaryRenderRef, primaryData.dataUrl)
    ? primaryData.dataUrl
    : null;
  const leasedCompareUrl = !compareData.isCanvas && leaseSurfaceBlobUrl(compareRenderRef, compareData.dataUrl)
    ? compareData.dataUrl
    : null;

  // The iframe cleanup owns the pane leases once installed. Until then a throw
  // (for example from makeBaseTokenContext) must release them here.
  let iframeOwnsLease = false;
  try {
    const odv = getODVConfig();
    const anyHandle = /** @type {*} */ (primaryRenderRef?.current);
    const tokenContext = makeBaseTokenContext(anyHandle, reason, forWhom, printFormat, { bundle, reasonSelection, printFormatSelection });

    const { frame, cleanup } = createHiddenIframe(
      resolveIframeCleanupDelay(MIN_MULTI_PAGE_CLEANUP_MS, printDelayMs),
      leasedPrimaryUrl || leasedCompareUrl
        ? () => {
          if (leasedPrimaryUrl) releasePrintableDataUrls(primaryRenderRef, [leasedPrimaryUrl]);
          if (leasedCompareUrl) releasePrintableDataUrls(compareRenderRef, [leasedCompareUrl]);
        }
        : undefined
    );
    iframeOwnsLease = true;
    const doc = frame.contentDocument || frame.contentWindow?.document;
    if (!doc) {
      logger.error('Failed to get iframe document for compare printing');
      cleanup();
      return;
    }

    renderMultiDocument(doc, {
      dataUrls,
      printDelayMs,
      printHeaderCfg: odv.printHeader || {},
      printFooterCfg: odv.printFooter || {},
      printFormatCfg: odv.print?.format || {},
      tokenContext,
      pageContexts: normalizePageContexts(pageContexts).slice(0, dataUrls.length),
    });
  } finally {
    if (!iframeOwnsLease) {
      if (leasedPrimaryUrl) releasePrintableDataUrls(primaryRenderRef, [leasedPrimaryUrl]);
      if (leasedCompareUrl) releasePrintableDataUrls(compareRenderRef, [leasedCompareUrl]);
    }
  }
}

// Longest side of a composed overlay/curtain page in canvas pixels. Larger frames (pages zoomed far
// apart) are scaled down; 8192 px still exceeds 600 dpi on A4.
const MAX_COMPOSED_PAGE_DIMENSION = 8192;

/**
 * View state of the overlay view needed to print it (utils/compareOverlay.js).
 * @typedef {Object} CompareOverlayPrintView
 * @property {number} opacity                                  Opacity of the top page in percent, 0–100.
 * @property {('primary'|'compare')} top                        The page drawn on top.
 * @property {{ primary:Object, compare:Object }} transforms    Per-page compare transforms (utils/compareTransform.js).
 * @property {number} [zoom=1]                                  Shared base zoom (CSS px per page pixel).
 * @property {{ width:number, height:number }} [stage]          Visible stage in CSS px; when given, the composed page is that window.
 */

/**
 * View state of the curtain view needed to print it (utils/compareCurtain.js).
 * @typedef {Object} CompareCurtainPrintView
 * @property {('horizontal'|'vertical')} mode                   Orientation of the border.
 * @property {number} position                                  Border position in percent of the stage.
 * @property {{ primary:Object, compare:Object }} transforms    Per-page compare transforms (utils/compareTransform.js).
 * @property {number} [zoom=1]                                  Shared base zoom (CSS px per page pixel).
 * @property {{ width:number, height:number }} [stage]          Visible stage in CSS px; when given, the composed page is that window.
 */

/**
 * One page placed in the shared page-pixel space of a composed compare page.
 * @typedef {Object} ComposedPagePlacement
 * @property {(HTMLCanvasElement|HTMLImageElement)} node   The rendered page surface.
 * @property {number} width                                Surface width in page pixels.
 * @property {number} height                               Surface height in page pixels.
 * @property {number} cx                                   Transform origin (page centre), x.
 * @property {number} cy                                   Transform origin (page centre), y.
 * @property {number} scale                                Compare transform scale.
 * @property {number} ox                                   Pan in page pixels (dx / zoom).
 * @property {number} oy                                   Pan in page pixels (dy / zoom).
 * @property {number} angle                                Residual rotation in radians.
 */

/**
 * Intrinsic pixel size of a rendered page surface (the canvas already carries the quarter turn).
 * @param {(HTMLCanvasElement|HTMLImageElement)} node
 * @returns {{ width:number, height:number }}
 */
function surfaceSize(node) {
  if ((node?.tagName || '').toLowerCase() === 'canvas') {
    return { width: Number(node.width) || 0, height: Number(node.height) || 0 };
  }
  const img = /** @type {HTMLImageElement} */ (node);
  return { width: Number(img?.naturalWidth) || 0, height: Number(img?.naturalHeight) || 0 };
}

/**
 * Placement of one page in the shared page-pixel space. The viewer applies
 * `scale(s) translate(dx, dy) rotate(residual)` around the page centre on a stage zoomed by the base
 * zoom, so in page pixels a point p maps to `c + s × (R(p − c) + d / zoom)`.
 *
 * @param {(HTMLCanvasElement|HTMLImageElement)} node
 * @param {*} transform
 * @param {number} zoom
 * @returns {ComposedPagePlacement}
 */
function placeComposedPage(node, transform, zoom) {
  const { width, height } = surfaceSize(node);
  const t = normalizeCompareTransform(transform);
  return {
    node,
    width,
    height,
    cx: width / 2,
    cy: height / 2,
    scale: t.scale,
    ox: t.dx / zoom,
    oy: t.dy / zoom,
    angle: (splitTransformRotation(t.rotation).residual * Math.PI) / 180,
  };
}

/**
 * @param {ComposedPagePlacement} page
 * @returns {{ minX:number, minY:number, maxX:number, maxY:number }}
 */
function placedPageBounds(page) {
  const cos = Math.cos(page.angle);
  const sin = Math.sin(page.angle);
  const xs = [];
  const ys = [];
  [[0, 0], [page.width, 0], [0, page.height], [page.width, page.height]].forEach(([x, y]) => {
    const rx = (x - page.cx) * cos - (y - page.cy) * sin + page.ox;
    const ry = (x - page.cx) * sin + (y - page.cy) * cos + page.oy;
    xs.push(page.cx + page.scale * rx);
    ys.push(page.cy + page.scale * ry);
  });
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/**
 * The area of the composed page in page pixels: the visible stage when its size is known (both
 * pages share the stage's top-left as origin), otherwise the union of both transformed pages.
 *
 * @param {Array<ComposedPagePlacement>} pages
 * @param {number} zoom
 * @param {*} stage
 * @returns {{ x:number, y:number, width:number, height:number }}
 */
function resolveComposeFrame(pages, zoom, stage) {
  const stageWidth = Number(stage?.width) || 0;
  const stageHeight = Number(stage?.height) || 0;
  if (stageWidth > 0 && stageHeight > 0) {
    return { x: 0, y: 0, width: stageWidth / zoom, height: stageHeight / zoom };
  }
  const bounds = pages.map(placedPageBounds);
  const minX = Math.min(...bounds.map((b) => b.minX));
  const minY = Math.min(...bounds.map((b) => b.minY));
  return {
    x: minX,
    y: minY,
    width: Math.max(...bounds.map((b) => b.maxX)) - minX,
    height: Math.max(...bounds.map((b) => b.maxY)) - minY,
  };
}

/**
 * Draw one placed page onto the composed canvas.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {ComposedPagePlacement} page
 * @param {{ x:number, y:number }} frame
 * @param {number} k Output pixels per page pixel.
 * @returns {void}
 */
function drawComposedPage(ctx, page, frame, k) {
  ctx.save();
  // `+ 0` keeps a zero frame origin from becoming a negative zero.
  ctx.setTransform(k, 0, 0, k, -frame.x * k + 0, -frame.y * k + 0);
  ctx.translate(page.cx, page.cy);
  ctx.scale(page.scale, page.scale);
  ctx.translate(page.ox, page.oy);
  ctx.rotate(page.angle);
  ctx.translate(-page.cx, -page.cy);
  ctx.drawImage(page.node, 0, 0, page.width, page.height);
  ctx.restore();
}

/**
 * Active page output uses the untransformed page frame as its sheet. Preserve CSS fine geometry
 * inside that frame (white outside the image, clipping at page edges), at raster resolution.
 * Quarter turns and image filters are already drawn in the source surface.
 * @param {HTMLCanvasElement|HTMLImageElement} node
 * @param {Object} transform
 * @param {number} zoom
 * @returns {HTMLCanvasElement|null}
 */
export function composePagePrintCanvas(node, transform, zoom) {
  const page = placeComposedPage(node, transform, Number(zoom) > 0 ? Number(zoom) : 1);
  if (!page.width || !page.height) return null;
  const k = Math.min(1, MAX_COMPOSED_PAGE_DIMENSION / Math.max(page.width, page.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(page.width * k));
  canvas.height = Math.max(1, Math.round(page.height * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawComposedPage(ctx, page, { x: 0, y: 0 }, k);
  return canvas;
}

/** Active print/export preserves fine geometry; composed views explicitly use raw surfaces. */
export function resolvePrintableSurface(renderRef) {
  const handle = renderRef?.current;
  return typeof handle?.getPrintableSurface === 'function'
    ? handle.getPrintableSurface() : handle?.getActiveCanvas?.();
}

/**
 * Shared set-up of a composed compare page: place both pages, size the offscreen canvas and paint
 * a white sheet. Returns null when a surface has no size or no 2D context is available.
 *
 * @param {(HTMLCanvasElement|HTMLImageElement)} primaryNode
 * @param {(HTMLCanvasElement|HTMLImageElement)} compareNode
 * @param {(CompareOverlayPrintView|CompareCurtainPrintView)} view
 * @returns {({ canvas:HTMLCanvasElement, ctx:CanvasRenderingContext2D, frame:Object, k:number, primary:Object, compare:Object }|null)}
 */
function beginComposedPage(primaryNode, compareNode, view) {
  const zoom = Number(view?.zoom) > 0 ? Number(view.zoom) : 1;
  const primary = placeComposedPage(primaryNode, selectCompareTransform(view?.transforms, 'primary'), zoom);
  const compare = placeComposedPage(compareNode, selectCompareTransform(view?.transforms, 'compare'), zoom);
  if (!primary.width || !primary.height || !compare.width || !compare.height) return null;

  const frame = resolveComposeFrame([primary, compare], zoom, view?.stage);
  if (!(frame.width > 0) || !(frame.height > 0)) return null;
  const k = Math.min(1, MAX_COMPOSED_PAGE_DIMENSION / Math.max(frame.width, frame.height));

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(frame.width * k));
  canvas.height = Math.max(1, Math.round(frame.height * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx, frame, k, primary, compare };
}

/**
 * Compose the overlay view onto one canvas: the bottom page opaque, the top page at the view's
 * opacity, each page with its own compare transform.
 *
 * @param {(HTMLCanvasElement|HTMLImageElement)} primaryNode Page A surface.
 * @param {(HTMLCanvasElement|HTMLImageElement)} compareNode Page B surface.
 * @param {CompareOverlayPrintView} view
 * @returns {(HTMLCanvasElement|null)}
 */
export function composeCompareOverlayCanvas(primaryNode, compareNode, view) {
  const page = beginComposedPage(primaryNode, compareNode, view);
  if (!page) return null;
  const top = view?.top === 'primary' ? 'primary' : 'compare';
  const { ctx, frame, k } = page;
  ctx.globalAlpha = 1;
  drawComposedPage(ctx, page[getOverlayBottomTarget(top)], frame, k);
  ctx.globalAlpha = clampOverlayOpacity(view?.opacity) / 100;
  drawComposedPage(ctx, page[top], frame, k);
  ctx.globalAlpha = 1;
  return page.canvas;
}

/**
 * Compose the curtain view onto one canvas: page A whole, page B clipped to its side of the border
 * (below a horizontal border, right of a vertical one), each page with its own compare transform.
 * The border position is a percentage of the composed page, as it is of the stage on screen.
 *
 * @param {(HTMLCanvasElement|HTMLImageElement)} primaryNode Page A surface.
 * @param {(HTMLCanvasElement|HTMLImageElement)} compareNode Page B surface.
 * @param {CompareCurtainPrintView} view
 * @returns {(HTMLCanvasElement|null)}
 */
export function composeCompareCurtainCanvas(primaryNode, compareNode, view) {
  const page = beginComposedPage(primaryNode, compareNode, view);
  if (!page) return null;
  const { canvas, ctx, frame, k } = page;
  const share = clampCurtainPosition(view?.position) / 100;
  drawComposedPage(ctx, page.primary, frame, k);

  ctx.save();
  ctx.beginPath();
  if (view?.mode === 'horizontal') {
    const y = canvas.height * share;
    ctx.rect(0, y, canvas.width, canvas.height - y);
  } else {
    const x = canvas.width * share;
    ctx.rect(x, 0, canvas.width - x, canvas.height);
  }
  ctx.clip();
  drawComposedPage(ctx, page.compare, frame, k);
  ctx.restore();
  return canvas;
}

/**
 * Shared body of the overlay and curtain print (after their `invoked` log line): one composed page
 * through the single-page print document, with the same config and base token context as the
 * side-by-side compare print.
 *
 * @param {string} name Calling function, for the log lines.
 * @param {function(*, *, Object):(HTMLCanvasElement|null)} compose
 * @param {{ current: (DocumentRenderHandle|null) }} primaryRenderRef
 * @param {{ current: (DocumentRenderHandle|null) }} compareRenderRef
 * @param {Object} view
 * @param {PrintOptions} options
 * @returns {void}
 */
function printComposedComparison(name, compose, primaryRenderRef, compareRenderRef, view, options) {
  const { printDelayMs = 0, reason = '', forWhom = '', printFormat = '', reasonSelection = null, printFormatSelection = null, bundle = null, pageContexts = [] } = options;
  const primaryNode = primaryRenderRef?.current?.getActiveCanvas?.();
  const compareNode = compareRenderRef?.current?.getActiveCanvas?.();
  if (!primaryNode || !compareNode) {
    logger.error('Compare view print requested without two active render surfaces', { name });
    return;
  }

  if (!getPrintableDataUrl(primaryNode).dataUrl || !getPrintableDataUrl(compareNode).dataUrl) {
    logger.error('Unable to derive printable data URLs for both compared pages', { name });
    return;
  }

  const composed = compose(primaryNode, compareNode, view);
  const { dataUrl } = composed ? getPrintableDataUrl(composed) : { dataUrl: null };
  if (!dataUrl) {
    logger.error('Unable to compose the compared pages into one printable page', { name });
    return;
  }

  const odv = getODVConfig();
  const anyHandle = /** @type {*} */ (primaryRenderRef?.current);
  const tokenContext = makeBaseTokenContext(anyHandle, reason, forWhom, printFormat, { bundle, reasonSelection, printFormatSelection });

  const { frame, cleanup } = createHiddenIframe(
    resolveIframeCleanupDelay(DEFAULT_IFRAME_CLEANUP_MS, printDelayMs)
  );
  const doc = frame.contentDocument || frame.contentWindow?.document;
  if (!doc) {
    logger.error('Failed to get iframe document for compare view printing', { name });
    cleanup();
    return;
  }

  renderSingleDocument(doc, {
    dataUrl,
    orientation: resolveOrientation(composed.width, composed.height, options.orientation || 'auto'),
    printDelayMs,
    printHeaderCfg: odv.printHeader || {},
    printFooterCfg: odv.printFooter || {},
    printFormatCfg: odv.print?.format || {},
    tokenContext,
    pageContexts: normalizePageContexts(pageContexts).slice(0, 1),
  });
}

/**
 * Print the overlay view as ONE page: page B over page A (or the other way round after a swap) at
 * the current opacity, each page with its own compare transform.
 *
 * @param {{ current: (DocumentRenderHandle|null) }} primaryRenderRef Page A (left) render handle.
 * @param {{ current: (DocumentRenderHandle|null) }} compareRenderRef Page B (right) render handle.
 * @param {CompareOverlayPrintView} view Current overlay settings and calibration.
 * @param {PrintOptions} [options]
 * @returns {void}
 */
export function handlePrintCompareOverlay(primaryRenderRef, compareRenderRef, view, options = {}) {
  logger.info('handlePrintCompareOverlay invoked');

  printComposedComparison('handlePrintCompareOverlay', composeCompareOverlayCanvas, primaryRenderRef, compareRenderRef, view, options);
}

/**
 * Print the curtain view as ONE page: page A with page B clipped at the current border, each page
 * with its own compare transform.
 *
 * @param {{ current: (DocumentRenderHandle|null) }} primaryRenderRef Page A (left) render handle.
 * @param {{ current: (DocumentRenderHandle|null) }} compareRenderRef Page B (right) render handle.
 * @param {CompareCurtainPrintView} view Current border orientation/position and calibration.
 * @param {PrintOptions} [options]
 * @returns {void}
 */
export function handlePrintCompareCurtain(primaryRenderRef, compareRenderRef, view, options = {}) {
  logger.info('handlePrintCompareCurtain invoked');

  printComposedComparison('handlePrintCompareCurtain', composeCompareCurtainCanvas, primaryRenderRef, compareRenderRef, view, options);
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
 * Only blob URLs can be revoked mid-print by the provider; data: and remote URLs
 * need no lease (releasing them is a no-op).
 *
 * @param {*} url
 * @returns {boolean}
 */
function isLeasableSurfaceUrl(url) {
  return typeof url === 'string' && /^blob:/i.test(url);
}

/**
 * Lease a live surface blob URL for the duration of a print flow so a
 * supersession (resolution boost, force-refresh) cannot revoke it mid-print.
 * Foreign handles without a lease function are ignored.
 *
 * @param {{ current: * }} documentRenderRef
 * @param {string} url
 * @returns {boolean} True when a lease was acquired (the caller must release it).
 */
function leaseSurfaceBlobUrl(documentRenderRef, url) {
  if (!isLeasableSurfaceUrl(url)) return false;
  try {
    const lease = documentRenderRef?.current?.leasePrintablePageUrl;
    if (typeof lease !== 'function') return false;
    lease.call(documentRenderRef.current, url);
    return true;
  } catch (error) {
    logger.warn('leasePrintablePageUrl() failed', { error: String(error?.message || error) });
    return false;
  }
}

/**
 * Release print URL leases held through the document renderer. The provider revokes a
 * released URL once no live page state references it; DOM-derived URLs and foreign
 * handles without a release function are ignored.
 *
 * @param {{ current: * }} documentRenderRef
 * @param {Array<string>} urls
 * @returns {void}
 */
function releasePrintableDataUrls(documentRenderRef, urls) {
  try {
    const release = documentRenderRef?.current?.releasePrintableDataUrls;
    if (typeof release === 'function' && Array.isArray(urls) && urls.length > 0) {
      release.call(documentRenderRef.current, urls);
    }
  } catch (error) {
    logger.warn('releasePrintableDataUrls() failed', { error: String(error?.message || error) });
  }
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

  const { printDelayMs = 0, viewerContainerRef, pageRange, reason = '', forWhom = '', printFormat = '', reasonSelection = null, printFormatSelection = null, bundle = null, pageContexts = [] } = options;

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
      for (let n = from; n >= to; n -= 1) {
        seq.push(dataUrls[n - 1]);
      }
      toPrint = seq;
      logger.info('Printing selected page range (descending)', { from, to, count: toPrint.length, total });
    }
  }

  // The iframe cleanup owns the collected URL leases once installed. Until then a
  // throw (for example from makeBaseTokenContext) must release them here.
  let iframeOwnsLease = false;
  try {
    const odv = getODVConfig();
    const anyHandle = /** @type {*} */ (documentRenderRef?.current);
    const tokenContext = makeBaseTokenContext(anyHandle, reason, forWhom, printFormat, { bundle, reasonSelection, printFormatSelection });

    const { frame, cleanup } = createHiddenIframe(
      resolveIframeCleanupDelay(
        Math.max(
          MIN_MULTI_PAGE_CLEANUP_MS,
          BASE_MULTI_PAGE_CLEANUP_MS + toPrint.length * PER_PAGE_CLEANUP_MS
        ),
        printDelayMs
      ),
      () => releasePrintableDataUrls(documentRenderRef, dataUrls)
    );
    iframeOwnsLease = true;
    const doc = frame.contentDocument || frame.contentWindow?.document;
    if (!doc) {
      logger.error('Failed to get iframe document for printing');
      cleanup();
      return;
    }

    renderMultiDocument(doc, {
      dataUrls: toPrint,
      printDelayMs,
      printHeaderCfg: odv.printHeader || {},
      printFooterCfg: odv.printFooter || {},
      printFormatCfg: odv.print?.format || {},
      tokenContext,
      pageContexts: normalizePageContexts(pageContexts).slice(0, toPrint.length)
    });
  } finally {
    if (!iframeOwnsLease) releasePrintableDataUrls(documentRenderRef, dataUrls);
  }
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
  const { printDelayMs = 0, viewerContainerRef, reason = '', forWhom = '', printFormat = '', reasonSelection = null, printFormatSelection = null, bundle = null, pageContexts = [] } = options || {};

  const dataUrls = await resolveAllPageDataUrls(documentRenderRef, viewerContainerRef);
  if (!Array.isArray(sequence) || !sequence.length) {
    logger.error('handlePrintSequence: empty sequence');
    releasePrintableDataUrls(documentRenderRef, dataUrls);
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
      releasePrintableDataUrls(documentRenderRef, dataUrls);
      return;
    }
    toPrint.push(dataUrls[idx]);
  }

  // The iframe cleanup owns the collected URL leases once installed. Until then a
  // throw (for example from makeBaseTokenContext) must release them here.
  let iframeOwnsLease = false;
  try {
    const odv = getODVConfig();
    const anyHandle = /** @type {*} */ (documentRenderRef?.current);
    const tokenContext = makeBaseTokenContext(anyHandle, reason, forWhom, printFormat, { bundle, reasonSelection, printFormatSelection });

    const { frame, cleanup } = createHiddenIframe(
      resolveIframeCleanupDelay(
        Math.max(
          MIN_MULTI_PAGE_CLEANUP_MS,
          BASE_MULTI_PAGE_CLEANUP_MS + toPrint.length * PER_PAGE_CLEANUP_MS
        ),
        printDelayMs
      ),
      () => releasePrintableDataUrls(documentRenderRef, dataUrls)
    );
    iframeOwnsLease = true;
    const doc = frame.contentDocument || frame.contentWindow?.document;
    if (!doc) {
      logger.error('Failed to get iframe document for printing');
      cleanup();
      return;
    }

    renderMultiDocument(doc, {
      dataUrls: toPrint,
      printDelayMs,
      printHeaderCfg: odv.printHeader || {},
      printFooterCfg: odv.printFooter || {},
      printFormatCfg: odv.print?.format || {},
      tokenContext,
      pageContexts: normalizePageContexts(pageContexts).slice(0, toPrint.length)
    });
  } finally {
    if (!iframeOwnsLease) releasePrintableDataUrls(documentRenderRef, dataUrls);
  }
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
