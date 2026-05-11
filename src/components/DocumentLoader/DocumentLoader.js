// File: src/components/DocumentLoader/DocumentLoader.js
/**
 * OpenDocViewer — Document loader orchestrator.
 *
 * WHAT CHANGED
 *   The legacy pipeline fetched, decoded, and rasterized everything up front. That works for small
 *   batches but becomes very expensive when users open thousands of pages at once.
 *
 *   The new loader now:
 *     1. resolves the ordered list of source URLs,
 *     2. optionally warns when the run looks too large,
 *     3. prefetches original source files into a temp store (memory or IndexedDB),
 *     4. analyzes page counts from the temp store in stable source order,
 *     5. inserts lightweight page placeholders, and
 *     6. lets the viewer lazily render full pages / thumbnails on demand.
 */

import React, { useEffect, useContext, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { fileTypeFromBlob } from 'file-type';
import ViewerContext from '../../contexts/viewerContext.js';
import logger from '../../logging/systemLogger.js';
import { generateDocumentList, generateDemoList, getTotalPages } from './documentLoaderUtils.js';
import {
  getDocumentLoadingConfig,
  shouldRecommendStopping,
} from '../../utils/documentLoadingConfig.js';
import LoadPressureDialog from './LoadPressureDialog.jsx';
import { getPublicAssetUrl } from '../../utils/publicAssetUrl.js';
import {
  createReloadCacheSessionId,
  describeDocumentSourceKey,
} from '../../utils/reloadCacheIdentity.js';

/**
 * @typedef {Object} DocumentSourceItem
 * @property {string} url
 * @property {string=} ext
 * @property {number=} fileIndex
 * @property {string=} documentId
 * @property {string=} documentVersion
 * @property {string=} fileId
 * @property {number=} documentNumber
 * @property {number=} totalDocuments
 * @property {number=} documentFileNumber
 * @property {number=} documentFileCount
 */

/**
 * @typedef {Object} DocumentLoaderProps
 * @property {string=} folder
 * @property {string=} extension
 * @property {number=} endNumber
 * @property {Array.<DocumentSourceItem>=} sourceList
 * @property {string=} reloadCacheSeed
 * @property {boolean=} demoMode
 * @property {'repeat'|'mix'=} demoStrategy
 * @property {number=} demoCount
 * @property {Array.<string>=} demoFormats
 * @property {*} children
 */


/**
 * @typedef {Object} PagePlaceholderInput
 * @property {number} fileIndex
 * @property {string} sourceKey
 * @property {string} fileExtension
 * @property {number} pageCount
 * @property {string} mimeType
 * @property {number} sizeBytes
 * @property {number} startIndex
 * @property {string=} documentId
 * @property {string=} documentVersion
 * @property {string=} fileId
 * @property {number=} documentNumber
 * @property {number=} totalDocuments
 * @property {number=} documentPageStart
 * @property {number=} documentPageCount
 */

/**
 * @typedef {Object} FailedPlaceholderInput
 * @property {number} fileIndex
 * @property {number} startIndex
 * @property {string=} documentId
 * @property {number=} documentNumber
 * @property {number=} totalDocuments
 * @property {number=} documentPageStart
 * @property {number=} documentPageCount
 */

/**
 * @typedef {Object} ResolvedEntry
 * @property {string} url
 * @property {number} fileIndex
 * @property {string} ext
 * @property {string=} documentId
 * @property {number=} documentNumber
 * @property {number=} totalDocuments
 * @property {number=} documentFileNumber
 * @property {number=} documentFileCount
 */

/**
 * @typedef {Object} LoadPressureSummary
 * @property {'preload'|'analysis'} phase
 * @property {number} sourceCount
 * @property {number} discoveredPageCount
 * @property {number} estimatedPageCount
 * @property {number} prefetchedBytes
 * @property {string} tempStoreMode
 * @property {boolean} tempStoreProtected
 * @property {boolean} recommendStop
 * @property {number=} prefetchConcurrency
 */

/**
 * @typedef {Object} PageEstimateStats
 * @property {number} sourceCount
 * @property {number} pageCount
 */

/**
 * @typedef {Object} PrefetchResult
 * @property {boolean} ok
 * @property {string=} sourceKey
 * @property {string=} fileExtension
 * @property {string=} mimeType
 * @property {number=} sizeBytes
 * @property {number} fileIndex
 * @property {string} url
 * @property {('document-version'|'document-url-fallback'|'url')=} cacheKeyMode
 * @property {*=} stats
 * @property {(Blob|undefined)} analysisBlob
 * @property {(number|undefined)} pageCountHint
 * @property {boolean=} aborted
 * @property {*=} error
 */

/**
 * @param {number} concurrency
 * @returns {function(function(): Promise<any>): Promise<any>}
 */
function createLimiter(concurrency) {
  const limit = Math.max(1, Number(concurrency) || 1);
  let activeCount = 0;
  /** @type {Array<{ task:function():Promise<any>, resolve:function(any):void, reject:function(*):void }>} */
  const queue = [];

  const pump = () => {
    while (activeCount < limit && queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      activeCount += 1;
      Promise.resolve()
        .then(next.task)
        .then(next.resolve, next.reject)
        .finally(() => {
          activeCount = Math.max(0, activeCount - 1);
          pump();
        });
    }
  };

  return (task) => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    pump();
  });
}

/**
 * @param {string} url
 * @returns {string}
 */
function inferUrlExtension(url) {
  const match = String(url || '').toLowerCase().match(/\.([a-z0-9]+)(?:$|\?|#)/i);
  return match ? match[1].toLowerCase() : '';
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeExtension(value) {
  const ext = String(value || '').toLowerCase().replace(/^\./, '');
  if (ext === 'jpeg') return 'jpg';
  if (ext === 'tif') return 'tiff';
  return ext;
}

const SUPPORTED_SOURCE_EXTENSIONS = Object.freeze(new Set([
  'bmp',
  'gif',
  'jpg',
  'pdf',
  'png',
  'tiff',
  'webp',
]));

const TEXT_LIKE_SOURCE_MIME_RE = /^(?:text\/|application\/(?:html|json|javascript|xhtml\+xml|xml|[\w.-]+\+(?:json|xml))|image\/svg\+xml)(?:[;\s]|$)/i;

/**
 * @param {string} value
 * @returns {boolean}
 */
function isSupportedSourceExtension(value) {
  return SUPPORTED_SOURCE_EXTENSIONS.has(normalizeExtension(value));
}

/**
 * @param {string} mimeType
 * @returns {boolean}
 */
function isTextLikeSourceMime(mimeType) {
  return TEXT_LIKE_SOURCE_MIME_RE.test(String(mimeType || '').trim());
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function asciiHead(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array();
  const chars = [];
  const limit = Math.min(view.length, 96);
  for (let index = 0; index < limit; index += 1) {
    const code = view[index];
    chars.push(code >= 32 && code <= 126 ? String.fromCharCode(code) : ' ');
  }
  return chars.join('').trimStart();
}

/**
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
function looksLikeTextPayload(bytes) {
  const head = asciiHead(bytes).toLowerCase();
  return head.startsWith('<!doctype')
    || head.startsWith('<html')
    || head.startsWith('<script')
    || head.startsWith('<?xml')
    || head.startsWith('{')
    || head.startsWith('[');
}

/**
 * @param {Uint8Array} bytes
 * @param {string} signature
 * @returns {boolean}
 */
function startsWithAscii(bytes, signature) {
  const text = String(signature || '');
  if (!bytes || bytes.length < text.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

/**
 * @param {Uint8Array} bytes
 * @param {string} ext
 * @returns {boolean}
 */
function matchesKnownSourceSignature(bytes, ext) {
  const normalized = normalizeExtension(ext);
  if (!bytes || bytes.length < 4) return false;

  switch (normalized) {
    case 'pdf':
      return startsWithAscii(bytes, '%PDF-');
    case 'png':
      return bytes.length >= 8
        && bytes[0] === 0x89
        && bytes[1] === 0x50
        && bytes[2] === 0x4e
        && bytes[3] === 0x47
        && bytes[4] === 0x0d
        && bytes[5] === 0x0a
        && bytes[6] === 0x1a
        && bytes[7] === 0x0a;
    case 'jpg':
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'gif':
      return startsWithAscii(bytes, 'GIF87a') || startsWithAscii(bytes, 'GIF89a');
    case 'bmp':
      return startsWithAscii(bytes, 'BM');
    case 'webp':
      return bytes.length >= 12 && startsWithAscii(bytes, 'RIFF') && startsWithAscii(bytes.slice(8), 'WEBP');
    case 'tiff':
      return (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00)
        || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a);
    default:
      return false;
  }
}

/**
 * @param {Blob} blob
 * @returns {Promise<Uint8Array>}
 */
async function readBlobHeadBytes(blob) {
  if (!(blob instanceof Blob) || blob.size <= 0) return new Uint8Array();
  const buffer = await blob.slice(0, 512).arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * @param {string} url
 * @returns {string}
 */
function redactUrlForLog(url) {
  try {
    const parsed = new URL(String(url || ''), globalThis.location?.href || 'http://localhost/');
    parsed.search = parsed.search ? '?...' : '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return String(url || '').split('?')[0];
  }
}

/**
 * @param {string} mimeType
 * @returns {string}
 */
function mimeToExtension(mimeType) {
  const type = String(mimeType || '').toLowerCase();
  if (type.includes('pdf')) return 'pdf';
  if (type.includes('tif')) return 'tiff';
  if (type.includes('png')) return 'png';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  if (type.includes('gif')) return 'gif';
  if (type.includes('bmp')) return 'bmp';
  if (type.includes('webp')) return 'webp';
  return '';
}

/**
 * @param {*} config
 * @returns {boolean}
 */
function isReloadCacheEnabled(config) {
  return Math.max(0, Number(config?.sourceStore?.reloadCacheTtlMs) || 0) > 0
    || Math.max(0, Number(config?.assetStore?.reloadCacheTtlMs) || 0) > 0;
}

/**
 * @param {*} config
 * @returns {'memory'|'indexeddb'}
 */
function getInitialTempStoreMode(config) {
  if (isReloadCacheEnabled(config)) return 'indexeddb';
  return String(config?.sourceStore?.mode || '').toLowerCase() === 'indexeddb' ? 'indexeddb' : 'memory';
}

/**
 * Resolve the best-effort extension we can use for page-count estimation before every source has
 * been fetched. Unknown entries intentionally fall back to an empty string so the estimator can
 * remain conservative instead of assuming that all unfetched sources behave like the first PDF/TIFF.
 *
 * @param {ResolvedEntry} entry
 * @returns {string}
 */
function getEstimatedEntryExtension(entry) {
  // Keep the warning estimator conservative. Explicit source-list extension hints can be wrong in
  // upstream integrations that proxy mixed file types through ticket-style URLs, so only trust an
  // extension that is visible in the URL itself.
  return normalizeExtension(inferUrlExtension(entry?.url || ''));
}

/**
 * Update per-extension page-count statistics used by the conservative warning estimator.
 *
 * @param {Map<string, PageEstimateStats>} statsMap
 * @param {string} extension
 * @param {number} pageCount
 * @returns {void}
 */
function updatePageEstimateStats(statsMap, extension, pageCount) {
  const key = normalizeExtension(extension);
  if (!key) return;
  const current = statsMap.get(key) || { sourceCount: 0, pageCount: 0 };
  current.sourceCount += 1;
  current.pageCount += Math.max(1, Number(pageCount) || 1);
  statsMap.set(key, current);
}

/**
 * Estimate the final page count conservatively.
 *
 * The previous estimator multiplied the average pages of the already processed sources by the total
 * number of sources. That badly overestimated mixed batches where the first few sources happened to
 * be multipage PDFs but the remaining hundreds of sources were single-page raster images.
 *
 * This estimator instead keeps per-extension averages and assumes 1 page for any unfetched source
 * whose extension is unknown or has not yet been sampled. That still catches genuinely large PDF/TIFF
 * runs but avoids alarming false positives for mixed batches.
 *
 * @param {ResolvedEntry[]} entries
 * @param {number} processedSourceCount
 * @param {number} discoveredPageCount
 * @param {Map<string, PageEstimateStats>} statsMap
 * @returns {number}
 */
function estimateTotalPagesConservatively(entries, processedSourceCount, discoveredPageCount, statsMap) {
  const processed = Math.max(0, Math.floor(Number(processedSourceCount) || 0));
  const discovered = Math.max(0, Math.floor(Number(discoveredPageCount) || 0));
  if (!Array.isArray(entries) || entries.length <= processed) return discovered;

  let estimate = discovered;
  for (let index = processed; index < entries.length; index += 1) {
    const extension = getEstimatedEntryExtension(entries[index]);
    const stats = extension ? statsMap.get(extension) : null;
    const averagePages = stats && stats.sourceCount > 0
      ? Math.max(1, Math.round(stats.pageCount / stats.sourceCount))
      : 1;
    estimate += averagePages;
  }

  return Math.max(discovered, estimate);
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  const delay = Math.max(0, Number(ms) || 0);
  if (delay <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

/**
 * Build a consistent HTTP error so the retry classifier can inspect the status code.
 *
 * @param {string} url
 * @param {number} status
 * @returns {Error}
 */
function createPrefetchHttpError(url, status) {
  const error = new Error(`Failed to fetch ${url} (status ${status})`);
  error.status = Number(status) || 0;
  error.isHttpError = true;
  return error;
}

/**
 * Host integrations often expose short-lived file tickets. When those expire, every source URL in
 * the new ODV run can fail with 404/410 or an auth-style response. Those are not transient ODV
 * failures; they mean the host must issue a fresh document session.
 *
 * @param {*} error
 * @returns {boolean}
 */
function isSourceUnavailableError(error) {
  const status = Number(error?.status);
  if (status === 401 || status === 403 || status === 404 || status === 410) return true;
  if (error?.isInvalidSourcePayload && error?.isTransientSourcePayload) return true;
  return false;
}

/**
 * @param {Object} input
 * @param {number} input.failureCount
 * @param {number} input.sourceCount
 * @returns {Error}
 */
function createSourceUnavailableSessionError({ failureCount, sourceCount }) {
  const error = new Error(
    `Document source tickets could not be resolved (${failureCount} of ${sourceCount} initial sources failed). The host/WebClient session may have expired and must issue fresh document links.`
  );
  error.isSourceUnavailableSession = true;
  return error;
}

/**
 * Build a timeout-flavoured prefetch error so the loader can fail fast without waiting for the
 * browser/network stack to decide when a stuck request should finally die.
 *
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Error}
 */
function createPrefetchTimeoutError(url, timeoutMs) {
  const error = new Error(`Prefetch timed out for ${url} after ${timeoutMs} ms`);
  error.isTimeoutError = true;
  error.timeoutMs = Number(timeoutMs) || 0;
  return error;
}

/**
 * Build a source-validation error. A common operational failure mode behind WebClient/iframe
 * integrations is an HTTP 200 response that contains an HTML login/error page instead of document
 * bytes. Such payloads must not be stored in ODV's temp caches as images/PDF files.
 *
 * @param {string} message
 * @param {Object=} details
 * @returns {Error}
 */
function createInvalidSourcePayloadError(message, details = {}) {
  const error = new Error(message);
  error.isInvalidSourcePayload = true;
  error.isTransientSourcePayload = !!details.retryable;
  error.details = details;
  return error;
}

/**
 * Validate that a fetched source looks like a renderable document before it is saved to ODV's
 * session temp store. This intentionally rejects text-like payloads even when the URL or host
 * metadata claims an image/PDF extension, because expired upstream sessions often return HTML.
 *
 * @param {Object} input
 * @param {ResolvedEntry} input.entry
 * @param {Blob} input.blob
 * @param {(Object|null)} input.detectedType
 * @param {string} input.mimeType
 * @param {string} input.fileExtension
 * @returns {Promise<void>}
 */
async function validateFetchedSourceBlob({ entry, blob, detectedType, mimeType, fileExtension }) {
  const normalizedExt = normalizeExtension(fileExtension);
  const detectedExt = normalizeExtension(detectedType?.ext || '');
  const mimeExt = normalizeExtension(mimeToExtension(mimeType));
  const expectedExt = normalizeExtension(entry?.ext || inferUrlExtension(entry?.url || ''));
  const headBytes = await readBlobHeadBytes(blob);
  const signatureExt = [detectedExt, normalizedExt, expectedExt]
    .filter(Boolean)
    .find((ext) => matchesKnownSourceSignature(headBytes, ext)) || '';

  const details = {
    url: redactUrlForLog(entry?.url || ''),
    fileIndex: Number(entry?.fileIndex || 0),
    expectedExt,
    detectedExt,
    mimeExt,
    resolvedExt: normalizedExt,
    mimeType: String(mimeType || ''),
    sizeBytes: Number(blob?.size || 0),
  };

  if (!isSupportedSourceExtension(normalizedExt)) {
    throw createInvalidSourcePayloadError(
      `Fetched source is not a supported ODV document type (${normalizedExt || 'unknown'}).`,
      details
    );
  }

  if (looksLikeTextPayload(headBytes) || (isTextLikeSourceMime(mimeType) && !signatureExt)) {
    throw createInvalidSourcePayloadError(
      'Fetched source looked like text/HTML/JSON instead of document bytes. The upstream session or document endpoint may have expired or returned an error page.',
      { ...details, retryable: true }
    );
  }

  if (detectedExt && isSupportedSourceExtension(detectedExt)) return;
  if (signatureExt) return;

  const mimeLooksRenderable = mimeExt && isSupportedSourceExtension(mimeExt);
  const imageMime = /^image\/(?!svg\+xml)/i.test(String(mimeType || ''));
  if (mimeLooksRenderable || imageMime) return;

  throw createInvalidSourcePayloadError(
    'Fetched source could not be verified as a supported PDF/image payload.',
    details
  );
}

/**
 * Retry only errors that are likely to be transient in real deployments: browser/network fetch
 * failures and gateway-style HTTP responses. Permanent input problems such as 404 are not retried.
 *
 * @param {*} error
 * @returns {boolean}
 */
function isTransientPrefetchError(error) {
  if (!error) return false;
  if (error?.isTransientSourcePayload === true) return true;
  const status = Number(error?.status);
  if (Number.isFinite(status)) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }

  const name = String(error?.name || '').toLowerCase();
  if (name === 'typeerror') return true;

  const message = String(error?.message || '').toLowerCase();
  return message.includes('failed to fetch')
    || message.includes('networkerror')
    || message.includes('network error')
    || message.includes('load failed')
    || message.includes('timed out')
    || message.includes('timeout');
}

/**
 * @param {*} value
 * @returns {(number|undefined)}
 */
function toPositiveIntOrUndefined(value) {
  const numeric = Math.floor(Number(value) || 0);
  return numeric > 0 ? numeric : undefined;
}

/**
 * Extract multi-document source context from an entry or placeholder input.
 *
 * @param {*} value
 * @returns {{ documentId:(string|undefined), documentNumber:(number|undefined), totalDocuments:(number|undefined), documentFileNumber:(number|undefined), documentFileCount:(number|undefined), hasMultipleDocuments:boolean }}
 */
function resolveDocumentSourceContext(value) {
  const documentNumber = toPositiveIntOrUndefined(value?.documentNumber);
  const totalDocuments = toPositiveIntOrUndefined(value?.totalDocuments);
  const documentFileNumber = toPositiveIntOrUndefined(value?.documentFileNumber);
  const documentFileCount = toPositiveIntOrUndefined(value?.documentFileCount);
  const rawDocumentId = value?.documentId;
  const documentId = rawDocumentId != null && String(rawDocumentId).trim()
    ? String(rawDocumentId)
    : undefined;

  return {
    documentId,
    documentNumber,
    totalDocuments,
    documentFileNumber,
    documentFileCount,
    hasMultipleDocuments: !!documentNumber && !!totalDocuments && totalDocuments > 1,
  };
}

/**
 * @param {*} entry
 * @returns {string}
 */
function getDocumentProgressKey(entry) {
  const context = resolveDocumentSourceContext(entry);
  if (!context.hasMultipleDocuments) return '';
  return context.documentId ? `doc:${context.documentId}` : `doc:${context.documentNumber}`;
}

/**
 * Patch the final page-count and boundary flags onto every page in a document once the loader knows
 * where that document ends.
 *
 * @param {Function} patchPageAtIndex
 * @param {number} startIndex
 * @param {number} endIndex
 * @param {number} documentPageCount
 * @returns {void}
 */
function finalizeDocumentPages(patchPageAtIndex, startIndex, endIndex, documentPageCount) {
  const start = Math.max(0, Number(startIndex) || 0);
  const end = Math.max(start, Number(endIndex) || 0);
  const total = Math.max(1, Number(documentPageCount) || 1);

  for (let index = start; index <= end; index += 1) {
    patchPageAtIndex(index, (current) => {
      if (!current) return {};
      const documentPageNumber = toPositiveIntOrUndefined(current.documentPageNumber)
        || (index - start + 1);
      return {
        documentPageNumber,
        documentPageCount: total,
        isDocumentStart: index === start,
        isDocumentEnd: index === end,
      };
    });
  }
}

/**
 * @param {PagePlaceholderInput} input
 * @returns {Array<Object>}
 */
function createPagePlaceholders(input) {
  const pages = [];
  const documentContext = resolveDocumentSourceContext(input);
  const documentPageStart = Math.max(0, Number(input.documentPageStart) || 0);
  const finalDocumentPageCount = toPositiveIntOrUndefined(input.documentPageCount);

  for (let pageIndex = 0; pageIndex < input.pageCount; pageIndex += 1) {
    const documentPageNumber = documentContext.hasMultipleDocuments
      ? documentPageStart + pageIndex + 1
      : undefined;

    pages.push({
      sourceKey: input.sourceKey,
      status: 1,
      fullSizeStatus: 0,
      thumbnailStatus: 0,
      fullSizeUrl: '',
      thumbnailUrl: '',
      thumbnailUsesFullAsset: false,
      loaded: false,
      fileExtension: input.fileExtension,
      fileIndex: input.fileIndex,
      pageIndex,
      allPagesIndex: input.startIndex + pageIndex,
      sourceMimeType: input.mimeType,
      sourceSizeBytes: input.sizeBytes,
      documentId: documentContext.documentId,
      documentNumber: documentContext.documentNumber,
      totalDocuments: documentContext.totalDocuments,
      documentPageNumber,
      documentPageCount: finalDocumentPageCount,
      isDocumentStart: !!documentPageNumber && documentPageNumber === 1,
      isDocumentEnd: !!documentPageNumber && !!finalDocumentPageCount && documentPageNumber === finalDocumentPageCount,
    });
  }
  return pages;
}

/**
 * @param {FailedPlaceholderInput} input
 * @returns {Array<Object>}
 */
function createFailedPlaceholder(input) {
  const documentContext = resolveDocumentSourceContext(input);
  const documentPageStart = Math.max(0, Number(input.documentPageStart) || 0);
  const finalDocumentPageCount = toPositiveIntOrUndefined(input.documentPageCount);
  const documentPageNumber = documentContext.hasMultipleDocuments
    ? documentPageStart + 1
    : undefined;

  return [{
    sourceKey: `failed_${input.fileIndex}_${input.startIndex}`,
    status: -1,
    fullSizeStatus: -1,
    thumbnailStatus: -1,
    fullSizeUrl: getPublicAssetUrl('lost.png'),
    thumbnailUrl: getPublicAssetUrl('lost.png'),
    thumbnailUsesFullAsset: false,
    loaded: false,
    fileExtension: 'png',
    fileIndex: input.fileIndex,
    pageIndex: 0,
    allPagesIndex: input.startIndex,
    documentId: documentContext.documentId,
    documentNumber: documentContext.documentNumber,
    totalDocuments: documentContext.totalDocuments,
    documentPageNumber,
    documentPageCount: finalDocumentPageCount,
    isDocumentStart: !!documentPageNumber && documentPageNumber === 1,
    isDocumentEnd: !!documentPageNumber && !!finalDocumentPageCount && documentPageNumber === finalDocumentPageCount,
  }];
}

/**
 * @param {Array<DocumentSourceItem>|null|undefined} sourceList
 * @param {boolean|undefined} demoMode
 * @param {'repeat'|'mix'|undefined} demoStrategy
 * @param {number|undefined} demoCount
 * @param {Array<string>|undefined} demoFormats
 * @param {string|undefined} folder
 * @param {string|undefined} extension
 * @param {number|undefined} endNumber
 * @returns {Array<ResolvedEntry>}
 */
function resolveEntries(sourceList, demoMode, demoStrategy, demoCount, demoFormats, folder, extension, endNumber) {
  if (Array.isArray(sourceList) && sourceList.length > 0) {
    return sourceList
      .map((item, index) => ({
        url: String(item?.url || ''),
        fileIndex: Number.isFinite(item?.fileIndex) ? Number(item.fileIndex) : index,
        ext: normalizeExtension(item?.ext || inferUrlExtension(item?.url || '')),
        documentId: item?.documentId != null && String(item.documentId).trim()
          ? String(item.documentId)
          : undefined,
        documentVersion: item?.documentVersion != null && String(item.documentVersion).trim()
          ? String(item.documentVersion)
          : undefined,
        fileId: item?.fileId != null && String(item.fileId).trim()
          ? String(item.fileId)
          : undefined,
        documentNumber: toPositiveIntOrUndefined(item?.documentNumber),
        totalDocuments: toPositiveIntOrUndefined(item?.totalDocuments),
        documentFileNumber: toPositiveIntOrUndefined(item?.documentFileNumber),
        documentFileCount: toPositiveIntOrUndefined(item?.documentFileCount),
      }))
      .filter((item) => !!item.url);
  }

  if (demoMode) {
    const urls = generateDemoList({
      strategy: demoStrategy || 'repeat',
      count: Math.max(1, Number(demoCount) || 1),
      formats: demoFormats,
    });
    return urls.map((url, index) => ({
      url,
      fileIndex: index,
      ext: normalizeExtension(inferUrlExtension(url)),
    }));
  }

  const urls = generateDocumentList(folder, extension, endNumber);
  return urls.map((url, index) => ({
    url,
    fileIndex: index,
    ext: normalizeExtension(extension || inferUrlExtension(url)),
  }));
}

/**
 * @param {string} text
 * @returns {string}
 */
function safeMessage(text) {
  return String(text || '').trim();
}

/**
 * @param {DocumentLoaderProps} props
 * @returns {React.ReactElement}
 */
const DocumentLoader = ({
  folder,
  extension,
  children,
  endNumber,
  sourceList,
  reloadCacheSeed = '',
  demoMode,
  demoStrategy = 'repeat',
  demoCount,
  demoFormats,
}) => {
  const { t } = useTranslation('common');
  const translateRef = useRef(t);
  const {
    insertPagesAtIndex,
    ensurePageAsset,
    setError,
    setWorkerCount,
    setLoadingRunActive,
    setPlannedPageCount,
    patchPageAtIndex,
    initializeDocumentSession,
    storeSourceBlob,
    readSourceBlob,
    registerSourceDescriptor,
    addMessage,
    scheduleSourceWarmup,
  } = useContext(ViewerContext);

  const isMountedRef = useRef(true);
  const activeControllersRef = useRef(new Set());
  const promptResolverRef = useRef(null);
  const [pressureSummary, setPressureSummary] = useState(null);

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  /**
   * @param {*} summary
   * @returns {Promise<boolean>}
   */
  const promptForPressure = useCallback((summary) => new Promise((resolve) => {
    promptResolverRef.current = resolve;
    setPressureSummary(summary);
  }), []);

  /**
   * @param {boolean} accepted
   * @returns {void}
   */
  const resolvePressurePrompt = useCallback((accepted) => {
    const resolver = promptResolverRef.current;
    promptResolverRef.current = null;
    setPressureSummary(null);
    resolver?.(!!accepted);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      const resolver = promptResolverRef.current;
      promptResolverRef.current = null;
      if (resolver) resolver(false);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const config = getDocumentLoadingConfig();
    const entries = resolveEntries(
      sourceList,
      demoMode,
      demoStrategy,
      demoCount,
      demoFormats,
      folder,
      extension,
      endNumber
    );

    logger.info('DocumentLoader run started', {
      sourceCount: entries.length,
      mode: Array.isArray(sourceList) && sourceList.length > 0 ? 'explicit-list' : (demoMode ? 'demo' : 'pattern'),
    });

    const reloadCacheSessionId = isReloadCacheEnabled(config)
      ? createReloadCacheSessionId(reloadCacheSeed)
      : undefined;

    const abortAllFetches = () => {
      const controllers = Array.from(activeControllersRef.current.values());
      activeControllersRef.current.clear();
      controllers.forEach((controller) => {
        try { controller.abort(); } catch {}
      });
    };

    /**
     * Whether this load run is no longer allowed to mutate React state.
     * Covers both stale re-runs (`cancelled`) and final unmounts (`isMountedRef`).
     *
     * @returns {boolean}
     */
    const shouldStopRun = () => cancelled || !isMountedRef.current;

    /**
     * @param {LoadPressureSummary} summary
     * @returns {Promise<boolean>}
     */
    const maybePrompt = async (summary) => {
      if (shouldStopRun()) return false;
      return promptForPressure({
        ...summary,
        prefetchConcurrency: String(config.fetch.strategy || 'parallel-limited').toLowerCase() === 'sequential'
          ? 1
          : config.fetch.prefetchConcurrency,
      });
    };

    const prefetchLimiter = createLimiter(config.fetch.prefetchConcurrency);

    /**
     * Fetch and persist one source blob with conservative retry behavior. The goal is not to mask
     * real permanent failures, but to absorb transient proxy/gateway/network hiccups without
     * pushing the deployment with high concurrency.
     *
     * @param {ResolvedEntry} entry
     * @param {number} orderIndex
     * @returns {Promise<PrefetchResult>}
     */
    const prefetchSource = (entry, orderIndex) => prefetchLimiter(async () => {
      if (cancelled || !isMountedRef.current) {
        return {
          ok: false,
          aborted: true,
          fileIndex: entry.fileIndex,
          url: entry.url,
        };
      }

      const maxAttempts = Math.max(1, Number(config.fetch.prefetchRetryCount) + 1 || 1);
      const retryBaseDelayMs = Math.max(0, Number(config.fetch.prefetchRetryBaseDelayMs) || 0);
      const requestTimeoutMs = Math.max(0, Number(config.fetch.prefetchRequestTimeoutMs) || 0);
      const sourceIdentity = describeDocumentSourceKey(entry, orderIndex);
      const sourceKey = sourceIdentity.sourceKey;

      if (reloadCacheSessionId && typeof readSourceBlob === 'function') {
        try {
          const cachedBlob = await readSourceBlob(sourceKey);
          if (cachedBlob instanceof Blob && cachedBlob.size > 0) {
            let detectedType = null;
            try { detectedType = await fileTypeFromBlob(cachedBlob); } catch {}

            const mimeType = String(
              detectedType?.mime
              || cachedBlob.type
              || 'application/octet-stream'
            );

            const fileExtension = normalizeExtension(
              detectedType?.ext
              || mimeToExtension(mimeType)
              || entry.ext
              || inferUrlExtension(entry.url)
              || 'png'
            );

            await validateFetchedSourceBlob({
              entry,
              blob: cachedBlob,
              detectedType,
              mimeType,
              fileExtension,
            });

            logger.info('Prefetch source restored from reload cache', {
              sourceKey,
              fileIndex: entry.fileIndex,
              fileExtension,
              sizeBytes: Number(cachedBlob.size || 0),
            });

            return {
              ok: true,
              sourceKey,
              fileExtension,
              mimeType,
              sizeBytes: Number(cachedBlob.size || 0),
              fileIndex: entry.fileIndex,
              url: entry.url,
              cacheKeyMode: sourceIdentity.mode,
              stats: { mode: 'indexeddb' },
              analysisBlob: cachedBlob,
              pageCountHint: fileExtension === 'pdf' || fileExtension === 'tiff' ? undefined : 1,
            };
          }
        } catch (error) {
          logger.warn('Reload cache source could not be reused; fetching source normally', {
            sourceKey,
            fileIndex: entry.fileIndex,
            error: String(error?.message || error),
          });
        }
      }

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const controller = new AbortController();
        activeControllersRef.current.add(controller);
        let timeoutId = 0;
        let didTimeout = false;

        try {
          if (requestTimeoutMs > 0) {
            timeoutId = window.setTimeout(() => {
              didTimeout = true;
              try { controller.abort(); } catch {}
            }, requestTimeoutMs);
          }

          const response = await fetch(entry.url, {
            signal: controller.signal,
            cache: 'no-store',
            credentials: 'same-origin',
          });
          if (!response.ok) throw createPrefetchHttpError(entry.url, response.status);

          const blob = await response.blob();
          if (!(blob instanceof Blob) || blob.size <= 0) {
            throw new Error(`Fetched source ${entry.url} is empty or invalid.`);
          }

          let detectedType = null;
          try { detectedType = await fileTypeFromBlob(blob); } catch {}

          const mimeType = String(
            detectedType?.mime
            || response.headers.get('content-type')
            || blob.type
            || 'application/octet-stream'
          );

          const fileExtension = normalizeExtension(
            detectedType?.ext
            || mimeToExtension(mimeType)
            || entry.ext
            || inferUrlExtension(entry.url)
            || 'png'
          );

          await validateFetchedSourceBlob({
            entry,
            blob,
            detectedType,
            mimeType,
            fileExtension,
          });

          const stored = await storeSourceBlob({
            sourceKey,
            blob,
            fileExtension,
            mimeType,
            originalUrl: entry.url,
            fileIndex: entry.fileIndex,
          });

          return {
            ok: true,
            sourceKey,
            fileExtension,
            mimeType,
            sizeBytes: Number(blob.size || 0),
            fileIndex: entry.fileIndex,
            url: entry.url,
            cacheKeyMode: sourceIdentity.mode,
            stats: stored?.stats || null,
            analysisBlob: blob,
            pageCountHint: fileExtension === 'pdf' || fileExtension === 'tiff' ? undefined : 1,
          };
        } catch (error) {
          const normalizedError = didTimeout
            ? createPrefetchTimeoutError(entry.url, requestTimeoutMs)
            : error;

          if ((controller.signal.aborted && !didTimeout) || cancelled) {
            return {
              ok: false,
              aborted: true,
              fileIndex: entry.fileIndex,
              url: entry.url,
            };
          }

          const shouldRetry = attempt < maxAttempts && isTransientPrefetchError(normalizedError);
          if (!shouldRetry) {
            logger.error('Prefetch failed', {
              url: entry.url,
              fileIndex: entry.fileIndex,
              attempt,
              maxAttempts,
              requestTimeoutMs,
              details: normalizedError?.details || undefined,
              error: String(normalizedError?.message || normalizedError),
            });
            return {
              ok: false,
              error: normalizedError,
              fileIndex: entry.fileIndex,
              url: entry.url,
            };
          }

          const retryDelayMs = retryBaseDelayMs * attempt;
          logger.warn('Prefetch attempt failed; retrying conservatively', {
            url: entry.url,
            fileIndex: entry.fileIndex,
            attempt,
            maxAttempts,
            requestTimeoutMs,
            retryDelayMs,
            details: normalizedError?.details || undefined,
            error: String(normalizedError?.message || normalizedError),
          });
          if (retryDelayMs > 0) await sleep(retryDelayMs);
        } finally {
          if (timeoutId) window.clearTimeout(timeoutId);
          activeControllersRef.current.delete(controller);
        }
      }

      return {
        ok: false,
        error: new Error(`Prefetch exhausted retries for ${entry.url}`),
        fileIndex: entry.fileIndex,
        url: entry.url,
      };
    });

    const run = async () => {
      setError(null);
      setWorkerCount(0);

      if (!entries.length) {
        setLoadingRunActive(false);
        setPlannedPageCount(0);
        return;
      }

      const cacheIdentityStats = entries.reduce((stats, entry, orderIndex) => {
        const mode = describeDocumentSourceKey(entry, orderIndex).mode;
        if (mode === 'document-version') stats.documentVersion += 1;
        else if (mode === 'document-url-fallback') stats.documentUrlFallback += 1;
        else stats.url += 1;
        return stats;
      }, { documentVersion: 0, documentUrlFallback: 0, url: 0 });

      const sourceWarningThreshold = Math.max(0, Number(config.warning.sourceCountThreshold) || 0);
      if (sourceWarningThreshold > 0 && entries.length >= sourceWarningThreshold) {
        const accepted = await maybePrompt({
          phase: 'preload',
          sourceCount: entries.length,
          discoveredPageCount: 0,
          estimatedPageCount: 0,
          prefetchedBytes: 0,
          tempStoreMode: getInitialTempStoreMode(config),
          tempStoreProtected: config.sourceStore.protection === 'aes-gcm-session',
          recommendStop: shouldRecommendStopping({
            sourceCount: entries.length,
            pageCount: 0,
            config,
          }),
        });

        if (!accepted || shouldStopRun()) {
          const msg = safeMessage(translateRef.current('viewer.loadPressure.stoppedMessage'));
          if (msg) addMessage(msg);
          setLoadingRunActive(false);
          return;
        }
      }

      await initializeDocumentSession({
        expectedSourceCount: entries.length,
        config,
        cacheSessionId: reloadCacheSessionId,
        cacheIdentityStats,
      });

      if (shouldStopRun()) return;

      setLoadingRunActive(true);
      setPlannedPageCount(0);

      let nextPageIndex = 0;
      let processedSourceCount = 0;
      let prefetchedBytes = 0;
      let pageWarningShown = false;
      let successfulPrefetches = 0;
      let initialUnavailableFailures = 0;
      let initialSourceUnavailableCheckActive = true;
      const pageEstimateStats = new Map();
      let activeTempStoreMode = getInitialTempStoreMode(config);
      const tempStoreProtected = config.sourceStore.protection === 'aes-gcm-session';
      const isSequentialFetch = String(config.fetch.strategy || 'parallel-limited').toLowerCase() === 'sequential';
      const abortOnSourceUnavailableCount = Math.max(0, Number(config.fetch.abortOnSourceUnavailableCount) || 0);
      const prefetchTasks = isSequentialFetch
        ? null
        : entries.map((entry, orderIndex) => prefetchSource(entry, orderIndex));
      const documentProgress = new Map();

      for (let i = 0; i < entries.length; i += 1) {
        if (cancelled) break;

        const entry = entries[i];
        const result = isSequentialFetch
          ? await prefetchSource(entry, i)
          : await prefetchTasks[i];
        if (shouldStopRun() || result.aborted) break;

        if (result.ok) {
          successfulPrefetches += 1;
          initialSourceUnavailableCheckActive = false;
          initialUnavailableFailures = 0;
        } else if (initialSourceUnavailableCheckActive && successfulPrefetches <= 0 && isSourceUnavailableError(result.error)) {
          initialUnavailableFailures += 1;
        } else {
          initialSourceUnavailableCheckActive = false;
        }

        const documentContext = resolveDocumentSourceContext(entry);
        const documentKey = getDocumentProgressKey(entry);
        let documentState = null;
        if (documentKey) {
          documentState = documentProgress.get(documentKey) || {
            startIndex: nextPageIndex,
            pageCount: 0,
          };
          if (!documentProgress.has(documentKey)) documentProgress.set(documentKey, documentState);
        }

        const documentPageStart = documentState ? documentState.pageCount : 0;
        const isLastFileInDocument = !!documentState
          && !!documentContext.documentFileNumber
          && !!documentContext.documentFileCount
          && documentContext.documentFileNumber >= documentContext.documentFileCount;

        if (!result.ok) {
          const failedPages = createFailedPlaceholder({
            fileIndex: result.fileIndex,
            startIndex: nextPageIndex,
            documentId: documentContext.documentId,
            documentNumber: documentContext.documentNumber,
            totalDocuments: documentContext.totalDocuments,
            documentPageStart,
            documentPageCount: isLastFileInDocument ? documentPageStart + 1 : undefined,
          });
          insertPagesAtIndex(failedPages, nextPageIndex);

          if (documentState) {
            documentState.pageCount += failedPages.length;
            if (isLastFileInDocument) {
              finalizeDocumentPages(
                patchPageAtIndex,
                documentState.startIndex,
                nextPageIndex + failedPages.length - 1,
                documentState.pageCount
              );
              documentProgress.delete(documentKey);
            }
          }

          nextPageIndex += failedPages.length;
          processedSourceCount += 1;
          setPlannedPageCount(nextPageIndex);

          if (
            abortOnSourceUnavailableCount > 0
            && initialSourceUnavailableCheckActive
            && successfulPrefetches <= 0
            && initialUnavailableFailures >= Math.min(abortOnSourceUnavailableCount, entries.length)
          ) {
            const sessionError = createSourceUnavailableSessionError({
              failureCount: initialUnavailableFailures,
              sourceCount: entries.length,
            });
            logger.error('Stopping document load because host source tickets appear unavailable', {
              failureCount: initialUnavailableFailures,
              sourceCount: entries.length,
              error: sessionError.message,
            });
            cancelled = true;
            abortAllFetches();
            setError(sessionError.message);
            setLoadingRunActive(false);
            setPlannedPageCount(nextPageIndex);
            return;
          }

          continue;
        }

        prefetchedBytes += Number(result.sizeBytes || 0);
        if (result.stats?.mode) activeTempStoreMode = result.stats.mode;

        let pageCount = Math.max(1, Number(result.pageCountHint) || 1);
        if (!result.pageCountHint) {
          try {
            const analysisBlob = result.analysisBlob instanceof Blob ? result.analysisBlob : null;
            const arrayBuffer = analysisBlob
              ? await analysisBlob.arrayBuffer()
              : null;
            if (!arrayBuffer) throw new Error(`Prefetched source is missing analysis bytes for ${result.sourceKey}`);
            pageCount = Math.max(1, Number(await getTotalPages(arrayBuffer, result.fileExtension)) || 1);
          } catch (error) {
            logger.warn('Failed to determine page count; falling back to 1 page', {
              sourceKey: result.sourceKey,
              url: result.url,
              error: String(error?.message || error),
            });
            pageCount = 1;
          }
        }
        result.analysisBlob = undefined;

        processedSourceCount += 1;
        updatePageEstimateStats(pageEstimateStats, result.fileExtension, pageCount);

        registerSourceDescriptor({
          sourceKey: result.sourceKey,
          fileExtension: result.fileExtension,
          fileIndex: result.fileIndex,
          pageCount,
          mimeType: result.mimeType,
          sourceUrl: result.url,
          sizeBytes: result.sizeBytes,
          cacheKeyMode: result.cacheKeyMode,
        });

        const placeholders = createPagePlaceholders({
          fileIndex: result.fileIndex,
          sourceKey: result.sourceKey,
          fileExtension: result.fileExtension,
          pageCount,
          mimeType: result.mimeType,
          sizeBytes: Number(result.sizeBytes || 0),
          startIndex: nextPageIndex,
          documentId: documentContext.documentId,
          documentNumber: documentContext.documentNumber,
          totalDocuments: documentContext.totalDocuments,
          documentPageStart,
          documentPageCount: isLastFileInDocument ? documentPageStart + pageCount : undefined,
        });

        insertPagesAtIndex(placeholders, nextPageIndex);
        scheduleSourceWarmup(nextPageIndex, placeholders.length);

        if (documentState) {
          documentState.pageCount += placeholders.length;
          if (isLastFileInDocument) {
            finalizeDocumentPages(
              patchPageAtIndex,
              documentState.startIndex,
              nextPageIndex + placeholders.length - 1,
              documentState.pageCount
            );
            documentProgress.delete(documentKey);
          }
        }

        nextPageIndex += placeholders.length;
        setPlannedPageCount(nextPageIndex);

        if (processedSourceCount === 1 && nextPageIndex > 0) {
          try { void ensurePageAsset(0, 'thumbnail', { priority: 'high' }); } catch {}
          try { void ensurePageAsset(0, 'full', { priority: 'critical' }); } catch {}
        }

        const estimatedTotalPages = processedSourceCount >= config.warning.probePageThresholdSources
          ? estimateTotalPagesConservatively(entries, processedSourceCount, nextPageIndex, pageEstimateStats)
          : nextPageIndex;

        const pageWarningThreshold = Math.max(0, Number(config.warning.pageCountThreshold) || 0);
        const exceedsPageThreshold = pageWarningThreshold > 0
          && !pageWarningShown
          && processedSourceCount < entries.length
          && (
            nextPageIndex >= pageWarningThreshold
            || estimatedTotalPages >= pageWarningThreshold
          );

        if (exceedsPageThreshold) {
          pageWarningShown = true;
          const accepted = await maybePrompt({
            phase: 'analysis',
            sourceCount: entries.length,
            discoveredPageCount: nextPageIndex,
            estimatedPageCount: estimatedTotalPages,
            prefetchedBytes,
            tempStoreMode: activeTempStoreMode,
            tempStoreProtected,
            recommendStop: shouldRecommendStopping({
              sourceCount: entries.length,
              pageCount: estimatedTotalPages,
              config,
            }),
          });

          if (!accepted || shouldStopRun()) {
            abortAllFetches();
            const msg = safeMessage(translateRef.current('viewer.loadPressure.stoppedMessage'));
            if (msg) addMessage(msg);
            setLoadingRunActive(false);
            setPlannedPageCount(nextPageIndex);
            return;
          }
        }
      }

      if (!shouldStopRun()) {
        setLoadingRunActive(false);
        setPlannedPageCount(nextPageIndex);

        if (nextPageIndex > 0) {
          try { void ensurePageAsset(0, 'thumbnail', { priority: 'high' }); } catch {}
          try { void ensurePageAsset(0, 'full', { priority: 'critical' }); } catch {}
        }
      }
    };

    run().catch((error) => {
      if (!shouldStopRun()) {
        logger.error('DocumentLoader run failed', { error: String(error?.message || error) });
        setError(String(error?.message || error));
        setLoadingRunActive(false);
      }
    });

    return () => {
      cancelled = true;
      abortAllFetches();
      const resolver = promptResolverRef.current;
      promptResolverRef.current = null;
      if (resolver) resolver(false);
      setPressureSummary(null);
      setLoadingRunActive(false);
      setWorkerCount(0);
    };
  }, [
    addMessage,
    demoCount,
    demoFormats,
    demoMode,
    demoStrategy,
    endNumber,
    ensurePageAsset,
    extension,
    folder,
    initializeDocumentSession,
    insertPagesAtIndex,
    patchPageAtIndex,
    promptForPressure,
    readSourceBlob,
    registerSourceDescriptor,
    scheduleSourceWarmup,
    setError,
    setLoadingRunActive,
    setPlannedPageCount,
    setWorkerCount,
    sourceList,
    reloadCacheSeed,
    storeSourceBlob,
  ]);

  return React.createElement(
    React.Fragment,
    null,
    children,
    React.createElement(LoadPressureDialog, {
      open: !!pressureSummary,
      summary: pressureSummary,
      onStop: () => resolvePressurePrompt(false),
      onContinue: () => resolvePressurePrompt(true),
    })
  );
};

export default DocumentLoader;
