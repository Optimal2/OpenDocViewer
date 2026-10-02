/**
 * PDF signature collection - level 1 integrity inspection.
 *
 * Reads digital signature information from PDF bytes and returns a stable
 * data contract (see docs-src/pdf-signatures.md). Level 1 answers exactly one
 * question per signature: is the content that the signature covered
 * byte-for-byte intact? Certificate chain building, revocation and trust are
 * level 2 (server-side) and will only fill the `trust` field later.
 *
 * The module is environment-agnostic: it runs on the main thread, inside a
 * web worker and in Node (tests). Heavy dependencies (pdf-lib, pkijs,
 * asn1js) are loaded through dynamic imports, so unsigned PDFs never pay for
 * the signature stack, and unexpected failures degrade to an empty or
 * per-signature `unreadable` report instead of throwing.
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
 * @property {'signed-attribute'|'pdf-M'|'none'} signingTimeSource Where
 * `signingTime` came from: the CMS signingTime signed attribute (for document
 * timestamps: the TSTInfo genTime), the PDF signature dictionary /M date, or
 * nowhere.
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
 * @property {'not-checked'} trust Always 'not-checked' at level 1; the field
 * is reserved for future server-side trust validation (level 2).
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

function indexOfAscii(bytes, ascii, from = 0) {
  if (bytes.length === 0 || ascii.length === 0) return -1;
  const first = ascii.charCodeAt(0);
  for (let i = from; i + ascii.length <= bytes.length; i += 1) {
    if (bytes[i] !== first) continue;
    let k = 1;
    while (k < ascii.length && bytes[i + k] === ascii.charCodeAt(k)) k += 1;
    if (k === ascii.length) return i;
  }
  return -1;
}

function hasAscii(bytes, ascii) {
  return indexOfAscii(bytes, ascii) !== -1;
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
  if (obj === null || obj === undefined) return null;
  const name = obj.constructor?.name;
  if (name === 'PDFHexString') return decodeTextBytes(obj.asBytes());
  if (name === 'PDFString') {
    const raw = obj.value ?? obj.toString?.() ?? '';
    const str = typeof raw === 'string' ? raw : String(raw);
    return str.charCodeAt(0) === 0xfeff ? str.slice(1) : str;
  }
  if (name === 'PDFName') {
    const str = typeof obj.value === 'string' ? obj.value : String(obj);
    return str.replace(/^\//, '');
  }
  return null;
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

function isDict(obj) {
  return obj?.constructor?.name === 'PDFDict';
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
    byteRangeRaw: sigDict.lookup(pdfLib.PDFName.of('ByteRange'), pdfLib.PDFArray),
    contentsRaw: sigDict.lookup(pdfLib.PDFName.of('Contents'))
  };
}

function readByteRange(brArray) {
  if (!brArray || typeof brArray.size !== 'function' || brArray.size() !== 4) return null;
  const values = [];
  for (let i = 0; i < 4; i += 1) {
    const num = brArray.lookup(i);
    const value = typeof num?.asNumber === 'function' ? num.asNumber() : Number(num?.value);
    if (!Number.isFinite(value)) return null;
    values.push(value);
  }
  return values;
}

function contentsToBytes(contents, pdfLib) {
  if (!contents) return null;
  const name = contents.constructor?.name;
  if (name === 'PDFHexString') return contents.asBytes();
  if (name === 'PDFString') {
    const raw = contents.value ?? '';
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i) & 0xff;
    return out;
  }
  if (pdfLib.PDFRawStream && contents instanceof pdfLib.PDFRawStream) {
    return contents.contents();
  }
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
  for (const [ref, obj] of pdfDoc.context.enumerateIndirectObjects()) {
    indirect.push({ ref: String(ref), obj });
  }

  /** @type {Map<string, {sigDict: any, fieldDict: any|null}>} */
  const found = new Map();

  // Fields (/FT /Sig) referencing their /V (or /DV) signature dictionary.
  for (const { obj } of indirect) {
    if (!isDict(obj)) continue;
    const ft = pdfText(obj.lookup(PDFName.of('FT')));
    if (ft !== 'Sig') continue;
    const v = obj.lookup(PDFName.of('V'), pdfLib.PDFDict) ?? obj.lookup(PDFName.of('DV'), pdfLib.PDFDict);
    if (isDict(v) && (dictHas(v, pdfLib, 'ByteRange') || pdfText(v.lookup(PDFName.of('Type'))) === 'Sig' || dictHas(v, pdfLib, 'SubFilter'))) {
      found.set(objectKey(v), { sigDict: v, fieldDict: obj });
    }
  }
  // Bare signature dictionaries (not referenced by any field).
  for (const { obj } of indirect) {
    if (!isDict(obj)) continue;
    const type = pdfText(obj.lookup(PDFName.of('Type')));
    if (type === 'Sig' || (dictHas(obj, pdfLib, 'ByteRange') && dictHas(obj, pdfLib, 'Contents'))) {
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
  while (isDict(current) && guard < 12) {
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

function dictionaryInfo(item, bytes, pdfLib) {
  const fields = signatureDictFields(item.sigDict, pdfLib);
  const byteRange = readByteRange(fields.byteRangeRaw);
  const contents = contentsToBytes(fields.contentsRaw, pdfLib);

  const coversWholeFile = byteRange
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
  if (!byteRange) {
    info.integrityReason = 'signature present, /ByteRange missing or malformed';
    return { info, ctx: { byteRange, contents, mDate, fields } };
  }
  info.integrity = 'intact'; // provisional; replaced by verification result below
  info.integrityReason = 'pending-verification';
  return { info, ctx: { byteRange, contents, mDate, fields } };
}

function coveredBytes(bytes, byteRange) {
  const [a, b, c, d] = byteRange;
  const from1 = Math.max(0, Math.min(a, bytes.length));
  const to1 = Math.max(from1, Math.min(a + b, bytes.length));
  const from2 = Math.max(to1, Math.min(c, bytes.length));
  const to2 = Math.max(from2, Math.min(c + d, bytes.length));
  const out = new Uint8Array(to1 - from1 + to2 - from2);
  out.set(bytes.subarray(from1, to1), 0);
  out.set(bytes.subarray(from2, to2), to1 - from1);
  return out;
}

function extensionCoveredByLaterSignature(self, all, fileLength) {
  const selfEnd = self.byteRange[2] + self.byteRange[3];
  return all.some(
    (other) =>
      other !== self &&
      other.byteRange &&
      other.byteRange[0] === 0 &&
      other.byteRange[2] >= selfEnd &&
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

function matchCertificate(signedData, signerInfo) {
  const certs = (signedData.certificates ?? []).filter((c) => c?.serialNumber);
  if (!certs.length) return null;
  const sid = signerInfo.sid;
  const sidSerialHex = sid?.serialNumber ? elementBytesToHex(sid.serialNumber) : null;
  if (sidSerialHex) {
    const want = normalizeSerialHex(new Uint8Array(asn1HexToBytes(sidSerialHex)));
    const match = certs.find((c) => normalizeSerialHex(new Uint8Array(asn1HexToBytes(elementBytesToHex(c.serialNumber) ?? ''))) === want);
    if (match) return match;
  }
  return certs[0];
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

  // --- parse CMS -----------------------------------------------------------
  let signedData;
  let contentInfo;
  try {
    const der = asn1jsLib.fromBER(bufferView(ctx.contents));
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
  if (!signerInfo) {
    info.integrity = 'unreadable';
    info.integrityReason = 'signature present, CMS has no signer information';
    return;
  }

  // --- certificate identity -------------------------------------------------
  const cert = matchCertificate(signedData, signerInfo);
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
  let documentDigestMissingSource = null;

  if (isTimestamp || eContentType === OID_TST_INFO) {
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
    if (!eContentBytes || eContentBytes.length < 16) {
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
  } else {
    // Detached: the signed messageDigest attribute must match.
    const mdAttr = findAttribute(signerInfo.signedAttrs, OID_ATTR_MESSAGE_DIGEST);
    const mdBytes = attrRawBytes(mdAttr);
    if (!mdBytes) {
      documentDigestMissingSource = 'CMS signed attributes contain no messageDigest';
    } else {
      const actual = await subtleDigest(hashName, signedBytes);
      documentDigestOk = bytesEqual(actual, mdBytes);
      if (!documentDigestOk) {
        info.integrity = 'digest-mismatch';
        info.integrityReason = 'document digest does not match the signed messageDigest (content changed after signing)';
        return;
      }
    }
  }

  // --- signing time from CMS attribute --------------------------------------
  const signingTimeAttr = findAttribute(signerInfo.signedAttrs, OID_ATTR_SIGNING_TIME);
  const signingTimeDate = attrDate(signingTimeAttr);
  if (signingTimeDate) {
    info.signingTime = isoOrNull(signingTimeDate);
    info.signingTimeSource = 'signed-attribute';
  } else if (documentDigestMissingSource) {
    info.integrity = 'unreadable';
    info.integrityReason = documentDigestMissingSource;
    return;
  }

  // --- signature value over the signed attributes ----------------------------
  const sigAlgOid = signerInfo.signatureAlgorithm?.algorithmId;
  let signedRegion;
  if (signerInfo.signedAttrs?.attributes?.length && signerInfo.signedAttrs.encodedValue?.byteLength) {
    signedRegion = signerInfo.signedAttrs.encodedValue; // pkijs patched tag to SET OF
  } else if (eContentBytes) {
    signedRegion = bufferView(eContentBytes);
  } else if (signerInfo.signedAttrs?.attributes?.length) {
    signedRegion = signerInfo.signedAttrs.toSchema().toBER(false);
  } else {
    signedRegion = bufferView(signedBytes);
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
 * Collect signature information from PDF bytes. This is the pure parser - it
 * runs on any environment with WebCrypto (main thread, worker, Node). To
 * avoid blocking the main thread, application code should call
 * `getDocumentSignatures` from `utils/pdfSignatureInspector.js` instead,
 * which offloads this function to a worker.
 *
 * Never throws: unexpected failures resolve to an empty report; per-signature
 * problems become `unreadable`/`unsupported` entries.
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
  if (bytes.length < 9 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== '%PDF') {
    return empty;
  }
  // Cheap pre-check: unsigned PDFs stop here without loading anything else.
  if (!hasAscii(bytes, '/ByteRange') && !hasAscii(bytes, '/SubFilter')) {
    return empty;
  }

  let pdfLib;
  let pdfDoc;
  try {
    pdfLib = await import('pdf-lib');
    const { PDFDocument } = pdfLib;
    pdfDoc = await PDFDocument.load(bytes.slice(), { updateMetadata: false, ignoreEncryption: true });
  } catch {
    return empty; // unreadable document structure: nothing we can honestly report
  }

  let discovered;
  try {
    discovered = discoverSignatures(pdfDoc, pdfLib);
  } catch {
    return empty;
  }
  if (!discovered.length) return empty;

  /** @type {PdfSignatureInfo[]} */
  const entries = [];
  /** @type {any[]} */
  const contexts = [];
  for (const item of discovered) {
    const { info, ctx } = dictionaryInfo(item, bytes, pdfLib);
    entries.push(info);
    contexts.push(ctx);
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

  for (let i = 0; i < contexts.length; i += 1) {
    try {
      await verifySignatureEntry(entries[i], contexts[i], bytes, pkijsLib, asn1jsLib, contexts);
    } catch (err) {
      entries[i].integrity = 'unreadable';
      entries[i].integrityReason = `unexpected verification failure: ${String(err?.message ?? err)}`;
    }
  }

  return { signatures: orderSignatures(entries, contexts) };
}
