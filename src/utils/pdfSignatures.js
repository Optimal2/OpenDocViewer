/**
 * PDF signature collection - level 1 integrity inspection.
 *
 * Reads digital signature information from PDF bytes and returns a stable
 * data contract (see docs-src/pdf-signatures.md). Level 1 answers exactly one
 * question per signature: is the content that the signature covered
 * byte-for-byte intact? Certificate chain building, revocation and trust are
 * level 2 (server-side), optionally merged by pdfSignatureGateway.js.
 *
 * The module is environment-agnostic: it runs on the main thread, inside a
 * web worker and in Node (tests). Heavy dependencies (pdf-lib, pkijs,
 * asn1js) are loaded through dynamic imports. Unsigned PDFs skip the CMS
 * stack; inspection failures produce a document-level or per-signature
 * `unreadable` report instead of claiming that signatures are absent.
 *
 * @module utils/pdfSignatures
 */

/**
 * One inspected PDF signature (level-1 integrity view; trust is never
 * evaluated here - see the `trust` property).
 *
 * @typedef {Object} PdfSignatureInfo
 * @property {string|null} fieldName AcroForm signature field name (/T).
 * @property {string|null} signer Signer certificate subject CN; falls back to
 * the signature dictionary /Name when no certificate could be read.
 * @property {string|null} signerOrganization Signer certificate subject O.
 * @property {string|null} issuer Signer certificate issuer CN (else full issuer DN).
 * @property {string|null} serial Certificate serial number, colon-separated hex.
 * @property {string|null} notBefore Certificate validity start, ISO 8601.
 * @property {string|null} notAfter Certificate validity end, ISO 8601.
 * @property {string|null} signingTime Signing time, ISO 8601 (see signingTimeSource).
 * @property {'signed-attribute'|'pdf-M'|'none'|'timestamp'} signingTimeSource Where
 * `signingTime` came from: the CMS signingTime signed attribute (for document
 * timestamps: the TSTInfo genTime), the PDF signature dictionary /M date, or
 * nowhere. Gateway enrichment can supply a verified timestamp.
 * @property {string|null} reason Signature dictionary /Reason text.
 * @property {string|null} location Signature dictionary /Location text.
 * @property {string|null} subFilter Raw /SubFilter value (without slash).
 * @property {'approval'|'certification'|'timestamp'} kind Certification
 * signature (signature dictionary carries /Reference), document timestamp
 * (ETSI.RFC3161), otherwise approval.
 * @property {'intact'|'modified-after-signing'|'digest-mismatch'|'signature-invalid'|'unsupported'|'unreadable'} integrity
 * Level-1 integrity verdict; the rules are documented in docs-src/pdf-signatures.md.
 * @property {string|null} integrityReason Short human-readable explanation;
 * null when the status needs no explanation.
 * @property {boolean|null} coversWholeFile Whether the ByteRange reaches the
 * end of the file (false = the file was extended after this signature;
 * null = the ByteRange could not be read).
 * @property {'not-checked'|'valid'|'invalid'|'unknown'} trust Always 'not-checked'
 * from this parser; optional gateway enrichment supplies level-2 trust.
 * @property {string|null} [trustReason] Plain-language server trust explanation.
 * @property {boolean} [serverValidationUnavailable] Client-only failure marker; never accepted from server JSON.
 * @property {string|null} [validationTime] ISO 8601 server validation time.
 */

/**
 * @typedef {Object} PdfSignatureReport
 * @property {PdfSignatureInfo[]} signatures Signatures ordered by signing
 * chronology (ByteRange end position). Empty array when the document has no
 * signature fields.
 * @property {string} [validatedAt] ISO 8601 gateway report validation time.
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

const HASH_OID_TO_NAME = new Map([
  ['1.3.14.3.2.26', 'SHA-1'],
  ['2.16.840.1.101.3.4.2.1', 'SHA-256'],
  ['2.16.840.1.101.3.4.2.2', 'SHA-384'],
  ['2.16.840.1.101.3.4.2.3', 'SHA-512'],
  ['2.16.840.1.101.3.4.2.4', 'SHA-224']
]);

const RSA_PKCS1_OIDS = new Set([
  '1.2.840.113549.1.1.1', // rsaEncryption
  '1.2.840.113549.1.1.5', // sha1WithRSAEncryption
  '1.2.840.113549.1.1.11', // sha256WithRSAEncryption
  '1.2.840.113549.1.1.12', // sha384WithRSAEncryption
  '1.2.840.113549.1.1.13', // sha512WithRSAEncryption
  '1.2.840.113549.1.1.14' // sha224WithRSAEncryption
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

async function subtleDigest(algName, data) {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('WebCrypto (crypto.subtle) is not available in this environment');
  }
  return new Uint8Array(await crypto.subtle.digest(algName, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
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
    if (visited.size > 100000) throw new Error('PDF object inspection limit exceeded');
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
    signerOrganization: null,
    issuer: null,
    serial: null,
    notBefore: null,
    notAfter: null,
    signingTime: isoOrNull(mDate),
    signingTimeSource: mDate ? 'pdf-M' : 'none',
    reason: fields.reason,
    location: fields.location,
    subFilter: fields.subFilter,
    kind,
    integrity: 'unreadable',
    integrityReason: null,
    coversWholeFile,
    trust: 'not-checked'
  };

  if (!fields.subFilter || !SUPPORTED_SUBFILTER_SET.has(fields.subFilter)) {
    info.integrity = 'unsupported';
    info.integrityReason = fields.subFilter
      ? `signature present, format not supported (${fields.subFilter})`
      : 'signature present, format not supported (missing /SubFilter)';
    return { info, ctx: { byteRange, contents, mDate, fields } };
  }
  if (!contents || contents.length === 0) {
    info.integrityReason = 'signature present, /Contents missing or empty';
    return { info, ctx: { byteRange, contents, mDate, fields } };
  }
  if (!rangeValid) {
    info.integrityReason = 'signature present, /ByteRange malformed or gap does not exactly match this /Contents hex string';
    return { info, ctx: { byteRange, contents, mDate, fields } };
  }
  info.integrity = 'intact'; // provisional; replaced by verification result below
  info.integrityReason = 'pending-verification';
  return { info, ctx: { byteRange, contents, mDate, fields } };
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
      other.info.integrityReason !== 'pending-verification' &&
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

function curvePointSize(cert, asn1jsLib) {
  try {
    const spki = cert.subjectPublicKeyInfo;
    const paramsOid = elementOid(spki?.algorithm?.algorithmParams);
    if (paramsOid && CURVE_OID_TO_POINT_SIZE.has(paramsOid)) return CURVE_OID_TO_POINT_SIZE.get(paramsOid);
    const keyBytes = new Uint8Array(spki?.subjectPublicKey?.valueBlock?.valueCutOffFromStartView ?? []);
    if (keyBytes.length > 1 && keyBytes[0] === 0x04 && (keyBytes.length - 1) % 2 === 0) {
      return (keyBytes.length - 1) / 2;
    }
  } catch {
    /* ignore, defaults below */
  }
  void asn1jsLib;
  return 32;
}

function pssParameters(algParams) {
  // RSASSA-PSS-params ::= SEQUENCE { hashAlgorithm[0], maskGenAlgorithm[1], saltLength[2] }
  const out = { hash: null, saltLength: null };
  try {
    const seq = algParams?.valueBlock?.value ?? [];
    for (const tagElem of seq) {
      const inner = tagElem?.valueBlock?.value?.[0] ?? tagElem;
      const tagNumber = tagElem?.idBlock?.tagNumber;
      if (tagNumber === 0) {
        out.hash = HASH_OID_TO_NAME.get(elementOid(inner)) ?? null;
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

async function verifySignatureEntry(info, ctx, bytes, pkijsLib, asn1jsLib, allContexts) {
  if (ctx.contents === null || ctx.byteRange === null) return; // already unreadable/unsupported
  if (info.integrityReason !== 'pending-verification') return;
  info.integrityReason = null;
  asn1jsRef = asn1jsLib;

  const signedBytes = coveredBytes(bytes, ctx.byteRange);
  if (ctx.contents.length > 1024 * 1024) {
    info.integrity = 'unreadable';
    info.integrityReason = 'CMS exceeds the 1 MiB signature inspection limit';
    return;
  }

  // --- parse CMS -----------------------------------------------------------
  let signedData;
  let contentInfo;
  try {
    const der = asn1jsLib.fromBER(bufferView(ctx.contents), { maxDepth: 64, maxNodes: 100000 });
    if (der.offset === -1 || !der.result) {
      info.integrity = 'unreadable';
      info.integrityReason = `signature present, CMS (PKCS#7) data not parseable: ${der.result?.error ?? 'unknown ASN.1 error'}`;
      return;
    }
    contentInfo = new pkijsLib.ContentInfo({ schema: der.result });
    if (contentInfo.contentType !== OID_SIGNED_DATA) {
      info.integrity = 'unreadable';
      info.integrityReason = `signature present, unexpected CMS content type ${contentInfo.contentType} (expected signedData)`;
      return;
    }
    signedData = new pkijsLib.SignedData({ schema: contentInfo.content });
  } catch (err) {
    info.integrity = 'unreadable';
    info.integrityReason = `signature present, CMS (PKCS#7) parse failed: ${String(err?.message ?? err)}`;
    return;
  }

  const signerInfo = signedData.signerInfos?.[0];
  if (!signerInfo || signedData.signerInfos.length !== 1) {
    info.integrity = 'unreadable';
    info.integrityReason = 'signature present, PDF CMS must contain exactly one signer';
    return;
  }

  // --- certificate identity -------------------------------------------------
  const cert = await matchCertificate(signedData, signerInfo, asn1jsLib);
  if (!cert) {
    info.integrity = 'unreadable';
    info.integrityReason = 'CMS contains no certificate matching the signer identifier';
    return;
  }
  if (cert) {
    const cn = rdnValue(cert.subject, RDN_CN);
    if (cn) info.signer = cn;
    info.signerOrganization = rdnValue(cert.subject, RDN_O);
    const issuerCn = rdnValue(cert.issuer, RDN_CN);
    info.issuer = issuerCn ?? dnToString(cert.issuer);
    const serialBytes = attrRawBytesOfInteger(cert.serialNumber);
    info.serial = serialBytes ? colonHex(trimSerial(serialBytes)) : null;
    info.notBefore = isoOrNull(cert.notBefore?.value ?? null);
    info.notAfter = isoOrNull(cert.notAfter?.value ?? null);
  }

  // --- digest algorithm ------------------------------------------------------
  const digestOid = signerInfo.digestAlgorithm?.algorithmId;
  const hashName = digestOid ? HASH_OID_TO_NAME.get(digestOid) ?? null : null;
  if (!hashName) {
    info.integrity = 'unreadable';
    info.integrityReason = `signature present, digest algorithm not supported: ${digestOid ?? 'missing'}`;
    return;
  }

  const isTimestamp = ctx.fields.subFilter === 'ETSI.RFC3161';
  const isSha1Embedded = ctx.fields.subFilter === 'adbe.pkcs7.sha1';

  // --- document integrity (digest over the covered bytes) -------------------
  const eContentType = signedData.encapContentInfo?.eContentType;
  const eContentBytes = attrRawBytesOfElement(signedData.encapContentInfo?.eContent);
  let documentDigestOk;
  const encapsulated = isTimestamp || isSha1Embedded;
  if ((encapsulated && !eContentBytes) || (!encapsulated && signedData.encapContentInfo?.eContent) ||
    (isTimestamp ? eContentType !== OID_TST_INFO : eContentType !== '1.2.840.113549.1.7.1')) {
    info.integrity = 'unreadable';
    info.integrityReason = 'CMS content does not match the PDF SubFilter';
    return;
  }
  const contentToVerify = encapsulated ? eContentBytes : signedBytes;
  // RFC 5652 section 5.4: signed attributes MUST bind the exact CMS content.
  if (signerInfo.signedAttrs) {
    const attrs = signerInfo.signedAttrs.attributes ?? [];
    const mdAttrs = attrs.filter((attr) => attr.type === OID_ATTR_MESSAGE_DIGEST);
    const md = mdAttrs[0];
    if (mdAttrs.length !== 1 || md.values?.length !== 1 || !(md.values[0] instanceof asn1jsLib.OctetString)) {
      info.integrity = 'unreadable';
      info.integrityReason = 'CMS signed attributes require exactly one messageDigest value';
      return;
    }
    const actual = await subtleDigest(hashName, contentToVerify);
    if (!bytesEqual(actual, attrRawBytes(md))) {
      info.integrity = 'digest-mismatch';
      info.integrityReason = 'CMS content digest does not match the signed messageDigest';
      return;
    }
    const contentTypes = attrs.filter((attr) => attr.type === '1.2.840.113549.1.9.3');
    if (contentTypes.length !== 1 || contentTypes[0].values?.length !== 1 ||
      contentTypes[0].values[0].valueBlock?.toString() !== eContentType) {
      info.integrity = 'unreadable';
      info.integrityReason = 'CMS signed contentType does not match the encapsulated content type';
      return;
    }
  }

  if (isTimestamp) {
    // Document timestamp: the TSTInfo messageImprint must match the file bytes.
    try {
      if (!eContentBytes) throw new Error('no encapsulated content');
      const tstAsn = asn1jsLib.fromBER(bufferView(eContentBytes));
      if (tstAsn.offset === -1) throw new Error(tstAsn.result?.error ?? 'ASN.1 error');
      const tst = new pkijsLib.TSTInfo({ schema: tstAsn.result });
      const imprint = tst.messageImprint;
      const imprintAlgOid = imprint?.hashAlgorithm?.algorithmId ?? imprint?.hashAlg?.algorithmId;
      const imprintAlg = imprintAlgOid ? HASH_OID_TO_NAME.get(imprintAlgOid) ?? null : null;
      const imprintBytes = attrRawBytesOfElement(imprint?.hashedMessage);
      if (!imprintAlg || !imprintBytes) throw new Error('messageImprint incomplete');
      const actual = await subtleDigest(imprintAlg, signedBytes);
      documentDigestOk = bytesEqual(actual, imprintBytes);
      if (!info.signingTime) {
        const gen = tst.genTime?.value ?? (typeof tst.genTime?.toDate === 'function' ? tst.genTime.toDate() : null) ?? tst.genTime;
        if (gen instanceof Date && info.signingTimeSource !== 'signed-attribute') {
          info.signingTime = isoOrNull(gen);
          info.signingTimeSource = 'signed-attribute';
        }
      }
    } catch (err) {
      info.integrity = 'unreadable';
      info.integrityReason = `document timestamp not parseable: ${String(err?.message ?? err)}`;
      return;
    }
    if (!documentDigestOk) {
      info.integrity = 'digest-mismatch';
      info.integrityReason = 'timestamp messageImprint does not match the document bytes';
      return;
    }
  } else if (isSha1Embedded) {
    // adbe.pkcs7.sha1: the CMS embeds the SHA-1 document digest.
    if (!eContentBytes || eContentBytes.length !== 20) {
      info.integrity = 'unreadable';
      info.integrityReason = 'legacy SHA-1 signature without embedded document digest';
      return;
    }
    const actual = await subtleDigest('SHA-1', signedBytes);
    documentDigestOk = bytesEqual(actual, eContentBytes);
    if (!documentDigestOk) {
      info.integrity = 'digest-mismatch';
      info.integrityReason = 'document SHA-1 digest does not match the embedded digest in the CMS';
      return;
    }
  }

  // --- signing time from CMS attribute --------------------------------------
  const signingTimeAttr = findAttribute(signerInfo.signedAttrs, OID_ATTR_SIGNING_TIME);
  const signingTimeDate = attrDate(signingTimeAttr);
  if (signingTimeDate) {
    info.signingTime = isoOrNull(signingTimeDate);
    info.signingTimeSource = 'signed-attribute';
  }

  // --- signature value over the signed attributes ----------------------------
  const sigAlgOid = signerInfo.signatureAlgorithm?.algorithmId;
  let signedRegion;
  if (signerInfo.signedAttrs?.encodedValue?.byteLength) {
    signedRegion = signerInfo.signedAttrs.encodedValue; // pkijs patched tag to SET OF
  } else if (signerInfo.signedAttrs) {
    info.integrity = 'unreadable';
    info.integrityReason = 'CMS signed attributes have no encoded signature input';
    return;
  } else {
    signedRegion = bufferView(contentToVerify);
  }

  const signatureBytes = attrRawBytesOfElement(signerInfo.signature);
  if (!signatureBytes) {
    info.integrity = 'unreadable';
    info.integrityReason = 'CMS signer info carries no signature value';
    return;
  }
  if (!cert) {
    info.integrity = 'unreadable';
    info.integrityReason = 'CMS contains no signer certificate';
    return;
  }

  let verified;
  try {
    verified = await verifyCmsSignature(pkijsLib, asn1jsLib, {
      cert, signerInfo, sigAlgOid, hashName, signatureBytes, signedRegion
    });
  } catch (err) {
    info.integrity = 'unreadable';
    info.integrityReason = `signature cannot be verified in this environment: ${String(err?.message ?? err)}`;
    return;
  }
  if (verified !== true) {
    if (verified === null) {
      info.integrity = 'unreadable';
      info.integrityReason = `signature algorithm not verifiable with WebCrypto: ${sigAlgOid ?? 'missing'}`;
      return;
    }
    info.integrity = 'signature-invalid';
    info.integrityReason = 'CMS signature does not verify against the embedded certificate';
    return;
  }

  // --- final state -----------------------------------------------------------
  if (ctx.coversWholeFile === true || info.coversWholeFile === true) {
    info.integrity = 'intact';
    info.integrityReason = null;
    return;
  }
  info.coversWholeFile = false;
  if (extensionCoveredByLaterSignature(ctx, allContexts, bytes.length)) {
    info.integrity = 'intact';
    info.integrityReason = 'file extended by later signature(s) after this one (incremental update)';
  } else {
    info.integrity = 'modified-after-signing';
    info.integrityReason = 'file was extended after signing outside the covered byte range (incremental update)';
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

async function verifyCmsSignature(pkijsLib, asn1jsLib, { cert, signerInfo, sigAlgOid, hashName, signatureBytes, signedRegion }) {
  const spkiDer = bufferView(new Uint8Array(cert.subjectPublicKeyInfo.toSchema().toBER(false)));
  const keyAlgOid = cert.subjectPublicKeyInfo?.algorithm?.algorithmId;

  if (RSA_PKCS1_OIDS.has(sigAlgOid)) {
    const key = await crypto.subtle.importKey('spki', spkiDer, { name: 'RSASSA-PKCS1-v1_5', hash: hashName }, false, ['verify']);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bufferView(signatureBytes), signedRegion);
  }
  if (sigAlgOid === OID_RSA_PSS) {
    const params = pssParameters(signerInfo.signatureAlgorithm?.algorithmParams);
    const hash = params.hash ?? hashName;
    const saltLength = params.saltLength ?? hashedLength(hash);
    const key = await crypto.subtle.importKey('spki', spkiDer, { name: 'RSA-PSS', hash, mgf: { name: 'MGF-1', hash } }, false, ['verify']);
    return crypto.subtle.verify({ name: 'RSA-PSS', saltLength }, key, bufferView(signatureBytes), signedRegion);
  }
  if (keyAlgOid === OID_EC_PUBLIC_KEY && ECDSA_HASH_BY_OID.has(sigAlgOid)) {
    const ecHash = ECDSA_HASH_BY_OID.get(sigAlgOid);
    const pointSize = curvePointSize(cert, asn1jsLib);
    const inner = asn1jsLib.fromBER(bufferView(signatureBytes));
    if (inner.offset === -1) return null;
    const raw = pkijsLib.createECDSASignatureFromCMS(inner.result, pointSize);
    if (!raw || !raw.byteLength) return null;
    const namedCurve = curveNameForPointSize(pointSize);
    const key = await crypto.subtle.importKey('spki', spkiDer, { name: 'ECDSA', namedCurve, hash: ecHash }, false, ['verify']);
    return crypto.subtle.verify({ name: 'ECDSA', hash: ecHash }, key, raw, signedRegion);
  }
  if (keyAlgOid === OID_EC_PUBLIC_KEY && sigAlgOid === undefined) return null;
  return null; // Ed25519, DSA, GOST, ...: reported unreadable by the caller
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
 * Report an inspection failure without claiming that the document is unsigned.
 * @param {string} reason Inspection failure reason.
 * @returns {PdfSignatureReport}
 */
export function unreadableSignatureReport(reason) {
  return { signatures: [{
    fieldName: null, signer: null, signerOrganization: null, issuer: null,
    serial: null, notBefore: null, notAfter: null, signingTime: null,
    signingTimeSource: 'none', reason: null, location: null, subFilter: null,
    kind: 'approval', integrity: 'unreadable', integrityReason: reason,
    coversWholeFile: null, trust: 'not-checked'
  }] };
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
 * @param {any} parser pdf-lib PDFParser instance reading `bytes`.
 * @param {Uint8Array} bytes The parser's byte buffer.
 */
export function installIndirectObjectHeaderProbe(parser, bytes) {
  const len = bytes.length;
  if (typeof parser.matchIndirectObjectHeader !== 'function') return;
  const match = parser.matchIndirectObjectHeader;
  let ws = { from: -1, end: -1, to: -1 }; // every byte in [from, end) is whitespace and skips to `to`
  let run = { from: -1, end: -1, ok: false, finiteFrom: 0 }; // header verdict for digit run [from, end)
  let cmt = { from: -1, end: -1 }; // '%' at `from` starts a comment run ending at `end` (EOL position or len)
  // Mirrors BaseParser.skipWhitespaceAndComments. A memoized comment run jumps
  // straight to its known EOL: every '%' inside [from, end) shares that EOL
  // (no EOL byte occurs inside a comment), so rescanning is never needed.
  const skip = (i) => {
    while (i < len) {
      while (i < len && isPdfWhitespace(bytes[i])) i++;
      if (bytes[i] !== 37) break;
      if (i >= cmt.from && i < cmt.end) i = cmt.end;
      else {
        const cs = i;
        while (i < len && bytes[i] !== 10 && bytes[i] !== 13) i++;
        cmt = { from: cs, end: i };
      }
    }
    return i;
  };
  const digitsEnd = (i) => { while (i < len && isDigit(bytes[i])) i++; return i; };
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
    else if (isPdfWhitespace(bytes[i]) || bytes[i] === 37) {
      p = skip(i);
      let end = i;
      while (end < p && isPdfWhitespace(bytes[end])) end++;
      ws = { from: i, end, to: p };
    }
    if (!isDigit(bytes[p])) return false;
    if (p < run.from || p >= run.end) {
      const end = digitsEnd(p);
      const q = skip(end);
      const qEnd = digitsEnd(q);
      const r = skip(qEnd);
      const ok = qEnd > q && finiteFrom(q, qEnd) === q &&
        bytes[r] === 111 && bytes[r + 1] === 98 && bytes[r + 2] === 106; // "obj"
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
  let depth = 0;
  let count = 0;
  let decodedTotal = 0;
  const parseObject = parser.parseObject;
  parser.parseObject = function () {
    if (++depth > 128 || ++count > 1000000) throw new Error('PDF inspection complexity limit exceeded');
    try {
      const object = parseObject.call(this);
      if (object instanceof pdfLib.PDFRawStream && ['ObjStm', 'XRef'].includes(pdfText(object.dict.lookup(pdfLib.PDFName.of('Type'))))) {
        // Decode parser-owned streams under a memory budget before pdf-lib's
        // object/xref stream parsers consume them. Page/image streams stay opaque.
        const filter = object.dict.lookup(pdfLib.PDFName.of('Filter'));
        if (filter instanceof pdfLib.PDFArray && filter.size() > 1) throw new Error('Multiple structural stream filters require external inspection');
        const decoded = pdfLib.decodePDFRawStream(object);
        const maxDecoded = 8 * 1024 * 1024;
        const ensureBuffer = decoded.ensureBuffer;
        if (ensureBuffer) decoded.ensureBuffer = function (size) {
          if (size > maxDecoded) throw new Error('PDF structural stream exceeds the 8 MiB inspection limit');
          return ensureBuffer.call(this, size);
        };
        const content = decoded.decode();
        decodedTotal += content.length;
        if (content.length > maxDecoded || decodedTotal > 32 * 1024 * 1024) throw new Error('PDF structural stream inspection budget exceeded');
        const dict = object.dict.clone();
        dict.delete(pdfLib.PDFName.of('Filter'));
        dict.delete(pdfLib.PDFName.of('DecodeParms'));
        dict.set(pdfLib.PDFName.of('Length'), pdfLib.PDFNumber.of(content.length));
        return pdfLib.PDFRawStream.of(dict, content);
      }
      return object;
    } finally { depth--; }
  };
  const context = await parser.parseDocument();
  return { context, sourceSpans, parsedDicts };
}

/**
 * Collect signature information from PDF bytes. This is the pure parser - it
 * runs on any environment with WebCrypto (main thread, worker, Node). To
 * avoid blocking the main thread, application code should call
 * `getDocumentSignatures` from `utils/pdfSignatureInspector.js` instead,
 * which offloads this function to a worker.
 *
 * Never throws: inspection failures resolve to a document-level unreadable
 * report; per-signature problems become `unreadable`/`unsupported` entries.
 *
 * @param {Uint8Array|ArrayBuffer} pdfBytes Complete PDF document bytes.
 * @returns {Promise<PdfSignatureReport>}
 */
export async function collectPdfSignatures(pdfBytes) {
  const empty = { signatures: [] };
  let bytes;
  try {
    bytes = toUint8(pdfBytes);
  } catch {
    return empty;
  }
  // Never gate discovery on a header or strip leading bytes: ByteRange and
  // /Contents positions must be verified against the actual file.
  if (bytes.length > 64 * 1024 * 1024) return unreadableSignatureReport('PDF exceeds the 64 MiB signature inspection limit');

  let pdfLib;
  let pdfDoc;
  try {
    pdfLib = await import('pdf-lib');
    pdfDoc = await parseWithSourceSpans(bytes, pdfLib);
    if (pdfDoc.context.trailerInfo.Encrypt) return unreadableSignatureReport('Encrypted PDF signature inspection is unavailable');
  } catch (err) {
    return unreadableSignatureReport(`PDF structure cannot be inspected: ${String(err?.message ?? err)}`);
  }

  let discovered;
  try {
    discovered = discoverSignatures(pdfDoc, pdfLib);
  } catch (err) {
    return unreadableSignatureReport(`PDF signatures cannot be discovered: ${String(err?.message ?? err)}`);
  }
  if (!discovered.length) return empty;
  if (discovered.length > 256) return unreadableSignatureReport('PDF exceeds the 256 signature inspection limit');

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
      const info = unreadableSignatureReport(`Signature dictionary cannot be inspected: ${String(err?.message ?? err)}`).signatures[0];
      info.fieldName = item.fieldName;
      entries.push(info);
      contexts.push({ byteRange: null, contents: null, info });
    }
  }

  // Load the CMS stack only now - the document really has signature fields.
  let pkijsLib;
  let asn1jsLib;
  try {
    [pkijsLib, asn1jsLib] = await Promise.all([loadPkijs(), loadAsn1js()]);
  } catch (err) {
    for (const entry of entries) {
      if (entry.integrityReason === 'pending-verification') {
        entry.integrity = 'unreadable';
        entry.integrityReason = `signature stack unavailable: ${String(err?.message ?? err)}`;
      }
    }
    return { signatures: orderSignatures(entries, contexts) };
  }

  // A later signature may authorize an extension only after its own final verdict.
  const verificationOrder = contexts.map((_, i) => i).sort((a, b) =>
    ((contexts[b].byteRange?.[2] ?? 0) + (contexts[b].byteRange?.[3] ?? 0)) -
    ((contexts[a].byteRange?.[2] ?? 0) + (contexts[a].byteRange?.[3] ?? 0)));
  for (const i of verificationOrder) {
    try {
      await verifySignatureEntry(entries[i], contexts[i], bytes, pkijsLib, asn1jsLib, contexts);
    } catch (err) {
      entries[i].integrity = 'unreadable';
      entries[i].integrityReason = `unexpected verification failure: ${String(err?.message ?? err)}`;
    }
  }

  return { signatures: orderSignatures(entries, contexts) };
}
