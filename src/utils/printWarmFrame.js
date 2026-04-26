// File: src/utils/printWarmFrame.js
/**
 * OpenDocViewer — Warm print iframe support.
 *
 * A warm print frame is a hidden, reusable iframe that preloads original page image URLs in natural
 * order. It is only used for order-preserving print jobs where printing can be represented by hiding
 * excluded pages. Active-page and reordered/duplicated custom jobs continue to use the regular print
 * path.
 */

import logger from '../logging/systemLogger.js';
import { buildWarmMultiDocument } from './printDom.js';

/** @typedef {'off'|'pending'|'ready'|'warning'|'error'} WarmPrintFrameStatus */

/**
 * @typedef {Object} WarmPrintFrame
 * @property {HTMLIFrameElement} frame
 * @property {Document} doc
 * @property {function(): void} cleanup
 * @property {number} pageCount
 * @property {Array<*>} pageContexts
 * @property {WarmPrintFrameStatus} status
 * @property {string} key
 */

/**
 * @returns {HTMLIFrameElement}
 */
function createPersistentHiddenIframe() {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('data-odv-warm-print-frame', 'true');
  Object.assign(frame.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
  });
  document.body.appendChild(frame);
  return frame;
}

/**
 * Create and fully load a warm print iframe.
 * @param {Object} opts
 * @param {Array<string>} opts.dataUrls
 * @param {Array<*>} opts.pageContexts
 * @param {*} opts.printHeaderCfg
 * @param {*} opts.printFooterCfg
 * @param {*} opts.printFormatCfg
 * @param {string=} opts.key
 * @returns {Promise<WarmPrintFrame>}
 */
export async function createWarmPrintFrame(opts) {
  const frame = createPersistentHiddenIframe();
  const doc = frame.contentDocument || frame.contentWindow?.document;
  if (!doc) {
    try { frame.remove(); } catch {}
    throw new Error('Unable to access warm print iframe document.');
  }

  /** @type {WarmPrintFrame} */
  const warmFrame = {
    frame,
    doc,
    cleanup() {
      try { frame.remove(); } catch {}
    },
    pageCount: Array.isArray(opts.dataUrls) ? opts.dataUrls.length : 0,
    pageContexts: Array.isArray(opts.pageContexts) ? opts.pageContexts : [],
    status: 'pending',
    key: String(opts.key || ''),
  };

  try {
    await buildWarmMultiDocument(doc, {
      dataUrls: opts.dataUrls || [],
      printHeaderCfg: opts.printHeaderCfg || {},
      printFooterCfg: opts.printFooterCfg || {},
      printFormatCfg: opts.printFormatCfg || {},
    });
    warmFrame.status = 'ready';
    return warmFrame;
  } catch (error) {
    warmFrame.status = 'error';
    logger.warn('Warm print frame preparation failed', { error: String(error?.message || error) });
    try { warmFrame.cleanup(); } catch {}
    throw error;
  }
}

/**
 * @param {(WarmPrintFrame|null|undefined)} warmFrame
 * @returns {void}
 */
export function disposeWarmPrintFrame(warmFrame) {
  if (!warmFrame) return;
  try { warmFrame.cleanup?.(); } catch {}
}

/**
 * @param {*} cfg
 * @param {number} pageCount
 * @param {string} memoryPressureStage
 * @returns {boolean}
 */
export function shouldEnableWarmPrintFrame(cfg, pageCount, memoryPressureStage = 'none') {
  const prewarmCfg = cfg?.print?.prewarmIframe || {};
  const enabled = prewarmCfg?.enabled ?? 'auto';
  if (enabled === false || String(enabled).toLowerCase() === 'false') return false;
  if (!Number.isFinite(pageCount) || pageCount <= 0) return false;
  if (String(memoryPressureStage || '').toLowerCase() === 'hard') return false;

  const explicitMax = Number(prewarmCfg?.maxPages || 0);
  if (Number.isFinite(explicitMax) && explicitMax > 0 && pageCount > explicitMax) return false;

  const mode = String(cfg?.documentLoading?.mode || 'auto').toLowerCase();
  if (mode === 'memory' && enabled !== true && String(enabled).toLowerCase() !== 'true') return false;

  if (enabled === true || String(enabled).toLowerCase() === 'true') return true;

  const performanceWindow = Number(cfg?.documentLoading?.adaptiveMemory?.performanceWindowPageCount || 0);
  if (Number.isFinite(performanceWindow) && performanceWindow > 0 && pageCount > performanceWindow) return false;
  return true;
}

export default {
  createWarmPrintFrame,
  disposeWarmPrintFrame,
  shouldEnableWarmPrintFrame,
};
