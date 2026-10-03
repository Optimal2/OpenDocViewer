// File: src/utils/pdfSignatureStatus.js
/**
 * Signature UI status helpers for browser integrity and gateway trust.
 *
 * Pure mapping between the phase 1 data contract (utils/pdfSignatures.js) and
 * the presentation concerns of the signature badge/dialog: which integrity
 * status is the "worst" of a document's signatures, and how integrity and
 * trust combine into the badge severity class. See
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
 * @param {string} [trust] Optional gateway trust verdict.
 * @returns {'ok'|'warning'|'error'}
 */
export function getSignatureSeverity(integrity, trust = 'not-checked') {
  const severity = SEVERITY_BY_INTEGRITY[normalizeSignatureIntegrity(integrity)];
  if (severity === 'error' || trust === 'invalid') return 'error';
  if (severity === 'warning' || trust === 'unknown') return 'warning';
  return severity;
}

/**
 * Worst severity across integrity and trust for all signatures.
 * @param {Array<*>} signatures
 * @returns {'ok'|'warning'|'error'}
 */
export function getReportSignatureSeverity(signatures) {
  const severities = signatures.map((signature) => getSignatureSeverity(signature?.integrity, signature?.trust));
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

/**
 * Trust verdicts ordered worst-first. A signature nobody checked is worse
 * than one the gateway validated; missing or unexpected values count as
 * not-checked.
 * @type {Array<string>}
 */
const TRUST_WORST_FIRST = ['invalid', 'unknown', 'not-checked', 'valid'];

/**
 * @param {*} trust
 * @returns {string}
 */
export function normalizeSignatureTrust(trust) {
  return typeof trust === 'string' && TRUST_WORST_FIRST.includes(trust) ? trust : 'not-checked';
}

/**
 * The worst trust verdict among signatures, or null when there are none.
 * @param {(Array<*>|null|undefined)} signatures
 * @returns {(string|null)}
 */
export function getWorstSignatureTrust(signatures) {
  if (!Array.isArray(signatures) || signatures.length <= 0) return null;
  const present = new Set(signatures.map((entry) => normalizeSignatureTrust(entry?.trust)));
  return TRUST_WORST_FIRST.find((status) => present.has(status)) || 'not-checked';
}

/**
 * Shared localized trust text for the details dialog and the overview. All
 * four contract values have labels, so level 2 only fills the field.
 * @param {Function} t
 * @param {*} trust
 * @returns {string}
 */
export function getTrustLabel(t, trust) {
  switch (normalizeSignatureTrust(trust)) {
    case 'valid':
      return t('signatures.trust.valid', { defaultValue: 'Valid' });
    case 'invalid':
      return t('signatures.trust.invalid', { defaultValue: 'Invalid' });
    case 'unknown':
      return t('signatures.trust.unknown', { defaultValue: 'Unknown' });
    case 'not-checked':
    default:
      return t('signatures.trust.notChecked', { defaultValue: 'Not checked' });
  }
}
