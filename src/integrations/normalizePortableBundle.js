// File: src/integrations/normalizePortableBundle.js
/**
 * File: src/integrations/normalizePortableBundle.js
 *
 * Normalizes multiple host payload shapes into the project's neutral portable bundle shape.
 *
 * Responsibilities:
 * - accept already-normalized bundles, object-document host models, URL arrays, and single URLs
 * - sanitize the result into a predictable shape for the rest of the app
 * - preserve host-provided document metadata in a rich, generic form
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
 * A normalized raw metadata record attached to a document.
 *
 * @typedef {Object} PortableMetadataRecord
 * @property {string} id
 * @property {string} key
 * @property {(string|undefined)} value
 * @property {(string|undefined)} lookupValue
 * @property {*=} rawValue
 * @property {*=} rawLookupValue
 * @property {(string|undefined)} label
 * @property {(Array<string>|undefined)} labels
 * @property {(Object<string, string>|undefined)} labelsBySource
 * @property {(Array<PortableMetadataRecord>|undefined)} duplicates
 */

/**
 * One resolved semantic alias derived from raw metadata records.
 *
 * @typedef {Object} PortableMetadataAliasDetail
 * @property {string} alias
 * @property {string} fieldId
 * @property {(string|undefined)} selectedValue
 * @property {(string|undefined)} selectedSource
 * @property {(string|undefined)} value
 * @property {(string|undefined)} lookupValue
 * @property {*=} rawValue
 * @property {*=} rawLookupValue
 * @property {(string|undefined)} label
 * @property {(string|undefined)} type
 * @property {(Array<string>|undefined)} contexts
 * @property {(Array<string>|undefined)} labels
 * @property {(Object<string, string>|undefined)} labelsBySource
 */

/**
 * A single document entry containing one or more files.
 *
 * @typedef {Object} PortableDocumentEntry
 * @property {string} documentId
 * @property {(Array<PortableMetadataRecord>|undefined)} [meta]                     Rich raw metadata records.
 * @property {(Object.<string, PortableMetadataRecord>|undefined)} [metaById]      Fast metadata lookup by field id.
 * @property {(Object.<string, string>|undefined)} [metadata]                       Simple alias -> selected text.
 * @property {(Object.<string, PortableMetadataAliasDetail>|undefined)} [metadataDetails]
 * @property {Array.<(string|PortableDocumentFile)>} files
 */

/**
 * A portable bundle groups a session and an array of document entries.
 *
 * @typedef {Object} PortableDocumentBundle
 * @property {PortableSession} session
 * @property {Array.<PortableDocumentEntry>} documents
 * @property {Object=} integration
 */

/**
 * Runtime-configurable mapping between semantic metadata aliases and metadata record identifiers used
 * by a host-specific object-document payload.
 *
 * Supported forms:
 * - `patientId: 'patient-id'`
 * - `documentDate: ['primary-date', 'fallback-date']`
 * - `unitName: { fieldId: 'unit', prefer: 'lookupValue', label: 'Unit', type: 'string' }`
 *
 * @typedef {Object.<string, (string|Array.<string>|Object|null|undefined)>} PortableBundleMetadataAliasMap
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
  const metadataAliasMap = getPortableBundleMetadataAliasMap();
  const normalizedMediaConfiguration = normalizeMediaConfiguration(model.MediaConfiguration);
  const metadataFieldCatalog = normalizedMediaConfiguration?.metadataFieldsById || {};

  const documents = [];

  for (const [docKey, docVal] of Object.entries(model.PortableDocuments || {})) {
    if (docKey === '$id') continue;

    const documentValue = isObject(docVal) ? docVal : {};
    const md = resolveMetadataBag(documentValue, docKey);
    const normalizedMeta = normalizeMetadataRecords(md, metadataFieldCatalog);
    const resolvedAliases = resolveMetadataAliases(normalizedMeta.byId, metadataAliasMap);

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

    const explicitDocumentId = documentValue.DocumentId != null && String(documentValue.DocumentId).trim()
      ? String(documentValue.DocumentId)
      : null;

    documents.push({
      documentId: explicitDocumentId || String(docKey),
      meta: normalizedMeta.list,
      metaById: hasOwnKeys(normalizedMeta.byId) ? normalizedMeta.byId : undefined,
      metadata: hasOwnKeys(resolvedAliases.text) ? resolvedAliases.text : undefined,
      metadataDetails: hasOwnKeys(resolvedAliases.details) ? resolvedAliases.details : undefined,
      files,
    });
  }

  const integration = {
    kind: 'object-document-model',
    uiCulture: coerceOptionalString(model.UICulture),
    mediaConfiguration: normalizedMediaConfiguration,
  };

  return sanitizeBundle({
    session: { id: sessId, userId },
    documents,
    integration,
  });
}

function getPortableBundleMetadataAliasMap() {
  try {
    const cfg = getRuntimeConfig();
    const map = cfg?.integrations?.portableBundle?.metadataAliases;
    if (!isObject(map)) return {};

    const out = {};
    for (const [alias, selector] of Object.entries(map)) {
      const normalizedAlias = String(alias || '').trim();
      const normalizedSelector = normalizeMetadataAliasSelector(selector);
      if (!normalizedAlias || !normalizedSelector) continue;
      out[normalizedAlias] = normalizedSelector;
    }
    return out;
  } catch {
    return {};
  }
}

function normalizeMetadataAliasSelector(value) {
  if (Array.isArray(value)) {
    const fieldIds = value
      .map((entry) => normalizeFieldId(entry))
      .filter(Boolean);
    return fieldIds.length > 0
      ? { fieldIds, prefer: 'valueThenLookup' }
      : undefined;
  }

  if (value == null) return undefined;

  if (typeof value === 'string' || typeof value === 'number') {
    const fieldId = normalizeFieldId(value);
    return fieldId ? { fieldIds: [fieldId], prefer: 'valueThenLookup' } : undefined;
  }

  if (!isObject(value)) return undefined;

  const rawFieldIds = [];
  if (value.fieldId != null) rawFieldIds.push(value.fieldId);
  if (Array.isArray(value.fieldIds)) rawFieldIds.push(...value.fieldIds);
  if (Array.isArray(value.ids)) rawFieldIds.push(...value.ids);
  if (Array.isArray(value.fields)) rawFieldIds.push(...value.fields);
  if (value.id != null) rawFieldIds.push(value.id);

  const fieldIds = rawFieldIds
    .map((entry) => normalizeFieldId(entry))
    .filter(Boolean);

  if (fieldIds.length <= 0) return undefined;

  const prefer = normalizeAliasPreference(value.prefer ?? value.select ?? value.use ?? value.mode);
  const label = coerceOptionalString(value.label ?? value.caption ?? value.name);
  const type = coerceOptionalString(value.type);
  const contexts = normalizeStringArray(value.contexts ?? value.targets ?? value.scopes);

  return {
    fieldIds,
    prefer,
    label,
    type,
    contexts,
  };
}

function normalizeAliasPreference(value) {
  const normalized = String(value || '').trim().toLowerCase();
  switch (normalized) {
    case 'value':
      return 'value';
    case 'lookupvalue':
    case 'lookup':
      return 'lookupValue';
    case 'lookupthenvalue':
    case 'lookup-first':
    case 'lookupfirst':
      return 'lookupThenValue';
    case 'valuethenlookup':
    case 'value-first':
    case 'valuefirst':
    case '':
    default:
      return 'valueThenLookup';
  }
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map((entry) => coerceOptionalString(entry))
    .filter(Boolean);
  return out.length > 0 ? out : undefined;
}

function normalizeFieldId(value) {
  if (value == null) return undefined;
  const out = String(value).trim();
  return out || undefined;
}

function resolveMetadataBag(documentValue, documentKey) {
  const candidate = documentValue.MetaDataCollection;
  if (!isObject(candidate)) return {};

  const nested = candidate[documentKey];
  if (isObject(nested)) return /** @type {Object.<string, *>} */ (nested);
  return /** @type {Object.<string, *>} */ (candidate);
}

function normalizeMetadataRecords(md, fieldCatalog) {
  /** @type {Array<PortableMetadataRecord>} */
  const list = [];
  /** @type {Object.<string, PortableMetadataRecord>} */
  const byId = {};
  if (!md || !isObject(md)) return { list, byId };

  for (const [metaKey, rawEntry] of Object.entries(md)) {
    if (metaKey === '$id') continue;
    const record = normalizeMetadataRecord(metaKey, rawEntry, fieldCatalog);
    if (!record) continue;
    list.push(record);

    const existing = byId[record.id];
    if (!existing) {
      byId[record.id] = record;
      continue;
    }

    const duplicates = Array.isArray(existing.duplicates) ? existing.duplicates.slice() : [];
    duplicates.push(record);
    byId[record.id] = {
      ...existing,
      duplicates,
    };
  }

  return { list, byId };
}

function normalizeMetadataRecord(metaKey, rawEntry, fieldCatalog) {
  const isEntryObject = isObject(rawEntry);
  const id = normalizeFieldId(
    isEntryObject
      ? (rawEntry.DataId ?? rawEntry.dataId ?? rawEntry.Id ?? rawEntry.id ?? metaKey)
      : metaKey
  );
  if (!id) return undefined;

  const rawValue = isEntryObject ? (rawEntry.Value ?? rawEntry.value) : rawEntry;
  const rawLookupValue = isEntryObject ? (rawEntry.LookupValue ?? rawEntry.lookupValue) : undefined;
  const presentation = isObject(fieldCatalog?.[id]) ? fieldCatalog[id] : null;

  return {
    id,
    key: String(metaKey || id),
    value: coerceOptionalString(rawValue),
    lookupValue: coerceOptionalString(rawLookupValue),
    rawValue,
    rawLookupValue,
    label: coerceOptionalString(presentation?.primaryCaption),
    labels: Array.isArray(presentation?.captions) ? presentation.captions.slice() : undefined,
    labelsBySource: isObject(presentation?.captionsBySource) ? { ...presentation.captionsBySource } : undefined,
    ...(isEntryObject ? spreadUnknown(rawEntry, ['DataId', 'dataId', 'Id', 'id', 'Value', 'value', 'LookupValue', 'lookupValue']) : {}),
  };
}

function resolveMetadataAliases(metaById, aliasMap) {
  const text = {};
  const details = {};
  if (!metaById || !isObject(aliasMap)) return { text, details };

  for (const [alias, selector] of Object.entries(aliasMap)) {
    const detail = resolveMetadataAlias(metaById, alias, selector);
    if (!detail || detail.selectedValue == null || detail.selectedValue === '') continue;
    text[alias] = detail.selectedValue;
    details[alias] = detail;
  }

  return { text, details };
}

function resolveMetadataAlias(metaById, alias, selector) {
  const fieldIds = Array.isArray(selector?.fieldIds) ? selector.fieldIds : [];
  for (const fieldId of fieldIds) {
    const record = metaById[fieldId];
    if (!record) continue;
    const picked = pickRecordText(record, selector?.prefer);
    if (!picked?.selectedValue) continue;
    return {
      alias,
      fieldId,
      selectedValue: picked.selectedValue,
      selectedSource: picked.selectedSource,
      value: record.value,
      lookupValue: record.lookupValue,
      rawValue: record.rawValue,
      rawLookupValue: record.rawLookupValue,
      label: coerceOptionalString(selector?.label) || record.label,
      type: coerceOptionalString(selector?.type),
      contexts: Array.isArray(selector?.contexts) ? selector.contexts.slice() : undefined,
      labels: Array.isArray(record.labels) ? record.labels.slice() : undefined,
      labelsBySource: isObject(record.labelsBySource) ? { ...record.labelsBySource } : undefined,
    };
  }
  return undefined;
}

function pickRecordText(record, prefer) {
  const value = coerceOptionalString(record?.value);
  const lookupValue = coerceOptionalString(record?.lookupValue);
  switch (normalizeAliasPreference(prefer)) {
    case 'value':
      return value ? { selectedValue: value, selectedSource: 'value' } : undefined;
    case 'lookupValue':
      return lookupValue ? { selectedValue: lookupValue, selectedSource: 'lookupValue' } : undefined;
    case 'lookupThenValue':
      if (lookupValue) return { selectedValue: lookupValue, selectedSource: 'lookupValue' };
      if (value) return { selectedValue: value, selectedSource: 'value' };
      return undefined;
    case 'valueThenLookup':
    default:
      if (value) return { selectedValue: value, selectedSource: 'value' };
      if (lookupValue) return { selectedValue: lookupValue, selectedSource: 'lookupValue' };
      return undefined;
  }
}

function normalizeMediaConfiguration(value) {
  if (!isObject(value)) return undefined;

  const largeMetadataFields = normalizeMetadataFieldCollection(value.LargeMetadataFormat, 'largeMetadataFormat');
  const metadataSortFields = normalizeMetadataFieldCollection(value.MetadataSortValues, 'metadataSortValues');
  const documentDescriptionFormat = normalizeMetadataFormatDescriptor(value.DocumentDescriptionFormat, 'documentDescriptionFormat');
  const documentShortDescriptionFormat = normalizeMetadataFormatDescriptor(value.DocumentShortDescriptionFormat, 'documentShortDescriptionFormat');
  const printoutReferenceFormat = normalizeMetadataFormatDescriptor(value.PrintoutReferenceFormat, 'printoutReferenceFormat');
  const metadataFieldsById = mergeMetadataFieldCatalogs(
    largeMetadataFields,
    metadataSortFields,
    documentDescriptionFormat,
    documentShortDescriptionFormat,
    printoutReferenceFormat
  );

  return {
    largeMetadataFields: largeMetadataFields.length > 0 ? largeMetadataFields : undefined,
    metadataSortFields: metadataSortFields.length > 0 ? metadataSortFields : undefined,
    documentDescriptionFormat,
    documentShortDescriptionFormat,
    printoutReferenceFormat,
    metadataFieldsById: hasOwnKeys(metadataFieldsById) ? metadataFieldsById : undefined,
    ...spreadUnknown(value, [
      'LargeMetadataFormat',
      'MetadataSortValues',
      'DocumentDescriptionFormat',
      'DocumentShortDescriptionFormat',
      'PrintoutReferenceFormat',
    ]),
  };
}

function normalizeMetadataFieldCollection(value, source) {
  const entries = enumerateCollectionEntries(value);
  return entries
    .map((entry) => normalizeMetadataFieldDescriptor(entry, source))
    .filter(Boolean);
}

function normalizeMetadataFieldDescriptor(value, source) {
  if (value == null) return undefined;
  if (typeof value === 'string' || typeof value === 'number') {
    const fieldId = normalizeFieldId(value);
    return fieldId ? { fieldId, source } : undefined;
  }
  if (!isObject(value)) return undefined;

  const fieldId = normalizeFieldId(value.FieldId ?? value.fieldId ?? value.DataId ?? value.dataId ?? value.Id ?? value.id);
  if (!fieldId) return undefined;

  return {
    fieldId,
    caption: coerceOptionalString(value.Caption ?? value.caption ?? value.Label ?? value.label ?? value.Name ?? value.name),
    source,
    ...spreadUnknown(value, ['FieldId', 'fieldId', 'DataId', 'dataId', 'Id', 'id', 'Caption', 'caption', 'Label', 'label', 'Name', 'name']),
  };
}

function normalizeMetadataFormatDescriptor(value, source) {
  if (!isObject(value)) return undefined;
  const fields = enumerateCollectionEntries(value.Fields)
    .map((entry) => normalizeFieldId(entry))
    .filter(Boolean);

  const formatString = coerceOptionalString(value.FormatString ?? value.formatString);
  const useLookupLongValues = typeof value.UseLookupLongValues === 'boolean'
    ? value.UseLookupLongValues
    : (typeof value.useLookupLongValues === 'boolean' ? value.useLookupLongValues : undefined);

  const out = {
    source,
    formatString,
    fields: fields.length > 0 ? fields : undefined,
    useLookupLongValues,
    ...spreadUnknown(value, ['FormatString', 'formatString', 'Fields', 'fields', 'UseLookupLongValues', 'useLookupLongValues']),
  };

  return hasOwnKeys(out) ? out : undefined;
}

function mergeMetadataFieldCatalogs(...parts) {
  const out = {};

  for (const part of parts) {
    if (Array.isArray(part)) {
      for (const descriptor of part) {
        addMetadataFieldCatalogEntry(out, descriptor);
      }
      continue;
    }

    if (isObject(part) && Array.isArray(part.fields)) {
      for (const fieldId of part.fields) {
        addMetadataFieldCatalogEntry(out, { fieldId, source: part.source });
      }
    }
  }

  return out;
}

function addMetadataFieldCatalogEntry(target, descriptor) {
  const fieldId = normalizeFieldId(descriptor?.fieldId);
  if (!fieldId) return;

  const current = isObject(target[fieldId])
    ? target[fieldId]
    : { fieldId, captions: [], captionsBySource: {} };

  const caption = coerceOptionalString(descriptor?.caption);
  const source = coerceOptionalString(descriptor?.source);

  if (caption && !current.captions.includes(caption)) {
    current.captions = current.captions.concat([caption]);
  }
  if (caption && source) {
    current.captionsBySource = {
      ...(isObject(current.captionsBySource) ? current.captionsBySource : {}),
      [source]: caption,
    };
  }

  current.primaryCaption = coerceOptionalString(current.primaryCaption) || caption || undefined;
  target[fieldId] = current;
}

function enumerateCollectionEntries(value) {
  if (Array.isArray(value)) return value;
  if (!isObject(value)) return [];
  return Object.entries(value)
    .filter(([key]) => key !== '$id')
    .map(([, entry]) => entry);
}

function sanitizeDocumentMetadata(value) {
  if (!isObject(value)) return undefined;

  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = String(key || '').trim();
    const normalizedValue = coerceOptionalString(entry);
    if (!normalizedKey || normalizedValue == null) continue;
    out[normalizedKey] = normalizedValue;
  }

  return hasOwnKeys(out) ? out : undefined;
}

function sanitizeMetadataAliasDetails(value) {
  if (!isObject(value)) return undefined;

  const out = {};
  for (const [alias, entry] of Object.entries(value)) {
    const normalizedAlias = String(alias || '').trim();
    if (!normalizedAlias || !isObject(entry)) continue;

    const fieldId = normalizeFieldId(entry.fieldId);
    const selectedValue = coerceOptionalString(entry.selectedValue);
    if (!fieldId || !selectedValue) continue;

    out[normalizedAlias] = {
      alias: normalizedAlias,
      fieldId,
      selectedValue,
      selectedSource: coerceOptionalString(entry.selectedSource),
      value: coerceOptionalString(entry.value),
      lookupValue: coerceOptionalString(entry.lookupValue),
      rawValue: entry.rawValue,
      rawLookupValue: entry.rawLookupValue,
      label: coerceOptionalString(entry.label),
      type: coerceOptionalString(entry.type),
      contexts: normalizeStringArray(entry.contexts),
      labels: normalizeStringArray(entry.labels),
      labelsBySource: isObject(entry.labelsBySource) ? { ...entry.labelsBySource } : undefined,
    };
  }

  return hasOwnKeys(out) ? out : undefined;
}

function sanitizeMetaRecord(record) {
  if (!isObject(record)) return undefined;
  const id = normalizeFieldId(record.id ?? record.DataId ?? record.dataId ?? record.key);
  if (!id) return undefined;

  const value = coerceOptionalString(record.value ?? record.Value);
  const lookupValue = coerceOptionalString(record.lookupValue ?? record.LookupValue);
  const out = {
    id,
    key: coerceOptionalString(record.key) || id,
    value,
    lookupValue,
    rawValue: record.rawValue,
    rawLookupValue: record.rawLookupValue,
    label: coerceOptionalString(record.label),
    labels: normalizeStringArray(record.labels),
    labelsBySource: isObject(record.labelsBySource) ? { ...record.labelsBySource } : undefined,
    ...spreadUnknown(record, [
      'id', 'DataId', 'dataId', 'key',
      'value', 'Value', 'lookupValue', 'LookupValue',
      'rawValue', 'rawLookupValue', 'label', 'labels', 'labelsBySource', 'duplicates'
    ]),
  };

  if (Array.isArray(record.duplicates) && record.duplicates.length > 0) {
    const duplicates = record.duplicates
      .map((entry) => sanitizeMetaRecord(entry))
      .filter(Boolean);
    if (duplicates.length > 0) out.duplicates = duplicates;
  }

  return out;
}

function sanitizeMetaRecords(value) {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map((entry) => sanitizeMetaRecord(entry))
    .filter(Boolean);
  return out.length > 0 ? out : undefined;
}

function sanitizeMetaById(value) {
  if (!isObject(value)) return undefined;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeFieldId(key);
    const normalizedValue = sanitizeMetaRecord(entry);
    if (!normalizedKey || !normalizedValue) continue;
    out[normalizedKey] = normalizedValue;
  }
  return hasOwnKeys(out) ? out : undefined;
}

function coerceOptionalString(value) {
  if (value == null) return undefined;
  const out = String(value);
  return out === '' ? undefined : out;
}

function hasOwnKeys(value) {
  return !!value && typeof value === 'object' && Object.keys(value).length > 0;
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
        meta: sanitizeMetaRecords(d?.meta),
        metaById: sanitizeMetaById(d?.metaById),
        metadata: sanitizeDocumentMetadata(d?.metadata),
        metadataDetails: sanitizeMetadataAliasDetails(d?.metadataDetails),
        files: Array.isArray(d?.files) ? d.files.map(toTicket) : [],
        ...spreadUnknown(d || {}, ['documentId', 'meta', 'metaById', 'metadata', 'metadataDetails', 'files']),
      }))
    : [];

  return {
    session,
    documents,
    ...(isObject(b?.integration) ? { integration: b.integration } : {}),
    ...spreadUnknown(b || {}, ['session', 'documents', 'integration']),
  };
}

export default {
  normalizeToPortableBundle,
};
