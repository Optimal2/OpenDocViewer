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

/**
 * Plain-language English default per gateway `trustReason` code. The codes mirror ODVGateway's
 * SignatureValidationReasons (a stable contract meant to be switched on); the locale files carry
 * them under `signatures.trustReason.<code>`. A gateway code missing here fails
 * src/utils/__tests__/pdfSignatureTrustText.test.js.
 * @type {Object<string, string>}
 */
const TRUST_REASON_DEFAULTS = {
  'byte-range-malformed': "The signature's byte range is malformed",
  'byte-range-missing': 'The signature has no byte range',
  'contents-missing': 'The signature data is missing from the document',
  'contents-too-large': 'The signature data is too large to check on the server',
  'subfilter-unsupported': 'The signature format is not supported by the server',
  'cms-unreadable': 'The signature data could not be read',
  'digest-algorithm-unsupported': "The signature's hash algorithm is not supported",
  'message-digest-attribute-missing': 'The signature has no checksum of the signed content',
  'digest-mismatch': 'The content does not match the signature – the document was changed after signing',
  'signature-invalid': 'The cryptographic signature does not verify',
  'bytes-appended-after-signed-range': 'The document was extended after signing without a new signature',
  'signer-certificate-missing': "The signer's certificate is missing from the signature",
  'chain-not-anchored': 'The certificate chain does not lead to a trusted root',
  'certificate-not-valid-at-validation-time': 'The certificate was not valid at the validation time',
  revoked: 'The certificate has been revoked',
  'revocation-unavailable': 'The revocation list could not be retrieved',
  'revocation-not-checked': 'Revocation status is not checked on the server',
  'weak-signature': 'The signature uses an algorithm or key that is too weak',
  'chain-policy-violation': "The certificate chain does not meet the server's policy",
  'modified-after-certification': 'The document was changed in a way the certification does not allow',
  'timestamp-not-verifiable': 'The timestamp could not be verified',
  'timestamp-responder-not-anchored': 'The timestamp issuer does not lead to a trusted root',
  'timestamp-responder-not-trusted': 'The timestamp issuer is not trusted on the server',
  'key-usage-not-signing': 'The certificate is not intended for signing',
  'validation-error': 'An error occurred while the server checked the signature',
  'validation-timeout': 'The server check took too long',
};

/** Every trustReason code the gateway can emit. @type {ReadonlyArray<string>} */
export const TRUST_REASON_CODES = Object.freeze(Object.keys(TRUST_REASON_DEFAULTS));

/**
 * Localized plain-language reason for a gateway trustReason code, or null for an unknown code.
 * @param {Function} t
 * @param {*} code
 * @returns {(string|null)}
 */
export function getTrustReasonText(t, code) {
  if (typeof code !== 'string' || !Object.hasOwn(TRUST_REASON_DEFAULTS, code)) return null;
  return t(`signatures.trustReason.${code}`, { defaultValue: TRUST_REASON_DEFAULTS[code] });
}

/**
 * Which trust situation a signature is in:
 * - `unavailable`: no gateway answered for this document (viewer opened without ODVGateway);
 * - `not-checked`: the gateway has server validation disabled by configuration;
 * - `server-error`: the gateway request failed or returned unusable data;
 * - `valid` / `invalid` / `unknown`: the gateway verdict.
 * The two markers are client-only fields set by utils/pdfSignatureGateway.js.
 * @param {*} signature
 * @returns {'unavailable'|'not-checked'|'server-error'|'valid'|'invalid'|'unknown'}
 */
export function getSignatureTrustState(signature) {
  const trust = normalizeSignatureTrust(signature?.trust);
  if (trust !== 'not-checked') return /** @type {'valid'|'invalid'|'unknown'} */ (trust);
  if (signature?.serverValidationUnavailable === true) return 'server-error';
  if (signature?.serverValidationDisabled === true) return 'not-checked';
  return 'unavailable';
}

/**
 * @typedef {Object} TrustExplanation
 * @property {string} state One of getSignatureTrustState().
 * @property {string} title Main sentence: why the trust is what it is and what that means.
 * @property {(string|null)} reason Plain-language gateway reason (valid/invalid/unknown with a code).
 * @property {(string|null)} notMeaning What an unknown verdict does not mean.
 * @property {(string|null)} hint Administrator hint (validation disabled).
 * @property {(string|null)} code Raw gateway code, kept for support.
 * @property {(string|null)} codeLine Localized "Code: <code>" line.
 */

/**
 * State-specific trust text for the details dialog.
 * @param {Function} t
 * @param {*} signature
 * @returns {TrustExplanation}
 */
export function getTrustExplanation(t, signature) {
  const state = getSignatureTrustState(signature);
  /** @type {TrustExplanation} */
  const result = { state, title: '', reason: null, notMeaning: null, hint: null, code: null, codeLine: null };
  const code = typeof signature?.trustReason === 'string' ? signature.trustReason.trim() : '';
  const addReason = () => {
    if (!code) return;
    const translated = getTrustReasonText(t, code);
    // Reason text that is not a code (older gateways, tests) is shown as given, without a code line.
    if (!translated && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code)) {
      result.reason = code;
      return;
    }
    result.code = code;
    result.reason = translated || t('signatures.trustExplanation.unknownReason', { defaultValue: 'Unknown reason' });
    result.codeLine = t('signatures.trustExplanation.code', { code, defaultValue: `Code: ${code}` });
  };
  switch (state) {
    case 'unavailable':
      result.title = t('signatures.trustExplanation.unavailable', {
        defaultValue: 'The validity of the signature can only be checked when the document is opened through ODVGateway. '
          + 'Shown here: who signed and whether the document is unchanged since signing.',
      });
      break;
    case 'not-checked':
      result.title = t('signatures.trustExplanation.notChecked', {
        defaultValue: 'The server does not check the certificate chain and revocation status in this installation '
          + '(ODVGateway signatures.enabled is off). Shown: who signed and whether the document is unchanged.',
      });
      result.hint = t('signatures.trustExplanation.notCheckedHint', {
        defaultValue: 'An administrator can enable the check in the ODVGateway configuration.',
      });
      break;
    case 'server-error':
      result.title = t('signatures.trustExplanation.serverError', {
        defaultValue: 'The server could not check the signature this time (ODVGateway did not answer or sent an unusable answer). '
          + 'Shown: who signed and whether the document is unchanged.',
      });
      break;
    case 'valid':
      result.title = t('signatures.trustExplanation.valid', {
        defaultValue: 'The signature is valid: the server checked the certificate chain and revocation status.',
      });
      addReason();
      break;
    case 'invalid':
      result.title = t('signatures.trustExplanation.invalid', { defaultValue: 'The signature is not valid' });
      addReason();
      break;
    case 'unknown':
    default:
      result.title = t('signatures.trustExplanation.unknown', { defaultValue: 'Could not determine whether the signature is valid' });
      addReason();
      result.notMeaning = t('signatures.trustExplanation.unknownNotMeaning', {
        defaultValue: 'This does not mean that the signature is invalid or that the document was changed – '
          + 'see Integrity for whether the content is unchanged since signing.',
      });
      break;
  }
  return result;
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
