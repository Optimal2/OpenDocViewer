// File: src/integrations/normalizeBundle.js
/**
 * File: src/integrations/normalizeBundle.js
 *
 * OpenDocViewer — Normalize many incoming shapes to a neutral PortableDocumentBundle v1
 *
 * PURPOSE
 *   Accepts a variety of host-provided inputs (parent page objects, arrays of URLs,
 *   string tickets, already-normalized bundles) and produces a predictable, minimal
 *   “portable bundle” that the rest of the app can consume without special cases.
 *
 * ACCEPTED INPUT SHAPES (in priority order)
 *   1) Already-normalized:
 *        { session: { id, userId? }, documents: [{ documentId, files: [...] }, ...] }
 *   2) Legacy parent-page model:
 *        { UserId?, SessionId?, PortableDocuments: { [docId]: { FileCollection, MetaDataCollection } } }
 *   3) Array of URLs or "tickets":
 *        [ "https://…/file1.png", "id|ext|relative/path/file2.tiff", { url, ext?, path? }, ... ]
 *   4) Single URL string:
 *        "https://…/file1.png"
 *   5) Fallback coercion:
 *        Any other object → minimal sanitized bundle with generated session id and empty docs.
 *
 * DESIGN NOTES
 *   - No network access and no type sniffing here (kept intentionally dependency-free).
 *   - Relative URL handling: if a value starts with "/", we treat it as app-relative (not site root)
 *     by stripping the leading slash before resolving against document.baseURI.
 *   - SSR-safety: all window/document access is guarded.
 *   - Project-wide gotcha (DO NOT change elsewhere): when type-sniffing in other modules,
 *     import from the **root** 'file-type' package (v21), NOT 'file-type/browser', which is
 *     not exported for bundlers and will break the Vite build.
 *
 * Baseline source for this module (traceability): :contentReference[oaicite:0]{index=0}
 */

/**
 * Session info stored on a bundle.
 * @typedef {Object} PortableSession
 * @property {string} id
 * @property {(string|undefined)} userId
 */

/**
 * A single file reference inside a document.
 * When a string is provided in input, it is normalized to `{ url: string }`.
 *
 * @typedef {Object} PortableDocumentFile
 * @property {string} [id]            Caller-defined identifier (optional).
 * @property {string} [ext]           File extension (lowercase, no dot), best-effort inferred.
 * @property {string} [path]          Local/relative path (portable/embedded deployments).
 * @property {string} [url]           Absolute/relative URL (hosted deployments).
 */

/**
 * A single document entry containing one or more files.
 *
 * @typedef {Object} PortableDocumentEntry
 * @property {string} documentId
 * @property {string} [created]
 * @property {string} [modified]
 * @property {*}      [meta]          Caller-defined metadata bag (kept as-is).
 * @property {Array.<(string|PortableDocumentFile)>} files
 */

/**
 * A portable bundle groups a session and an array of document entries.
 *
 * @typedef {Object} PortableDocumentBundle
 * @property {PortableSession} session
 * @property {Array.<PortableDocumentEntry>} documents
 */

/* ========================================================================== *
 * Public API
 * ========================================================================== */

/**
 * Normalize many incoming shapes to a neutral PortableDocumentBundle v1.
 *
 * @param {*} input
 * @returns {(PortableDocumentBundle|null)} A sanitized bundle or null if input is null/undefined.
 */
export function normalizeToPortableBundle(input) {
  if (!input) return null;

  // 1) Already in neutral form
  if (isObject(input) && hasNeutralShape(/** @type {*} */ (input))) {
    return sanitizeBundle(/** @type {*} */ (input));
  }

  // 2) Legacy-like parent-page model → neutral
  if (isObject(input) && looksLikeLegacyParentModel(/** @type {*} */ (input))) {
    return fromLegacyParentModel(/** @type {*} */ (input));
  }

  // 3) Array of URLs or ticket objects/strings
  if (Array.isArray(input)) {
    return fromUrlArray(/** @type {Array.<*>} */ (input));
  }

  // 4) Single URL string?
  if (typeof input === 'string') {
    return fromUrlArray([input]);
  }

  // 5) Unknown shape; coerce minimally to a sanitized bundle with empty docs.
  return sanitizeBundle({
    session: {
      id: String(/** @type {*} */ (input)?.sessionId || /** @type {*} */ (input)?.SessionId || nowId()),
      userId: /** @type {*} */ (input)?.userId || /** @type {*} */ (input)?.UserId || '',
    },
    documents: [],
  });
}

/* ========================================================================== *
 * Implementation
 * ========================================================================== */

/**
 * Is a plain object (and not an array / null).
 * @param {*} v
 * @returns {boolean}
 */
function isObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Generate a simple, unique-ish id using current time (for fallbacks).
 * @returns {string}
 */
function nowId() {
  try { return String(Date.now()); } catch { return '0'; }
}

/**
 * Determine if an input object appears to already have the neutral shape.
 * @param {*} obj
 * @returns {boolean}
 */
function hasNeutralShape(obj) {
  return isObject(obj?.session) && Array.isArray(obj?.documents);
}

/**
 * Determine if an input object resembles the legacy parent-page model.
 * @param {*} obj
 * @returns {boolean}
 */
function looksLikeLegacyParentModel(obj) {
  return (
    isObject(obj) &&
    isObject(obj.PortableDocuments) &&
    (typeof obj.UserId !== 'undefined' || typeof obj.SessionId !== 'undefined' ||
     typeof obj.userId !== 'undefined' || typeof obj.sessionId !== 'undefined')
  );
}

/**
 * Resolve a URL-like string against the current document base (SSR-safe).
 * If the string begins with "/", treat it as app-relative (strip the slash)
 * so "/images/a.png" becomes "<base>/images/a.png" instead of site-root.
 *
 * @param {*} u
 * @returns {string}
 */
function absUrl(u) {
  try {
    const s = String(u || '');
    const coerced = s.startsWith('/') ? s.slice(1) : s;
    const base =
      (typeof document !== 'undefined' && document.baseURI) ||
      (typeof window !== 'undefined' && window.location && window.location.href) ||
      'http://localhost/';
    return new URL(coerced, base).toString();
  } catch {
    return /** @type {string} */ (u || '');
  }
}

/**
 * Best-effort extension extraction from a url/path string.
 * @param {string} s
 * @returns {(string|undefined)}
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
 * Convert a "ticket" (string or object) into a normalized PortableDocumentFile (minimal).
 * Strings may be raw URLs or "id|ext|path" triples; objects may contain { id, ext, path, url }.
 *
 * @param {*} objOrStr
 * @returns {PortableDocumentFile}
 */
function toTicket(objOrStr) {
  if (typeof objOrStr === 'string') {
    // Could be "id|ext|path" or a URL
    if (objOrStr.includes('|')) {
      const [id, ext, path] = objOrStr.split('|');
      const url = path ? absUrl(path) : undefined;
      return { id, ext: (ext || undefined)?.toLowerCase(), url };
    }
    return { url: absUrl(objOrStr), ext: extFromString(objOrStr) };
  }

  if (isObject(objOrStr)) {
    const { id, ext, path, url } = /** @type {Object.<string, *>} */ (objOrStr);
    const resolved = url ? absUrl(url) : (path ? absUrl(path) : undefined);
    return {
      id: id != null ? String(id) : undefined,
      ext: (ext || extFromString(resolved || path || ''))?.toLowerCase(),
      path: path != null ? String(path) : undefined,
      url: resolved,
      // Preserve unknown fields (non-destructive shaping)
      ...spreadUnknown(/** @type {Object.<string, *>} */ (objOrStr), ['id', 'ext', 'path', 'url']),
    };
  }

  return {};
}

/**
 * Return a shallow copy of obj without the listed keys (for preserving unknown fields).
 * @param {Object.<string, *>} obj
 * @param {Array.<string>} exclude
 * @returns {Object.<string, *>}
 */
function spreadUnknown(obj, exclude) {
  /** @type {Object.<string, *>} */
  const out = {};
  for (const k in obj) {
    if (!exclude.includes(k)) out[k] = obj[k];
  }
  return out;
}

/**
 * Build a neutral bundle from an array of tickets/URLs.
 * @param {Array.<*>} arr
 * @returns {PortableDocumentBundle}
 */
function fromUrlArray(arr) {
  const files = arr.map(toTicket);
  return sanitizeBundle({
    session: { id: nowId() },
    documents: [{ documentId: 'doc-1', files }],
  });
}

/**
 * Map a legacy parent-page model to a neutral bundle.
 *
 * Expected (partial) legacy shape:
 *   {
 *     SessionId: string|number,
 *     UserId?: string|number,
 *     PortableDocuments: {
 *       [documentId]: {
 *         FileCollection: { [k]: { FileId?, FileName?, FilePath?|Path?|Url? } },
 *         MetaDataCollection: { [k]: { DataId, Value?, LookupValue? } }
 *       },
 *       $id?: ...
 *     }
 *   }
 *
 * @param {Object.<string, *>} model
 * @returns {PortableDocumentBundle}
 */
function fromLegacyParentModel(model) {
  const sessId = String(model.SessionId ?? model.sessionId ?? nowId());
  const userId = model.UserId ?? model.userId ?? '';

  /** @type {Array.<PortableDocumentEntry>} */
  const documents = [];

  // Shape: PortableDocuments is an object keyed by documentId
  for (const [docKey, docVal] of Object.entries(model.PortableDocuments || {})) {
    if (docKey === '$id') continue;

    const md = (docVal.MetaDataCollection && docVal.MetaDataCollection[docKey]) || {};
    const created = pickMeta(/** @type {Object.<string, *>} */ (md), '500');
    const modified = pickMeta(/** @type {Object.<string, *>} */ (md), '502');

    /** @type {Array.<PortableDocumentFile>} */
    const files = [];

    for (const [fileKey, f] of Object.entries(docVal.FileCollection || {})) {
      if (fileKey === '$id') continue;
      const fileName = String(f.FileName || '');
      const ext = (fileName.split('.').pop() || '').toLowerCase();
      const path = f.FilePath || f.Path || f.Url || '';
      const ticket = `${f.FileId || ''}|${ext}|${path}`;
      files.push(toTicket(ticket));
    }

    // Preserve metadata in a compact array (id/value/lookupValue)
    const mappedMeta = [];
    for (const [metaKey, m] of Object.entries(docVal.MetaDataCollection || {})) {
      if (metaKey === '$id') continue;
      mappedMeta.push({
        id: m?.DataId,
        value: m?.Value,
        lookupValue: m?.LookupValue,
      });
    }

    documents.push({
      documentId: String(docKey),
      created,
      modified,
      meta: mappedMeta,
      files,
    });
  }

  return sanitizeBundle({
    session: { id: sessId, userId },
    documents,
  });
}

/**
 * Pick a metadata value by key (best-effort).
 * @param {Object.<string, *>} md
 * @param {string} key
 * @returns {(string|undefined)}
 */
function pickMeta(md, key) {
  if (!md || !md[key]) return undefined;
  return md[key].Value ?? md[key].value ?? undefined;
}

/**
 * Sanitize a possibly-partial bundle to the canonical shape:
 *  - Ensure session.id exists and is stringified
 *  - Ensure documents[] exists (array)
 *  - Ensure each document has a string documentId
 *  - Ensure each document.files[] exists and is normalized via toTicket()
 *
 * Unknown keys are preserved at both bundle and document/file levels.
 *
 * @param {*} b
 * @returns {PortableDocumentBundle}
 */
function sanitizeBundle(b) {
  const session = {
    id: String(b?.session?.id ?? nowId()),
    userId: b?.session?.userId ?? '',
    ...spreadUnknown(b?.session || {}, ['id', 'userId']),
  };

  const documents = Array.isArray(b?.documents)
    ? b.documents.map((d) => ({
        documentId: String(d?.documentId ?? `doc-${Math.random().toString(36).slice(2)}`),
        created: d?.created,
        modified: d?.modified,
        meta: d?.meta,
        files: Array.isArray(d?.files) ? d.files.map(toTicket) : [],
        ...spreadUnknown(d || {}, ['documentId', 'created', 'modified', 'meta', 'files']),
      }))
    : [];

  return {
    session,
    documents,
    ...spreadUnknown(b || {}, ['session', 'documents']),
  };
}

export default {
  normalizeToPortableBundle,
};
