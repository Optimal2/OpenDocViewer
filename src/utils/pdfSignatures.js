/**
 * PDF signature collection - level 1 integrity inspection.
 *
 * Reads digital signature information from PDF bytes and returns a stable
 * data contract (see docs-src/pdf-signatures.md). Level 1 answers exactly one
 * question per signature: is the content that the signature covered
 * byte-for-byte intact? Certificate chain building, issuer validity and revocation
 * are not checked in the viewer.
 *
 * The module is environment-agnostic: it runs on the main thread, inside a
 * web worker and in Node (tests). Heavy dependencies (pdf-lib, pkijs,
 * asn1js) are loaded through dynamic imports. Unsigned PDFs skip the CMS
 * stack; inspection failures produce a document-level or per-signature
 * placeholder (`not-checked-in-viewer` for viewer limits, `indeterminate` for
 * unclassifiable failures) instead of claiming that signatures are absent.
 *
 * @module utils/pdfSignatures
 */

import { classifyAppendedRevisions, createRevisionLog, installRevisionLogHooks } from './pdfSignatureRevisions.js';
import { createRenderComparator, renderCheckVerdict } from './pdfSignatureRenderCheck.js';

/**
 * One inspected PDF signature (level-1 integrity view).
 *
 * @typedef {Object} PdfSignatureInfo
 * @property {string|null} fieldName AcroForm signature field name (/T).
 * @property {string|null} signer Signer certificate subject CN; falls back to
 * the signature dictionary /Name when no certificate could be read.
 * @property {'certificate'|'pdf-name'|null} signerSource Where `signer` came
 * from: the certificate subject CN, the self-declared signature dictionary
 * /Name (never verified), or nowhere (null).
 * @property {string|null} signerOrganization Signer certificate subject O.
 * @property {string|null} issuer Signer certificate issuer CN (else full issuer DN).
 * @property {string|null} serial Certificate serial number, colon-separated hex.
 * @property {string|null} notBefore Certificate validity start, ISO 8601.
 * @property {string|null} notAfter Certificate validity end, ISO 8601.
 * @property {string|null} signingTime Signing time, ISO 8601 (see signingTimeSource).
 * @property {'timestamp'|'signed-attribute'|'pdf-M'|'none'} signingTimeSource Where
 * `signingTime` came from: a verified RFC 3161 genTime, the CMS signingTime
 * signed attribute, the PDF signature dictionary /M date, or nowhere.
 * @property {'within-validity'|'outside-validity'|'timestamp-invalid'|'not-checked'} signingTimeCheck
 * Result of comparing the selected signing time with the signer certificate window.
 * @property {'signed-before-certificate-valid'|'signed-after-certificate-expired'|'timestamp-invalid'|'signing-time-unknown'|'certificate-dates-unreadable'|'no-certificate'|null} signingTimeCode
 * Machine-readable detail for signingTimeCheck.
 * @property {'verified'|'invalid'|'not-checked'|null} signatureTimestampCheck
 * Embedded signature-timestamp result; null means no token was present.
 * @property {string|null} reason Signature dictionary /Reason text.
 * @property {string|null} location Signature dictionary /Location text.
 * @property {string|null} subFilter Raw /SubFilter value (without slash).
 * @property {'approval'|'certification'|'timestamp'} kind Certification
 * signature (signature dictionary carries /Reference), document timestamp
 * (ETSI.RFC3161), otherwise approval.
 * @property {PdfSignatureIntegrity} integrity Level-1 integrity verdict; the
 * rules are documented in docs-src/pdf-signatures.md.
 * @property {PdfSignatureIntegrityCode|null} integrityCode Machine-readable
 * reason from a closed kebab-case set; null only for a plain `intact`.
 * @property {string|null} integrityReason Short English detail line (may carry
 * OIDs or exception text for support staff); null when no detail is needed.
 * @property {boolean|null} coversWholeFile Whether the ByteRange reaches the
 * end of the file (false = the file was extended after this signature;
 * null = the ByteRange could not be read).
 */

/**
 * Produced integrity values. `unsupported` is a legacy alias that the status
 * helpers normalize to `not-checked-in-viewer`; the parser never produces it.
 * @typedef {'intact'|'not-checked-in-viewer'|'indeterminate'|'modified-after-signing'|'digest-mismatch'|'signature-invalid'|'unreadable'} PdfSignatureIntegrity
 */

/**
 * Closed set of integrity codes (see INTEGRITY_CODES in utils/pdfSignatureStatus.js).
 * @typedef {'format-unsupported'|'algorithm-unsupported'|'inspection-limit'|'timeout'|'structure-unsupported'|'encrypted'|'viewer-error'|'unexpected-error'|'key-import-failed'|'content-changed-after-signing'|'unclassified-change-after-signing'|'extended-with-validation-data'|'extended-by-later-signature'|'contents-missing'|'byte-range-invalid'|'cms-malformed'|'cms-content-mismatch'|'message-digest-attribute'|'signer-certificate-missing'|'content-digest-mismatch'|'document-digest-mismatch'|'signature-invalid'} PdfSignatureIntegrityCode
 */

/**
 * @typedef {Object} PdfSignatureReport
 * @property {PdfSignatureInfo[]} signatures Signatures ordered by signing
 * chronology (ByteRange end position). Empty array when the document has no
 * signature fields.
 */

/** SubFilters with level-1 handling. Anything else is reported, never hidden. */
export const SUPPORTED_SUBFILTERS = Object.freeze([
  'adbe.pkcs7.detached',
  'ETSI.CAdES.detached',
  'adbe.pkcs7.sha1',
  'ETSI.RFC3161'
]);

const SUPPORTED_SUBFILTER_SET = new Set(SUPPORTED_SUBFILTERS);

const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';
const OID_TST_INFO = '1.2.840.113549.1.9.16.1.4';
const OID_ATTR_MESSAGE_DIGEST = '1.2.840.113549.1.9.4';
const OID_ATTR_SIGNING_TIME = '1.2.840.113549.1.9.5';
const OID_SIGNATURE_TIMESTAMP = '1.2.840.113549.1.9.16.2.14';

const HASH_OID_TO_NAME = new Map([
  ['1.3.14.3.2.26', 'SHA-1'],
  ['2.16.840.1.101.3.4.2.1', 'SHA-256'],
  ['2.16.840.1.101.3.4.2.2', 'SHA-384'],
  ['2.16.840.1.101.3.4.2.3', 'SHA-512'],
  ['2.16.840.1.101.3.4.2.4', 'SHA-224']
]);

const RSA_PKCS1_OIDS = new Set([
  '1.2.840.113549.1.1.1', // rsaEncryption: generic; digestAlgorithm selects the hash
  '1.2.840.113549.1.1.5', // sha1WithRSAEncryption
  '1.2.840.113549.1.1.11', // sha256WithRSAEncryption
  '1.2.840.113549.1.1.12', // sha384WithRSAEncryption
  '1.2.840.113549.1.1.13', // sha512WithRSAEncryption
  '1.2.840.113549.1.1.14' // sha224WithRSAEncryption
]);
const RSA_PKCS1_HASH_BY_OID = new Map([
  ['1.2.840.113549.1.1.5', 'SHA-1'],
  ['1.2.840.113549.1.1.11', 'SHA-256'],
  ['1.2.840.113549.1.1.12', 'SHA-384'],
  ['1.2.840.113549.1.1.13', 'SHA-512'],
  ['1.2.840.113549.1.1.14', 'SHA-224']
]);
const OID_RSA_PSS = '1.2.840.113549.1.1.10';
const OID_EC_PUBLIC_KEY = '1.2.840.10045.2.1';
const ECDSA_HASH_BY_OID = new Map([
  ['1.2.840.10045.4.1', 'SHA-1'],
  ['1.2.840.10045.4.3.1', 'SHA-224'],
  ['1.2.840.10045.4.3.2', 'SHA-256'],
  ['1.2.840.10045.4.3.3', 'SHA-384'],
  ['1.2.840.10045.4.3.4', 'SHA-512']
]);
const CURVE_OID_TO_POINT_SIZE = new Map([
  ['1.2.840.10045.3.1.7', 32], // P-256
  ['1.3.132.0.34', 48], // P-384
  ['1.3.132.0.35', 66] // P-521
]);
/** Hash names WebCrypto implements. SHA-224 is a known OID but not one of them. */
const WEBCRYPTO_HASHES = new Set(['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']);
/** Structural stream filters pdf-lib's decodePDFRawStream can decode. */
const DECODABLE_STREAM_FILTERS = new Set(['FlateDecode', 'LZWDecode', 'ASCII85Decode', 'ASCIIHexDecode', 'RunLengthDecode']);

/**
 * A check the viewer could not perform because of its own limits (budget,
 * missing algorithm, failing machinery), with no evidence of a defect. Carries
 * a `not-checked-in-viewer` integrity code. Decided by `instanceof` and the
 * code, never by parsing messages (class names are minified in production).
 */
class ViewerLimitError extends Error {
  /** @param {PdfSignatureIntegrityCode} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const RDN_CN = '2.5.4.3';
const RDN_O = '2.5.4.10';

/** @type {Promise<any>|null} */
let pkijsPromise = null;
/** @type {Promise<any>|null} */
let asn1jsPromise = null;

function loadPkijs() {
  if (!pkijsPromise) pkijsPromise = import('pkijs');
  return pkijsPromise;
}

function loadAsn1js() {
  if (!asn1jsPromise) asn1jsPromise = import('asn1js');
  return asn1jsPromise;
}

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

function toUint8(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (input && ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError('pdfBytes must be an ArrayBuffer or Uint8Array');
}

function bytesToHex(a) {
  let out = '';
  for (let i = 0; i < a.length; i += 1) out += a[i].toString(16).padStart(2, '0');
  return out;
}

function colonHex(a) {
  const hex = bytesToHex(a).toUpperCase();
  const parts = [];
  for (let i = 0; i < hex.length; i += 2) parts.push(hex.slice(i, i + 2));
  return parts.join(':');
}

function normalizeSerialHex(a) {
  return bytesToHex(a).replace(/^0+(?=.)/, '');
}

function requireSubtle() {
  if (typeof crypto === 'undefined' || !crypto?.subtle) {
    throw new ViewerLimitError('viewer-error', 'WebCrypto (crypto.subtle) is not available in this environment');
  }
  return crypto.subtle;
}

async function subtleDigest(algName, data) {
  const subtle = requireSubtle();
  if (!WEBCRYPTO_HASHES.has(algName)) {
    throw new ViewerLimitError('algorithm-unsupported', `hash algorithm not available in WebCrypto: ${algName}`);
  }
  try {
    return new Uint8Array(await subtle.digest(algName, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
  } catch (err) {
    if (err?.name === 'NotSupportedError') {
      throw new ViewerLimitError('algorithm-unsupported', `hash algorithm not available in WebCrypto: ${algName}`);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// PDF text/date helpers
// ---------------------------------------------------------------------------

function decodeTextBytes(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return out;
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

/**
 * Decode a PDF text string object (literal string or hex string) to a JS
 * string, honouring the UTF-16BE byte-order mark.
 * @param {any} obj pdf-lib object (PDFString/PDFHexString/PDFName) or null.
 * @returns {string|null}
 */
function pdfText(obj) {
  // PDFString, PDFHexString and PDFName expose this API in production too.
  // Constructor names are minified and must never control discovery/decoding.
  return typeof obj?.decodeText === 'function' ? obj.decodeText() : null;
}

/**
 * Parse a PDF date string ("D:YYYYMMDDHHmmSS+02'30'", also without the D:
 * prefix, with partial fields, or without a timezone - a missing timezone is
 * treated as UTC).
 * @param {string|null|undefined} raw
 * @returns {Date|null}
 */
export function parsePdfDateString(raw) {
  if (!raw) return null;
  const full = String(raw).trim();
  let s = full.startsWith('D:') ? full.slice(2) : full;
  const m = /^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(s);
  if (!m || !m[1]) return null;
  const year = Number(m[1]);
  const month = m[2] ? Number(m[2]) - 1 : 0;
  const day = m[3] ? Number(m[3]) : 1;
  const hour = m[4] ? Math.min(Number(m[4]), 23) : 0;
  const minute = m[5] ? Math.min(Number(m[5]), 59) : 0;
  const second = m[6] ? Math.min(Number(m[6]), 59) : 0;
  const ts = Date.UTC(year, month, day, hour, minute, second);
  if (Number.isNaN(ts)) return null;
  const rest = s.slice(m[0].length);
  const tz = /([+-])(\d{2})'?(\d{2})?'?/.exec(rest);
  if (!tz) return new Date(ts);
  const offsetMinutes = Number(tz[2]) * 60 + Number(tz[3] || 0);
  return new Date(ts - (tz[1] === '+' ? offsetMinutes : -offsetMinutes) * 60000);
}

function isoOrNull(date) {
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

// ---------------------------------------------------------------------------
// Signature discovery with pdf-lib (raw object access)
// ---------------------------------------------------------------------------

function isDict(obj, pdfLib) {
  return obj instanceof pdfLib.PDFDict;
}

function dictHas(obj, pdfLib, key) {
  return obj?.get?.(pdfLib.PDFName.of(key)) !== undefined;
}

function signatureDictFields(sigDict, pdfLib) {
  const subFilterName = pdfText(sigDict.lookup(pdfLib.PDFName.of('SubFilter')));
  return {
    subFilter: subFilterName,
    signerName: pdfText(sigDict.lookup(pdfLib.PDFName.of('Name'))),
    mDate: pdfText(sigDict.lookup(pdfLib.PDFName.of('M'))),
    reason: pdfText(sigDict.lookup(pdfLib.PDFName.of('Reason'))),
    location: pdfText(sigDict.lookup(pdfLib.PDFName.of('Location'))),
    hasReference: dictHas(sigDict, pdfLib, 'Reference'),
    byteRangeRaw: sigDict.lookup(pdfLib.PDFName.of('ByteRange')),
    contentsRaw: sigDict.get(pdfLib.PDFName.of('Contents'))
  };
}

function readByteRange(brArray) {
  if (!brArray || typeof brArray.size !== 'function' || brArray.size() !== 4) return null;
  const values = [];
  for (let i = 0; i < 4; i += 1) {
    const num = brArray.lookup(i);
    const value = typeof num?.asNumber === 'function' ? num.asNumber() : Number(num?.value);
    if (!Number.isSafeInteger(value) || value < 0) return null;
    values.push(value);
  }
  return values;
}

function contentsToBytes(contents, pdfLib) {
  if (contents instanceof pdfLib.PDFHexString || contents instanceof pdfLib.PDFString) return contents.asBytes();
  return null;
}

/**
 * Walk every indirect object; collect signature dictionaries together with
 * the field dictionary that references them (for /T). Inline /V dictionaries
 * are handled too.
 */
function discoverSignatures(pdfDoc, pdfLib) {
  const { PDFName } = pdfLib;
  const indirect = [];
  const queue = [...pdfDoc.context.enumerateIndirectObjects().map(([, obj]) => obj), ...pdfDoc.parsedDicts];
  const visited = new Set();
  for (let i = 0; i < queue.length; i++) {
    const obj = queue[i];
    if (!obj || visited.has(obj)) continue;
    visited.add(obj);
    if (visited.size > 100000) throw new ViewerLimitError('inspection-limit', 'PDF object inspection limit exceeded');
    if (obj instanceof pdfLib.PDFDict) {
      indirect.push({ obj });
      for (const [, value] of obj.entries()) queue.push(value);
    } else if (obj instanceof pdfLib.PDFArray) {
      queue.push(...obj.asArray());
    }
  }

  /** @type {Map<string, {sigDict: any, fieldDict: any|null}>} */
  const found = new Map();

  // Fields (/FT /Sig) referencing their /V (or /DV) signature dictionary.
  for (const { obj } of indirect) {
    if (!isDict(obj, pdfLib)) continue;
    const ft = pdfText(obj.lookup(PDFName.of('FT')));
    if (ft !== 'Sig') continue;
    const v = obj.lookup(PDFName.of('V')) ?? obj.lookup(PDFName.of('DV'));
    if (isDict(v, pdfLib) && (dictHas(v, pdfLib, 'ByteRange') || pdfText(v.lookup(PDFName.of('Type'))) === 'Sig' || dictHas(v, pdfLib, 'SubFilter'))) {
      found.set(objectKey(v), { sigDict: v, fieldDict: obj });
    }
  }
  // Bare signature dictionaries (not referenced by any field).
  for (const { obj } of indirect) {
    if (!isDict(obj, pdfLib)) continue;
    const type = pdfText(obj.lookup(PDFName.of('Type')));
    if (type === 'Sig' || type === 'DocTimeStamp' ||
      ((dictHas(obj, pdfLib, 'ByteRange') || dictHas(obj, pdfLib, 'SubFilter')) && dictHas(obj, pdfLib, 'Contents'))) {
      const k = objectKey(obj);
      if (!found.has(k)) found.set(k, { sigDict: obj, fieldDict: null });
    }
  }

  const items = [];
  for (const { sigDict, fieldDict } of found.values()) {
    items.push({ sigDict, fieldDict, fieldName: qualifiedFieldName(fieldDict, pdfLib) });
  }
  return items;
}

const objectKeys = new WeakMap();
let objectKeyCounter = 0;
function objectKey(obj) {
  if (obj?.contextRef?.toString) return `ref:${obj.contextRef.toString()}`;
  let k = objectKeys.get(obj);
  if (k === undefined) {
    objectKeyCounter += 1;
    k = `o${objectKeyCounter}`;
    objectKeys.set(obj, k);
  }
  return k;
}

function qualifiedFieldName(fieldDict, pdfLib) {
  if (!fieldDict) return null;
  const { PDFName } = pdfLib;
  const parts = [];
  let current = fieldDict;
  let guard = 0;
  while (isDict(current, pdfLib) && guard < 12) {
    const t = pdfText(current.lookup(PDFName.of('T')));
    if (t) parts.unshift(t);
    const parentRef = current.get(PDFName.of('Parent'));
    if (!parentRef) break;
    current = current.context?.lookup?.(parentRef) ?? undefined;
    guard += 1;
  }
  return parts.length ? parts.join('.') : null;
}

// ---------------------------------------------------------------------------
// Base (PDF dictionary level) info for one signature
// ---------------------------------------------------------------------------

function dictionaryInfo(item, bytes, pdfLib, sourceSpans) {
  const fields = signatureDictFields(item.sigDict, pdfLib);
  const byteRange = readByteRange(fields.byteRangeRaw);
  const contents = contentsToBytes(fields.contentsRaw, pdfLib);

  const rangeValid = validByteRange(bytes, byteRange, fields.contentsRaw, sourceSpans);
  const coversWholeFile = rangeValid
    ? byteRange[0] === 0 && byteRange[2] + byteRange[3] === bytes.length && byteRange[3] >= 0
    : null;

  const mDate = parsePdfDateString(fields.mDate);
  const kind = fields.subFilter === 'ETSI.RFC3161'
    ? 'timestamp'
    : fields.hasReference ? 'certification' : 'approval';

  /** @type {PdfSignatureInfo} */
  const info = {
    fieldName: item.fieldName,
    signer: fields.signerName || null,
    signerSource: fields.signerName ? 'pdf-name' : null,
    signerOrganization: null,
    issuer: null,
    serial: null,
    notBefore: null,
    notAfter: null,
    signingTime: isoOrNull(mDate),
    signingTimeSource: mDate ? 'pdf-M' : 'none',
    signingTimeCheck: 'not-checked',
    signingTimeCode: 'no-certificate',
    signatureTimestampCheck: null,
    reason: fields.reason,
    location: fields.location,
    subFilter: fields.subFilter,
    kind,
    // Fail-closed default: every return path below sets integrity and code explicitly.
    integrity: 'unreadable',
    integrityCode: null,
    integrityReason: null,
    coversWholeFile
  };

  if (!fields.subFilter || !SUPPORTED_SUBFILTER_SET.has(fields.subFilter)) {
    setIntegrity(info, 'not-checked-in-viewer', 'format-unsupported', fields.subFilter
      ? `signature present, format not supported (${fields.subFilter})`
      : 'signature present, format not supported (missing /SubFilter)');
    return { info, ctx: { byteRange, contents, mDate, fields, pending: false } };
  }
  if (!contents || contents.length === 0) {
    setIntegrity(info, 'unreadable', 'contents-missing', 'signature present, /Contents missing or empty');
    return { info, ctx: { byteRange, contents, mDate, fields, pending: false } };
  }
  if (!rangeValid) {
    setIntegrity(info, 'unreadable', 'byte-range-invalid',
      'signature present, /ByteRange malformed or gap does not exactly match this /Contents hex string');
    return { info, ctx: { byteRange, contents, mDate, fields, pending: false } };
  }
  // Provisional; verifySignatureEntry replaces it with the verification result.
  setIntegrity(info, 'intact', null, null);
  return { info, ctx: { byteRange, contents, mDate, fields, pending: true } };
}

/**
 * @param {PdfSignatureInfo} info
 * @param {PdfSignatureIntegrity} integrity
 * @param {PdfSignatureIntegrityCode|null} code
 * @param {string|null} reason
 */
function setIntegrity(info, integrity, code, reason) {
  info.integrity = integrity;
  info.integrityCode = code;
  info.integrityReason = reason;
}

/**
 * Classify an exception: a ViewerLimitError is `not-checked-in-viewer` with its
 * own code, anything else cannot be classified and is `indeterminate`.
 * @param {PdfSignatureInfo} info
 * @param {*} err
 * @param {string} prefix
 */
function setIntegrityFromError(info, err, prefix) {
  const message = `${prefix}: ${String(err?.message ?? err)}`;
  if (err instanceof ViewerLimitError) setIntegrity(info, 'not-checked-in-viewer', err.code, message);
  else setIntegrity(info, 'indeterminate', 'unexpected-error', message);
}

function validByteRange(bytes, br, contents, sourceSpans) {
  if (!br || br.some((v) => !Number.isSafeInteger(v) || v < 0)) return false;
  const [a, b, c, d] = br;
  if (a !== 0 || b >= c || c > bytes.length || d > bytes.length - c) return false;
  const span = sourceSpans.get(contents);
  if (!span || span.start !== b || span.end !== c) return false;
  if (bytes[b] !== 0x3c || bytes[c - 1] !== 0x3e) return false;
  // pdf-lib accepts some malformed hex strings; only PDF hex/whitespace is legal.
  for (let i = b + 1; i < c - 1; i++) {
    const ch = bytes[i];
    if (!((ch >= 48 && ch <= 57) || (ch >= 65 && ch <= 70) || (ch >= 97 && ch <= 102) ||
      ch === 0 || ch === 9 || ch === 10 || ch === 12 || ch === 13 || ch === 32)) return false;
  }
  return true;
}

function coveredBytes(bytes, byteRange) {
  const [, b, c, d] = byteRange;
  const out = new Uint8Array(b + d);
  out.set(bytes.subarray(0, b), 0);
  out.set(bytes.subarray(c, c + d), b);
  return out;
}

function extensionCoveredByLaterSignature(self, all, fileLength) {
  const selfEnd = self.byteRange[2] + self.byteRange[3];
  return all.some(
    (other) =>
      other !== self &&
      other.info?.integrity === 'intact' &&
      !other.pending &&
      other.byteRange &&
      other.byteRange[0] === 0 &&
      other.byteRange[1] >= selfEnd &&
      other.byteRange[2] + other.byteRange[3] >= fileLength
  );
}

// ---------------------------------------------------------------------------
// CMS verification
// ---------------------------------------------------------------------------

function findAttribute(signedAttrs, oid) {
  if (!signedAttrs?.attributes) return null;
  return signedAttrs.attributes.find((a) => a.type === oid) ?? null;
}

function attrRawBytes(attr) {
  const val = attr?.values?.[0];
  if (!val) return null;
  if (val.valueBlock?.valueHexView) return new Uint8Array(val.valueBlock.valueHexView);
  if (val.valueBlock?.valueBeforeDecodeView) return new Uint8Array(val.valueBlock.valueBeforeDecodeView);
  return null;
}

function attrDate(attr) {
  const val = attr?.values?.[0];
  if (!val) return null;
  if (typeof val.toDate === 'function') {
    try {
      return val.toDate();
    } catch {
      /* fall through */
    }
  }
  const raw = val.valueBlock?.valueDate;
  if (raw instanceof Date) return raw;
  const bytes = attrRawBytes(attr);
  if (!bytes) return null;
  return parsePdfDateString(decodeTextBytes(bytes)) || parseAsn1TimeString(decodeTextBytes(bytes));
}

function parseAsn1TimeString(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z?$/.exec(String(s).trim());
  if (!m) return null;
  return new Date(Date.UTC(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)
  ));
}

function rdnValue(rdn, oid) {
  const pair = rdn?.typesAndValues?.find((tv) => tv.type === oid);
  const value = pair?.value;
  if (!value) return null;
  if (typeof value.value === 'string') return value.value;
  const bytes = value.valueBlock?.valueHexView;
  return bytes ? decodeTextBytes(new Uint8Array(bytes)) : null;
}

function dnToString(rdn) {
  const parts = rdn?.typesAndValues?.map((tv) => `${tv.type}=${rdnValue(rdn, tv.type) ?? ''}`);
  return parts && parts.length ? parts.join(', ') : null;
}

function elementBytesToHex(element) {
  const bytes = element?.valueBlock?.valueHexView ?? element?.valueBlock?.valueBeforeDecodeView;
  return bytes ? bytesToHex(new Uint8Array(bytes)) : null;
}

async function matchCertificate(signedData, signerInfo, asn1jsLib) {
  const certs = (signedData.certificates ?? []).filter((c) => c?.serialNumber);
  if (!certs.length) return null;
  const sid = signerInfo.sid;
  const sidSerialHex = sid?.serialNumber ? elementBytesToHex(sid.serialNumber) : null;
  if (sidSerialHex) {
    const want = normalizeSerialHex(new Uint8Array(asn1HexToBytes(sidSerialHex)));
    return certs.find((c) => c.issuer.isEqual(sid.issuer) &&
      normalizeSerialHex(new Uint8Array(asn1HexToBytes(elementBytesToHex(c.serialNumber) ?? ''))) === want) ?? null;
  }
  // PKIjs decodes subjectKeyIdentifier into a raw OctetString.
  const want = sid?.idBlock?.isConstructed
    ? sid.valueBlock?.value?.[0]?.valueBlock?.valueHexView : sid?.valueBlock?.valueHexView;
  if (!want?.length) return null;
  for (const cert of certs) {
    const extension = cert.extensions?.find((e) => e.extnID === '2.5.29.14');
    let keyId;
    if (extension) {
      const parsed = asn1jsLib.fromBER(bufferView(extension.extnValue.valueBlock.valueHexView));
      if (parsed.offset === -1 || !(parsed.result instanceof asn1jsLib.OctetString)) continue;
      keyId = parsed.result.valueBlock.valueHexView;
    } else {
      keyId = await subtleDigest('SHA-1', cert.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView);
    }
    if (bytesEqual(want, keyId)) return cert;
  }
  return null;
}

function asn1HexToBytes(hex) {
  const out = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

function elementOid(element) {
  if (!element) return null;
  if (typeof element.value === 'string') return element.value;
  const bytes = element.valueBlock?.valueHexView;
  if (!bytes) return null;
  return decodeOidBytes(new Uint8Array(bytes));
}

function decodeOidBytes(b) {
  if (!b.length) return null;
  const parts = [Math.floor(b[0] / 40), b[0] % 40];
  let value = 0;
  let started = false;
  for (let i = 1; i < b.length; i += 1) {
    value = (value << 7) | (b[i] & 0x7f);
    if (!(b[i] & 0x80)) {
      parts.push(value);
      value = 0;
      started = true;
    } else {
      started = true;
    }
  }
  void started;
  return parts.join('.');
}

/** Dotted OID of an asn1js ObjectIdentifier (or raw OID element), else null. */
function oidOf(element) {
  if (typeof element?.getValue === 'function') {
    const value = element.getValue();
    if (typeof value === 'string' && value) return value;
  }
  return elementOid(element);
}

/**
 * Point size of the certificate's named curve, or null when the SPKI does not
 * name one of the WebCrypto curves. Never guessed from the key length: an
 * unknown curve (brainpool, explicit parameters, ...) verified as P-256/384/521
 * would produce a false `signature-invalid`.
 */
function curvePointSize(cert) {
  try {
    const params = cert.subjectPublicKeyInfo?.algorithm?.algorithmParams;
    return CURVE_OID_TO_POINT_SIZE.get(oidOf(params)) ?? null;
  } catch {
    return null;
  }
}

function pssParameters(algParams) {
  // RSASSA-PSS-params ::= SEQUENCE { hashAlgorithm[0], maskGenAlgorithm[1], saltLength[2] }
  const out = { hash: null, hashUnknown: false, saltLength: null };
  try {
    const seq = algParams?.valueBlock?.value ?? [];
    for (const tagElem of seq) {
      const inner = tagElem?.valueBlock?.value?.[0] ?? tagElem;
      const tagNumber = tagElem?.idBlock?.tagNumber;
      if (tagNumber === 0) {
        const oid = oidOf(inner);
        out.hash = HASH_OID_TO_NAME.get(oid) ?? null;
        out.hashUnknown = Boolean(oid) && !out.hash;
      } else if (tagNumber === 2) {
        const bytes = inner?.valueBlock?.valueHexView;
        if (bytes) {
          let value = 0;
          for (const byte of new Uint8Array(bytes)) value = value * 256 + byte;
          if (Number.isFinite(value) && value >= 0 && value <= 256) out.saltLength = value;
        }
      }
    }
  } catch {
    /* defaults below */
  }
  return out;
}

function signedDataFailure(integrity, integrityCode, integrityReason, cert = null) {
  return { status: 'failed', integrity, integrityCode, integrityReason, cert };
}

/**
 * Parse and verify one CMS SignedData structure. PDF signatures and embedded
 * RFC 3161 signature timestamps share these checks: exactly one signer, the
 * matching certificate, content/messageDigest binding and the CMS signature.
 * Document-specific imprint checks remain with the caller.
 */
async function verifySignedDataStructure(contentInfoDer, options, pkijsLib, asn1jsLib) {
  const { expectedEContentType, encapsulated, detachedContent = null } = options;
  let signedData;
  try {
    // No legitimate CMS gets near depth 64: an ASN.1 limit here means malformed data.
    const der = asn1jsLib.fromBER(bufferView(contentInfoDer), { maxDepth: 64, maxNodes: 100000 });
    if (der.offset === -1 || !der.result) {
      return signedDataFailure('unreadable', 'cms-malformed',
        `signature present, CMS (PKCS#7) data not parseable: ${der.result?.error ?? 'unknown ASN.1 error'}`);
    }
    const contentInfo = new pkijsLib.ContentInfo({ schema: der.result });
    if (contentInfo.contentType !== OID_SIGNED_DATA) {
      return signedDataFailure('unreadable', 'cms-malformed',
        `signature present, unexpected CMS content type ${contentInfo.contentType} (expected signedData)`);
    }
    signedData = new pkijsLib.SignedData({ schema: contentInfo.content });
  } catch (err) {
    return signedDataFailure('unreadable', 'cms-malformed',
      `signature present, CMS (PKCS#7) parse failed: ${String(err?.message ?? err)}`);
  }

  const signerInfo = signedData.signerInfos?.[0];
  if (!signerInfo || signedData.signerInfos.length !== 1) {
    return signedDataFailure('unreadable', 'cms-malformed', 'signature present, CMS must contain exactly one signer');
  }
  const cert = await matchCertificate(signedData, signerInfo, asn1jsLib);
  if (!cert) {
    return signedDataFailure('unreadable', 'signer-certificate-missing',
      'CMS contains no certificate matching the signer identifier');
  }

  const digestOid = signerInfo.digestAlgorithm?.algorithmId;
  if (!digestOid) return signedDataFailure('unreadable', 'cms-malformed', 'signature present, digest algorithm missing', cert);
  const hashName = HASH_OID_TO_NAME.get(digestOid) ?? null;
  if (!hashName) {
    return signedDataFailure('not-checked-in-viewer', 'algorithm-unsupported',
      `signature present, digest algorithm not supported: ${digestOid}`, cert);
  }
  // Preserve the viewer-limit boundary for a known hash WebCrypto cannot use
  // (SHA-224), including direct CMS signatures without signed attributes.
  if (!WEBCRYPTO_HASHES.has(hashName)) {
    return signedDataFailure('not-checked-in-viewer', 'algorithm-unsupported',
      `signature present, digest algorithm not supported by WebCrypto: ${hashName}`, cert);
  }
  const sigAlgOid = signerInfo.signatureAlgorithm?.algorithmId;
  const pkcs1Hash = RSA_PKCS1_HASH_BY_OID.get(sigAlgOid) ?? null;
  if (pkcs1Hash && pkcs1Hash !== hashName) {
    return signedDataFailure('unreadable', 'cms-content-mismatch',
      `CMS signatureAlgorithm (${sigAlgOid}) and digestAlgorithm (${digestOid}) bind different hashes`, cert);
  }

  const eContentType = signedData.encapContentInfo?.eContentType;
  const eContentBytes = attrRawBytesOfElement(signedData.encapContentInfo?.eContent);
  if ((encapsulated && !eContentBytes) || (!encapsulated && signedData.encapContentInfo?.eContent) ||
    eContentType !== expectedEContentType) {
    return signedDataFailure('unreadable', 'cms-content-mismatch', 'CMS content does not match the expected content type', cert);
  }
  const contentToVerify = encapsulated ? eContentBytes : detachedContent;
  // RFC 5652 section 5.4: signed attributes MUST bind the exact CMS content.
  if (signerInfo.signedAttrs) {
    const attrs = signerInfo.signedAttrs.attributes ?? [];
    const mdAttrs = attrs.filter((attr) => attr.type === OID_ATTR_MESSAGE_DIGEST);
    const md = mdAttrs[0];
    if (mdAttrs.length !== 1 || md.values?.length !== 1 || !(md.values[0] instanceof asn1jsLib.OctetString)) {
      return signedDataFailure('unreadable', 'message-digest-attribute',
        'CMS signed attributes require exactly one messageDigest value', cert);
    }
    // A hash WebCrypto lacks (SHA-224) or a missing crypto.subtle throws a
    // ViewerLimitError, which the caller reports as not checked in the viewer.
    const actual = await subtleDigest(hashName, contentToVerify);
    if (!bytesEqual(actual, attrRawBytes(md))) {
      return signedDataFailure('digest-mismatch', 'content-digest-mismatch',
        'CMS content digest does not match the signed messageDigest', cert);
    }
    const contentTypes = attrs.filter((attr) => attr.type === '1.2.840.113549.1.9.3');
    if (contentTypes.length !== 1 || contentTypes[0].values?.length !== 1 ||
      contentTypes[0].values[0].valueBlock?.toString() !== eContentType) {
      return signedDataFailure('unreadable', 'cms-content-mismatch',
        'CMS signed contentType does not match the encapsulated content type', cert);
    }
  }

  let signedRegion;
  if (signerInfo.signedAttrs?.encodedValue?.byteLength) {
    signedRegion = signerInfo.signedAttrs.encodedValue; // pkijs patched tag to SET OF
  } else if (signerInfo.signedAttrs) {
    return signedDataFailure('indeterminate', 'unexpected-error',
      'CMS signed attributes have no encoded signature input', cert);
  } else {
    signedRegion = bufferView(contentToVerify);
  }
  const signatureBytes = attrRawBytesOfElement(signerInfo.signature);
  if (!signatureBytes) return signedDataFailure('unreadable', 'cms-malformed', 'CMS signer info carries no signature value', cert);

  let verified;
  try {
    verified = await verifyCmsSignature(pkijsLib, asn1jsLib, {
      cert, signerInfo, sigAlgOid, hashName: pkcs1Hash ?? hashName, signatureBytes, signedRegion
    });
  } catch (err) {
    const detail = `signature cannot be verified in this environment: ${String(err?.message ?? err)}`;
    if (err instanceof ViewerLimitError) return signedDataFailure('not-checked-in-viewer', err.code, detail, cert);
    if (err?.name === 'NotSupportedError') return signedDataFailure('not-checked-in-viewer', 'algorithm-unsupported', detail, cert);
    if (err?.name === 'DataError') return signedDataFailure('indeterminate', 'key-import-failed', detail, cert);
    return signedDataFailure('indeterminate', 'unexpected-error', detail, cert);
  }
  if (verified === 'unsupported') {
    return signedDataFailure('not-checked-in-viewer', 'algorithm-unsupported',
      `signature algorithm or curve not verifiable with WebCrypto: ${sigAlgOid ?? 'missing'}`, cert);
  }
  if (verified === 'malformed') {
    return signedDataFailure('unreadable', 'cms-malformed', 'CMS signature value is not a valid ECDSA DER signature', cert);
  }
  if (verified !== 'verified') {
    return signedDataFailure('signature-invalid', 'signature-invalid',
      'CMS signature does not verify against the embedded certificate', cert);
  }
  return { status: 'verified', cert, signerInfo, signedData, eContentBytes, signatureBytes };
}

function applyCertificateIdentity(info, cert) {
  if (!cert) return;
  const cn = rdnValue(cert.subject, RDN_CN);
  if (cn) {
    info.signer = cn;
    info.signerSource = 'certificate';
  }
  info.signerOrganization = rdnValue(cert.subject, RDN_O);
  const issuerCn = rdnValue(cert.issuer, RDN_CN);
  info.issuer = issuerCn ?? dnToString(cert.issuer);
  const serialBytes = attrRawBytesOfInteger(cert.serialNumber);
  info.serial = serialBytes ? colonHex(trimSerial(serialBytes)) : null;
  info.notBefore = isoOrNull(cert.notBefore?.value ?? null);
  info.notAfter = isoOrNull(cert.notAfter?.value ?? null);
}

/** Compare only the selected signing time with the certificate window, never with now. */
function updateSigningTimeWindow(info, cert) {
  const timestampInvalid = info.signingTimeCheck === 'timestamp-invalid';
  let check;
  let code;
  if (!cert) {
    check = 'not-checked';
    code = 'no-certificate';
  } else {
    const notBefore = Date.parse(info.notBefore);
    const notAfter = Date.parse(info.notAfter);
    const signingTime = Date.parse(info.signingTime);
    if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter)) {
      check = 'not-checked';
      code = 'certificate-dates-unreadable';
    } else if (!Number.isFinite(signingTime)) {
      check = 'not-checked';
      code = 'signing-time-unknown';
    } else if (signingTime < notBefore) {
      check = 'outside-validity';
      code = 'signed-before-certificate-valid';
    } else if (signingTime > notAfter) {
      check = 'outside-validity';
      code = 'signed-after-certificate-expired';
    } else {
      check = 'within-validity';
      code = null;
    }
  }
  // The fallback source is always evaluated above. A defective timestamp remains
  // the visible warning even when that fallback lies inside the certificate window.
  info.signingTimeCheck = timestampInvalid ? 'timestamp-invalid' : check;
  info.signingTimeCode = timestampInvalid ? 'timestamp-invalid' : code;
}

function readTstInfo(eContentBytes, pkijsLib, asn1jsLib) {
  const tstAsn = asn1jsLib.fromBER(bufferView(eContentBytes));
  if (tstAsn.offset === -1) throw new Error(tstAsn.result?.error ?? 'ASN.1 error');
  const tst = new pkijsLib.TSTInfo({ schema: tstAsn.result });
  const imprint = tst.messageImprint;
  const gen = tst.genTime?.value ?? (typeof tst.genTime?.toDate === 'function' ? tst.genTime.toDate() : null) ?? tst.genTime;
  return {
    imprintAlgOid: imprint?.hashAlgorithm?.algorithmId ?? imprint?.hashAlg?.algorithmId ?? null,
    imprintBytes: attrRawBytesOfElement(imprint?.hashedMessage),
    genTime: gen instanceof Date && !Number.isNaN(gen.getTime()) ? gen : null
  };
}

async function timestampImprintMatches(tst, sourceBytes) {
  if (!tst.imprintAlgOid || !tst.imprintBytes) throw new Error('timestamp messageImprint incomplete');
  const imprintAlg = HASH_OID_TO_NAME.get(tst.imprintAlgOid) ?? null;
  if (!imprintAlg) {
    throw new ViewerLimitError('algorithm-unsupported', `timestamp imprint algorithm not supported: ${tst.imprintAlgOid}`);
  }
  const actual = await subtleDigest(imprintAlg, sourceBytes);
  return bytesEqual(actual, tst.imprintBytes);
}

/** Verify the unsigned id-aa-signatureTimeStampToken attribute, when present. */
async function verifyEmbeddedSignatureTimestamp(signerInfo, signatureBytes, pkijsLib, asn1jsLib) {
  const attrs = (signerInfo.unsignedAttrs?.attributes ?? []).filter((attr) => attr.type === OID_SIGNATURE_TIMESTAMP);
  if (!attrs.length) return { status: 'absent' };
  if (attrs.length !== 1 || attrs[0].values?.length !== 1 || typeof attrs[0].values[0]?.toBER !== 'function') {
    return { status: 'invalid', reason: 'signature timestamp attribute is malformed or ambiguous' };
  }
  try {
    const tokenDer = new Uint8Array(attrs[0].values[0].toBER(false));
    const cms = await verifySignedDataStructure(tokenDer, {
      expectedEContentType: OID_TST_INFO, encapsulated: true
    }, pkijsLib, asn1jsLib);
    if (cms.status !== 'verified') {
      return cms.integrity === 'not-checked-in-viewer'
        ? { status: 'not-checked', reason: cms.integrityReason }
        : { status: 'invalid', reason: cms.integrityReason };
    }
    const tst = readTstInfo(cms.eContentBytes, pkijsLib, asn1jsLib);
    const imprintMatches = await timestampImprintMatches(tst, signatureBytes);
    if (!imprintMatches || !tst.genTime) {
      return { status: 'invalid', reason: 'signature timestamp messageImprint does not match the signature value' };
    }
    return { status: 'verified', genTime: tst.genTime };
  } catch (err) {
    if (err instanceof ViewerLimitError) return { status: 'not-checked', reason: String(err?.message ?? err) };
    return { status: 'invalid', reason: `signature timestamp cannot be verified: ${String(err?.message ?? err)}` };
  }
}

async function verifySignatureEntry(info, ctx, bytes, pkijsLib, asn1jsLib, allContexts, revisions, pdfLib, renderCheck) {
  if (!ctx.pending) return; // dictionary level already decided (format, /Contents, ByteRange)
  ctx.pending = false;
  asn1jsRef = asn1jsLib;
  let cert = null;
  try {
    const signedBytes = coveredBytes(bytes, ctx.byteRange);
    if (ctx.contents.length > 1024 * 1024) {
      setIntegrity(info, 'not-checked-in-viewer', 'inspection-limit', 'CMS exceeds the 1 MiB signature inspection limit');
      return;
    }

    const isTimestamp = ctx.fields.subFilter === 'ETSI.RFC3161';
    const isSha1Embedded = ctx.fields.subFilter === 'adbe.pkcs7.sha1';
    const encapsulated = isTimestamp || isSha1Embedded;
    const cms = await verifySignedDataStructure(ctx.contents, {
      expectedEContentType: isTimestamp ? OID_TST_INFO : '1.2.840.113549.1.7.1',
      encapsulated,
      detachedContent: signedBytes
    }, pkijsLib, asn1jsLib);
    cert = cms.cert;
    applyCertificateIdentity(info, cert);
    if (cms.status !== 'verified') {
      setIntegrity(info, cms.integrity, cms.integrityCode, cms.integrityReason);
      return;
    }
    const { signerInfo, eContentBytes, signatureBytes } = cms;

    if (isTimestamp) {
      // A document timestamp proves genTime only after its CMS and imprint verify.
      let tst;
      try {
        tst = readTstInfo(eContentBytes, pkijsLib, asn1jsLib);
      } catch (err) {
        setIntegrity(info, 'unreadable', 'cms-malformed', `document timestamp not parseable: ${String(err?.message ?? err)}`);
        return;
      }
      let imprintMatches;
      try {
        imprintMatches = await timestampImprintMatches(tst, signedBytes);
      } catch (err) {
        if (err instanceof ViewerLimitError) setIntegrity(info, 'not-checked-in-viewer', err.code, String(err?.message ?? err));
        else setIntegrity(info, 'unreadable', 'cms-malformed', `document timestamp not parseable: ${String(err?.message ?? err)}`);
        return;
      }
      if (!imprintMatches) {
        setIntegrity(info, 'digest-mismatch', 'document-digest-mismatch', 'timestamp messageImprint does not match the document bytes');
        return;
      }
      const signingTimeDate = attrDate(findAttribute(signerInfo.signedAttrs, OID_ATTR_SIGNING_TIME));
      if (signingTimeDate) {
        info.signingTime = isoOrNull(signingTimeDate);
        info.signingTimeSource = 'signed-attribute';
      }
      if (tst.genTime) {
        info.signingTime = isoOrNull(tst.genTime);
        info.signingTimeSource = 'timestamp';
      }
    } else {
      if (isSha1Embedded) {
        // adbe.pkcs7.sha1: the CMS embeds the SHA-1 document digest.
        if (!eContentBytes || eContentBytes.length !== 20) {
          setIntegrity(info, 'unreadable', 'cms-content-mismatch', 'legacy SHA-1 signature without embedded document digest');
          return;
        }
        const actual = await subtleDigest('SHA-1', signedBytes);
        if (!bytesEqual(actual, eContentBytes)) {
          setIntegrity(info, 'digest-mismatch', 'document-digest-mismatch', 'document SHA-1 digest does not match the embedded digest in the CMS');
          return;
        }
      }
      const signingTimeDate = attrDate(findAttribute(signerInfo.signedAttrs, OID_ATTR_SIGNING_TIME));
      if (signingTimeDate) {
        info.signingTime = isoOrNull(signingTimeDate);
        info.signingTimeSource = 'signed-attribute';
      }

      // RFC 3161 Appendix A: the embedded token imprints the signature value
      // OCTET STRING contents, not the whole CMS or the document bytes.
      const timestamp = await verifyEmbeddedSignatureTimestamp(signerInfo, signatureBytes, pkijsLib, asn1jsLib);
      if (timestamp.status === 'verified') {
        info.signatureTimestampCheck = 'verified';
        info.signingTime = isoOrNull(timestamp.genTime);
        info.signingTimeSource = 'timestamp';
      } else if (timestamp.status === 'invalid') {
        info.signatureTimestampCheck = 'invalid';
        info.signingTimeCheck = 'timestamp-invalid';
        info.signingTimeCode = 'timestamp-invalid';
      } else if (timestamp.status === 'not-checked') {
        info.signatureTimestampCheck = 'not-checked';
      }
    }

    // --- final state ---------------------------------------------------------
    if (ctx.coversWholeFile === true || info.coversWholeFile === true) {
      setIntegrity(info, 'intact', null, null);
      return;
    }
    info.coversWholeFile = false;
    if (extensionCoveredByLaterSignature(ctx, allContexts, bytes.length)) {
      setIntegrity(info, 'intact', 'extended-by-later-signature',
        'file extended by later signature(s) after this one (incremental update)');
      return;
    }
    // What did the unsigned revision(s) after this signature change? Anything the
    // classifier cannot prove harmless stays modified-after-signing.
    const signedEnd = ctx.byteRange[2] + ctx.byteRange[3];
    const tail = classifyAppendedRevisions(revisions, signedEnd, pdfLib);
    if (tail.integrity !== 'intact') {
      setIntegrity(info, tail.integrity, tail.code, tail.reason);
      return;
    }
    // Green only when pdf.js, the engine that renders, shows the same document
    // for the signed revision and the full file (docs-src/pdf-signatures.md).
    const rendered = renderCheckVerdict(await renderCheck().compare(signedEnd));
    if (rendered) setIntegrity(info, rendered.integrity, rendered.code, rendered.reason);
    else setIntegrity(info, tail.integrity, tail.code, `${tail.reason}; pdf.js shows the same document as the signed revision`);
  } finally {
    updateSigningTimeWindow(info, cert);
  }
}

function trimSerial(b) {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i += 1;
  return b.subarray(i);
}

function attrRawBytesOfInteger(intElement) {
  if (!intElement?.valueBlock?.valueHexView) return null;
  return new Uint8Array(intElement.valueBlock.valueHexView);
}

function attrRawBytesOfElement(element) {
  if (!element) return null;
  const direct = element.valueBlock?.valueHexView;
  if (direct && direct.length) return new Uint8Array(direct);
  // Unparsed OCTET STRING wrappers (eContent, hashedMessage, ...) keep the
  // inner TLV undecoded; re-parse the encoded form and peel one DER layer off.
  try {
    const encoded = element.valueBlock?.valueBeforeDecodeView;
    if (encoded && encoded.length) {
      const parsed = asn1jsFromBERCached(new Uint8Array(encoded));
      const inner = parsed?.valueBlock?.valueHexView;
      if (inner && inner.length) return new Uint8Array(inner);
      if (parsed?.valueBlock?.valueBeforeDecodeView?.length) {
        // Nested still-unparsed layer (constructed encoding); decode once more.
        const again = asn1jsFromBERCached(new Uint8Array(parsed.valueBlock.valueBeforeDecodeView));
        const deep = again?.valueBlock?.valueHexView;
        return deep && deep.length ? new Uint8Array(deep) : null;
      }
      return null;
    }
    if (typeof element.toBER === 'function') {
      const parsed = asn1jsFromBERCached(new Uint8Array(element.toBER(false)));
      const inner = parsed?.valueBlock?.valueHexView;
      return inner && inner.length ? new Uint8Array(inner) : null;
    }
    return null;
  } catch {
    return null;
  }
}

let asn1jsRef = null;
function asn1jsFromBERCached(bytes) {
  if (!asn1jsRef || !bytes || !bytes.length) return null;
  try {
    const der = asn1jsRef.fromBER(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    return der.offset === -1 ? null : der.result;
  } catch {
    return null;
  }
}

function bufferView(u8) {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

function bytesEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Verify the CMS signature value with WebCrypto.
 * @returns {Promise<'verified'|'invalid'|'unsupported'|'malformed'>} `unsupported`
 * for an algorithm, hash or curve WebCrypto lacks; `malformed` when an ECDSA
 * signature value is not DER. Import/verify failures throw (classified by the caller).
 */
async function verifyCmsSignature(pkijsLib, asn1jsLib, { cert, signerInfo, sigAlgOid, hashName, signatureBytes, signedRegion }) {
  const subtle = requireSubtle();
  const spkiDer = bufferView(new Uint8Array(cert.subjectPublicKeyInfo.toSchema().toBER(false)));
  const keyAlgOid = cert.subjectPublicKeyInfo?.algorithm?.algorithmId;
  const result = (ok) => (ok ? 'verified' : 'invalid');

  if (RSA_PKCS1_OIDS.has(sigAlgOid)) {
    if (!WEBCRYPTO_HASHES.has(hashName)) return 'unsupported';
    const key = await subtle.importKey('spki', spkiDer, { name: 'RSASSA-PKCS1-v1_5', hash: hashName }, false, ['verify']);
    return result(await subtle.verify('RSASSA-PKCS1-v1_5', key, bufferView(signatureBytes), signedRegion));
  }
  if (sigAlgOid === OID_RSA_PSS) {
    const params = pssParameters(signerInfo.signatureAlgorithm?.algorithmParams);
    const hash = params.hash ?? hashName;
    if (params.hashUnknown || !WEBCRYPTO_HASHES.has(hash)) return 'unsupported';
    const saltLength = params.saltLength ?? hashedLength(hash);
    const key = await subtle.importKey('spki', spkiDer, { name: 'RSA-PSS', hash, mgf: { name: 'MGF-1', hash } }, false, ['verify']);
    return result(await subtle.verify({ name: 'RSA-PSS', saltLength }, key, bufferView(signatureBytes), signedRegion));
  }
  if (keyAlgOid === OID_EC_PUBLIC_KEY && ECDSA_HASH_BY_OID.has(sigAlgOid)) {
    const ecHash = ECDSA_HASH_BY_OID.get(sigAlgOid);
    const pointSize = curvePointSize(cert);
    if (pointSize === null || !WEBCRYPTO_HASHES.has(ecHash)) return 'unsupported';
    const inner = asn1jsLib.fromBER(bufferView(signatureBytes));
    if (inner.offset === -1) return 'malformed';
    let raw;
    try {
      raw = pkijsLib.createECDSASignatureFromCMS(inner.result, pointSize);
    } catch {
      return 'malformed'; // an INTEGER longer than the curve's point size
    }
    if (!raw || !raw.byteLength) return 'malformed';
    const namedCurve = curveNameForPointSize(pointSize);
    const key = await subtle.importKey('spki', spkiDer, { name: 'ECDSA', namedCurve, hash: ecHash }, false, ['verify']);
    return result(await subtle.verify({ name: 'ECDSA', hash: ecHash }, key, raw, signedRegion));
  }
  return 'unsupported'; // Ed25519, DSA, GOST, ...: not checked in the viewer
}

function curveNameForPointSize(pointSize) {
  if (pointSize === 48) return 'P-384';
  if (pointSize === 66) return 'P-521';
  return 'P-256';
}

function hashedLength(hashName) {
  if (hashName === 'SHA-384') return 48;
  if (hashName === 'SHA-512') return 64;
  if (hashName === 'SHA-224') return 28;
  return 32;
}

function orderSignatures(entries, contexts) {
  const indices = entries.map((_, i) => i);
  indices.sort((x, y) => {
    const ex = contexts[x].byteRange ? contexts[x].byteRange[2] + contexts[x].byteRange[3] : Number.MAX_SAFE_INTEGER;
    const ey = contexts[y].byteRange ? contexts[y].byteRange[2] + contexts[y].byteRange[3] : Number.MAX_SAFE_INTEGER;
    return ex - ey;
  });
  return indices.map((i) => entries[i]);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Document-level placeholder: one signature entry without identity fields, so
 * an inspection failure never claims that the document is unsigned.
 * @param {PdfSignatureIntegrity} integrity
 * @param {PdfSignatureIntegrityCode} code
 * @param {string} detail English detail line (integrityReason).
 * @returns {PdfSignatureReport}
 */
function placeholderSignatureReport(integrity, code, detail) {
  return { signatures: [{
    fieldName: null, signer: null, signerSource: null, signerOrganization: null, issuer: null,
    serial: null, notBefore: null, notAfter: null, signingTime: null,
    signingTimeSource: 'none', signingTimeCheck: 'not-checked', signingTimeCode: 'no-certificate',
    signatureTimestampCheck: null, reason: null, location: null, subFilter: null,
    kind: 'approval', integrity, integrityCode: code, integrityReason: detail,
    coversWholeFile: null
  }] };
}

/**
 * The viewer could not inspect the document's signatures because of its own
 * limits (budget, worker, library, read error); there is no evidence of a defect.
 * @param {PdfSignatureIntegrityCode} code A `not-checked-in-viewer` code.
 * @param {string} detail
 * @returns {PdfSignatureReport}
 */
export function notCheckedSignatureReport(code, detail) {
  return placeholderSignatureReport('not-checked-in-viewer', code, detail);
}

/**
 * Inspection failed in a way that is neither a known viewer limit nor proof of
 * a defect (shown as a warning).
 * @param {PdfSignatureIntegrityCode} code An `indeterminate` code.
 * @param {string} detail
 * @returns {PdfSignatureReport}
 */
export function indeterminateSignatureReport(code, detail) {
  return placeholderSignatureReport('indeterminate', code, detail);
}

/**
 * Placeholder for an exception: ViewerLimitError -> not checked with its code,
 * anything else -> indeterminate.
 * @param {*} err
 * @param {string} prefix
 * @returns {PdfSignatureReport}
 */
function errorSignatureReport(err, prefix) {
  const detail = `${prefix}: ${String(err?.message ?? err)}`;
  return err instanceof ViewerLimitError
    ? notCheckedSignatureReport(err.code, detail)
    : indeterminateSignatureReport('unexpected-error', detail);
}

const isPdfWhitespace = (b) => b === 0 || b === 9 || b === 10 || b === 12 || b === 13 || b === 32;
const isDigit = (b) => b >= 48 && b <= 57;

/**
 * pdf-lib's skipJibberish probes every byte of leading junk with
 * matchIndirectObjectHeader, which throws (building an Error) on each miss:
 * ~17 us per byte, so a 64 KiB prefix cost about one second. This instance
 * override answers the same `ws* int ws* int ws* obj` grammar without throwing,
 * memoizing the current whitespace run, comment run, and digit run so probing
 * stays linear. When the parser has no `matchIndirectObjectHeader` function
 * (unexpected pdf-lib shape) the probe is left uninstalled, falling back to
 * pdf-lib's own path instead of throwing.
 * Only a confirmed header reaches pdf-lib's own matcher, so offsets and results
 * are identical. Exported for the differential test only.
 *
 * A comment scan records the whole run of consecutive comment lines (each
 * `%..EOL` segment plus the EOL whitespace up to the next `%`), so one cache
 * entry linearizes `%`-heavy prefixes for LF, CR, CRLF, and unterminated
 * trailing comments alike. The run lookup applies only to `%` bytes, leaving
 * whitespace inside comment bodies on the historical step-over path.
 *
 * @param {any} parser pdf-lib PDFParser instance reading `bytes`.
 * @param {Uint8Array} bytes The parser's byte buffer.
 * @param {object} [stats] Test-only byte-visit counter: `stats.visits` is
 * reset to zero and incremented once per probed byte read (the bounded
 * digit-window conversion in `finiteFrom` is excluded). Omit in production.
 */
export function installIndirectObjectHeaderProbe(parser, bytes, stats) {
  const len = bytes.length;
  if (typeof parser.matchIndirectObjectHeader !== 'function') return;
  const match = parser.matchIndirectObjectHeader;
  // Test-only visit counter. Production callers omit `stats`, in which case
  // peek is a plain byte read.
  const peek = stats
    ? (j) => { if (j < len) stats.visits++; return bytes[j]; }
    : (j) => bytes[j];
  if (stats) stats.visits = 0;
  let ws = { from: -1, end: -1, to: -1 }; // every byte in [from, end) is whitespace and skips to `to`
  let run = { from: -1, end: -1, ok: false, finiteFrom: 0 }; // header verdict for digit run [from, end)
  let cmt = { from: -1, runEnd: -1 }; // '%' at `from` starts a comment run ending at `runEnd`
  // Mirrors BaseParser.skipWhitespaceAndComments. A memoized comment run jumps
  // straight past the whole run of consecutive comment lines: every '%' in
  // [from, runEnd) continues down the same run to runEnd, so each comment line
  // is scanned once no matter how lines break (LF, CR, CRLF, or no EOL at
  // all). The lookup applies only to '%' bytes, so whitespace inside a comment
  // body keeps the historical step-over behaviour byte for byte.
  const skip = (i) => {
    while (i < len) {
      while (i < len && isPdfWhitespace(peek(i))) i++;
      if (peek(i) !== 37) break;
      if (i >= cmt.from && i < cmt.runEnd) i = cmt.runEnd;
      else {
        const cs = i;
        while (i < len && peek(i) !== 10 && peek(i) !== 13) i++;
        let r = i;
        for (;;) {
          let w = r;
          while (w < len && isPdfWhitespace(peek(w))) w++;
          if (peek(w) !== 37) break;
          r = w + 1;
          while (r < len && peek(r) !== 10 && peek(r) !== 13) r++;
        }
        cmt = { from: cs, runEnd: r };
        i = r;
      }
    }
    return i;
  };
  const digitsEnd = (i) => { while (i < len && isDigit(peek(i))) i++; return i; };
  // Smallest start in [s, e) whose digit suffix Number() parses as finite; a
  // double holds at most 309 integer digits, and leading zeros are free.
  const finiteFrom = (s, e) => {
    const k = e - 309;
    if (k < s) return s;
    if (!Number.isFinite(Number(String.fromCharCode(...bytes.subarray(k, e))))) return k + 1;
    let f = k;
    while (f > s && bytes[f - 1] === 48) f--;
    return f;
  };
  parser.matchIndirectObjectHeader = function () {
    const i = this.bytes.offset();
    let p = i;
    if (i >= ws.from && i < ws.end) p = ws.to;
    else if (isPdfWhitespace(peek(i)) || peek(i) === 37) {
      p = skip(i);
      let end = i;
      while (end < p && isPdfWhitespace(peek(end))) end++;
      ws = { from: i, end, to: p };
    }
    if (!isDigit(peek(p))) return false;
    if (p < run.from || p >= run.end) {
      const end = digitsEnd(p);
      const q = skip(end);
      const qEnd = digitsEnd(q);
      const r = skip(qEnd);
      const ok = qEnd > q && finiteFrom(q, qEnd) === q &&
        peek(r) === 111 && peek(r + 1) === 98 && peek(r + 2) === 106; // "obj"
      run = { from: p, end, ok, finiteFrom: finiteFrom(p, end) };
    }
    return run.ok && p >= run.finiteFrom ? match.call(this) : false;
  };
}

// Track source positions on a parser INSTANCE, never by patching global prototypes.
// Identity ties a direct /Contents value to its real source span, including <>.
// Object-stream contents have no file span and consequently cannot pass ByteRange.
async function parseWithSourceSpans(bytes, pdfLib) {
  const parser = pdfLib.PDFParser.forBytesWithOptions(bytes, 100, true);
  // The caller already treats this document as PDF. Discover objects from byte
  // zero even if the header is missing or follows signature dictionaries. The
  // parser's default version metadata is irrelevant to integrity verification.
  parser.parseHeader = () => parser.context.header;
  installIndirectObjectHeaderProbe(parser, bytes);
  const sourceSpans = new WeakMap();
  const parsedDicts = [];
  const assign = parser.context.assign;
  parser.context.assign = function (ref, object) {
    parsedDicts.push(object); // Also preserve superseded objects from object streams.
    return assign.call(this, ref, object);
  };
  const parseHex = parser.parseHexString;
  parser.parseHexString = function () {
    const start = this.bytes.offset();
    const value = parseHex.call(this);
    sourceSpans.set(value, { start, end: this.bytes.offset() });
    return value;
  };
  const parseDict = parser.parseDict;
  parser.parseDict = function () {
    const dict = parseDict.call(this);
    parsedDicts.push(dict); // Preserve signatures superseded in later revisions too.
    return dict;
  };
  // Object positions, cross-reference sections and trailers for the appended-revision
  // classifier; left uninstalled (classifier answers "unclassified") on an unexpected shape.
  const revisions = createRevisionLog();
  installRevisionLogHooks(parser, revisions);
  let depth = 0;
  let count = 0;
  let decodedTotal = 0;
  // pdf-lib wraps errors thrown inside an indirect object into its own parsing
  // error, so the first viewer limit is remembered here and rethrown below.
  let limit = null;
  const fail = (code, message) => {
    limit ??= new ViewerLimitError(code, message);
    throw limit;
  };
  const parseObject = parser.parseObject;
  parser.parseObject = function () {
    if (++depth > 128 || ++count > 1000000) fail('inspection-limit', 'PDF inspection complexity limit exceeded');
    try {
      const object = parseObject.call(this);
      if (object instanceof pdfLib.PDFRawStream && ['ObjStm', 'XRef'].includes(pdfText(object.dict.lookup(pdfLib.PDFName.of('Type'))))) {
        // Decode parser-owned streams under a memory budget before pdf-lib's
        // object/xref stream parsers consume them. Page/image streams stay opaque.
        const filter = object.dict.lookup(pdfLib.PDFName.of('Filter'));
        if (filter instanceof pdfLib.PDFArray && filter.size() > 1) fail('structure-unsupported', 'Multiple structural stream filters require external inspection');
        const filterName = pdfText(filter instanceof pdfLib.PDFArray ? filter.lookup(0) : filter);
        if (filter && !DECODABLE_STREAM_FILTERS.has(filterName)) {
          fail('structure-unsupported', `Structural stream filter ${filterName ?? '(unreadable)'} cannot be decoded`);
        }
        const decoded = pdfLib.decodePDFRawStream(object);
        const maxDecoded = 8 * 1024 * 1024;
        const ensureBuffer = decoded.ensureBuffer;
        if (ensureBuffer) decoded.ensureBuffer = function (size) {
          if (size > maxDecoded) fail('inspection-limit', 'PDF structural stream exceeds the 8 MiB inspection limit');
          return ensureBuffer.call(this, size);
        };
        const content = decoded.decode();
        decodedTotal += content.length;
        if (content.length > maxDecoded || decodedTotal > 32 * 1024 * 1024) fail('inspection-limit', 'PDF structural stream inspection budget exceeded');
        revisions.noteStream(pdfText(object.dict.lookup(pdfLib.PDFName.of('Type'))), object.dict, content, depth);
        const dict = object.dict.clone();
        dict.delete(pdfLib.PDFName.of('Filter'));
        dict.delete(pdfLib.PDFName.of('DecodeParms'));
        dict.set(pdfLib.PDFName.of('Length'), pdfLib.PDFNumber.of(content.length));
        return pdfLib.PDFRawStream.of(dict, content);
      }
      return object;
    } finally { depth--; }
  };
  let context;
  try {
    context = await parser.parseDocument();
  } catch (err) {
    throw limit ?? err;
  }
  if (limit) throw limit;
  return { context, sourceSpans, parsedDicts, revisions };
}

/**
 * Collect signature information from PDF bytes. This is the pure parser - it
 * runs on any environment with WebCrypto (main thread, worker, Node). To
 * avoid blocking the main thread, application code should call
 * `getDocumentSignatures` from `utils/pdfSignatureInspector.js` instead,
 * which offloads this function to a worker.
 *
 * Never throws: inspection failures resolve to a document-level placeholder
 * (`not-checked-in-viewer` for viewer limits, otherwise `indeterminate`);
 * per-signature results follow the status model in docs-src/pdf-signatures.md.
 *
 * @param {Uint8Array|ArrayBuffer} pdfBytes Complete PDF document bytes.
 * @param {Object} [options]
 * @param {Object} [options.renderCheck] Options for the pdf.js differential
 * confirmation of appended revisions (`loadPdfjs`, `documentOptions`,
 * `budgetMs`; see utils/pdfSignatureRenderCheck.js). The signature worker
 * passes the viewer's pdf.js build and document options.
 * @returns {Promise<PdfSignatureReport>}
 */
export async function collectPdfSignatures(pdfBytes, options = {}) {
  const empty = { signatures: [] };
  let bytes;
  try {
    bytes = toUint8(pdfBytes);
  } catch {
    return empty;
  }
  // Never gate discovery on a header or strip leading bytes: ByteRange and
  // /Contents positions must be verified against the actual file.
  if (bytes.length > 64 * 1024 * 1024) return notCheckedSignatureReport('inspection-limit', 'PDF exceeds the 64 MiB signature inspection limit');

  let pdfLib;
  let pdfDoc;
  try {
    pdfLib = await import('pdf-lib');
    pdfDoc = await parseWithSourceSpans(bytes, pdfLib);
    if (pdfDoc.context.trailerInfo.Encrypt) return notCheckedSignatureReport('encrypted', 'Encrypted PDF signature inspection is unavailable');
  } catch (err) {
    return errorSignatureReport(err, 'PDF structure cannot be inspected');
  }

  let discovered;
  try {
    discovered = discoverSignatures(pdfDoc, pdfLib);
  } catch (err) {
    return errorSignatureReport(err, 'PDF signatures cannot be discovered');
  }
  if (!discovered.length) return empty;
  if (discovered.length > 256) return notCheckedSignatureReport('inspection-limit', 'PDF exceeds the 256 signature inspection limit');

  /** @type {PdfSignatureInfo[]} */
  const entries = [];
  /** @type {any[]} */
  const contexts = [];
  for (const item of discovered) {
    try {
      const { info, ctx } = dictionaryInfo(item, bytes, pdfLib, pdfDoc.sourceSpans);
      entries.push(info);
      contexts.push({ ...ctx, info });
    } catch (err) {
      // A malformed signature dictionary, but no proof that the signature is defective.
      const info = indeterminateSignatureReport('unexpected-error',
        `Signature dictionary cannot be inspected: ${String(err?.message ?? err)}`).signatures[0];
      info.fieldName = item.fieldName;
      entries.push(info);
      contexts.push({ byteRange: null, contents: null, info, pending: false });
    }
  }

  // Load the CMS stack only now - the document really has signature fields.
  let pkijsLib;
  let asn1jsLib;
  try {
    [pkijsLib, asn1jsLib] = await Promise.all([loadPkijs(), loadAsn1js()]);
  } catch (err) {
    for (const ctx of contexts) {
      if (ctx.pending) {
        ctx.pending = false;
        setIntegrity(ctx.info, 'not-checked-in-viewer', 'viewer-error', `signature stack unavailable: ${String(err?.message ?? err)}`);
      }
    }
    return { signatures: orderSignatures(entries, contexts) };
  }

  // A later signature may authorize an extension only after its own final verdict.
  const verificationOrder = contexts.map((_, i) => i).sort((a, b) =>
    ((contexts[b].byteRange?.[2] ?? 0) + (contexts[b].byteRange?.[3] ?? 0)) -
    ((contexts[a].byteRange?.[2] ?? 0) + (contexts[a].byteRange?.[3] ?? 0)));
  // Created on first use: only a green appended-revision verdict needs pdf.js.
  let comparator = null;
  const renderCheck = () => (comparator ??= createRenderComparator(bytes, options.renderCheck));
  try {
    for (const i of verificationOrder) {
      try {
        await verifySignatureEntry(entries[i], contexts[i], bytes, pkijsLib, asn1jsLib, contexts, pdfDoc.revisions, pdfLib, renderCheck);
      } catch (err) {
        contexts[i].pending = false;
        setIntegrityFromError(entries[i], err, 'unexpected verification failure');
      }
    }
  } finally {
    await comparator?.destroy();
  }

  return { signatures: orderSignatures(entries, contexts) };
}
