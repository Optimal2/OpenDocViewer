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
 * @returns {string}
 */
function buildPrintCss(extraCss, pageOrientation) {
  const safeOrientation = normalizePageOrientation(pageOrientation);
  const trustedExtraCss = normalizeTrustedExtraCss(extraCss);
  const pageRule = `@page{margin:0;${safeOrientation ? `size:${safeOrientation};` : ''}}`;

  const base =
    `@media print{${pageRule}html,body{height:100%;}}` +
    'html,body{margin:0;padding:0;background:#fff;height:100%;}' +
    '.page{break-after:page;-webkit-break-after:page;page-break-after:always;' +
      'display:flex;align-items:center;justify-content:center;min-height:100vh;' +
      'box-sizing:border-box;overflow:hidden;position:relative;}' +
    '.page.last{break-after:auto;-webkit-break-after:auto;page-break-after:auto;}' +
    '.page img{display:block;width:auto;height:auto;max-width:100vw;max-height:100vh;object-fit:contain;' +
      'page-break-inside:avoid;break-inside:avoid;}' +
    '.odv-print-header,.odv-print-footer{pointer-events:none;z-index:2147483647;}' +
    '.odv-print-format-header{position:absolute;top:0;left:0;right:0;text-align:center;' +
      'font:bold 24px/1.2 Arial,Helvetica,sans-serif;letter-spacing:.18em;color:#000;' +
      'background:rgba(255,255,255,.88);padding:4mm 0;pointer-events:none;z-index:2147483646;}' +
    '.odv-print-watermark{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-32deg);' +
      'font:bold 84px/1 Arial,Helvetica,sans-serif;letter-spacing:.12em;color:rgba(0,0,0,.16);' +
      'white-space:nowrap;pointer-events:none;user-select:none;z-index:2147483645;}';

  return base + trustedExtraCss;
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
  div.setAttribute(
    'style',
    'position:absolute;' +
    (posBottom ? 'bottom:0;' : 'top:0;') +
    'left:0;right:0;' +
    (heightPx > 0 ? `min-height:${heightPx}px;box-sizing:border-box;` : '')
  );

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

    const footer = buildOverlayElement(doc, printFooterCfg, pageTokenContext, i + 1, total, 'footer');
    if (footer) pageWrapper.appendChild(footer);

    const safeSrc = isSafeImageSrc(pages[i].src) ? pages[i].src : '';
    if (safeSrc) {
      const img = doc.createElement('img');
      img.setAttribute('alt', pages[i].alt || tr('viewer.pageAlt', 'Page {page}', { page: i + 1 }));
      img.src = safeSrc;
      pageWrapper.appendChild(img);
      imgs.push(img);
    }

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
  const cssText = buildPrintCss(mergeOverlayCss(opts.printHeaderCfg, opts.printFooterCfg), opts.orientation);
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
  const cssText = buildPrintCss(mergeOverlayCss(opts.printHeaderCfg, opts.printFooterCfg), undefined);
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
