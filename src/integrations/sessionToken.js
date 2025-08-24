/**
 * File: src/integrations/sessionToken.js
 *
 * OpenDocViewer — Session Token Reader (Browser-only)
 *
 * PURPOSE
 *   Decode an optional Base64/URL-safe Base64 JSON payload provided via the query string:
 *     ?sessiondata=<base64>
 *
 *   This enables hosts to pass a compact, self-contained “portable bundle” or other
 *   bootstrap data into the viewer without exposing raw JSON in the URL.
 *
 * BEHAVIOR
 *   - SSR-safe: returns null when `window` is unavailable.
 *   - Size guards: rejects tokens above conservative thresholds to avoid memory issues.
 *   - Decoding:
 *       • Accepts standard Base64 and URL-safe Base64 ("-" and "_" instead of "+" and "/").
 *       • Adds missing "=" padding as needed (len % 4).
 *       • Tries to decode as UTF-8 text; falls back to raw atob bytes if needed.
 *   - Parsing:
 *       • Attempts `JSON.parse`; when that fails, returns the decoded string as-is.
 *
 * SECURITY / PRIVACY
 *   - No network access and no eval; we only parse JSON or return a string.
 *   - Host code is responsible for validating the decoded object’s schema.
 *
 * PROJECT GOTCHA (reminder for future reviewers)
 *   - Elsewhere in the app we import from the **root** 'file-type' package, NOT 'file-type/browser'.
 *     With file-type v21 the '/browser' subpath is not exported and will break Vite builds.
 */

 /** Upper bound for the Base64 token length (~200 KB base64 ≈ 150 KB raw). */
const MAX_B64_LEN = 200_000;
/** Upper bound for the decoded raw string length. */
const MAX_RAW_LEN = 150_000;

/**
 * Normalize a Base64 string to a decodable form:
 *  - Trim whitespace
 *  - Convert URL-safe chars '-' → '+', '_' → '/'
 *  - Add '=' padding to reach a length divisible by 4
 *
 * @param {string} s
 * @returns {string}
 */
function normalizeBase64(s) {
  let v = String(s || '').trim();
  // Some proxies can replace '+' with spaces; be defensive.
  v = v.replace(/\s+/g, '');
  v = v.replace(/-/g, '+').replace(/_/g, '/');
  const pad = v.length % 4;
  if (pad === 2) v += '==';
  else if (pad === 3) v += '=';
  else if (pad !== 0 && v.length > 0) {
    // For pad === 1, decoding will fail—leave as-is and let decode handle it.
  }
  return v;
}

/**
 * Decode a Base64 string into a UTF-8 JavaScript string.
 * Falls back to best-effort ANSI decoding when UTF-8 decode fails.
 *
 * @param {string} str
 * @returns {string|null}
 */
export function b64DecodeUnicode(str) {
  try {
    const normalized = normalizeBase64(str);
    // atob yields a "binary string" (bytes 0–255 in JS 16-bit string)
    const bin = atob(normalized);
    // Percent-encode each byte, then decode as UTF-8
    const pct = Array.prototype.map
      .call(bin, (c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join('');
    return decodeURIComponent(pct);
  } catch {
    // Fallback: return raw atob if possible, else null.
    try {
      return atob(str);
    } catch {
      return null;
    }
  }
}

/**
 * Read and decode a session payload from the URL query string.
 *
 * Example:
 *   https://host/app?sessiondata=eyJzZXNzaW9uIjp7ImlkIjoiMTIzIn19  (base64-JSON)
 *
 * @returns {{ source: 'sessiondata', data: any } | null}
 *          `{ source, data }` on success; otherwise `null` if no/invalid token.
 */
export function readFromSessionToken() {
  // SSR guard
  if (typeof window === 'undefined' || typeof URLSearchParams === 'undefined') {
    return null;
  }

  const q = new URLSearchParams(window.location.search);
  const tok = q.get('sessiondata');
  if (!tok) return null;

  // First-stage guard: encoded length
  if (tok.length > MAX_B64_LEN) return null;

  // Decode with Unicode handling; if null, try raw atob; otherwise give up
  let decoded = b64DecodeUnicode(tok);
  if (decoded == null) {
    try {
      decoded = atob(tok);
    } catch {
      decoded = null;
    }
  }

  if (!decoded) return null;

  // Second-stage guard: decoded length
  if (decoded.length > MAX_RAW_LEN) return null;

  // Parse JSON if possible; otherwise return the decoded string as-is.
  try {
    const obj = JSON.parse(decoded);
    return { source: 'sessiondata', data: obj };
  } catch {
    return { source: 'sessiondata', data: decoded };
  }
}

export default { readFromSessionToken, b64DecodeUnicode };
