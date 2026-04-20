// File: src/utils/documentMetadata.js
/**
 * Helpers for resolving document-level metadata from the normalized portable bundle.
 *
 * The viewer keeps raw metadata (`document.meta` / `metaById`) as the primary truth and may also
 * carry semantic aliases (`metadata` / `metadataDetails`). These helpers provide a UI-friendly
 * projection without discarding the richer underlying structures.
 */

/**
 * @param {*} value
 * @returns {boolean}
 */
function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {*} value
 * @returns {(string|undefined)}
 */
function toOptionalText(value) {
  if (value == null) return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
}

/**
 * @param {*} value
 * @returns {Array<string>}
 */
function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => toOptionalText(entry))
    .filter(Boolean);
}

/**
 * @param {*} bundle
 * @param {(string|null|undefined)} documentId
 * @returns {(Object|null)}
 */
export function getBundleDocumentById(bundle, documentId) {
  const normalizedDocumentId = String(documentId || '').trim();
  if (!normalizedDocumentId) return null;
  const documents = Array.isArray(bundle?.documents) ? bundle.documents : [];
  return documents.find((entry) => String(entry?.documentId || '').trim() === normalizedDocumentId) || null;
}

/**
 * @param {*} bundleDocument
 * @returns {boolean}
 */
export function documentHasMetadata(bundleDocument) {
  if (!bundleDocument || typeof bundleDocument !== 'object') return false;
  if (Array.isArray(bundleDocument.meta) && bundleDocument.meta.length > 0) return true;
  if (isObject(bundleDocument.metaById) && Object.keys(bundleDocument.metaById).length > 0) return true;
  if (isObject(bundleDocument.metadataDetails) && Object.keys(bundleDocument.metadataDetails).length > 0) return true;
  if (isObject(bundleDocument.metadata) && Object.keys(bundleDocument.metadata).length > 0) return true;
  return false;
}

/**
 * @param {*} bundle
 * @param {(string|null|undefined)} documentId
 * @returns {boolean}
 */
export function bundleDocumentHasMetadata(bundle, documentId) {
  return documentHasMetadata(getBundleDocumentById(bundle, documentId));
}

/**
 * @param {*} mediaConfiguration
 * @returns {{ order: Map<string, number>, labelsById: Object<string, string> }}
 */
function buildFieldPresentationHints(mediaConfiguration) {
  const order = new Map();
  const labelsById = {};
  let nextOrder = 0;

  /** @param {*} entry */
  const pushEntry = (entry) => {
    const fieldId = toOptionalText(entry?.fieldId);
    if (!fieldId) return;
    if (!order.has(fieldId)) {
      order.set(fieldId, nextOrder);
      nextOrder += 1;
    }
    const caption = toOptionalText(entry?.caption);
    if (caption && !labelsById[fieldId]) labelsById[fieldId] = caption;
  };

  const metadataSortFields = Array.isArray(mediaConfiguration?.metadataSortFields)
    ? mediaConfiguration.metadataSortFields
    : [];
  const largeMetadataFields = Array.isArray(mediaConfiguration?.largeMetadataFields)
    ? mediaConfiguration.largeMetadataFields
    : [];

  metadataSortFields.forEach(pushEntry);
  largeMetadataFields.forEach(pushEntry);

  const catalog = isObject(mediaConfiguration?.metadataFieldsById)
    ? mediaConfiguration.metadataFieldsById
    : {};
  for (const [fieldId, descriptor] of Object.entries(catalog)) {
    if (!order.has(fieldId)) {
      order.set(fieldId, nextOrder);
      nextOrder += 1;
    }
    const primaryCaption = toOptionalText(descriptor?.primaryCaption);
    if (primaryCaption && !labelsById[fieldId]) labelsById[fieldId] = primaryCaption;
  }

  return { order, labelsById };
}

/**
 * @param {*} record
 * @param {Object<string, string>} labelsById
 * @returns {string}
 */
function resolveMetadataLabel(record, labelsById) {
  const fieldId = toOptionalText(record?.id) || toOptionalText(record?.key) || '—';
  const directLabel = toOptionalText(record?.label);
  if (directLabel) return directLabel;
  const labels = normalizeStringArray(record?.labels);
  if (labels.length > 0) return labels[0];
  const labelsBySource = isObject(record?.labelsBySource) ? record.labelsBySource : null;
  if (labelsBySource) {
    const sourcedLabel = Object.values(labelsBySource)
      .map((value) => toOptionalText(value))
      .find(Boolean);
    if (sourcedLabel) return sourcedLabel;
  }
  if (labelsById[fieldId]) return labelsById[fieldId];
  return fieldId;
}

/**
 * @param {*} record
 * @returns {{ displayValue:string, secondaryValue:(string|undefined), selectedSource:(string|undefined) }}
 */
function resolveMetadataValue(record) {
  const value = toOptionalText(record?.value);
  const lookupValue = toOptionalText(record?.lookupValue);
  if (lookupValue && lookupValue !== value) {
    return {
      displayValue: lookupValue,
      secondaryValue: value,
      selectedSource: 'lookupValue',
    };
  }
  return {
    displayValue: value || lookupValue || '—',
    secondaryValue: undefined,
    selectedSource: value ? 'value' : (lookupValue ? 'lookupValue' : undefined),
  };
}

/**
 * @param {*} detail
 * @param {string} alias
 * @returns {{ key:string, fieldId:string, label:string, displayValue:string, secondaryValue:(string|undefined), alias:(string|undefined), selectedSource:(string|undefined) }}
 */
function buildAliasDetailRow(detail, alias) {
  const fieldId = toOptionalText(detail?.fieldId) || alias;
  const label = toOptionalText(detail?.label) || alias;
  const selectedValue = toOptionalText(detail?.selectedValue);
  const lookupValue = toOptionalText(detail?.lookupValue);
  const value = toOptionalText(detail?.value);
  const displayValue = selectedValue || lookupValue || value || '—';
  let secondaryValue;
  if (toOptionalText(detail?.selectedSource) === 'lookupValue' && value && value !== displayValue) {
    secondaryValue = value;
  }
  return {
    key: `alias:${alias}`,
    fieldId,
    label,
    displayValue,
    secondaryValue,
    alias,
    selectedSource: toOptionalText(detail?.selectedSource),
  };
}

/**
 * @param {*} bundleDocument
 * @param {*} mediaConfiguration
 * @returns {Array<Object>}
 */
function buildRowsFromRawMetadata(bundleDocument, mediaConfiguration) {
  const meta = Array.isArray(bundleDocument?.meta) ? bundleDocument.meta : [];
  if (meta.length <= 0) return [];
  const { order, labelsById } = buildFieldPresentationHints(mediaConfiguration);

  return meta
    .map((record, index) => {
      const fieldId = toOptionalText(record?.id) || toOptionalText(record?.key) || `field-${index + 1}`;
      const valueInfo = resolveMetadataValue(record);
      return {
        key: `meta:${fieldId}:${index}`,
        fieldId,
        label: resolveMetadataLabel(record, labelsById),
        displayValue: valueInfo.displayValue,
        secondaryValue: valueInfo.secondaryValue,
        alias: undefined,
        selectedSource: valueInfo.selectedSource,
        sortOrder: order.has(fieldId) ? order.get(fieldId) : Number.MAX_SAFE_INTEGER,
        sourceIndex: index,
      };
    })
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.sourceIndex - b.sourceIndex;
    });
}

/**
 * @param {*} bundleDocument
 * @returns {Array<Object>}
 */
function buildRowsFromMetadataDetails(bundleDocument) {
  const details = isObject(bundleDocument?.metadataDetails) ? bundleDocument.metadataDetails : null;
  if (!details) return [];
  return Object.entries(details).map(([alias, detail]) => buildAliasDetailRow(detail, alias));
}

/**
 * @param {*} bundleDocument
 * @returns {Array<Object>}
 */
function buildRowsFromMetadataAliases(bundleDocument) {
  const metadata = isObject(bundleDocument?.metadata) ? bundleDocument.metadata : null;
  if (!metadata) return [];
  return Object.entries(metadata).map(([alias, value]) => ({
    key: `alias-text:${alias}`,
    fieldId: alias,
    label: alias,
    displayValue: toOptionalText(value) || '—',
    secondaryValue: undefined,
    alias,
    selectedSource: 'value',
  }));
}

/**
 * Build a UI-friendly projection of one document's metadata.
 *
 * Raw metadata rows are preferred because they preserve field ids, lookup-vs-raw distinctions,
 * and host-provided field ordering. Semantic alias data is used as a fallback when the bundle only
 * contains alias projections.
 *
 * @param {*} bundle
 * @param {(string|null|undefined)} documentId
 * @returns {(null|{ documentId:string, rows:Array<Object>, metadataRowCount:number })}
 */
export function buildDocumentMetadataView(bundle, documentId) {
  const bundleDocument = getBundleDocumentById(bundle, documentId);
  if (!bundleDocument || !documentHasMetadata(bundleDocument)) return null;

  const mediaConfiguration = bundle?.integration?.mediaConfiguration;
  let rows = buildRowsFromRawMetadata(bundleDocument, mediaConfiguration);
  if (rows.length <= 0) rows = buildRowsFromMetadataDetails(bundleDocument);
  if (rows.length <= 0) rows = buildRowsFromMetadataAliases(bundleDocument);
  if (rows.length <= 0) return null;

  return {
    documentId: String(bundleDocument.documentId || documentId || ''),
    rows,
    metadataRowCount: rows.length,
  };
}
