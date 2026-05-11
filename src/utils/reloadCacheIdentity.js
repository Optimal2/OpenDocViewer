// File: src/utils/reloadCacheIdentity.js
/**
 * Stable identities for the opt-in reload/document cache.
 *
 * Host file URLs can be short-lived tickets. Cache keys must therefore be based on stable document
 * identity when a host provides it, and fall back to URL identity only when no document version is
 * available.
 */

/**
 * @param {string} value
 * @returns {string}
 */
export function stableHash(value) {
  const text = String(value || '');
  let h1 = 0x811c9dc5;
  let h2 = 0x45d9f3b;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code;
    h2 = Math.imul(h2, 0x1000193);
    h2 ^= h2 >>> 13;
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

/**
 * @param {*} value
 * @returns {string}
 */
function part(value) {
  return value == null ? '' : String(value).trim();
}

/**
 * @param {string=} seed
 * @returns {string}
 */
export function createReloadCacheSessionId(seed = '') {
  return `odv_reload_doc_v2_${stableHash([
    'odv-reload-cache-scope-v2',
    part(seed),
  ].join('|'))}`;
}

/**
 * @param {*} entry
 * @param {number} orderIndex
 * @returns {{ sourceKey:string, mode:('document-version'|'document-url-fallback'|'url'), hasDocumentId:boolean, hasDocumentVersion:boolean }}
 */
export function describeDocumentSourceKey(entry, orderIndex = 0) {
  const documentId = part(entry?.documentId);
  const documentVersion = part(entry?.documentVersion);
  const fileToken = part(entry?.fileId)
    || part(entry?.documentFileNumber)
    || part(orderIndex)
    || part(entry?.fileIndex);
  const fileCount = part(entry?.documentFileCount);
  const extension = part(entry?.ext).toLowerCase();

  if (documentId && documentVersion) {
    return {
      sourceKey: `docsrc_${stableHash([
        'document-source-v2',
        documentId,
        documentVersion,
        fileToken,
        fileCount,
        extension,
      ].join('|'))}`,
      mode: 'document-version',
      hasDocumentId: true,
      hasDocumentVersion: true,
    };
  }

  if (documentId) {
    return {
      sourceKey: `docsrc_${stableHash([
        'document-source-url-fallback-v2',
        documentId,
        fileToken,
        fileCount,
        extension,
        part(entry?.url),
        part(orderIndex),
      ].join('|'))}`,
      mode: 'document-url-fallback',
      hasDocumentId: true,
      hasDocumentVersion: false,
    };
  }

  return {
    sourceKey: `src_${stableHash([
      'url-source-v2',
      part(entry?.url),
      part(entry?.fileIndex),
      part(orderIndex),
      extension,
    ].join('|'))}`,
    mode: 'url',
    hasDocumentId: false,
    hasDocumentVersion: false,
  };
}

/**
 * @param {*} entry
 * @param {number} orderIndex
 * @returns {string}
 */
export function createDocumentSourceKey(entry, orderIndex = 0) {
  return describeDocumentSourceKey(entry, orderIndex).sourceKey;
}

/**
 * @param {*} renderConfig
 * @returns {string}
 */
export function createRenderAssetSignature(renderConfig = {}) {
  return `render_${stableHash([
    'render-asset-v1',
    Number(renderConfig?.fullPageScale || 0) || '',
    Number(renderConfig?.thumbnailMaxWidth || 0) || '',
    Number(renderConfig?.thumbnailMaxHeight || 0) || '',
  ].join('|'))}`;
}

/**
 * @param {Object} input
 * @param {string} input.sourceKey
 * @param {number} input.pageIndex
 * @param {'full'|'thumbnail'} input.variant
 * @param {string} input.renderSignature
 * @returns {string}
 */
export function createPersistedPageAssetKey({
  sourceKey,
  pageIndex,
  variant,
  renderSignature,
}) {
  return [
    part(sourceKey),
    Math.max(0, Number(pageIndex) || 0),
    String(variant || 'full').toLowerCase() === 'thumbnail' ? 'thumbnail' : 'full',
    part(renderSignature),
  ].join(':');
}
