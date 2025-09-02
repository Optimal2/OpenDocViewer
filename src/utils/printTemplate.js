// File: src/utils/printTemplate.js
/**
 * File: src/utils/printTemplate.js
 *
 * OpenDocViewer — Print Templating & Tokens
 *
 * PURPOSE
 *   Provide token context generation and safe token substitution where
 *   values are HTML-escaped before inserting into admin-authored templates.
 */

/**
 * Escape a string for safe insertion into HTML (text context).
 * @param {string} s
 * @returns {string}
 */
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Zero-pad helper. */
function z2(n) { return (n < 10 ? '0' : '') + n; }

/**
 * Build the base token context used by header templates.
 * Adds:
 *   - date: YYYY-MM-DD (local)
 *   - time: HH:MM (24h, local)
 *
 * @param {Object|undefined} handle
 * @param {string} reason
 * @param {string} forWhom
 * @returns {{ now: string, date: string, time: string, reason: string, forWhom: string, user: Object, doc: Object, viewer: Object }}
 */
export function makeBaseTokenContext(handle, reason, forWhom) {
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
    now: now.toLocaleString ? now.toLocaleString() : now.toISOString(),
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
 * Resolve a dotted-path property from an object (e.g., "doc.title").
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
 * Perform token substitution for strings like:
 *   "${now} | ${doc.title||''} | Page ${page}/${totalPages}"
 * Values are HTML-escaped before substitution.
 * Supported form: ${path} or ${path||fallbackLiteral}
 * - path may be "reason", "forWhom", "user.name", "doc.title", "page", "totalPages", "date", "time", etc.
 * - fallbackLiteral is used if resolved value is null/undefined/empty string; quotes may be single or double.
 *
 * @param {string} tpl
 * @param {Object} tokenContext
 * @returns {string}
 */
export function applyTemplateTokensEscaped(tpl, tokenContext) {
  if (typeof tpl !== 'string' || !tpl) return '';
  return tpl.replace(/\$\{([^}]+)\}/g, function (_m, inner) {
    const raw = String(inner || '').trim();
    const parts = raw.split('||');
    const path = (parts[0] || '').trim();
    let val;
    if (path) {
      val = getByPath(tokenContext, path);
    }
    if (val === undefined || val === null || String(val) === '') {
      if (parts.length > 1) {
        const fb = parts.slice(1).join('||').trim();
        const m = fb.match(/^(['"])(.*)\1$/);
        return escapeHtml(m ? m[2] : fb);
      }
      return '';
    }
    return escapeHtml(String(val));
  });
}
