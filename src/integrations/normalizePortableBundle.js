// File: src/integrations/normalizePortableBundle.js
/**
 * File: src/integrations/normalizePortableBundle.js
 *
 * Normalizes multiple host payload shapes into the project’s neutral portable bundle shape.
 *
 * Responsibilities:
 * - accept already-normalized bundles, object-document host models, URL arrays, and single URLs
 * - sanitize the result into a predictable shape for the rest of the app
 * - avoid network access or heavy runtime dependencies
 *
 * This file is an integration boundary. Rendering code should consume the normalized output rather than
 * branching on host-specific input shapes.
 */

import { getRuntimeConfig } from '../utils/runtimeConfig.js';
import { createOpaqueId } from '../utils/idUtils.js';

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

/**
 * Runtime-configurable mapping between semantic document fields and metadata record identifiers used
 * by a host-specific object-document payload.
 *
 * @typedef {Object} PortableBundleMetadataFieldMap
 * @property {(string|Array.<string>|null|undefined)} [created]
 * @property {(string|Array.<string>|null|undefined)} [modified]
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

  if (isObject(input) && hasNeutralShape(/** @type {*} */ (input))) {
    return sanitizeBundle(/** @type {*} */ (input));
  }

  if (isObject(input) && looksLikeObjectDocumentModel(/** @type {*} */ (input))) {
    return fromObjectDocumentModel(/** @type {*} */ (input));
  }

  if (Array.isArray(input)) {
    return fromUrlArray(/** @type {Array.<*>} */ (input));
  }

  if (typeof input === 'string') {
    return fromUrlArray([input]);
  }

  return sanitizeBundle({
    session: {
      id: String(/** @type {*} */ (input)?.sessionId || /** @type {*} */ (input)?.SessionId || nowId()),
      userId: /** @type {*} */ (input)?.userId || /** @type {*} */ (input)?.UserId || '',
    },
    documents: [],
  });
}

function isObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function nowId() {
  try { return String(Date.now()); } catch { return '0'; }
}

function hasNeutralShape(obj) {
  return isObject(obj?.session) && Array.isArray(obj?.documents);
}

function looksLikeObjectDocumentModel(obj) {
  return (
    isObject(obj) &&
    isObject(obj.PortableDocuments) &&
    (typeof obj.UserId !== 'undefined' || typeof obj.SessionId !== 'undefined' ||
     typeof obj.userId !== 'undefined' || typeof obj.sessionId !== 'undefined')
  );
}

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

function extFromString(s) {
  try {
    const q = String(s || '');
    const lastSlash = Math.max(q.lastIndexOf('/'), q.lastIndexOf('\\'));
    const lastDot = q.lastIndexOf('.');
    if (lastDot > lastSlash && lastDot !== -1 && lastDot < q.length - 1) {
      return q.slice(lastDot + 1).toLowerCase();
    }
  } catch {}
  return undefined;
}

function toTicket(objOrStr) {
  if (typeof objOrStr === 'string') {
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
      ...spreadUnknown(/** @type {Object.<string, *>} */ (objOrStr), ['id', 'ext', 'path', 'url']),
    };
  }

  return {};
}

function spreadUnknown(obj, exclude) {
  const out = {};
  for (const k in obj) {
    if (!exclude.includes(k)) out[k] = obj[k];
  }
  return out;
}

function fromUrlArray(arr) {
  const files = arr.map(toTicket);
  return sanitizeBundle({
    session: { id: nowId() },
    documents: [{ documentId: 'doc-1', files }],
  });
}

function fromObjectDocumentModel(model) {
  const sessId = String(model.SessionId ?? model.sessionId ?? nowId());
  const userId = model.UserId ?? model.userId ?? '';
  const metadataFieldMap = getPortableBundleMetadataFieldMap();

  const documents = [];

  for (const [docKey, docVal] of Object.entries(model.PortableDocuments || {})) {
    if (docKey === '$id') continue;

    const documentValue = isObject(docVal) ? docVal : {};
    const md = resolveMetadataBag(documentValue, docKey);
    const created = resolveSemanticMetadataValue(md, metadataFieldMap.created)
      ?? coerceOptionalString(documentValue.Created ?? documentValue.created);
    const modified = resolveSemanticMetadataValue(md, metadataFieldMap.modified)
      ?? coerceOptionalString(documentValue.Modified ?? documentValue.modified);

    const files = [];

    for (const [fileKey, f] of Object.entries(documentValue.FileCollection || {})) {
      if (fileKey === '$id') continue;
      if (!isObject(f)) continue;
      const fileName = String(f.FileName || '');
      const ext = (fileName.split('.').pop() || '').toLowerCase();
      const path = f.FilePath || f.Path || f.Url || '';
      const ticket = `${f.FileId || ''}|${ext}|${path}`;
      files.push(toTicket(ticket));
    }

    const mappedMeta = [];
    for (const [metaKey, m] of Object.entries(md || {})) {
      if (metaKey === '$id') continue;
      mappedMeta.push({
        id: m?.DataId ?? metaKey,
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

function getPortableBundleMetadataFieldMap() {
  try {
    const cfg = getRuntimeConfig();
    const map = cfg?.integrations?.portableBundle?.metadataFieldMap;
    if (!isObject(map)) return {};
    return {
      created: normalizeMetadataSelector(map.created),
      modified: normalizeMetadataSelector(map.modified),
    };
  } catch {
    return {};
  }
}

function normalizeMetadataSelector(value) {
  if (Array.isArray(value)) {
    const cleaned = value
      .map((entry) => (entry == null ? '' : String(entry).trim()))
      .filter(Boolean);
    return cleaned.length > 0 ? cleaned : undefined;
  }
  if (value == null) return undefined;
  const single = String(value).trim();
  return single || undefined;
}

function resolveMetadataBag(documentValue, documentKey) {
  const candidate = documentValue.MetaDataCollection;
  if (!isObject(candidate)) return {};

  const nested = candidate[documentKey];
  if (isObject(nested)) return /** @type {Object.<string, *>} */ (nested);
  return /** @type {Object.<string, *>} */ (candidate);
}

function resolveSemanticMetadataValue(md, selector) {
  if (!md || !selector) return undefined;
  const keys = Array.isArray(selector) ? selector : [selector];
  for (const key of keys) {
    const value = pickMeta(md, key);
    if (value != null && value !== '') return value;
  }
  return undefined;
}

function pickMeta(md, key) {
  if (!md || !key) return undefined;

  const direct = md[key];
  if (isObject(direct)) {
    return coerceOptionalString(direct.Value ?? direct.value ?? direct.LookupValue ?? direct.lookupValue);
  }
  if (direct != null && typeof direct !== 'object') {
    return coerceOptionalString(direct);
  }

  for (const value of Object.values(md)) {
    if (!isObject(value)) continue;
    const dataId = value.DataId ?? value.dataId ?? value.Id ?? value.id;
    if (dataId == null || String(dataId) !== key) continue;
    return coerceOptionalString(value.Value ?? value.value ?? value.LookupValue ?? value.lookupValue);
  }

  return undefined;
}

function coerceOptionalString(value) {
  if (value == null) return undefined;
  const out = String(value);
  return out === '' ? undefined : out;
}

function sanitizeBundle(b) {
  const session = {
    id: String(b?.session?.id ?? nowId()),
    userId: b?.session?.userId ?? '',
    ...spreadUnknown(b?.session || {}, ['id', 'userId']),
  };

  const documents = Array.isArray(b?.documents)
    ? b.documents.map((d) => ({
        documentId: String(d?.documentId ?? createOpaqueId('doc', 8)),
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
