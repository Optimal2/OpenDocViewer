// File: src/utils/printDom.js
/**
 * File: src/utils/printDom.js
 *
 * OpenDocViewer — Print DOM Builder
 *
 * PURPOSE
 *   Safely construct the print iframe’s DOM using DOM APIs (no doc.write),
 *   wait until images load, then trigger window.print().
 */

import i18next from 'i18next';
import { applyTemplateTokensEscaped } from './printTemplate.js';
import { isSafeImageSrc } from './printSanitize.js';

/**
 * Print header config (runtime) consumed by the print overlay logic.
 * @typedef {Object} PrintHeaderCfg
 * @property {boolean=} enabled
 * @property {"top"|"bottom"=} position
 * @property {"all"|"first"|"last"=} applyTo
 * @property {string=} template
 * @property {string=} css
 */

/**
 * Token context used by templates.
 * @typedef {Object} TokenContext
 * @property {string} now
 * @property {string} date
 * @property {string} time
 * @property {string} reason
 * @property {string} forWhom
 * @property {Object} user
 * @property {Object} doc
 * @property {Object} viewer
 */

/**
 * Tiny helper to translate with safe fallback.
 * @param {string} key
 * @param {string} defaultValue
 * @param {Object=} options
 * @returns {string}
 */
function tr(key, defaultValue, options) {
  try {
    return i18next.t(key, { ns: 'common', defaultValue, ...(options || {}) });
  } catch {
    return defaultValue;
  }
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
 * Build the print-only CSS string (inlined within the print iframe).
 * @param {string} extraCss
 * @param {('portrait'|'landscape'|undefined)} pageOrientation
 * @returns {string}
 */
function buildPrintCss(extraCss, pageOrientation) {
  const base =
    '@media print{@page{margin:0;}' +
      (pageOrientation ? '@page{size:' + pageOrientation + ';}' : '') +
    'html,body{height:100%;}}' +
    'html,body{margin:0;padding:0;background:#fff;height:100%;}' +
    '.page{break-after:page;-webkit-break-after:page;page-break-after:always;' +
      'display:flex;align-items:center;justify-content:center;min-height:100vh;' +
      'box-sizing:border-box;overflow:hidden;position:relative;}' +
    '.page.last{break-after:auto;-webkit-break-after:auto;page-break-after:auto;}' +
    '.page img{display:block;width:auto;height:auto;max-width:100vw;max-height:100vh;object-fit:contain;' +
      'page-break-inside:avoid;break-inside:avoid;}' +
    '.odv-print-header{pointer-events:none;z-index:2147483647;}';

  return base + (typeof extraCss === 'string' && extraCss ? String(extraCss) : '');
}

/**
 * Ensure there is exactly one <head>, clear it, and append meta+style.
 * @param {Document} doc
 * @param {string} cssText
 * @returns {void}
 */
function ensureHead(doc, cssText) {
  const html = doc.documentElement || doc.createElement('html');
  if (!doc.documentElement) doc.appendChild(html);

  let head = doc.head;
  if (!head) {
    head = doc.createElement('head');
    html.appendChild(head);
  }
  // Clear existing <head> content
  while (head.firstChild) head.removeChild(head.firstChild);

  const meta = doc.createElement('meta');
  meta.setAttribute('charset', 'utf-8');
  head.appendChild(meta);

  const style = doc.createElement('style');
  style.setAttribute('media', 'print');
  style.textContent = cssText;
  head.appendChild(style);
}

/**
 * Ensure there is exactly one <body> and clear it.
 * @param {Document} doc
 * @returns {HTMLBodyElement}
 */
function ensureBody(doc) {
  const html = doc.documentElement || doc.createElement('html');
  if (!doc.documentElement) doc.appendChild(html);

  let body = doc.body;
  if (!body) {
    body = doc.createElement('body');
    html.appendChild(body);
  }
  // Clear existing <body> content
  while (body.firstChild) body.removeChild(body.firstChild);
  return body;
}

/**
 * Build a header DIV element for a page using config + tokens (values escaped).
 * @param {Document} doc
 * @param {PrintHeaderCfg} cfg
 * @param {TokenContext} tokenContext
 * @param {number} page     1-based page number in the CURRENT printed sequence
 * @param {number} total    total pages in the CURRENT printed sequence
 * @returns {HTMLElement|null}
 */
function buildHeaderElement(doc, cfg, tokenContext, page, total) {
  if (!cfg || !cfg.enabled) return null;
  const applyTo = /** @type {("all"|"first"|"last")} */ (cfg.applyTo || 'all');
  if (!shouldApplyHeader(applyTo, page, total)) return null;

  const posBottom = (cfg.position || 'top') === 'bottom';
  const tpl = cfg.template || '';
  const content = applyTemplateTokensEscaped(tpl, { ...tokenContext, page, totalPages: total });

  const div = doc.createElement('div');
  div.className = 'odv-print-header';
  div.setAttribute('style', 'position:absolute;' + (posBottom ? 'bottom:0;' : 'top:0;') + 'left:0;right:0;');
  // Admin template may contain markup; token values are already escaped.
  div.innerHTML = content;
  return div;
}

/**
 * Attach pages and images into the (cleared) body, wait for loads, then print.
 * @param {Document} doc
 * @param {Array.<{src: string, alt: string}>} pages
 * @param {number} printDelayMs
 * @param {PrintHeaderCfg} printHeaderCfg
 * @param {TokenContext} tokenContext
 * @returns {void}
 */
function populateBodyAndPrint(doc, pages, printDelayMs, printHeaderCfg, tokenContext) {
  const body = ensureBody(doc);

  const total = pages.length;
  const imgs = [];
  for (let i = 0; i < pages.length; i++) {
    const pageWrapper = doc.createElement('div');
    pageWrapper.className = 'page' + (i === total - 1 ? ' last' : '');

    const header = buildHeaderElement(doc, printHeaderCfg, tokenContext, i + 1, total);
    if (header) pageWrapper.appendChild(header);

    const img = doc.createElement('img');
    // Default alt falls back to translated "Page {page}"
    img.setAttribute('alt', pages[i].alt || tr('viewer.pageAlt', 'Page {page}', { page: i + 1 }));
    // Allow-list only
    if (isSafeImageSrc(pages[i].src)) img.src = pages[i].src;
    pageWrapper.appendChild(img);
    imgs.push(img);

    body.appendChild(pageWrapper);
  }

  // Wait until images load (or error), then print.
  const delay = Math.max(0, Number(printDelayMs) || 0);
  const isLoaded = (im) => im.complete && (typeof im.naturalWidth === 'undefined' || im.naturalWidth > 0);

  function whenAllLoaded(list, cb) {
    let remaining = list.length;
    if (remaining === 0) return cb();
    list.forEach((im) => {
      if (isLoaded(im)) {
        if (--remaining === 0) cb();
        return;
      }
      const done = () => { if (--remaining === 0) cb(); };
      im.addEventListener('load', done, { once: true });
      im.addEventListener('error', done, { once: true });
    });
  }

  whenAllLoaded(imgs, () => {
    setTimeout(() => {
      try { doc.defaultView?.print(); } catch {}
    }, delay);
  });
}

/**
 * Render a *single* page print document in the given print iframe document.
 * @param {Document} doc
 * @param {{ dataUrl: string, orientation: ('portrait'|'landscape'), printDelayMs: number, printHeaderCfg: PrintHeaderCfg, tokenContext: TokenContext }} opts
 * @returns {void}
 */
export function renderSingleDocument(doc, opts) {
  const cssText = buildPrintCss((opts.printHeaderCfg?.css) || '', opts.orientation);
  ensureHead(doc, cssText);

  populateBodyAndPrint(
    doc,
    [{ src: opts.dataUrl, alt: tr('print.alt.printableDocument', 'Printable Document') }],
    opts.printDelayMs,
    opts.printHeaderCfg || {},
    opts.tokenContext
  );
}

/**
 * Render a *multi*-page print document in the given print iframe document.
 * @param {Document} doc
 * @param {{ dataUrls: Array.<string>, printDelayMs: number, printHeaderCfg: PrintHeaderCfg, tokenContext: TokenContext }} opts
 * @returns {void}
 */
export function renderMultiDocument(doc, opts) {
  const cssText = buildPrintCss((opts.printHeaderCfg?.css) || '', undefined);
  ensureHead(doc, cssText);

  const pages = (opts.dataUrls || []).map((src, i) => ({
    src,
    alt: tr('viewer.pageAlt', 'Page {page}', { page: i + 1 }),
  }));
  populateBodyAndPrint(
    doc,
    pages,
    opts.printDelayMs,
    opts.printHeaderCfg || {},
    opts.tokenContext
  );
}
