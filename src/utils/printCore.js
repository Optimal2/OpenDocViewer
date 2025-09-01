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

/** Zero-pad helper. */
function z2(n) { return (n < 10 ? '0' : '') + n; }

/**
 * Make a shallow "context" object for token substitution in header templates.
 * `doc` and `user` are best-effort and may be empty objects.
 *
 * Adds:
 *   - date: YYYY-MM-DD (local)
 *   - time: HH:MM (24h, local)
 *
 * @param {Object|undefined} handle   Optional imperative handle for doc metadata (best-effort).
 * @param {string} reason
 * @param {string} forWhom
 * @returns {{ now: string, date: string, time: string, reason: string, forWhom: string, user: Object, doc: Object, viewer: Object }}
 */
function makeBaseTokenContext(handle, reason, forWhom) {
  /** @type {any} */
  const user = (/** @type {any} */ (window)).__ODV_USER__ || {};
  /** @type {any} */
  const viewer = { version: (/** @type {any} */ (window)).__ODV_VERSION__ || '' };

  /** @type {any} */
  let doc = {};
  try {
    if (handle && typeof (/** @type {any} */ (handle)).getDocumentMeta === 'function') {
      const meta = (/** @type {any} */ (handle)).getDocumentMeta();
      if (meta && typeof meta === 'object') doc = meta;
    } else if (handle && typeof (/** @type {any} */ (handle)).getDocumentSummary === 'function') {
      const meta = (/** @type {any} */ (handle)).getDocumentSummary();
      if (meta && typeof meta === 'object') doc = meta;
    }
  } catch {
    // best-effort only
  }

  const now = new Date();
  const y = now.getFullYear();
  const m = z2(now.getMonth() + 1);
  const d = z2(now.getDate());
  const hh = z2(now.getHours());
  const mm = z2(now.getMinutes());

  return {
    // Back-compat token:
    now: now.toLocaleString ? now.toLocaleString() : now.toISOString(),
    // New explicit tokens for formatting:
    date: y + '-' + m + '-' + d,      // YYYY-MM-DD
    time: hh + ':' + mm,              // HH:MM (24h)
    reason: reason || '',
    forWhom: forWhom || '',
    user,
    doc,
    viewer
  };
}

/**
 * Resolve a dotted-path property from an object (e.g., path "doc.title").
 * @param {Object} obj
 * @param {string} path
 * @returns {any}
 */
function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  /** @type {any} */
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    const k = parts[i];
    if (cur && Object.prototype.hasOwnProperty.call(cur, k)) {
      cur = cur[k];
    } else {
      return undefined;
    }
  }
  return cur;
}

/**
 * Perform simple token substitution for strings like:
 *   "${now} | ${doc.title||''} | Page ${page}/${totalPages}"
 * Supported form: ${path} or ${path||fallbackLiteral}
 * - path may be "reason", "forWhom", "user.name", "doc.title", "page", "totalPages", "date", "time", etc.
 * - fallbackLiteral is used if resolved value is null/undefined/empty string; quotes may be single or double.
 *
 * @param {string} tpl
 * @param {Object} tokenContext
 * @returns {string}
 */
function applyTemplateTokens(tpl, tokenContext) {
  if (typeof tpl !== 'string' || !tpl) return '';
  return tpl.replace(/\$\{([^}]+)\}/g, function (_m, inner) {
    const raw = String(inner || '').trim();
    // Support "path||'fallback'" syntax
    const parts = raw.split('||');
    const path = (parts[0] || '').trim();
    let val;
    if (path) {
      val = getByPath(tokenContext, path);
    }
    if (val === undefined || val === null || String(val) === '') {
      if (parts.length > 1) {
        // Parse simple quoted literal or bare text fallback
        const fb = parts.slice(1).join('||').trim();
        // Remove surrounding quotes if present
        const m = fb.match(/^(['"])(.*)\1$/);
        return m ? m[2] : fb;
      }
      return '';
    }
    return String(val);
  });
}

/**
 * Build the print-only CSS (inlined within the print iframe).
 * Includes base rules for pages, image fit, and the header overlay class,
 * and appends admin-provided CSS (string) if present.
 *
 * @param {string} extraCss
 * @returns {string}
 */
function buildPrintCss(extraCss) {
  const base =
    '@media print{@page{margin:0;}html,body{height:100%;}}' +
    'html,body{margin:0;padding:0;background:#fff;height:100%;}' +
    '.page{break-after:page;-webkit-break-after:page;page-break-after:always;' +
      'display:flex;align-items:center;justify-content:center;min-height:100vh;' +
      'box-sizing:border-box;overflow:hidden;position:relative;}' +
    '.page.last{break-after:auto;-webkit-break-after:auto;page-break-after:auto;}' +
    '.page img{display:block;width:auto;height:auto;max-width:100vw;max-height:100vh;object-fit:contain;' +
      'page-break-inside:avoid;break-inside:avoid;}' +
    '.odv-print-header{pointer-events:none;z-index:2147483647;}';

  const css = base + (typeof extraCss === 'string' && extraCss ? String(extraCss) : '');
  // Use <style media="print"> to scope to printing context (still present in preview)
  return '<style media="print">' + css + '</style>';
}

/**
 * Decide if a header should be applied to the i-th page in a sequence of N,
 * according to "all" | "first" | "last".
 * @param {"all"|"first"|"last"} applyTo
 * @param {number} index1  1-based index within the printed SEQUENCE
 * @param {number} total   total printed pages in the SEQUENCE
 * @returns {boolean}
 */
function shouldApplyHeader(applyTo, index1, total) {
  if (applyTo === 'first') return index1 === 1;
  if (applyTo === 'last') return index1 === total;
  return true; // "all" or any unknown → default all
}

/**
 * Create a single header DIV markup for a page using config + tokens.
 *
 * @param {PrintHeaderCfg} cfg
 * @param {Object} tokenContext
 * @param {number} page     1-based page number in the CURRENT printed sequence
 * @param {number} total    total pages in the CURRENT printed sequence
 * @returns {string}        HTML string, or empty string if not applicable
 */
function buildHeaderDivHtml(cfg, tokenContext, page, total) {
  if (!cfg || !cfg.enabled) return '';
  const applyTo = /** @type {("all"|"first"|"last")} */ (cfg.applyTo || 'all');
  if (!shouldApplyHeader(applyTo, page, total)) return '';

  const pos = (cfg.position || 'top') === 'bottom' ? 'bottom:0;' : 'top:0;';
  const tpl = cfg.template || '';
  const content = applyTemplateTokens(tpl, { ...tokenContext, page, totalPages: total });

  // Inline position for overlay, allow admin CSS to style content
  return '<div class="odv-print-header" style="position:absolute;' + pos + 'left:0;right:0;">' +
           content +
         '</div>';
}

/**
 * Create a minimal, print-ready HTML document string embedding a single raster image.
 * Includes optional header overlay per config.
 *
 * @param {string} dataUrl
 * @param {'portrait'|'landscape'} orientation
 * @param {number} printDelayMs
 * @param {Object} odvConfig
 * @param {Object} tokenContext
 * @returns {string}
 */
function buildPrintHtml(dataUrl, orientation, printDelayMs, odvConfig, tokenContext) {
  const ph = (odvConfig && odvConfig.printHeader) || {};
  const css = buildPrintCss(ph.css || '');

  const header = ph.enabled
    ? buildHeaderDivHtml(ph, tokenContext, 1, 1)
    : '';

  // Wrap in .page to unify with multi-page layout
  const body =
    '<div class="page last">' +
      header +
      '<img id="__odv_print_image__" alt="Printable Document" src="' + dataUrl + '" />' +
    '</div>';

  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Print</title><style>' +
    '@media print{@page{size:' + orientation + ';margin:0;}}' +
    '</style>' +
    css +
    '</head><body>' +
    body +
    '<script>(function(){function g(){try{window.print()}catch(e){}}var d=' + (Math.max(0, Number(printDelayMs) || 0)) + ';' +
    'var i=document.getElementById("__odv_print_image__");if(i&&i.complete){setTimeout(g,d)}else if(i){i.addEventListener("load",function(){setTimeout(g,d)},{once:true})}})();</script>' +
    '</body></html>'
  );
}

/**
 * Build a multi-page print HTML with one image per page, single column, page breaks between items.
 * Injects header overlay per page if enabled by config.
 *
 * @param {Array.<string>} dataUrls
 * @param {number} printDelayMs
 * @param {Object} odvConfig
 * @param {Object} tokenContext
 * @returns {string}
 */
function buildPrintAllHtml(dataUrls, printDelayMs, odvConfig, tokenContext) {
  const total = dataUrls.length;
  const ph = (odvConfig && odvConfig.printHeader) || {};
  const css = buildPrintCss(ph.css || '');

  const imgs = dataUrls
    .map((src, i) => {
      const index1 = i + 1;
      const last = i === total - 1;
      const header = ph.enabled ? buildHeaderDivHtml(ph, tokenContext, index1, total) : '';
      return '<div class="page' + (last ? ' last' : '') + '">' +
               header +
               '<img alt="Page ' + index1 + '" src="' + src + '" />' +
             '</div>';
    })
    .join('');

  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Print All</title>' +
    css +
    '</head><body>' +
    imgs +
    '<script>(function(){var d=' + (Math.max(0, Number(printDelayMs) || 0)) + ';' +
    'var a=Array.prototype.slice.call(document.images||[]);function L(i){return i.complete&&(typeof i.naturalWidth==="undefined"||i.naturalWidth>0)}' +
    'function whenAllLoaded(list,cb){var r=list.length;if(r===0)return cb();list.forEach(function(i){if(L(i)){if(--r===0)cb();return}i.addEventListener("load",function(){if(--r===0)cb()},{once:true});i.addEventListener("error",function(){if(--r===0)cb()},{once:true})})}' +
    'whenAllLoaded(a,function(){setTimeout(function(){try{window.print()}catch(e){}},d)})})();</script>' +
    '</body></html>'
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
  const viaHandle = documentRenderRef?.current?.getActiveCanvas?.();
  if (viaHandle) return viaHandle;

  const container = viewerContainerRef?.current;
  const pick = container ? pickLargestVisibleElement(container) : null;
  return pick || pickLargestVisibleElement(document);
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

  try {
    const doc = f.contentDocument || f.contentWindow?.document;
    if (!doc) {
      logger.error('Failed to get iframe document for printing');
      cleanup();
      return f;
    }
    doc.open();
    doc.write(html);
    doc.close();

    try { f.contentWindow?.addEventListener('afterprint', cleanup, { once: true }); } catch {}
    setTimeout(cleanup, Math.max(1000, cleanupDelayMs));
  } catch (e) {
    logger.error('Error writing to print iframe', { error: String(e?.message || e) });
    cleanup();
  }
  return f;
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

  const html = buildPrintHtml(dataUrl, pageOrientation, printDelayMs, odv, tokenContext);
  printViaHiddenIframe(html, 2000);
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

  const html = buildPrintAllHtml(toPrint, printDelayMs, odv, tokenContext);
  printViaHiddenIframe(html, Math.max(2500, 1000 + toPrint.length * 5));
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

  const html = buildPrintAllHtml(toPrint, printDelayMs, odv, tokenContext);
  printViaHiddenIframe(html, Math.max(2500, 1000 + toPrint.length * 5));
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
