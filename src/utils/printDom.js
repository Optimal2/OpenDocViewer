// File: src/utils/printDom.js
/**
 * File: src/utils/printDom.js
 *
 * OpenDocViewer — Print DOM Builder
 *
 * PURPOSE
 *   Safely construct the print iframe’s DOM using DOM APIs (no doc.write),
 *   wait until images reach a terminal state, then trigger window.print().
 *
 * DESIGN NOTES
 *   - We intentionally build the print document with DOM APIs instead of string-based document writing.
 *   - We intentionally wait for each image to reach a terminal state before printing.
 *     "Terminal state" means either:
 *       1) the image loaded successfully, or
 *       2) the image failed to load.
 *     The print flow must not hang forever just because one image errors.
 *   - The print header template may be either:
 *       * a plain string, or
 *       * a localized object such as { sv: '...', en: '...' }.
 *     We resolve the localized form at runtime.
 *   - Only allow-listed image sources are assigned to <img>. This prevents unsafe sources
 *     from being injected into the print document.
 */

import i18next from 'i18next';
import { applyTemplateTokensEscaped } from './printTemplate.js';
import { isSafeImageSrc } from './printSanitize.js';
import { resolveLocalizedValue } from './localizedValue.js';

/**
 * Print header config (runtime) consumed by the print overlay logic.
 * @typedef {Object} PrintHeaderCfg
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
 *
 * IMPORTANT:
 *   We intentionally generate a single @page rule when orientation is present.
 *   This is clearer than concatenating multiple @page blocks and avoids unnecessary duplication.
 *
 * @param {string} extraCss
 * @param {('portrait'|'landscape'|undefined)} pageOrientation
 * @returns {string}
 */
function buildPrintCss(extraCss, pageOrientation) {
  const pageRule = `@page{margin:0;${pageOrientation ? `size:${pageOrientation};` : ''}}`;

  const base =
    `@media print{${pageRule}html,body{height:100%;}}` +
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

  // Clear existing <head> content so each print render starts from a known clean state.
  while (head.firstChild) head.removeChild(head.firstChild);

  const meta = doc.createElement('meta');
  meta.setAttribute('charset', 'utf-8');
  head.appendChild(meta);

  const style = doc.createElement('style');
  // Intentionally limited to print media.
  // This iframe is used as a dedicated print host, so these styles are only meant
  // to affect print rendering / print preview, not general screen styling.
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

  // Clear existing <body> content so repeated print attempts do not accumulate stale nodes.
  while (body.firstChild) body.removeChild(body.firstChild);
  return body;
}

/**
 * Build a header DIV element for a page using config + tokens (values escaped).
 *
 * SECURITY / CORRECTNESS NOTES
 *   - Token values are escaped before insertion.
 *   - The admin-defined template itself may contain intentional markup, so it is inserted as HTML.
 *   - The template can be localized; we resolve it for the active i18n language before token expansion.
 *
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

  // The template may be a localized object instead of a plain string.
  // Resolve that here so printing works consistently across languages.
  const tpl = resolveLocalizedValue(cfg.template || '', i18next);
  const content = applyTemplateTokensEscaped(tpl, {
    ...tokenContext,
    page,
    totalPages: total,
  });

  // If the resolved/expanded template becomes empty, do not create a header node.
  if (!content) return null;

  const heightPx = Number.isFinite(cfg.heightPx) ? Math.max(0, Number(cfg.heightPx)) : 0;

  const div = doc.createElement('div');
  div.className = 'odv-print-header';
  div.setAttribute(
    'style',
    'position:absolute;' +
    (posBottom ? 'bottom:0;' : 'top:0;') +
    'left:0;right:0;' +
    (heightPx > 0 ? (`min-height:${heightPx}px;box-sizing:border-box;`) : '')
  );

  // Intentionally using innerHTML:
  // - token values are already escaped
  // - template markup is considered admin-authored formatting
  div.innerHTML = content;
  return div;
}

/**
 * Wait until every image in the list has reached a terminal state, then invoke the callback.
 *
 * WHY THIS IS WRITTEN THIS WAY
 *   - We use one Promise per image and resolve it on either "load" or "error".
 *   - This avoids manual shared-counter bookkeeping and makes the completion contract explicit.
 *   - Event listeners are attached BEFORE the immediate `complete` re-check to avoid the classic
 *     timing gap where an image finishes between an initial state check and listener registration.
 *   - We intentionally treat `complete === true` as a terminal state here, even if the image failed,
 *     because the goal of this function is "do not hang forever", not "verify successful decode".
 *     Success/failure is already represented by the browser's load/error lifecycle.
 *
 * @param {Array<HTMLImageElement>} list
 * @param {function(): void} cb
 * @returns {void}
 */
function waitForImagesToLoad(list, cb) {
  if (!Array.isArray(list) || list.length === 0) {
    cb();
    return;
  }

  const promises = list.map((im) => {
    return new Promise((resolve) => {
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

      // Re-check after listeners are attached.
      // If the image already reached a terminal state very quickly, resolve immediately.
      if (im.complete) {
        onDone();
      }
    });
  });

  Promise.all(promises).then(() => cb());
}

/**
 * Attach pages and images into the (cleared) body, wait for image terminal states, then print.
 *
 * IMPORTANT BEHAVIOR
 *   - We only create and track an <img> when the source is allow-listed.
 *   - Unsafe or disallowed sources are not assigned to the DOM image element.
 *   - The page wrapper is still created so page ordering and header numbering remain stable.
 *     This is intentional low-risk behavior: we avoid silently re-numbering pages in print output.
 *
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

    const safeSrc = isSafeImageSrc(pages[i].src) ? pages[i].src : '';

    if (safeSrc) {
      const img = doc.createElement('img');
      // Intentionally reusing the generic page-alt translation here.
      // Multi-page print pages conceptually map to viewer pages ("Page {page}") and
      // this avoids introducing a second near-identical translation key.
      img.setAttribute('alt', pages[i].alt || tr('viewer.pageAlt', 'Page {page}', { page: i + 1 }));
      img.src = safeSrc;
      pageWrapper.appendChild(img);
      imgs.push(img);
    }

    body.appendChild(pageWrapper);
  }

  const delay = Math.max(0, Number(printDelayMs) || 0);

  waitForImagesToLoad(imgs, () => {
    setTimeout(() => {
      try {
        doc.defaultView?.print();
      } catch {}
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
