// File: src/utils/documentMetadata.js
/**
 * Helpers for resolving document-level metadata from the normalized portable bundle.
 *
 * The viewer keeps raw metadata (`document.meta` / `metaById`) as the primary truth and may also
 * carry semantic aliases (`metadata` / `metadataDetails`). These helpers provide UI-friendly
 * projections without discarding the richer underlying structures.
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
 * Resolve the label shown for one metadata row.
 *
 * @param {*} record
 * @param {Object<string, string>} labelsById Captions from media-configuration field catalogs.
 * @param {Object<string, Array<{ label:string, selectedSource:(string|undefined) }>>} aliasLabelsById
 *   Alias-derived labels grouped by metadata field id. This lets the UI fall back to deployment
 *   alias labels when the host payload does not provide a usable caption.
 * @returns {string}
 */
function resolveMetadataLabel(record, labelsById, aliasLabelsById = {}) {
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
  const aliasCandidates = Array.isArray(aliasLabelsById[fieldId]) ? aliasLabelsById[fieldId] : [];
  if (aliasCandidates.length > 0) {
    const value = toOptionalText(record?.value);
    const lookupValue = toOptionalText(record?.lookupValue);
    const preferredLookup = aliasCandidates.find((entry) => entry?.selectedSource === 'lookupValue');
    if (preferredLookup && lookupValue && lookupValue !== value) return preferredLookup.label;
    const preferredValue = aliasCandidates.find((entry) => entry?.selectedSource === 'value');
    if (preferredValue) return preferredValue.label;
    const anyAlias = aliasCandidates.find((entry) => toOptionalText(entry?.label));
    if (anyAlias) return anyAlias.label;
  }
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
 * @returns {Object<string, Array<{ label:string, selectedSource:(string|undefined) }>>}
 */
function buildAliasLabelsByFieldId(bundleDocument) {
  const details = isObject(bundleDocument?.metadataDetails) ? bundleDocument.metadataDetails : null;
  if (!details) return {};
  const out = {};
  for (const detail of Object.values(details)) {
    const fieldId = toOptionalText(detail?.fieldId);
    const label = toOptionalText(detail?.label);
    if (!fieldId || !label) continue;
    const bucket = Array.isArray(out[fieldId]) ? out[fieldId] : [];
    const selectedSource = toOptionalText(detail?.selectedSource);
    if (!bucket.some((entry) => entry?.label === label && entry?.selectedSource === selectedSource)) {
      bucket.push({ label, selectedSource });
    }
    out[fieldId] = bucket;
  }
  return out;
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
  const aliasLabelsById = buildAliasLabelsByFieldId(bundleDocument);

  return meta
    .map((record, index) => {
      const fieldId = toOptionalText(record?.id) || toOptionalText(record?.key) || `field-${index + 1}`;
      const valueInfo = resolveMetadataValue(record);
      return {
        key: `meta:${fieldId}:${index}`,
        fieldId,
        label: resolveMetadataLabel(record, labelsById, aliasLabelsById),
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
 * @param {*} bundleDocument
 * @param {*} mediaConfiguration
 * @returns {Array<Object>}
 */
function buildDocumentRows(bundleDocument, mediaConfiguration) {
  let rows = buildRowsFromRawMetadata(bundleDocument, mediaConfiguration);
  if (rows.length <= 0) rows = buildRowsFromMetadataDetails(bundleDocument);
  if (rows.length <= 0) rows = buildRowsFromMetadataAliases(bundleDocument);
  return rows;
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
  const rows = buildDocumentRows(bundleDocument, mediaConfiguration);
  if (rows.length <= 0) return null;

  return {
    documentId: String(bundleDocument.documentId || documentId || ''),
    rows,
    metadataRowCount: rows.length,
  };
}

/**
 * Build a session-wide metadata matrix with one row per document and one column per metadata field.
 *
 * @param {*} bundle
 * @returns {(null|{
 *   columns:Array<{ fieldId:string, label:string }>,
 *   documents:Array<{
 *     documentId:string,
 *     documentNumber:number,
 *     totalDocuments:number,
 *     pageCount:number,
 *     cells:Object<string, { displayValue:string, secondaryValue:(string|undefined), label:string, fieldId:string }>
 *   }>
 * })}
 */
export function buildDocumentMetadataMatrixView(bundle) {
  const documents = Array.isArray(bundle?.documents) ? bundle.documents : [];
  if (documents.length <= 0) return null;

  const mediaConfiguration = bundle?.integration?.mediaConfiguration;
  const { order } = buildFieldPresentationHints(mediaConfiguration);
  const metadataDocuments = [];
  const columnsById = new Map();

  documents.forEach((bundleDocument, index) => {
    if (!documentHasMetadata(bundleDocument)) return;
    const rows = buildDocumentRows(bundleDocument, mediaConfiguration);
    if (rows.length <= 0) return;

    /** @type {Record<string, { displayValue:string, secondaryValue:(string|undefined), label:string, fieldId:string }>} */
    const cells = {};
    rows.forEach((row, rowIndex) => {
      const fieldId = toOptionalText(row?.fieldId) || `field-${rowIndex + 1}`;
      cells[fieldId] = {
        displayValue: String(row?.displayValue || '—'),
        secondaryValue: toOptionalText(row?.secondaryValue),
        label: String(row?.label || fieldId),
        fieldId,
      };

      const existing = columnsById.get(fieldId);
      const currentLabel = String(row?.label || fieldId);
      const nextSortOrder = order.has(fieldId) ? order.get(fieldId) : (Number.MAX_SAFE_INTEGER - 1024 + columnsById.size);
      if (!existing) {
        columnsById.set(fieldId, {
          fieldId,
          label: currentLabel,
          sortOrder: nextSortOrder,
          sourceIndex: rowIndex,
        });
      } else if ((existing.label === existing.fieldId || !existing.label) && currentLabel && currentLabel !== fieldId) {
        existing.label = currentLabel;
      }
    });

    metadataDocuments.push({
      documentId: String(bundleDocument?.documentId || ''),
      documentNumber: index + 1,
      totalDocuments: documents.length,
      pageCount: Array.isArray(bundleDocument?.files) ? bundleDocument.files.length : 0,
      cells,
    });
  });

  if (metadataDocuments.length <= 0 || columnsById.size <= 0) return null;

  const columns = Array.from(columnsById.values())
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.sourceIndex - b.sourceIndex;
    })
    .map(({ fieldId, label }) => ({ fieldId, label: label || fieldId }));

  return {
    columns,
    documents: metadataDocuments,
  };
}
