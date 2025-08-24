/**
 * File: src/integrations/urlParams.js
 *
 * OpenDocViewer — URL Parameter Reader (Browser-only)
 *
 * PURPOSE
 *   Read a minimal set of query parameters to bootstrap the viewer in
 *   “pattern mode”, i.e. when the host only provides a folder/path,
 *   an extension, and a page/file count.
 *
 * ACCEPTED ALIASES (first match wins; case-sensitive)
 *   - folder:   ["folder", "path", "dir"]
 *   - extension:["extension", "ext", "type", "format"]
 *   - endNumber:["endNumber", "pages", "total", "end", "count", "n"]
 *
 * RETURN SHAPE
 *   { source: 'url-params', data: { folder, extension, endNumber } } | null
 *
 * SSR / SAFETY
 *   - No-ops gracefully when window / URLSearchParams is unavailable.
 *   - Sanitizes/validates basics; never throws.
 *
 * PROJECT GOTCHA (reminder for future reviewers):
 *   - Elsewhere in the app we import from the **root** 'file-type' package,
 *     NOT 'file-type/browser'. With file-type v21, the '/browser' subpath is
 *     not exported for bundlers and will break the Vite build.
 */

import logger from '../LogController';

/**
 * Pick the first non-empty value among a list of candidate query keys.
 * @param {URLSearchParams} q
 * @param {string[]} keys
 * @returns {string|null}
 */
function pick(q, keys) {
  for (const k of keys) {
    const v = q.get(k);
    if (v !== null && v !== '') return v;
  }
  return null;
}

/**
 * Parse a positive integer from a string. Returns null on failure.
 * @param {string|null} s
 * @returns {number|null}
 */
function parsePositiveInt(s) {
  if (s == null || s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

/**
 * Reads common query params used by the demo and other hosts.
 * Returns a normalized shape or null if insufficient data is present.
 *
 * @example
 *   // ?folder=/images/&ext=png&pages=12
 *   const r = readFromUrlParams();
 *   // -> { source:'url-params', data: { folder:'/images/', extension:'png', endNumber:12 } }
 *
 * @returns {{ source:'url-params', data:{ folder:string, extension:string, endNumber:number } } | null}
 */
export function readFromUrlParams() {
  if (typeof window === 'undefined' || typeof URLSearchParams === 'undefined') {
    return null;
  }

  let q;
  try {
    q = new URLSearchParams(window.location.search);
  } catch {
    return null;
  }

  const folder = pick(q, ['folder', 'path', 'dir']);
  const extension = pick(q, ['extension', 'ext', 'type', 'format']);
  const endRaw = pick(q, ['endNumber', 'pages', 'total', 'end', 'count', 'n']);
  const endNumber = parsePositiveInt(endRaw);

  if (folder && extension && endNumber) {
    logger.debug('URL params detected for pattern mode', { folder, extension, endNumber });
    return { source: 'url-params', data: { folder, extension, endNumber } };
  }

  logger.debug('URL params incomplete for pattern mode', { folder: !!folder, extension: !!extension, endRaw });
  return null;
}

export default { readFromUrlParams };
