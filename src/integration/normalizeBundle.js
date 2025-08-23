// File: src/integration/normalizeBundle.js

/**
 * Normalize many incoming shapes to a neutral PortableDocumentBundle v1.
 * Accepted inputs:
 *  - Already-normalized { session, documents[] }
 *  - Parent-page object containing { UserId, SessionId, PortableDocuments, ... }
 *  - Array of URLs or tickets
 *  - Single URL string
 */
export function normalizeToPortableBundle(input) {
  if (!input) return null;

  // Already in neutral form
  if (input.session && Array.isArray(input.documents)) {
    return sanitizeBundle(input);
  }

  // Legacy-like model → neutral
  if (input.PortableDocuments && (input.UserId || input.SessionId)) {
    return fromLegacyParentModel(input);
  }

  // Array of URLs or ticket objects/strings
  if (Array.isArray(input)) {
    return fromUrlArray(input);
  }

  // Single URL string?
  if (typeof input === 'string') {
    return fromUrlArray([input]);
  }

  // Unknown; try to coerce minimally
  return sanitizeBundle({
    session: { id: String(input.sessionId || input.SessionId || Date.now()), userId: input.userId || input.UserId || '' },
    documents: []
  });
}

function absUrl(u) {
  try {
    const base = document.baseURI || window.location.href;
    // If a caller sends "/foo/bar", interpret it as app-relative, not site root.
    const coerced = (typeof u === 'string' && u.startsWith('/')) ? u.slice(1) : u;
    return new URL(coerced, base).toString();
  } catch {
    return u;
  }
}

function toTicket(objOrStr) {
  if (typeof objOrStr === 'string') {
    // Could be "id|ext|path" or a URL
    if (objOrStr.includes('|')) {
      const [id, ext, path] = objOrStr.split('|');
      return { id, ext, url: path ? absUrl(path) : undefined };
    }
    return { url: absUrl(objOrStr) };
  }
  if (objOrStr && typeof objOrStr === 'object') {
    const { id, ext, path, url } = objOrStr;
    return { id, ext, url: url ? absUrl(url) : (path ? absUrl(path) : undefined) };
  }
  return {};
}

function fromUrlArray(arr) {
  const files = arr.map(toTicket);
  return sanitizeBundle({
    session: { id: String(Date.now()) },
    documents: [{ documentId: 'doc-1', files }]
  });
}

function fromLegacyParentModel(model) {
  const sessId = String(model.SessionId ?? model.sessionId ?? Date.now());
  const userId = model.UserId ?? model.userId ?? '';
  const documents = [];

  // Shape: PortableDocuments is an object keyed by documentId
  for (const [docKey, docVal] of Object.entries(model.PortableDocuments || {})) {
    if (docKey === '$id') continue;
    const md = (docVal.MetaDataCollection && docVal.MetaDataCollection[docKey]) || {};
    const created = pickMeta(md, '500');
    const modified = pickMeta(md, '502');

    const files = [];
    for (const [fileKey, f] of Object.entries(docVal.FileCollection || {})) {
      if (fileKey === '$id') continue;
      const fileName = String(f.FileName || '');
      const ext = (fileName.split('.').pop() || '').toLowerCase();
      const path = f.FilePath || f.Path || f.Url || '';
      const ticket = `${f.FileId || ''}|${ext}|${path}`;
      files.push(toTicket(ticket));
    }

    const mappedMeta = [];
    for (const [metaKey, m] of Object.entries(md)) {
      if (metaKey === '$id') continue;
      mappedMeta.push({
        id: m.DataId,
        value: m.Value,
        lookupValue: m.LookupValue
      });
    }

    documents.push({
      documentId: docKey,
      created,
      modified,
      meta: mappedMeta,
      files
    });
  }

  return sanitizeBundle({
    session: { id: sessId, userId },
    documents
  });
}

function pickMeta(md, key) {
  if (!md || !md[key]) return undefined;
  return md[key].Value ?? md[key].value ?? undefined;
}

function sanitizeBundle(b) {
  const session = {
    id: String(b.session?.id ?? Date.now()),
    userId: b.session?.userId ?? ''
  };
  const documents = Array.isArray(b.documents) ? b.documents.map(d => ({
    documentId: String(d.documentId ?? 'doc-' + Math.random().toString(36).slice(2)),
    created: d.created,
    modified: d.modified,
    meta: d.meta,
    files: Array.isArray(d.files) ? d.files.map(toTicket) : []
  })) : [];
  return { session, documents };
}
