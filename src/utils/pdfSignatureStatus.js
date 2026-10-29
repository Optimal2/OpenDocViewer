// File: src/utils/pdfSignatureStatus.js
/**
 * Signature UI status helpers for browser integrity.
 *
 * Pure mapping between the phase 1 data contract (utils/pdfSignatures.js) and
 * the presentation concerns of the signature badge/dialog: which integrity
 * status is the "worst" of a document's signatures and which badge severity
 * class it produces. See docs-src/pdf-signatures.md for the contract.
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
  return SEVERITY_BY_INTEGRITY[normalizeSignatureIntegrity(integrity)];
}

/**
 * Worst severity across integrity for all signatures.
 * @param {Array<*>} signatures
 * @returns {'ok'|'warning'|'error'}
 */
export function getReportSignatureSeverity(signatures) {
  const severities = signatures.map((signature) => getSignatureSeverity(signature?.integrity));
  return severities.includes('error') ? 'error' : severities.includes('warning') ? 'warning' : 'ok';
}

/**
 * Fail closed for missing, unexpected and inherited property names.
 * @param {*} integrity
 * @returns {string}
 */
export function normalizeSignatureIntegrity(integrity) {
  return typeof integrity === 'string' && Object.hasOwn(SEVERITY_BY_INTEGRITY, integrity)
    ? integrity : 'unreadable';
}

/**
 * Shared localized status text for the badge tooltip and details dialog.
 * @param {Function} t
 * @param {*} integrity
 * @returns {string}
 */
export function getIntegrityLabel(t, integrity) {
  const labels = {
    intact: ['intact', 'Intact'],
    'modified-after-signing': ['modifiedAfterSigning', 'Modified after signing'],
    'digest-mismatch': ['digestMismatch', 'Digest mismatch'],
    'signature-invalid': ['signatureInvalid', 'Signature invalid'],
    unsupported: ['unsupported', 'Signature present, format not supported'],
    unreadable: ['unreadable', 'Signature unreadable'],
  };
  const [key, defaultValue] = labels[normalizeSignatureIntegrity(integrity)];
  return t(`signatures.integrity.${key}`, { defaultValue });
}

/**
 * The worst integrity status among a document's signatures, or null when
 * there are none. Drives the badge colour/icon.
 * @param {(Array<*>|null|undefined)} signatures
 * @returns {(string|null)}
 */
export function getWorstSignatureIntegrity(signatures) {
  if (!Array.isArray(signatures) || signatures.length <= 0) return null;
  const present = new Set(Array.from(signatures, (entry) => normalizeSignatureIntegrity(entry?.integrity)));
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

/** @param {number} value @returns {string} */
function pad2(value) {
  return String(value).padStart(2, '0');
}

/**
 * Format a signature-related ISO time (signing, validation, certificate validity) as local time,
 * "2022-04-27 19:55", in both supported languages. `iso` is the same instant as an ISO UTC string
 * for a title attribute and `<time dateTime>`. Unparseable values are shown as given.
 * @param {*} value
 * @returns {({ text:string, iso:(string|null) }|null)} Null when there is no value.
 */
export function formatSignatureTime(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return { text: raw, iso: null };
  const date = new Date(ms);
  return {
    text: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`,
    iso: date.toISOString(),
  };
}
