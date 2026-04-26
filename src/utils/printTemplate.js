// File: src/utils/printTemplate.js
/**
 * File: src/utils/printTemplate.js
 *
 * OpenDocViewer — Print Templating & Tokens
 *
 * PURPOSE
 *   Provide token context generation and safe token substitution where values are HTML-escaped
 *   before insertion into admin-authored print header/footer templates.
 *
 * SUPPORTED TEMPLATE FORMS
 *   - ${path} and ${path||'fallback'}             Existing/backward-compatible syntax.
 *   - {{path}} and {{path||'fallback'}             Preferred print-template syntax.
 *   - [[{{path}}, "content with {{path}}"]]       Conditional block. The content is emitted only
 *                                                   when path resolves to a non-empty value.
 */

const HTML_ENTITY_RE = /&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g;

/**
 * Escape a string for safe insertion into HTML (text context). Existing HTML entities are
 * preserved so already-normalized host values such as "&lt;" are not rendered as "&amp;lt;".
 * @param {string} s
 * @returns {string}
 */
export function escapeHtml(s) {
  const text = String(s);
  const entities = [];
  const protectedText = text.replace(HTML_ENTITY_RE, (entity) => {
    const token = '___ODV_ENTITY_' + entities.length + '___';
    entities.push(entity);
    return token;
  });

  return protectedText.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return ch;
    }
  }).replace(/___ODV_ENTITY_(\d+)___/g, (_m, index) => {
    const numericIndex = Number(index);
    return Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < entities.length
      ? entities[numericIndex]
      : '';
  });
}

/** Zero-pad helper. */
function z2(n) { return (n < 10 ? '0' : '') + n; }

/**
 * @param {*} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Treat null-like host values as absent so conditional blocks suppress their whole label/value pair.
 * @param {*} value
 * @returns {boolean}
 */
function hasPrintableValue(value) {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  const text = String(value).trim();
  if (!text) return false;
  const lowered = text.toLowerCase();
  return lowered !== 'null' && lowered !== 'undefined';
}

/**
 * @param {*} value
 * @returns {string}
 */
function valueToText(value) {
  if (!hasPrintableValue(value)) return '';
  if (Array.isArray(value)) return value.map((entry) => valueToText(entry)).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    if (hasPrintableValue(value.selectedValue)) return String(value.selectedValue);
    if (hasPrintableValue(value.lookupValue)) return String(value.lookupValue);
    if (hasPrintableValue(value.value)) return String(value.value);
    if (hasPrintableValue(value.displayValue)) return String(value.displayValue);
    return '';
  }
  return String(value).trim();
}

/**
 * @param {*} value
 * @returns {(string|undefined)}
 */
function optionalText(value) {
  const text = valueToText(value);
  return text ? text : undefined;
}

/**
 * @param {Object} obj
 * @param {string} key
 * @returns {string|undefined}
 */
function findCaseInsensitiveKey(obj, key) {
  if (!isPlainObject(obj)) return undefined;
  const wanted = String(key || '').toLowerCase();
  return Object.keys(obj).find((candidate) => candidate.toLowerCase() === wanted);
}

/**
 * Resolve a dotted-path property from an object (e.g., "doc.title").
 * Resolution is exact first, then case-insensitive per segment to tolerate host payload casing.
 * @param {Object} obj
 * @param {string} path
 * @returns {any}
 */
export function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = String(path).split('.').map((part) => part.trim()).filter(Boolean);
  /** @type {any} */
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    const k = parts[i];
    if (cur && Object.prototype.hasOwnProperty.call(cur, k)) {
      cur = cur[k];
      continue;
    }
    const ciKey = findCaseInsensitiveKey(cur, k);
    if (ciKey) {
      cur = cur[ciKey];
      continue;
    }
    return undefined;
  }
  return cur;
}

/**
 * @param {*} record
 * @returns {(string|undefined)}
 */
function resolveMetadataRecordValue(record) {
  if (!isPlainObject(record)) return optionalText(record);
  return optionalText(record.selectedValue)
    || optionalText(record.lookupValue)
    || optionalText(record.value)
    || optionalText(record.displayValue);
}

/**
 * @param {*} record
 * @returns {(string|undefined)}
 */
function resolveMetadataRecordKey(record) {
  if (!isPlainObject(record)) return undefined;
  return optionalText(record.id) || optionalText(record.key) || optionalText(record.fieldId);
}

/**
 * @param {*} record
 * @returns {(string|undefined)}
 */
function resolveMetadataRecordLabel(record) {
  if (!isPlainObject(record)) return undefined;
  const direct = optionalText(record.label) || optionalText(record.caption);
  if (direct) return direct;
  if (Array.isArray(record.labels)) return record.labels.map(optionalText).find(Boolean);
  if (isPlainObject(record.labelsBySource)) {
    return Object.values(record.labelsBySource).map(optionalText).find(Boolean);
  }
  return undefined;
}

/**
 * Store a metadata value under a safe, useful key if that key is not already populated.
 * @param {Object} target
 * @param {*} key
 * @param {*} value
 * @returns {void}
 */
function putMetadataValue(target, key, value) {
  const normalizedKey = optionalText(key);
  const normalizedValue = optionalText(value);
  if (!normalizedKey || !normalizedValue) return;
  if (!hasPrintableValue(target[normalizedKey])) target[normalizedKey] = normalizedValue;
}

/**
 * Build a generic metadata lookup map from raw metadata, aliases and details.
 * Keys include field ids and, when available, labels/aliases.
 * @param {*} bundleDocument
 * @returns {Object}
 */
function buildMetadataTokenMap(bundleDocument) {
  const out = {};
  if (!isPlainObject(bundleDocument)) return out;

  if (isPlainObject(bundleDocument.metadata)) {
    for (const [key, value] of Object.entries(bundleDocument.metadata)) {
      putMetadataValue(out, key, value);
    }
  }

  if (isPlainObject(bundleDocument.metadataDetails)) {
    for (const [alias, detail] of Object.entries(bundleDocument.metadataDetails)) {
      const value = resolveMetadataRecordValue(detail);
      putMetadataValue(out, alias, value);
      putMetadataValue(out, detail?.fieldId, value);
      putMetadataValue(out, detail?.label, value);
    }
  }

  if (isPlainObject(bundleDocument.metaById)) {
    for (const [key, record] of Object.entries(bundleDocument.metaById)) {
      const value = resolveMetadataRecordValue(record);
      putMetadataValue(out, key, value);
      putMetadataValue(out, resolveMetadataRecordKey(record), value);
      putMetadataValue(out, resolveMetadataRecordLabel(record), value);
    }
  }

  if (Array.isArray(bundleDocument.meta)) {
    bundleDocument.meta.forEach((record) => {
      const value = resolveMetadataRecordValue(record);
      putMetadataValue(out, resolveMetadataRecordKey(record), value);
      putMetadataValue(out, resolveMetadataRecordLabel(record), value);
    });
  }

  return out;
}

/**
 * @param {*} bundle
 * @param {*} pageInfo
 * @returns {(Object|null)}
 */
function resolveBundleDocumentForPage(bundle, pageInfo) {
  const documents = Array.isArray(bundle?.documents) ? bundle.documents : [];
  if (!documents.length) return null;

  const documentId = optionalText(pageInfo?.documentId);
  if (documentId) {
    const byId = documents.find((entry) => optionalText(entry?.documentId) === documentId);
    if (byId) return byId;
  }

  const documentNumber = Math.floor(Number(pageInfo?.documentNumber) || 0);
  if (documentNumber > 0 && documents[documentNumber - 1]) return documents[documentNumber - 1];
  return null;
}

/**
 * @param {*} session
 * @returns {Object}
 */
function buildSessionTokenAliases(session) {
  const out = {};
  if (!isPlainObject(session)) return out;

  for (const [key, value] of Object.entries(session)) {
    if (hasPrintableValue(value) && !Object.prototype.hasOwnProperty.call(out, key)) out[key] = value;
  }

  const sessionId = optionalText(session.id) || optionalText(session.sessionId) || optionalText(session.SessionId);
  const userId = optionalText(session.userId) || optionalText(session.UserId);
  if (sessionId) {
    out.sessionId = sessionId;
    out.SessionId = sessionId;
  }
  if (userId) {
    out.userId = userId;
    out.UserId = userId;
  }
  return out;
}

/**
 * Read document metadata from a viewer handle without leaking handle-specific checks into the
 * token-context builder. This is best-effort because print rendering must not fail if a host
 * implementation exposes no metadata methods or throws.
 * @param {*} handle
 * @returns {Object}
 */
function tryGetDocumentMetadata(handle) {
  if (!handle) return {};
  const candidateMethods = ['getDocumentMeta', 'getDocumentSummary'];
  for (const methodName of candidateMethods) {
    try {
      const method = handle?.[methodName];
      if (typeof method !== 'function') continue;
      const result = method.call(handle);
      if (isPlainObject(result)) return result;
    } catch {
      // Try the next compatible handle method.
    }
  }
  return {};
}

/**
 * Build the base token context used by print templates.
 *
 * @param {Object|undefined} handle
 * @param {string} reason
 * @param {string} forWhom
 * @param {string} printFormat
 * @param {Object=} options
 * @param {Object=} options.bundle
 * @param {Object=} options.reasonSelection
 * @param {Object=} options.printFormatSelection
 * @returns {Object}
 */
export function makeBaseTokenContext(handle, reason, forWhom, printFormat = '', options = {}) {
  /** @type {any} */
  const win = typeof window !== 'undefined' ? /** @type {any} */ (window) : {};
  /** @type {any} */
  const user = win.__ODV_USER__ || {};
  /** @type {any} */
  const viewer = { version: win.__ODV_VERSION__ || '' };
  const bundle = isPlainObject(options?.bundle) ? options.bundle : {};
  const session = isPlainObject(bundle?.session) ? bundle.session : (isPlainObject(win.__ODV_SESSION__) ? win.__ODV_SESSION__ : {});

  const doc = tryGetDocumentMetadata(handle);

  const now = new Date();
  const y = now.getFullYear();
  const m = z2(now.getMonth() + 1);
  const d = z2(now.getDate());
  const hh = z2(now.getHours());
  const mm = z2(now.getMinutes());
  const printFormatText = valueToText(printFormat);
  const sessionAliases = buildSessionTokenAliases(session);
  const reasonSelection = isPlainObject(options?.reasonSelection) ? options.reasonSelection : {};
  const printFormatSelection = isPlainObject(options?.printFormatSelection) ? options.printFormatSelection : {};

  return {
    ...sessionAliases,
    now: now.toLocaleString ? now.toLocaleString() : now.toISOString(),
    date: y + '-' + m + '-' + d,
    time: hh + ':' + mm,
    reason: reason || '',
    reasonSelection,
    reasonOption: reasonSelection,
    forWhom: forWhom || '',
    printFormat: printFormatText,
    printFormatSelection,
    printFormatOption: printFormatSelection,
    isCopy: printFormatText,
    user,
    session,
    bundle,
    doc,
    document: {},
    metadata: {},
    viewer
  };
}

/**
 * Derive a page-specific token context by adding the document metadata tied to one printed page.
 * @param {Object} baseContext
 * @param {*} pageInfo
 * @param {*} bundle
 * @returns {Object}
 */
export function makePageTokenContext(baseContext, pageInfo, bundle) {
  const bundleDocument = resolveBundleDocumentForPage(bundle || baseContext?.bundle, pageInfo) || {};
  const metadata = buildMetadataTokenMap(bundleDocument);
  const metadataAlias = isPlainObject(bundleDocument.metadataDetails) ? bundleDocument.metadataDetails : {};
  const documentId = optionalText(pageInfo?.documentId) || optionalText(bundleDocument.documentId) || '';
  const documentNumber = Math.max(0, Math.floor(Number(pageInfo?.documentNumber) || 0));
  const totalDocuments = Math.max(0, Math.floor(Number(pageInfo?.totalDocuments) || 0));
  const documentPageNumber = Math.max(0, Math.floor(Number(pageInfo?.documentPageNumber) || 0));
  const documentPageCount = Math.max(0, Math.floor(Number(pageInfo?.documentPageCount) || 0));
  const fileCount = Array.isArray(bundleDocument.files) ? bundleDocument.files.length : 0;

  const doc = {
    ...(isPlainObject(baseContext?.doc) ? baseContext.doc : {}),
    ...(isPlainObject(bundleDocument.metadata) ? bundleDocument.metadata : {}),
    id: documentId,
    documentId,
    documentNumber: documentNumber || '',
    totalDocuments: totalDocuments || '',
    documentPageNumber: documentPageNumber || '',
    documentPageCount: documentPageCount || '',
    pageCount: documentPageCount || fileCount || '',
    title: optionalText(bundleDocument.title) || optionalText(bundleDocument.name) || documentId || '',
    metadata,
    metadataAlias,
    metadataAliases: metadataAlias,
    metadataDetails: metadataAlias,
    metaById: isPlainObject(bundleDocument.metaById) ? bundleDocument.metaById : {},
  };

  return {
    ...baseContext,
    doc,
    document: bundleDocument,
    metadata,
    metadataAlias,
    metadataAliases: metadataAlias,
    metadataDetails: metadataAlias,
    pageInfo: pageInfo || {},
  };
}

/**
 * Parse a token expression: path or path||fallbackLiteral.
 * @param {string} raw
 * @returns {{ path:string, fallback:(string|undefined) }}
 */
function parseTokenExpression(raw) {
  const text = String(raw || '').trim();
  const parts = text.split('||');
  const path = (parts[0] || '').trim();
  if (parts.length <= 1) return { path, fallback: undefined };
  const fb = parts.slice(1).join('||').trim();
  const m = fb.match(/^(['"])(.*)\1$/);
  return { path, fallback: m ? m[2] : fb };
}

/**
 * @param {string} raw
 * @param {Object} tokenContext
 * @returns {string}
 */
function resolveTokenExpressionEscaped(raw, tokenContext) {
  const { path, fallback } = parseTokenExpression(raw);
  const val = path ? getByPath(tokenContext, path) : undefined;
  if (!hasPrintableValue(val)) return fallback !== undefined ? escapeHtml(fallback) : '';
  return escapeHtml(valueToText(val));
}

/**
 * @param {string} tpl
 * @param {Object} tokenContext
 * @returns {string}
 */
function applyBraceTokensEscaped(tpl, tokenContext) {
  return String(tpl || '').replace(/\{\{([^}]+)\}\}/g, function (_m, inner) {
    return resolveTokenExpressionEscaped(inner, tokenContext);
  });
}

/**
 * Decode the small string literal grammar used inside conditional blocks.
 * @param {string} text
 * @returns {string}
 */
function decodeTemplateLiteral(text) {
  const input = String(text || '');
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch !== '\\' || i === input.length - 1) {
      out += ch;
      continue;
    }

    const next = input[i + 1];
    i += 1;
    switch (next) {
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case '"': out += '"'; break;
      case "'": out += "'"; break;
      case '\\': out += '\\'; break;
      default: out += next; break;
    }
  }
  return out;
}

// Conditional block grammar:
//   [[{{condition.path}}, "template content"]]
// Capture groups:
//   1 = condition token path/expression inside {{ }}
//   2 = double-quoted content, with backslash escapes allowed
//   3 = single-quoted content, with backslash escapes allowed
//   4 = bare unquoted content up to the closing block
const CONDITIONAL_BLOCK_RE = /\[\[\s*\{\{\s*([^}]+?)\s*\}\}\s*,\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\]]*?))\s*\]\]/g;

/**
 * Resolve conditional blocks of the form [[{{path}}, "content"]].
 * @param {string} tpl
 * @param {Object} tokenContext
 * @returns {string}
 */
function applyConditionalBlocks(tpl, tokenContext) {
  return String(tpl || '').replace(CONDITIONAL_BLOCK_RE, function (_match, conditionPath, doubleQuoted, singleQuoted, bare) {
    const { path } = parseTokenExpression(conditionPath);
    const value = path ? getByPath(tokenContext, path) : undefined;
    if (!hasPrintableValue(value)) return '';
    const rawContent = doubleQuoted !== undefined
      ? doubleQuoted
      : (singleQuoted !== undefined ? singleQuoted : (bare || ''));
    return decodeTemplateLiteral(rawContent);
  });
}

/**
 * Convert template newlines to HTML line breaks after token expansion.
 * @param {string} html
 * @returns {string}
 */
function convertNewlinesToBreaks(html) {
  return String(html || '').replace(/\r\n|\r|\n/g, '<br>');
}

/**
 * Perform safe token substitution for print templates.
 *
 * Supported forms:
 *   ${now} | ${doc.title||''} | Page ${page}/${totalPages}
 *   {{now}} | {{doc.title||''}} | Page {{page}}/{{totalPages}}
 *   [[{{UserId}}, "Utskriven av: {{UserId}} | "]]
 *
 * Values are HTML-escaped before substitution. Admin-authored markup in the template itself is
 * preserved, matching the previous print-header behavior.
 *
 * @param {string} tpl
 * @param {Object} tokenContext
 * @returns {string}
 */
export function applyTemplateTokensEscaped(tpl, tokenContext) {
  if (typeof tpl !== 'string' || !tpl) return '';
  let out = applyConditionalBlocks(tpl, tokenContext);
  out = out.replace(/\$\{([^}]+)\}/g, function (_m, inner) {
    return resolveTokenExpressionEscaped(inner, tokenContext);
  });
  out = applyBraceTokensEscaped(out, tokenContext);
  return convertNewlinesToBreaks(out).trim();
}
