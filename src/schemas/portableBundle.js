/**
 * File: src/schemas/portableBundle.js
 *
 * OpenDocViewer — Portable Document Bundle Schema & Helpers (ESM)
 *
 * PURPOSE
 *   Define the canonical shape for a portable, serializable set of documents and
 *   provide minimal, dependency-free helpers to validate and normalize input.
 *
 * DESIGN NOTES
 *   - The schema is intentionally permissive for `files`: each entry may be either
 *     a string (treated as a URL or path) or a small object with optional fields.
 *   - We DO NOT sniff file types here. (Project-wide reminder: when type sniffing
 *     elsewhere, import from the **root** 'file-type' package, not 'file-type/browser',
 *     because v21 does not export the '/browser' subpath for bundlers.)
 *   - This module has no runtime side-effects and can be used in Node or the browser.
 *
 * Provenance / baseline reference: :contentReference[oaicite:0]{index=0}
 */

/** Schema version of this portable bundle definition. Increase on breaking changes. */
export const __portableBundleSchemaVersion = 1;

/**
 * A single file reference inside a document.
 * When a string is provided in input, it is normalized to `{ url: string }`.
 *
 * @typedef {Object} PortableDocumentFile
 * @property {string} [id]    - Caller-defined identifier (optional).
 * @property {string} [ext]   - File extension without dot (e.g., "png", "tiff").
 * @property {string} [path]  - Local/relative path (for portable/embedded deployments).
 * @property {string} [url]   - Absolute/relative URL (for hosted deployments).
 */

/**
 * A single document entry containing one or more files.
 *
 * @typedef {Object} PortableDocumentEntry
 * @property {string} documentId             - Required stable ID for the document.
 * @property {string} [created]              - ISO timestamp when created.
 * @property {string} [modified]             - ISO timestamp when last modified.
 * @property {any}    [meta]                 - Arbitrary metadata bag (client-defined).
 * @property {(string|PortableDocumentFile)[]} files - Required list of file refs.
 */

/**
 * A portable bundle groups a session and an array of document entries.
 *
 * @typedef {Object} PortableDocumentBundle
 * @property {{ id: string, userId?: string, issuedAt?: string }} session - Session context.
 * @property {PortableDocumentEntry[]} documents                         - Ordered documents.
 */

/* ========================================================================== *
 * Utilities (no external deps)
 * ========================================================================== */

/**
 * Coerce unknown input to a plain object (or return null).
 * @param {unknown} v
 * @returns {Record<string, any> | null}
 */
function toObject(v) {
  return (v && typeof v === 'object' && !Array.isArray(v)) ? /** @type {Record<string, any>} */ (v) : null;
}

/**
 * Extract lowercase file extension from a string (best-effort).
 * @param {string} s
 * @returns {string|undefined}
 */
function extFromString(s) {
  try {
    const q = String(s || '');
    const lastSlash = Math.max(q.lastIndexOf('/'), q.lastIndexOf('\\'));
    const lastDot = q.lastIndexOf('.');
    if (lastDot > lastSlash && lastDot !== -1 && lastDot < q.length - 1) {
      return q.slice(lastDot + 1).toLowerCase();
    }
  } catch { /* ignore */ }
  return undefined;
}

/**
 * Normalize a file entry. Strings become `{ url }`. Missing `ext` is inferred best-effort.
 * Unknown properties are preserved.
 *
 * @param {string|PortableDocumentFile} input
 * @returns {PortableDocumentFile}
 */
export function normalizeDocumentFile(input) {
  if (typeof input === 'string') {
    const url = input;
    return {
      url,
      ext: extFromString(url),
    };
  }
  const obj = toObject(input) || {};
  const out = /** @type {PortableDocumentFile} */ ({
    id: obj.id,
    ext: obj.ext || extFromString(obj.url || obj.path || ''),
    path: obj.path,
    url: obj.url,
  });
  // Preserve unknown fields (non-destructive normalization)
  for (const k in obj) {
    if (!(k in out)) out[k] = obj[k];
  }
  return out;
}

/**
 * Normalize a single document entry.
 *
 * @param {unknown} input
 * @returns {PortableDocumentEntry}
 */
export function normalizeDocumentEntry(input) {
  const obj = toObject(input) || {};
  const files = Array.isArray(obj.files) ? obj.files.map(normalizeDocumentFile) : [];
  /** @type {PortableDocumentEntry} */
  const out = {
    documentId: String(obj.documentId || ''),
    created: obj.created ? String(obj.created) : undefined,
    modified: obj.modified ? String(obj.modified) : undefined,
    meta: obj.meta,
    files,
  };
  // Preserve unknown fields
  for (const k in obj) {
    if (!(k in out)) out[k] = obj[k];
  }
  return out;
}

/**
 * Normalize a bundle to a predictable, minimally validated shape:
 *  - Ensures `session.id` and stringifies known fields.
 *  - Normalizes documents and files.
 *  - Does NOT throw; always returns an object (possibly with empty arrays/fields).
 *
 * @param {unknown} input
 * @returns {PortableDocumentBundle}
 */
export function normalizePortableBundle(input) {
  const obj = toObject(input) || {};
  const sessionIn = toObject(obj.session) || {};
  const docsIn = Array.isArray(obj.documents) ? obj.documents : [];

  /** @type {PortableDocumentBundle} */
  const out = {
    session: {
      id: String(sessionIn.id || ''),
      userId: sessionIn.userId != null ? String(sessionIn.userId) : undefined,
      issuedAt: sessionIn.issuedAt != null ? String(sessionIn.issuedAt) : undefined,
    },
    documents: docsIn.map(normalizeDocumentEntry),
  };

  return out;
}

/**
 * Validate a normalized (or raw) bundle. Returns a report instead of throwing.
 * Checks only the essentials to keep this light-weight:
 *  - session.id: non-empty string
 *  - documents: array
 *  - each document.documentId: non-empty string
 *  - each document.files: non-empty array of normalized file objects
 *
 * @param {unknown} input
 * @returns {{ ok: boolean, errors: string[], version: number }}
 */
export function validatePortableBundle(input) {
  const b = normalizePortableBundle(input);
  const errors = /** @type {string[]} */([]);

  if (!b.session || typeof b.session.id !== 'string' || b.session.id.trim() === '') {
    errors.push('session.id must be a non-empty string');
  }

  if (!Array.isArray(b.documents)) {
    errors.push('documents must be an array');
  } else {
    b.documents.forEach((d, idx) => {
      if (!d || typeof d.documentId !== 'string' || d.documentId.trim() === '') {
        errors.push(`documents[${idx}].documentId must be a non-empty string`);
      }
      if (!Array.isArray(d.files) || d.files.length === 0) {
        errors.push(`documents[${idx}].files must be a non-empty array`);
      } else {
        d.files.forEach((f, j) => {
          const fo = normalizeDocumentFile(f);
          if (!fo.url && !fo.path) {
            errors.push(`documents[${idx}].files[${j}] must have url or path`);
          }
        });
      }
    });
  }

  return { ok: errors.length === 0, errors, version: __portableBundleSchemaVersion };
}

/**
 * Create a shallow, immutable copy of a normalized bundle (Object.freeze tree).
 * Useful when you want to ensure read-only behavior in Redux/Context.
 *
 * @param {PortableDocumentBundle} bundle
 * @returns {PortableDocumentBundle}
 */
export function freezePortableBundle(bundle) {
  /** @type {any} */ (bundle.documents).forEach((d) => {
    Object.freeze(d.files);
    Object.freeze(d);
  });
  Object.freeze(bundle.documents);
  Object.freeze(bundle.session);
  return Object.freeze(bundle);
}

/**
 * Convenience constructor: normalize → (optionally validate) → freeze.
 *
 * @param {unknown} input
 * @param {{ validate?: boolean, freeze?: boolean }} [opts]
 * @returns {{ bundle: PortableDocumentBundle, report?: { ok: boolean, errors: string[], version: number } }}
 */
export function createPortableBundle(input, opts = {}) {
  const { validate = true, freeze = false } = opts;
  const normalized = normalizePortableBundle(input);
  let report;
  if (validate) {
    report = validatePortableBundle(normalized);
  }
  const out = freeze ? freezePortableBundle(normalized) : normalized;
  return { bundle: out, report };
}

export default {
  __portableBundleSchemaVersion,
  normalizeDocumentFile,
  normalizeDocumentEntry,
  normalizePortableBundle,
  validatePortableBundle,
  freezePortableBundle,
  createPortableBundle,
};
