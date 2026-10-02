// File: src/utils/pdfSignatureStatus.js
/**
 * Level-1 signature UI status helpers.
 *
 * Pure mapping between the phase 1 data contract (utils/pdfSignatures.js) and
 * the presentation concerns of the signature badge/dialog: which integrity
 * status is the "worst" of a document's signatures (drives the badge colour
 * and icon) and which severity class a status belongs to. See
 * docs-src/pdf-signatures.md for the contract.
 *
 * @module utils/pdfSignatureStatus
 */

/**
 * Severity classes used for colours/icons: intact is neutral/positive,
 * modified-after-signing and unsupported are warnings, and digest-mismatch,
 * signature-invalid and unreadable are errors. Unknown values fail safe to
 * error so an unrecognised status is never presented as fine.
 * @type {Object<string, 'ok'|'warning'|'error'>}
 */
const SEVERITY_BY_INTEGRITY = {
  intact: 'ok',
  'modified-after-signing': 'warning',
  unsupported: 'warning',
  'digest-mismatch': 'error',
  'signature-invalid': 'error',
  unreadable: 'error',
};

/**
 * Integrity statuses ordered worst-first. Ties on severity are broken by this
 * order: not being able to read a signature at all is worse than a signature
 * that reads but does not verify, and content modified after signing is worse
 * than a format we simply cannot check.
 * @type {Array<string>}
 */
const INTEGRITY_WORST_FIRST = [
  'unreadable',
  'signature-invalid',
  'digest-mismatch',
  'modified-after-signing',
  'unsupported',
  'intact',
];

/**
 * Map one integrity status to its severity class.
 * @param {(string|null|undefined)} integrity
 * @returns {'ok'|'warning'|'error'}
 */
export function getSignatureSeverity(integrity) {
  return SEVERITY_BY_INTEGRITY[String(integrity || '')] || 'error';
}

/**
 * The worst integrity status among a document's signatures, or null when
 * there are none. Drives the badge colour/icon.
 * @param {(Array<*>|null|undefined)} signatures
 * @returns {(string|null)}
 */
export function getWorstSignatureIntegrity(signatures) {
  if (!Array.isArray(signatures) || signatures.length <= 0) return null;
  const present = new Set(signatures.map((entry) => String(entry?.integrity || '')));
  for (const status of INTEGRITY_WORST_FIRST) {
    if (present.has(status)) return status;
  }
  // Every signature carries a status outside the known set: fail safe.
  return 'unreadable';
}

/**
 * @param {*} report PdfSignatureReport-shaped object.
 * @returns {number}
 */
export function getSignatureCount(report) {
  return Array.isArray(report?.signatures) ? report.signatures.length : 0;
}

/**
 * @param {*} report PdfSignatureReport-shaped object.
 * @returns {boolean} True when the document has at least one signature.
 */
export function reportHasSignatures(report) {
  return getSignatureCount(report) > 0;
}
