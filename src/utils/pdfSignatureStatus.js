// File: src/utils/pdfSignatureStatus.js
/**
 * Signature UI status helpers for browser integrity.
 *
 * Pure mapping between the data contract (utils/pdfSignatures.js) and the
 * presentation concerns of the signature badge/dialogs: which integrity status
 * is the "worst" of a document's signatures, which severity class (colour and
 * icon) it produces, and the localized texts for statuses and codes. The viewer
 * warns only on a real problem; what it cannot check is information. See
 * docs-src/pdf-signatures.md ("Status model") for the full mapping table.
 *
 * Severity is presentation: it is computed here from the signature object plus
 * the site option `{ uncheckedSeverity }` and never stored in the (shared,
 * per-sourceKey) report cache.
 *
 * @module utils/pdfSignatureStatus
 */

/**
 * Severity class per integrity status. `not-checked-in-viewer` resolves through
 * the `uncheckedSeverity` option ('ok' by default). Unknown values never reach
 * this table: normalizeSignatureIntegrity turns them into `unreadable` first.
 * @type {Object<string, 'ok'|'warning'|'error'|'unchecked'>}
 */
const SEVERITY_BY_INTEGRITY = {
  intact: 'ok',
  'not-checked-in-viewer': 'unchecked',
  indeterminate: 'warning',
  'modified-after-signing': 'warning',
  'digest-mismatch': 'error',
  'signature-invalid': 'error',
  unreadable: 'error',
};

/**
 * Legacy values accepted from older caches. `unsupported` was the former
 * "format not supported" status; it means the same as not checked in the viewer.
 * @type {Object<string, string>}
 */
const INTEGRITY_ALIASES = {
  unsupported: 'not-checked-in-viewer',
};

/**
 * Integrity statuses ordered worst-first. `not-checked-in-viewer` ranks above
 * `intact`, so a document label says "Not checked in the viewer" whenever any
 * signature is unchecked, even while the colour is green.
 * @type {Array<string>}
 */
const INTEGRITY_WORST_FIRST = [
  'unreadable',
  'signature-invalid',
  'digest-mismatch',
  'modified-after-signing',
  'indeterminate',
  'not-checked-in-viewer',
  'intact',
];

/**
 * Closed set of `integrityCode` values produced by utils/pdfSignatures.js and
 * utils/pdfSignatureInspector.js. Each has a localized text under
 * `signatures.integrityCode.<code>`.
 * @type {ReadonlyArray<string>}
 */
export const INTEGRITY_CODES = Object.freeze([
  'format-unsupported',
  'algorithm-unsupported',
  'inspection-limit',
  'timeout',
  'structure-unsupported',
  'encrypted',
  'viewer-error',
  'unexpected-error',
  'key-import-failed',
  'content-changed-after-signing',
  'unclassified-change-after-signing',
  'extended-with-validation-data',
  'extended-by-later-signature',
  'contents-missing',
  'byte-range-invalid',
  'cms-malformed',
  'cms-content-mismatch',
  'message-digest-attribute',
  'signer-certificate-missing',
  'content-digest-mismatch',
  'document-digest-mismatch',
  'signature-invalid',
]);

/**
 * Severity per signing-time check. Missing values (signatures from the parser
 * before it checks signing time) are `not-checked`, which is never a warning.
 * @type {Object<string, 'ok'|'warning'>}
 */
const SEVERITY_BY_SIGNING_TIME_CHECK = {
  'within-validity': 'ok',
  'outside-validity': 'warning',
  'timestamp-invalid': 'warning',
  'not-checked': 'ok',
};

/** Closed set of `signingTimeCode` values; texts under `signatures.signingTimeCode.<code>`. */
export const SIGNING_TIME_CODES = Object.freeze([
  'signed-before-certificate-valid',
  'signed-after-certificate-expired',
  'timestamp-invalid',
  'signing-time-unknown',
  'certificate-dates-unreadable',
  'no-certificate',
]);

const SEVERITY_RANK = { ok: 0, warning: 1, error: 2 };

/**
 * Fail closed for missing, unexpected and inherited property names: anything
 * outside the known set (after resolving legacy aliases) is `unreadable`.
 * @param {*} integrity
 * @returns {string}
 */
export function normalizeSignatureIntegrity(integrity) {
  if (typeof integrity !== 'string') return 'unreadable';
  if (Object.hasOwn(SEVERITY_BY_INTEGRITY, integrity)) return integrity;
  if (Object.hasOwn(INTEGRITY_ALIASES, integrity)) return INTEGRITY_ALIASES[integrity];
  return 'unreadable';
}

/**
 * The site switch `pdfSignatures.uncheckedSeverity`: exactly 'warning' shows
 * not-checked signatures as warnings; anything else keeps them 'ok'.
 * @param {*} value
 * @returns {'ok'|'warning'}
 */
export function normalizeUncheckedSeverity(value) {
  return value === 'warning' ? 'warning' : 'ok';
}

/**
 * Missing values mean the check was not performed; an unknown string fails
 * closed to `outside-validity` (a warning).
 * @param {*} check
 * @returns {string}
 */
export function normalizeSigningTimeCheck(check) {
  if (check === null || check === undefined) return 'not-checked';
  return typeof check === 'string' && Object.hasOwn(SEVERITY_BY_SIGNING_TIME_CHECK, check)
    ? check : 'outside-validity';
}

/**
 * Severity of one signature: the worse of its integrity and its signing-time
 * check. `uncheckedSeverity` is consulted only after normalization and only for
 * exactly `not-checked-in-viewer`, so it can raise that status to a warning but
 * can never lower an error or a warning, and unknown values stay errors.
 * @param {*} signature PdfSignatureInfo-shaped object.
 * @param {{ uncheckedSeverity:(string|undefined) }} [options]
 * @returns {'ok'|'warning'|'error'}
 */
export function getSignatureSeverity(signature, { uncheckedSeverity } = {}) {
  let severity = SEVERITY_BY_INTEGRITY[normalizeSignatureIntegrity(signature?.integrity)];
  if (severity === 'unchecked') severity = normalizeUncheckedSeverity(uncheckedSeverity);
  const time = SEVERITY_BY_SIGNING_TIME_CHECK[normalizeSigningTimeCheck(signature?.signingTimeCheck)];
  return SEVERITY_RANK[time] > SEVERITY_RANK[severity] ? time : severity;
}

/**
 * Worst severity across all signatures.
 * @param {Array<*>} signatures
 * @param {{ uncheckedSeverity:(string|undefined) }} [options] Passed through to getSignatureSeverity.
 * @returns {'ok'|'warning'|'error'}
 */
export function getReportSignatureSeverity(signatures, options = {}) {
  const severities = signatures.map((signature) => getSignatureSeverity(signature, options));
  return severities.includes('error') ? 'error' : severities.includes('warning') ? 'warning' : 'ok';
}

/**
 * Shared localized status text for the badge tooltip and the dialogs.
 * @param {Function} t
 * @param {*} integrity
 * @returns {string}
 */
export function getIntegrityLabel(t, integrity) {
  const labels = {
    intact: ['intact', 'Intact'],
    'not-checked-in-viewer': ['notCheckedInViewer', 'Not checked in the viewer'],
    indeterminate: ['indeterminate', 'Could not be determined'],
    'modified-after-signing': ['modifiedAfterSigning', 'Modified after signing'],
    'digest-mismatch': ['digestMismatch', 'Digest mismatch'],
    'signature-invalid': ['signatureInvalid', 'Signature invalid'],
    unreadable: ['unreadable', 'Signature data is damaged'],
  };
  const [key, defaultValue] = labels[normalizeSignatureIntegrity(integrity)];
  return t(`signatures.integrity.${key}`, { defaultValue });
}

/**
 * Localized plain-language line for an integrity code, or null for a missing or
 * unknown code (closed set, nothing outside it is ever rendered).
 * @param {Function} t
 * @param {*} code
 * @returns {(string|null)}
 */
export function getIntegrityCodeText(t, code) {
  if (typeof code !== 'string' || !INTEGRITY_CODES.includes(code)) return null;
  return t(`signatures.integrityCode.${code}`, { defaultValue: code });
}

/**
 * Localized signing-time check text, or null when the signature carries no
 * signing-time check (the parser has not checked it). The code refines the text
 * when it belongs to the closed set.
 * @param {Function} t
 * @param {*} check
 * @param {*} [code]
 * @returns {(string|null)}
 */
export function getSigningTimeCheckLabel(t, check, code) {
  if (check === null || check === undefined) return null;
  if (typeof code === 'string' && SIGNING_TIME_CODES.includes(code)) {
    return t(`signatures.signingTimeCode.${code}`, { defaultValue: code });
  }
  const labels = {
    'within-validity': ['withinValidity', 'Signed while the certificate was valid'],
    'outside-validity': ['outsideValidity', 'Signed outside the certificate validity period'],
    'timestamp-invalid': ['timestampInvalid', 'The signature timestamp could not be confirmed'],
    'not-checked': ['notChecked', 'Signing time against the certificate validity was not checked'],
  };
  const [key, defaultValue] = labels[normalizeSigningTimeCheck(check)];
  return t(`signatures.signingTimeCheck.${key}`, { defaultValue });
}

/**
 * The most severe signing-time check among signatures that carry one, or null
 * when none of them is a warning. Drives the extra badge tooltip line.
 * @param {(Array<*>|null|undefined)} signatures
 * @returns {(*|null)} The first signature whose signing-time check is a warning.
 */
export function getSigningTimeWarningSignature(signatures) {
  if (!Array.isArray(signatures)) return null;
  return signatures.find((signature) =>
    SEVERITY_BY_SIGNING_TIME_CHECK[normalizeSigningTimeCheck(signature?.signingTimeCheck)] === 'warning') || null;
}

/**
 * The worst integrity status among a document's signatures, or null when
 * there are none. Drives the badge and overview label.
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
