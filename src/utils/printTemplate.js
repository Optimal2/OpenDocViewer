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

const PRESERVED_NAMED_HTML_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'apos', 'nbsp']);

/**
 * Escape a string for safe insertion into HTML (text context). Existing HTML entities are
 * preserved so already-normalized host values such as "&lt;" are not rendered as "&amp;lt;".
 * @param {string} s
 * @returns {string}
 */
function escapeHtmlSegment(s) {
  return String(s).replace(/[&<>"'`]/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      case '`': return '&#96;';
      default: return ch;
    }
  });
}

function isPreservedHtmlEntity(entity) {
  const text = String(entity || '');
  const numeric = text.match(/^&#(\d{1,7});$/);
  if (numeric) {
    const codePoint = Number(numeric[1]);
    return Number.isInteger(codePoint)
      && codePoint > 0
      && codePoint <= 0x10FFFF
      && (codePoint < 0xD800 || codePoint > 0xDFFF);
  }

  const hex = text.match(/^&#x([0-9a-fA-F]{1,6});$/);
  if (hex) {
    const codePoint = Number.parseInt(hex[1], 16);
    return Number.isInteger(codePoint)
      && codePoint > 0
      && codePoint <= 0x10FFFF
      && (codePoint < 0xD800 || codePoint > 0xDFFF);
  }

  const named = text.match(/^&([a-zA-Z][a-zA-Z0-9]{0,31});$/);
  return !!named && PRESERVED_NAMED_HTML_ENTITIES.has(named[1]);
}

export function escapeHtml(s) {
  const text = String(s);
  let out = '';
  let lastIndex = 0;
  const entityRe = /&(?:#\d{1,7}|#x[0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{0,31});/g;
  let match = entityRe.exec(text);
  while (match) {
    if (!isPreservedHtmlEntity(match[0])) {
      const invalidEntityEnd = match.index + match[0].length;
      out += escapeHtmlSegment(text.slice(lastIndex, invalidEntityEnd));
      lastIndex = invalidEntityEnd;
      match = entityRe.exec(text);
      continue;
    }

    out += escapeHtmlSegment(text.slice(lastIndex, match.index));
    out += match[0];
    lastIndex = match.index + match[0].length;
    match = entityRe.exec(text);
  }
  out += escapeHtmlSegment(text.slice(lastIndex));
  return out;
}

/** Zero-pad helper for two-digit date/time fields. */
function zeroPad2(n) {
  const value = Number(n);
  const whole = Number.isFinite(value) ? Math.trunc(value) : 0;
  const sign = whole < 0 ? '-' : '';
  return sign + String(Math.abs(whole)).padStart(2, '0');
}

/**
 * Format the built-in print date tokens.
 * @param {Date} date
 * @returns {{ now: string, date: string, time: string }}
 */
function formatDateTokens(date) {
  const y = date.getFullYear();
  const m = zeroPad2(date.getMonth() + 1);
  const d = zeroPad2(date.getDate());
  const hh = zeroPad2(date.getHours());
  const mm = zeroPad2(date.getMinutes());

  return {
    now: date.toLocaleString(),
    date: y + '-' + m + '-' + d,
    time: hh + ':' + mm,
  };
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizePositiveInteger(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

/**
 * Treat null-like host values as absent so conditional blocks suppress their whole label/value pair.
 * Other sentinel text such as "N/A" is left printable because hosts may use it deliberately.
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

function isPresentText(value) {
  return value !== undefined && value !== '';
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
 * Resolve the configured copy/print-format marker text consistently across print backends.
 * The fallback order preserves older templates while preferring the explicit marker tokens.
 * @param {*} tokenContext
 * @returns {string}
 */
export function resolveCopyMarkerText(tokenContext) {
  return valueToText(
    tokenContext?.copyMarkerText
      || tokenContext?.printFormatOutput
      || tokenContext?.printFormat
      || tokenContext?.isCopy
      || ''
  );
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
  if (Array.isArray(record.labels)) return record.labels.map(optionalText).find(isPresentText);
  if (isPlainObject(record.labelsBySource)) {
    return Object.values(record.labelsBySource).map(optionalText).find(isPresentText);
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
 * Normalize host document numbers to the print-template convention.
 * Document numbers are 1-based ordinals; 0 means absent/unknown and is never used
 * as an array index.
 * @param {*} value
 * @returns {number}
 */
function normalizeDocumentOrdinal(value) {
  const ordinal = Math.floor(Number(value) || 0);
  return ordinal >= 1 ? ordinal : 0;
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

  // documentNumber is normalized as a 1-based document ordinal throughout the print
  // token pipeline. Values below 1 mean "no document ordinal supplied" and are not
  // interpreted as zero-based array indexes.
  const documentNumber = normalizeDocumentOrdinal(pageInfo?.documentNumber);
  if (documentNumber >= 1 && documentNumber <= documents.length) {
    const document = documents[documentNumber - 1];
    return isPlainObject(document) ? document : null;
  }
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
 * Window-level values optionally supplied by embedding hosts.
 * This stays as a plain object typedef because JSDoc's type parser in our CI does not
 * accept intersection syntax like `Window & {...}`.
 * @typedef {Object} ODVPrintWindow
 * @property {Object=} __ODV_USER__
 * @property {string=} __ODV_VERSION__
 * @property {Object=} __ODV_SESSION__
 */

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
  /** @type {ODVPrintWindow} */
  const win = typeof window !== 'undefined' ? /** @type {ODVPrintWindow} */ (window) : {};
  const user = isPlainObject(win.__ODV_USER__) ? win.__ODV_USER__ : {};
  const viewer = { version: optionalText(win.__ODV_VERSION__) || '' };
  const bundle = isPlainObject(options?.bundle) ? options.bundle : {};
  const session = isPlainObject(bundle?.session) ? bundle.session : (isPlainObject(win.__ODV_SESSION__) ? win.__ODV_SESSION__ : {});

  const doc = tryGetDocumentMetadata(handle);

  const dateTokens = formatDateTokens(new Date());
  const printFormatText = valueToText(printFormat);
  const sessionAliases = buildSessionTokenAliases(session);
  const reasonSelection = isPlainObject(options?.reasonSelection) ? options.reasonSelection : {};
  const printFormatSelection = isPlainObject(options?.printFormatSelection) ? options.printFormatSelection : {};

  return {
    ...sessionAliases,
    now: dateTokens.now,
    date: dateTokens.date,
    time: dateTokens.time,
    reason: reason || '',
    reasonSelection,
    reasonOption: reasonSelection,
    forWhom: forWhom || '',
    printFormat: printFormatText,
    printFormatOutput: printFormatText,
    copyMarkerText: printFormatText,
    printFormatSelection,
    printFormatOption: printFormatSelection,
    // Backward-compatible alias: contains marker text, not a boolean.
    isCopy: printFormatText,
    user,
    session,
    bundle,
    doc,
    // Page-specific print flows replace these placeholders in makePageTokenContext().
    // They remain present in the base context so header/footer templates can safely
    // resolve document/metadata tokens even when a non-page-specific print path is used.
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
  // Keep ordinal normalization consistent with resolveBundleDocumentForPage():
  // documentNumber is 1-based when present; 0 means absent/unknown.
  const documentNumber = normalizeDocumentOrdinal(pageInfo?.documentNumber);
  const totalDocuments = normalizePositiveInteger(pageInfo?.totalDocuments);
  const documentPageNumber = normalizePositiveInteger(pageInfo?.documentPageNumber);
  const documentPageCount = normalizePositiveInteger(pageInfo?.documentPageCount);

  const doc = {
    ...(isPlainObject(baseContext?.doc) ? baseContext.doc : {}),
    ...(isPlainObject(bundleDocument.metadata) ? bundleDocument.metadata : {}),
    id: documentId,
    documentId,
    documentNumber: documentNumber || '',
    totalDocuments: totalDocuments || '',
    documentPageNumber: documentPageNumber || '',
    documentPageCount: documentPageCount || '',
    pageCount: documentPageCount || (Array.isArray(bundleDocument.files) ? bundleDocument.files.length : 0) || '',
    // Convenience title fallback for legacy templates and generic deployments:
    // prefer explicit title, then host-provided name, then stable document id.
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
  const separatorIndex = findFallbackSeparator(text);
  const path = separatorIndex === -1 ? text.trim() : text.slice(0, separatorIndex).trim();
  if (separatorIndex === -1) return { path, fallback: undefined };
  const fb = text.slice(separatorIndex + 2).trim();
  const quotedFallback = parseQuotedFallback(fb);
  return { path, fallback: quotedFallback !== undefined ? quotedFallback : fb };
}

function parseQuotedFallback(value) {
  const doubleQuoted = value.match(/^"((?:\\.|[^"\\])*)"$/);
  if (doubleQuoted) return decodeTemplateLiteral(doubleQuoted[1]);

  const singleQuoted = value.match(/^'((?:\\.|[^'\\])*)'$/);
  if (singleQuoted) return decodeTemplateLiteral(singleQuoted[1]);

  return undefined;
}

function findFallbackSeparator(text) {
  let quote = '';
  let escaped = false;

  for (let i = 0; i < text.length - 1; i += 1) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === '|' && text[i + 1] === '|') return i;
  }

  return -1;
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
//
// Regex parts / capture groups:
//   CONDITIONAL_OPEN       = opening [[ and optional whitespace
//   CONDITIONAL_EXPR       = group 1: condition token path/expression inside {{ }}
//   CONDITIONAL_SEPARATOR  = comma separator between condition and emitted content
//   CONDITIONAL_CONTENT    = group 2, 3 or 4:
//     group 2 = double-quoted content, with backslash escapes allowed
//     group 3 = single-quoted content, with backslash escapes allowed
//     group 4 = bare unquoted content up to the closing block
//   CONDITIONAL_CLOSE      = optional whitespace and closing ]]
//
// Conditional blocks must be resolved before normal token substitution because
// the block content itself may contain {{...}} or ${...} tokens. Resolving tokens
// first would erase missing condition values and make the block condition ambiguous.
const CONDITIONAL_OPEN = String.raw`\[\[\s*`;
const CONDITIONAL_EXPR = String.raw`\{\{\s*([^}]+?)\s*\}\}`;
const CONDITIONAL_SEPARATOR = String.raw`\s*,\s*`;
const CONDITIONAL_DOUBLE_QUOTED = String.raw`"((?:\\.|[^"\\])*)"`;
const CONDITIONAL_SINGLE_QUOTED = String.raw`'((?:\\.|[^'\\])*)'`;
const CONDITIONAL_BARE = String.raw`([^\]]*?)`;
const CONDITIONAL_CONTENT = `(?:${CONDITIONAL_DOUBLE_QUOTED}|${CONDITIONAL_SINGLE_QUOTED}|${CONDITIONAL_BARE})`;
const CONDITIONAL_CLOSE = String.raw`\s*\]\]`;
const CONDITIONAL_BLOCK_RE = new RegExp(
  CONDITIONAL_OPEN + CONDITIONAL_EXPR + CONDITIONAL_SEPARATOR + CONDITIONAL_CONTENT + CONDITIONAL_CLOSE,
  'g'
);

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
 * Expand legacy ${...} tokens. This intentionally supports only a simple, single-level
 * expression and skips malformed/nested expressions rather than matching across unintended
 * spans. The preferred syntax for new templates is {{...}}.
 * @param {string} tpl
 * @param {Object} tokenContext
 * @returns {string}
 */
function applyLegacyTokensEscaped(tpl, tokenContext) {
  const input = String(tpl || '');
  let out = '';
  let index = 0;

  while (index < input.length) {
    const start = input.indexOf('${', index);
    if (start === -1) {
      out += input.slice(index);
      break;
    }

    out += input.slice(index, start);
    const end = input.indexOf('}', start + 2);
    if (end === -1) {
      out += input.slice(start);
      break;
    }

    const inner = input.slice(start + 2, end);
    // Legacy tokens intentionally reject nested braces. Keeping the original
    // text avoids accidentally matching across malformed template spans.
    if (!inner || /[{}]/.test(inner)) {
      out += input.slice(start, end + 1);
    } else {
      out += resolveTokenExpressionEscaped(inner, tokenContext);
    }
    index = end + 1;
  }

  return out;
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
  // Resolution order is intentional:
  //   1) conditional blocks decide whether complete label/value fragments are emitted,
  //   2) legacy ${...} tokens are expanded for backward compatibility,
  //   3) preferred {{...}} tokens are expanded inside the remaining template.
  let out = applyConditionalBlocks(tpl, tokenContext);
  out = applyLegacyTokensEscaped(out, tokenContext);
  out = applyBraceTokensEscaped(out, tokenContext);
  return convertNewlinesToBreaks(out).trim();
}
