// File: src/utils/printDom.js
/**
 * File: src/utils/printDom.js
 *
 * OpenDocViewer — Print DOM Builder
 *
 * PURPOSE
 *   Safely construct the print iframe’s DOM using DOM APIs (no doc.write), wait until images reach
 *   a terminal state, then trigger window.print(). Header/footer templates are expanded per printed
 *   page so document-specific metadata can follow the actual printed page sequence.
 */

import i18next from 'i18next';
import logger from '../logging/systemLogger.js';
import { applyTemplateTokensEscaped, makePageTokenContext } from './printTemplate.js';
import { isSafeImageSrc } from './printSanitize.js';
import { resolveLocalizedValue } from './localizedValue.js';

/**
 * Print overlay config (runtime) consumed by the print overlay logic.
 * @typedef {Object} PrintOverlayCfg
 * @property {boolean=} enabled
 * @property {"top"|"bottom"=} position
 * @property {"all"|"first"|"last"=} applyTo
 * @property {number=} heightPx
 * @property {(string|Object.<string,string>)=} template
 * @property {string=} css
 * @property {"flow"|"overlay"=} layout Flow reserves page space; overlay preserves legacy absolute positioning.
 */

/**
 * Token context used by templates.
 * @typedef {Object} TokenContext
 * @property {string} now
 * @property {string} date
 * @property {string} time
 * @property {string} reason
 * @property {string} forWhom
 * @property {string} printFormat
 * @property {string} isCopy
 * @property {Object} user
 * @property {Object} session
 * @property {Object} doc
 * @property {Object} metadata
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
 * Normalize an unknown configuration value to a non-negative number.
 * @param {*} value
 * @returns {number}
 */
function normalizeNonNegativeNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(0, numericValue) : 0;
}

/**
 * Normalize runtime overlay application mode.
 * @param {unknown} applyTo
 * @returns {('all'|'first'|'last')}
 */
function normalizeApplyTo(applyTo) {
  if (applyTo === 'first' || applyTo === 'last' || applyTo === 'all') return applyTo;
  return 'all';
}

/**
 * @param {"all"|"first"|"last"} applyTo
 * @param {number} index1
 * @param {number} total
 * @returns {boolean}
 */
function shouldApplyOverlay(applyTo, index1, total) {
  if (applyTo === 'first') return index1 === 1;
  if (applyTo === 'last') return index1 === total;
  return true;
}

/**
 * @param {unknown} pageOrientation
 * @returns {('portrait'|'landscape'|undefined)}
 */
function normalizePageOrientation(pageOrientation) {
  if (pageOrientation === 'portrait' || pageOrientation === 'landscape') return pageOrientation;
  return undefined;
}

/**
 * @param {unknown} extraCss
 * @returns {string}
 */
function normalizeTrustedExtraCss(extraCss) {
  return typeof extraCss === 'string' && extraCss ? extraCss : '';
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function enabled(value) {
  return value !== false;
}

/**
 * Build the print-only CSS string (inlined within the print iframe).
 * @param {string} extraCss
 * @param {('portrait'|'landscape'|undefined)} pageOrientation
 * @param {*} printFormatCfg
 * @returns {string}
 */
function buildPrintCss(extraCss, pageOrientation, printFormatCfg) {
  const safeOrientation = normalizePageOrientation(pageOrientation);
  const trustedExtraCss = normalizeTrustedExtraCss(extraCss);
  const pageRule = `@page{margin:0;${safeOrientation ? `size:${safeOrientation};` : ''}}`;
  const watermarkExtraCss = normalizeTrustedExtraCss(printFormatCfg?.watermark?.css || '');
  const headerMarkerExtraCss = normalizeTrustedExtraCss(printFormatCfg?.headerMarker?.css || '');

  const base =
    `@media print{${pageRule}html,body{height:100%;}.odv-print-excluded{display:none!important;}}` +
    'html,body{margin:0;padding:0;background:#fff;height:100%;}' +
    '.page{break-after:page;-webkit-break-after:page;page-break-after:always;' +
      'display:flex;flex-direction:column;align-items:stretch;justify-content:stretch;' +
      'height:100vh;box-sizing:border-box;overflow:hidden;position:relative;}' +
    '.page.last{break-after:auto;-webkit-break-after:auto;page-break-after:auto;}' +
    '.page-content{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;' +
      'box-sizing:border-box;overflow:hidden;}' +
    '.page-content img{display:block;width:auto;height:auto;max-width:100vw;max-height:100%;object-fit:contain;' +
      'page-break-inside:avoid;break-inside:avoid;}' +
    '.odv-print-header,.odv-print-footer{flex:0 0 auto;pointer-events:none;z-index:2147483647;box-sizing:border-box;}' +
    '.odv-print-format-header{position:absolute;top:0;left:0;right:0;text-align:center;' +
      'font:bold 24px/1.2 Arial,Helvetica,sans-serif;letter-spacing:.18em;color:#000;' +
      'background:rgba(255,255,255,.88);padding:4mm 0;pointer-events:none;z-index:2147483646;}' +
    '.odv-print-watermark{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-32deg);' +
      'font:bold 19vmin/1 Arial,Helvetica,sans-serif;letter-spacing:.16em;color:rgba(255,255,255,.16);' +
      'paint-order:stroke fill;-webkit-text-stroke:1.2px rgba(0,0,0,.20);' +
      'text-shadow:0 0 .4px rgba(0,0,0,.26),0 0 2px rgba(0,0,0,.18),0 0 12px rgba(255,255,255,.20);' +
      'white-space:nowrap;pointer-events:none;user-select:none;z-index:2147483645;}' +
    '.odv-print-watermark::after{content:attr(data-text);position:absolute;left:0;top:0;' +
      'color:rgba(0,0,0,.10);text-shadow:0 0 1px rgba(255,255,255,.32),0 0 6px rgba(255,255,255,.22);' +
      'pointer-events:none;z-index:-1;}';

  return base + trustedExtraCss + headerMarkerExtraCss + watermarkExtraCss;
}

/**
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

  while (body.firstChild) body.removeChild(body.firstChild);
  return body;
}

/**
 * Build a header/footer DIV element for a page using config + tokens.
 *
 * @param {Document} doc
 * @param {PrintOverlayCfg} cfg
 * @param {TokenContext} tokenContext
 * @param {number} page
 * @param {number} total
 * @param {'header'|'footer'} kind
 * @returns {HTMLElement|null}
 */
function buildOverlayElement(doc, cfg, tokenContext, page, total, kind) {
  if (!cfg || !cfg.enabled) return null;

  const applyTo = normalizeApplyTo(cfg.applyTo);
  if (!shouldApplyOverlay(applyTo, page, total)) return null;

  const defaultPosition = kind === 'footer' ? 'bottom' : 'top';
  const posBottom = (cfg.position || defaultPosition) === 'bottom';
  const layout = cfg.layout === 'overlay' ? 'overlay' : 'flow';
  const tpl = resolveLocalizedValue(cfg.template || '', i18next);
  const content = applyTemplateTokensEscaped(tpl, {
    ...tokenContext,
    page,
    totalPages: total,
  });
  if (!content) return null;

  const heightPx = normalizeNonNegativeNumber(cfg.heightPx);
  const div = doc.createElement('div');
  div.className = kind === 'footer' ? 'odv-print-footer' : 'odv-print-header';
  const style = layout === 'overlay'
    ? 'position:absolute;' +
      (posBottom ? 'bottom:0;' : 'top:0;') +
      'left:0;right:0;' +
      (heightPx > 0 ? `min-height:${heightPx}px;box-sizing:border-box;` : '')
    : 'position:relative;' +
      (heightPx > 0 ? `min-height:${heightPx}px;box-sizing:border-box;` : '');
  div.setAttribute('style', style);

  // Token values are escaped in applyTemplateTokensEscaped; admin-authored markup is preserved.
  div.innerHTML = content;
  return div;
}

/**
 * Build configured print-format header/watermark elements for a page.
 * @param {Document} doc
 * @param {TokenContext} tokenContext
 * @param {*} printFormatCfg
 * @returns {{ header: HTMLElement|null, watermark: HTMLElement|null }}
 */
function buildPrintFormatElements(doc, tokenContext, printFormatCfg) {
  const text = String(tokenContext?.printFormat || '').trim();
  if (!text) return { header: null, watermark: null };

  let header = null;
  if (enabled(printFormatCfg?.headerMarker?.enabled)) {
    header = doc.createElement('div');
    header.className = 'odv-print-format-header';
    header.textContent = text;
  }

  let watermark = null;
  if (enabled(printFormatCfg?.watermark?.enabled)) {
    watermark = doc.createElement('div');
    watermark.className = 'odv-print-watermark';
    watermark.textContent = text;
    watermark.setAttribute('data-text', text);
  }

  return { header, watermark };
}

/**
 * @param {Array<HTMLImageElement>} list
 * @param {function(): void} cb
 * @returns {void}
 */
function waitForImagesToLoad(list, cb) {
  if (!Array.isArray(list) || list.length === 0) {
    cb();
    return;
  }

  const promises = list.map((im) => new Promise((resolve) => {
    let settled = false;

    const onDone = () => {
      if (settled) return;
      settled = true;
      im.removeEventListener('load', onDone);
      im.removeEventListener('error', onDone);
      resolve();
    };

    im.addEventListener('load', onDone);
    im.addEventListener('error', onDone);
    if (im.complete) onDone();
  }));

  Promise.all(promises).then(() => cb());
}

/**
 * Attach pages and images into the (cleared) body, wait for image terminal states, then print.
 *
 * @param {Document} doc
 * @param {Array.<{src: string, alt: string}>} pages
 * @param {number} printDelayMs
 * @param {PrintOverlayCfg} printHeaderCfg
 * @param {PrintOverlayCfg} printFooterCfg
 * @param {*} printFormatCfg
 * @param {TokenContext} tokenContext
 * @param {Array<*>} pageContexts
 * @returns {void}
 */
function populateBodyAndPrint(doc, pages, printDelayMs, printHeaderCfg, printFooterCfg, printFormatCfg, tokenContext, pageContexts) {
  const body = ensureBody(doc);
  const total = pages.length;
  const imgs = [];
  const bundle = tokenContext?.bundle || {};

  for (let i = 0; i < pages.length; i += 1) {
    const pageWrapper = doc.createElement('div');
    pageWrapper.className = 'page' + (i === total - 1 ? ' last' : '');

    const pageTokenContext = makePageTokenContext(tokenContext || {}, Array.isArray(pageContexts) ? pageContexts[i] : null, bundle);
    const printFormatElements = buildPrintFormatElements(doc, pageTokenContext, printFormatCfg || {});
    if (printFormatElements.watermark) pageWrapper.appendChild(printFormatElements.watermark);

    const header = buildOverlayElement(doc, printHeaderCfg, pageTokenContext, i + 1, total, 'header');
    if (header) pageWrapper.appendChild(header);
    if (printFormatElements.header) pageWrapper.appendChild(printFormatElements.header);

    const contentWrapper = doc.createElement('div');
    contentWrapper.className = 'page-content';

    const safeSrc = isSafeImageSrc(pages[i].src) ? pages[i].src : '';
    if (safeSrc) {
      const img = doc.createElement('img');
      img.setAttribute('alt', pages[i].alt || tr('viewer.pageAlt', 'Page {page}', { page: i + 1 }));
      img.src = safeSrc;
      contentWrapper.appendChild(img);
      imgs.push(img);
    }
    pageWrapper.appendChild(contentWrapper);

    const footer = buildOverlayElement(doc, printFooterCfg, pageTokenContext, i + 1, total, 'footer');
    if (footer) pageWrapper.appendChild(footer);

    body.appendChild(pageWrapper);
  }

  const delay = normalizeNonNegativeNumber(printDelayMs);
  waitForImagesToLoad(imgs, () => {
    setTimeout(() => {
      try {
        doc.defaultView?.print();
      } catch (error) {
        logger.warn('Print invocation failed', { error: String(error?.message || error) });
      }
    }, delay);
  });
}


/**
 * Promise wrapper around image terminal-state waiting.
 * @param {Array<HTMLImageElement>} list
 * @returns {Promise<void>}
 */
function waitForImagesToLoadAsync(list) {
  return new Promise((resolve) => waitForImagesToLoad(list, resolve));
}

/**
 * Remove dynamic print-only decorations from a warmed page wrapper.
 * The page image stays in place so the iframe can remain warm between print jobs.
 * @param {HTMLElement} pageWrapper
 * @returns {void}
 */
function clearDynamicPageDecorations(pageWrapper) {
  pageWrapper.querySelectorAll('.odv-print-header,.odv-print-footer,.odv-print-format-header,.odv-print-watermark')
    .forEach((node) => {
      try { node.remove(); } catch {}
    });
}

/**
 * Build a hidden, reusable multi-page print document without invoking print().
 * This is used by the warm-print path for order-preserving original-page jobs.
 * @param {Document} doc
 * @param {Object} opts
 * @param {Array.<string>} opts.dataUrls
 * @param {PrintOverlayCfg} opts.printHeaderCfg
 * @param {PrintOverlayCfg=} opts.printFooterCfg
 * @param {*=} opts.printFormatCfg
 * @returns {Promise<void>}
 */
export async function buildWarmMultiDocument(doc, opts) {
  const cssText = buildPrintCss(mergeOverlayCss(opts.printHeaderCfg, opts.printFooterCfg), undefined, opts.printFormatCfg || {});
  ensureHead(doc, cssText);
  const body = ensureBody(doc);
  body.setAttribute('data-odv-warm-print-frame', 'true');

  const dataUrls = Array.isArray(opts.dataUrls) ? opts.dataUrls : [];
  /** @type {Array<HTMLImageElement>} */
  const imgs = [];

  for (let i = 0; i < dataUrls.length; i += 1) {
    const pageWrapper = doc.createElement('div');
    pageWrapper.className = 'page';
    pageWrapper.setAttribute('data-source-index', String(i));

    const contentWrapper = doc.createElement('div');
    contentWrapper.className = 'page-content';

    const safeSrc = isSafeImageSrc(dataUrls[i]) ? dataUrls[i] : '';
    if (safeSrc) {
      const img = doc.createElement('img');
      img.setAttribute('alt', tr('viewer.pageAlt', 'Page {page}', { page: i + 1 }));
      img.src = safeSrc;
      contentWrapper.appendChild(img);
      imgs.push(img);
    }

    pageWrapper.appendChild(contentWrapper);
    body.appendChild(pageWrapper);
  }

  await waitForImagesToLoadAsync(imgs);
}

/**
 * Reuse a warmed multi-page print document. Only order-preserving subsets are supported:
 * the caller passes 0-based source indexes in natural order and this function hides all others.
 * @param {Document} doc
 * @param {Object} opts
 * @param {Array<number>} opts.includedPageIndexes
 * @param {number} opts.printDelayMs
 * @param {PrintOverlayCfg} opts.printHeaderCfg
 * @param {PrintOverlayCfg=} opts.printFooterCfg
 * @param {*=} opts.printFormatCfg
 * @param {TokenContext} opts.tokenContext
 * @param {Array<*>=} opts.pageContexts All page contexts aligned with the warmed source order.
 * @returns {void}
 */
export function printWarmMultiDocument(doc, opts) {
  const body = doc?.body;
  if (!body) return;
  const wrappers = Array.from(body.querySelectorAll('.page'));
  if (!wrappers.length) return;

  const rawIndexes = Array.isArray(opts.includedPageIndexes) && opts.includedPageIndexes.length
    ? opts.includedPageIndexes
    : wrappers.map((_node, index) => index);
  const includedSet = new Set(rawIndexes.map((value) => Math.floor(Number(value))).filter((value) => Number.isFinite(value) && value >= 0));
  const included = wrappers
    .map((node, sourceIndex) => ({ node: /** @type {HTMLElement} */ (node), sourceIndex }))
    .filter((entry) => includedSet.has(entry.sourceIndex));

  const total = included.length;
  const bundle = opts.tokenContext?.bundle || {};

  wrappers.forEach((node) => {
    const pageWrapper = /** @type {HTMLElement} */ (node);
    pageWrapper.classList.add('odv-print-excluded');
    pageWrapper.classList.remove('last');
    clearDynamicPageDecorations(pageWrapper);
  });

  included.forEach((entry, ordinal) => {
    const pageWrapper = entry.node;
    const printPageNumber = ordinal + 1;
    pageWrapper.classList.remove('odv-print-excluded');
    if (ordinal === total - 1) pageWrapper.classList.add('last');

    const pageInfo = Array.isArray(opts.pageContexts) ? opts.pageContexts[entry.sourceIndex] : null;
    const pageTokenContext = makePageTokenContext(opts.tokenContext || {}, pageInfo, bundle);
    const printFormatElements = buildPrintFormatElements(doc, pageTokenContext, opts.printFormatCfg || {});
    if (printFormatElements.watermark) pageWrapper.insertBefore(printFormatElements.watermark, pageWrapper.firstChild);

    const header = buildOverlayElement(doc, opts.printHeaderCfg || {}, pageTokenContext, printPageNumber, total, 'header');
    if (header) pageWrapper.insertBefore(header, pageWrapper.firstChild);
    if (printFormatElements.header) pageWrapper.insertBefore(printFormatElements.header, pageWrapper.firstChild);

    const footer = buildOverlayElement(doc, opts.printFooterCfg || {}, pageTokenContext, printPageNumber, total, 'footer');
    if (footer) pageWrapper.appendChild(footer);
  });

  const delay = normalizeNonNegativeNumber(opts.printDelayMs);
  window.setTimeout(() => {
    try {
      doc.defaultView?.print();
    } catch (error) {
      logger.warn('Warm print invocation failed', { error: String(error?.message || error) });
    }
  }, delay);
}

/**
 * @param {*} printHeaderCfg
 * @param {*} printFooterCfg
 * @returns {string}
 */
function mergeOverlayCss(printHeaderCfg, printFooterCfg) {
  return [printHeaderCfg?.css, printFooterCfg?.css]
    .filter((entry) => typeof entry === 'string' && entry)
    .join('\n');
}

/**
 * Render a single-page print document in the given print iframe document.
 * @param {Document} doc
 * @param {Object} opts
 * @param {string} opts.dataUrl
 * @param {('portrait'|'landscape')} opts.orientation
 * @param {number} opts.printDelayMs
 * @param {PrintOverlayCfg} opts.printHeaderCfg
 * @param {PrintOverlayCfg=} opts.printFooterCfg
 * @param {*=} opts.printFormatCfg
 * @param {TokenContext} opts.tokenContext
 * @param {Array<*>=} opts.pageContexts
 * @returns {void}
 */
export function renderSingleDocument(doc, opts) {
  const cssText = buildPrintCss(mergeOverlayCss(opts.printHeaderCfg, opts.printFooterCfg), opts.orientation, opts.printFormatCfg || {});
  ensureHead(doc, cssText);

  populateBodyAndPrint(
    doc,
    [{ src: opts.dataUrl, alt: tr('print.alt.printableDocument', 'Printable Document') }],
    opts.printDelayMs,
    opts.printHeaderCfg || {},
    opts.printFooterCfg || {},
    opts.printFormatCfg || {},
    opts.tokenContext,
    opts.pageContexts || []
  );
}

/**
 * Render a multi-page print document in the given print iframe document.
 * @param {Document} doc
 * @param {Object} opts
 * @param {Array.<string>} opts.dataUrls
 * @param {number} opts.printDelayMs
 * @param {PrintOverlayCfg} opts.printHeaderCfg
 * @param {PrintOverlayCfg=} opts.printFooterCfg
 * @param {*=} opts.printFormatCfg
 * @param {TokenContext} opts.tokenContext
 * @param {Array<*>=} opts.pageContexts
 * @returns {void}
 */
export function renderMultiDocument(doc, opts) {
  const cssText = buildPrintCss(mergeOverlayCss(opts.printHeaderCfg, opts.printFooterCfg), undefined, opts.printFormatCfg || {});
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
    opts.printFooterCfg || {},
    opts.printFormatCfg || {},
    opts.tokenContext,
    opts.pageContexts || []
  );
}
