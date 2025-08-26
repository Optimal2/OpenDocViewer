// File: src/utils/printParse.js
/**
 * File: src/utils/printParse.js
 *
 * OpenDocViewer — Print Sequence Parser
 *
 * PURPOSE
 *   Parse a user-entered "Custom pages" string into a sequence of page indices.
 *   Supports ascending ranges (2-5) and descending ranges (5-2).
 *   Accepts spaces or commas as separators; ignores other characters.
 */

/**
 * Result of parsing a custom pages string.
 * @typedef {Object} ParseResult
 * @property {boolean} ok
 * @property {(Array.<number>|undefined)} sequence
 * @property {(string|undefined)} error
 */

/**
 * Parse "Custom pages" into a sequence.
 * - Ranges may ascend (2-5) or descend (5-2)
 * - Separators are spaces or commas
 * - Returns { ok:false, error:string } on failure
 *
 * @param {*} text
 * @param {number} totalPages
 * @returns {ParseResult}
 */
export function parsePrintSequence(text, totalPages) {
  const max = Math.max(1, Number(totalPages) || 1);

  const cleaned = String(text ?? '')
    .replace(/,/g, ' ')
    .replace(/[^0-9\- ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return { ok: false, error: 'Enter at least one page or range.' };

  /** @type {Array.<number>} */
  const out = [];

  const tokens = cleaned.split(' ').filter(Boolean);
  for (const tok of tokens) {
    if (tok.includes('--') || tok.startsWith('-') || tok.endsWith('-')) {
      return { ok: false, error: 'Invalid token "' + tok + '".' };
    }

    if (tok.includes('-')) {
      const parts = tok.split('-');
      const a = Number.parseInt(parts[0], 10);
      const b = Number.parseInt(parts[1], 10);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return { ok: false, error: 'Invalid range "' + tok + '".' };
      if (a < 1 || b < 1) return { ok: false, error: 'Page numbers must be positive.' };
      if (a > max || b > max) return { ok: false, error: 'Highest page is ' + max + '.' };

      if (a <= b) {
        for (let n = a; n <= b; n++) out.push(n);
      } else {
        for (let n = a; n >= b; n--) out.push(n);
      }
      continue;
    }

    const n = Number.parseInt(tok, 10);
    if (!Number.isFinite(n)) return { ok: false, error: 'Invalid number "' + tok + '".' };
    if (n < 1) return { ok: false, error: 'Page numbers must be positive.' };
    if (n > max) return { ok: false, error: 'Highest page is ' + max + '.' };
    out.push(n);
  }

  if (!out.length) return { ok: false, error: 'No pages selected.' };
  return { ok: true, sequence: out };
}
