// File: src/utils/pdfSignatureDocuments.js
/**
 * Per-document aggregation of PDF signature reports.
 *
 * Signature reports are produced and cached per file (`sourceKey`), while the
 * thumbnail strip groups pages into documents ("DOK n") and one document can
 * consist of several files. This module folds the per-file reports into
 * per-document entries for the document symbol, the details dialog file tabs
 * and the toolbar overview. Pure functions only; see docs-src/pdf-signatures.md.
 *
 * @module utils/pdfSignatureDocuments
 */

import {
  getReportSignatureSeverity,
  getWorstSignatureIntegrity,
  getWorstSignatureTrust,
  reportHasSignatures,
} from './pdfSignatureStatus.js';

/**
 * @typedef {Object} SignatureFileEntry
 * @property {string} sourceKey
 * @property {number} fileNumber 1-based position of the file inside its document.
 * @property {number} fileCount Number of files in the document.
 * @property {string} fileName Display file name, or '' when not available.
 * @property {(*|null)} report PdfSignatureReport, or null when the file has none yet.
 * @property {number} signatureCount
 * @property {('ok'|'warning'|'error'|null)} severity Null when the file has no signatures.
 */

/**
 * @typedef {Object} SignatureDocumentEntry
 * @property {string} key Stable document key (documentId, `doc:n`, or `file:<sourceKey>`).
 * @property {number} documentNumber 1-based document number shown as "DOK n".
 * @property {number} totalDocuments
 * @property {number} firstPageNumber Original 1-based session page number of the document's first page.
 * @property {Array<SignatureFileEntry>} files Every file of the document in page order.
 * @property {Array<SignatureFileEntry>} signedFiles Files that carry at least one signature.
 * @property {Array<*>} signatures All signatures of all files, file order then signature order.
 * @property {number} signatureCount
 * @property {('ok'|'warning'|'error')} severity Worst severity across all files.
 * @property {string} worstIntegrity
 * @property {string} worstTrust
 * @property {(*|null)} newestSignature Signature with the latest parseable signing time.
 */

/**
 * Document key of a page. Pages without document context form one document
 * per file, so a plain file list still gets one entry per signed file.
 * @param {*} page
 * @returns {string}
 */
export function getPageSignatureDocumentKey(page) {
  const documentId = String(page?.documentId || '').trim();
  if (documentId) return documentId;
  const documentNumber = Math.max(0, Number(page?.documentNumber) || 0);
  if (documentNumber > 0) return `doc:${documentNumber}`;
  const sourceKey = String(page?.sourceKey || '');
  return sourceKey ? `file:${sourceKey}` : '';
}

/**
 * Display file name from a source URL: the last path segment, only when it
 * looks like a file name (has an extension). Opaque API URLs, blob: and data:
 * URLs yield ''.
 * @param {*} sourceUrl
 * @returns {string}
 */
export function getSourceFileNameFromUrl(sourceUrl) {
  const text = String(sourceUrl || '').trim();
  if (!text) return '';
  let url;
  try {
    url = new URL(text, 'http://odv.invalid/');
  } catch {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  const segment = url.pathname.split('/').filter(Boolean).pop() || '';
  let decoded;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    decoded = segment;
  }
  return /^[^/\\]+\.[A-Za-z0-9]{1,8}$/.test(decoded) ? decoded : '';
}

/**
 * @param {Array<*>} signatures
 * @returns {(*|null)}
 */
function pickNewestSignature(signatures) {
  let newest = null;
  let newestTime = -Infinity;
  for (const signature of signatures) {
    const time = Date.parse(String(signature?.signingTime || ''));
    if (Number.isFinite(time) && time > newestTime) {
      newest = signature;
      newestTime = time;
    }
  }
  return newest || signatures[signatures.length - 1] || null;
}

/**
 * Fold per-file signature reports into per-document entries. Only documents
 * with at least one signature are returned, in page order.
 *
 * @param {(Array<*>|null|undefined)} pages Session pages (allPages).
 * @param {(Object<string, *>|null|undefined)} reports Map of sourceKey to PdfSignatureReport.
 * @param {{ getFileName:(function(string): string|undefined) }} [options]
 * @returns {Array<SignatureDocumentEntry>}
 */
export function buildSignatureDocuments(pages, reports, options = {}) {
  const list = Array.isArray(pages) ? pages : [];
  const reportMap = reports && typeof reports === 'object' ? reports : {};
  const getFileName = typeof options?.getFileName === 'function' ? options.getFileName : null;

  /** @type {Map<string, { key:string, documentNumber:number, totalDocuments:number, firstPageNumber:number, sourceKeys:Array<string> }>} */
  const groups = new Map();
  list.forEach((page, index) => {
    const key = getPageSignatureDocumentKey(page);
    const sourceKey = String(page?.sourceKey || '');
    if (!key || !sourceKey) return;
    let group = groups.get(key);
    if (!group) {
      const rawIndex = Number(page?.allPagesIndex);
      group = {
        key,
        documentNumber: Math.max(0, Number(page?.documentNumber) || 0) || (groups.size + 1),
        totalDocuments: Math.max(0, Number(page?.totalDocuments) || 0),
        firstPageNumber: (Number.isFinite(rawIndex) && rawIndex >= 0 ? Math.floor(rawIndex) : index) + 1,
        sourceKeys: [],
      };
      groups.set(key, group);
    }
    if (!group.sourceKeys.includes(sourceKey)) group.sourceKeys.push(sourceKey);
  });

  const documents = [];
  for (const group of groups.values()) {
    const fileCount = group.sourceKeys.length;
    const files = group.sourceKeys.map((sourceKey, fileIndex) => {
      const report = reportMap[sourceKey] || null;
      const signed = reportHasSignatures(report);
      return {
        sourceKey,
        fileNumber: fileIndex + 1,
        fileCount,
        fileName: String((getFileName && getFileName(sourceKey)) || ''),
        report,
        signatureCount: signed ? report.signatures.length : 0,
        severity: signed ? getReportSignatureSeverity(report.signatures) : null,
      };
    });
    const signedFiles = files.filter((file) => file.signatureCount > 0);
    if (signedFiles.length <= 0) continue;
    const signatures = signedFiles.flatMap((file) => file.report.signatures);
    documents.push({
      key: group.key,
      documentNumber: group.documentNumber,
      totalDocuments: group.totalDocuments || groups.size,
      firstPageNumber: group.firstPageNumber,
      files,
      signedFiles,
      signatures,
      signatureCount: signatures.length,
      severity: getReportSignatureSeverity(signatures),
      worstIntegrity: getWorstSignatureIntegrity(signatures),
      worstTrust: getWorstSignatureTrust(signatures),
      newestSignature: pickNewestSignature(signatures),
    });
  }
  return documents;
}

/**
 * Totals for the toolbar overview button, or null when nothing is signed (the
 * button is then not rendered).
 * @param {(Array<SignatureDocumentEntry>|null|undefined)} documents
 * @returns {({ documentCount:number, signatureCount:number, severity:('ok'|'warning'|'error') }|null)}
 */
export function summarizeSignatureDocuments(documents) {
  const list = Array.isArray(documents) ? documents : [];
  if (list.length <= 0) return null;
  return {
    documentCount: list.length,
    signatureCount: list.reduce((sum, doc) => sum + doc.signatureCount, 0),
    severity: getReportSignatureSeverity(list.flatMap((doc) => doc.signatures)),
  };
}

/**
 * @param {(Array<SignatureDocumentEntry>|null|undefined)} documents
 * @param {string} sourceKey
 * @returns {(SignatureDocumentEntry|null)}
 */
export function findSignatureDocumentBySourceKey(documents, sourceKey) {
  const key = String(sourceKey || '');
  if (!key || !Array.isArray(documents)) return null;
  return documents.find((doc) => doc.files.some((file) => file.sourceKey === key)) || null;
}

/**
 * Heading for one file of a multi-file document: "File k of m – name", or
 * "File k of m" when no file name is available.
 * @param {Function} t
 * @param {{ fileNumber:number, fileCount:number, fileName:string }} file
 * @returns {string}
 */
export function getSignatureFileHeading(t, file) {
  const position = t('signatures.dialog.filePosition', {
    file: file.fileNumber,
    total: file.fileCount,
    defaultValue: `File ${file.fileNumber} of ${file.fileCount}`,
  });
  return file.fileName ? `${position} – ${file.fileName}` : position;
}
