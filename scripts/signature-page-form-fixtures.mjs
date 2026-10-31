// Synthetic page forms for timing the pdf.js differential confirmation
// (src/utils/pdfSignatureRenderCheck.js) on image-heavy documents. Every byte
// is produced in memory at run time with the throwaway fixture PKI; no real
// documents, scans, certificates or names.
//
// Forms (createPageFormFixtures):
// - text       45 text lines, vector graphics and one shared 256x256 RGB image
//              per page (createMultiPageFixtures);
// - flate-rgb  an A4 page scanned at 300 dpi: one distinct 2480x3508 DeviceRGB
//              8-bit FlateDecode image per page (a scan shares nothing between
//              pages);
// - jpeg       the same page form as DCTDecode, encoded by the baseline JPEG
//              encoder below (no dependency);
// - smask      a DeviceRGB FlateDecode image plus a DeviceGray FlateDecode soft
//              mask of the same size referenced through /SMask;
// - jpeg-text  the jpeg form with dark text-like strokes on the paper, so the
//              JPEG carries real edges (AC coefficients) like a scanned page.
//
// Every form returns the signed file, a DSS-only append (pdf.js must show the
// same document) and a content change on a late page (it must differ). For the
// image forms the change replaces the late page's image (smask: only its soft
// mask) with other pixels under the same object number and drawing operators.
//
// Object numbers: the DSS append writes /DSS on 20, certificates on 21 and
// OCSP on 22, so page objects must stay clear of 20-22. Page 1 reuses the base
// fixture's page 3 and content 6; page p > 1 is 2000 + 2(p - 1), its content
// 3000 + (p - 1), its image 1000 + (p - 1) and its soft mask 5000 + (p - 1).
import { deflateSync } from 'node:zlib';
import { baseSignedPdf, buildSignedData, signFile } from './generate-signature-fixtures.mjs';
import { appendDssRevision, appendRevision, createMultiPageFixtures, dssObjects, stream } from './signature-revision-fixtures.mjs';

/** A4 at 300 dpi. */
export const SCAN_WIDTH = 2480;
export const SCAN_HEIGHT = 3508;
export const PAGE_FORMS = Object.freeze(['text', 'flate-rgb', 'jpeg', 'smask', 'jpeg-text']);

const pageNum = (p) => (p === 1 ? 3 : 2000 + 2 * (p - 1));
const contentNum = (p) => (p === 1 ? 6 : 3000 + (p - 1));
const imageNum = (p) => 1000 + (p - 1);
const maskNum = (p) => 5000 + (p - 1);

/**
 * Paper-like RGB pixels: a smooth, row-correlated gradient (deflates small,
 * decodes to full pixels), distinct per seed. `strokes` adds dark text-like
 * bars on 40-pixel lines.
 */
export function scanPixels(seed, { width = SCAN_WIDTH, height = SCAN_HEIGHT, strokes = false } = {}) {
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    const line = Math.floor(y / 40);
    const inText = strokes && y % 40 >= 10 && y % 40 < 32 && line % 9 !== 0;
    const g = 210 + (((y >> 5) + seed * 3) % 30);
    for (let x = 0, i = y * width * 3; x < width; x++, i += 3) {
      let r = 200 + (((x >> 5) + seed) % 40);
      let gg = g;
      let b = 220 + ((((x + y) >> 6) + seed) % 30);
      if (inText && x > 150 && x < width - 150) {
        const glyph = Math.floor(x / 23);
        const h = (Math.imul(glyph * 31 + line, 2654435761) ^ seed) >>> 0;
        if (h % 5 !== 0 && (x % 23) < 3 + (h % 15)) { r = 30; gg = 30; b = 40; }
      }
      rgb[i] = r; rgb[i + 1] = gg; rgb[i + 2] = b;
    }
  }
  return rgb;
}

/** Smooth DeviceGray soft mask (a vignette), distinct per seed. */
export function maskPixels(seed, { width = SCAN_WIDTH, height = SCAN_HEIGHT } = {}) {
  const gray = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    const dy = Math.abs(y - height / 2) >> 4;
    for (let x = 0; x < width; x++) {
      gray[y * width + x] = 255 - ((dy + (Math.abs(x - width / 2) >> 4) + seed) % 120);
    }
  }
  return gray;
}

const imageDict = (colorSpace, filter, length, extra = '') =>
  `<< /Type /XObject /Subtype /Image /Width ${SCAN_WIDTH} /Height ${SCAN_HEIGHT} /ColorSpace /${colorSpace} /BitsPerComponent 8 /Filter /${filter}${extra} /Length ${length} >>`;
const imageObject = (dict, data) => `${dict}\nstream\n${data}\nendstream`;

function flateImage(seed, extra = '') {
  const data = deflateSync(scanPixels(seed)).toString('latin1');
  return imageObject(imageDict('DeviceRGB', 'FlateDecode', data.length, extra), data);
}

function jpegImage(seed, strokes) {
  const data = Buffer.from(encodeBaselineJpeg(scanPixels(seed, { strokes }), SCAN_WIDTH, SCAN_HEIGHT)).toString('latin1');
  return imageObject(imageDict('DeviceRGB', 'DCTDecode', data.length), data);
}

function maskImage(seed) {
  const data = deflateSync(maskPixels(seed)).toString('latin1');
  return imageObject(imageDict('DeviceGray', 'FlateDecode', data.length), data);
}

const scanPageText = (p) => `q 595 0 0 842 0 0 cm /Im1 Do Q\nBT /F1 10 Tf 20 20 Td (Scanned page ${p}) Tj ET`;

/**
 * Build one signed fixture of the given form and its two appended directions.
 * @param {Object} pki createFixturePki()
 * @param {string} form One of PAGE_FORMS.
 * @param {number} pageCount
 * @returns {Promise<{signed: Uint8Array, dss: Uint8Array, contentChanged: Uint8Array, changedPage: number}>}
 */
export async function createPageFormFixtures(pki, form, pageCount) {
  const late = Math.max(1, pageCount - 3);
  if (form === 'text') {
    const multi = await createMultiPageFixtures(pki, pageCount);
    return { signed: multi.signed, dss: multi.dss, contentChanged: multi.contentChanged, changedPage: late };
  }
  if (!PAGE_FORMS.includes(form)) throw new Error(`unknown page form ${form}`);
  const image = (p, seed = p) => {
    if (form === 'flate-rgb') return flateImage(seed);
    if (form === 'smask') return flateImage(p, ` /SMask ${maskNum(p)} 0 R`);
    return jpegImage(seed, form === 'jpeg-text');
  };
  const builder = baseSignedPdf({ fieldName: 'Signature1', visible: true,
    sigOptions: { subFilter: 'adbe.pkcs7.detached', nameLiteral: 'ODV Fixture Signer' } });
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
  builder.set(2, `<< /Type /Pages /Kids [${pages.map((p) => `${pageNum(p)} 0 R`).join(' ')}] /Count ${pageCount} >>`);
  for (const p of pages) {
    builder.set(pageNum(p), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 ${imageNum(p)} 0 R >> >> /Contents ${contentNum(p)} 0 R${p === 1 ? ' /Annots [7 0 R]' : ''} >>`);
    builder.set(contentNum(p), stream(scanPageText(p)));
    builder.set(imageNum(p), image(p));
    if (form === 'smask') builder.set(maskNum(p), maskImage(p));
  }
  const rev = builder.serialize({ trailerExtras: '/Info 9 0 R' });
  const signed = await signFile(rev.bytes, rev.offsets.get(8), (signedOverBytes) =>
    buildSignedData({ signer: pki.rsa, certificates: [pki.ca.cert], signedOverBytes }));
  const size = Math.max(23, ...pages.map((p) => (form === 'smask' ? maskNum(p) : imageNum(p)))) + 1;
  const changed = form === 'smask'
    ? { num: maskNum(late), body: maskImage(late + 1000) }
    : { num: imageNum(late), body: image(late, late + 1000) };
  return {
    signed,
    dss: appendDssRevision(signed, { size }),
    contentChanged: appendRevision(signed, [changed, ...dssObjects()], { size }).bytes,
    changedPage: late
  };
}

// ---------------------------------------------------------------------------
// Baseline JPEG encoder (ITU T.81, sequential Huffman, 8-bit, 3 components
// YCbCr 4:4:4, the Annex K example tables). Small and slow, for fixtures only.
// ---------------------------------------------------------------------------

const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const LUMA_Q = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const CHROMA_Q = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  ...new Array(32).fill(99)];
const AC_LUMA_VALUES = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
  0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
  0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
  0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa];
const AC_CHROMA_VALUES = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91,
  0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58,
  0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4,
  0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa];
const TABLES = {
  dcLuma: { bits: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], values: [...Array(12).keys()] },
  acLuma: { bits: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d], values: AC_LUMA_VALUES },
  dcChroma: { bits: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], values: [...Array(12).keys()] },
  acChroma: { bits: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77], values: AC_CHROMA_VALUES }
};
const NATURAL_TO_ZIGZAG = Int32Array.from({ length: 64 }, (_, n) => ZIGZAG.indexOf(n));
// cos[u * 8 + x] = 0.5 * C(u) * cos((2x + 1) u pi / 16)
const COS = Float64Array.from({ length: 64 }, (_, i) => {
  const u = i >> 3;
  return 0.5 * (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * (i & 7) + 1) * u * Math.PI) / 16);
});

function huffmanCodes({ bits, values }) {
  const codes = new Map();
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length++) {
    for (let i = 0; i < bits[length - 1]; i++) codes.set(values[k++], [code++, length]);
    code <<= 1;
  }
  return codes;
}

class BitWriter {
  constructor() {
    this.buf = new Uint8Array(1 << 20);
    this.at = 0;
    this.acc = 0;
    this.n = 0;
  }
  byte(b) {
    if (this.at === this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.at++] = b;
  }
  bytes(list) {
    for (const b of list) this.byte(b);
  }
  bits(value, length) {
    for (let i = length - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((value >> i) & 1);
      if (++this.n === 8) {
        this.byte(this.acc);
        if (this.acc === 0xff) this.byte(0); // byte stuffing
        this.acc = 0;
        this.n = 0;
      }
    }
  }
  flush() {
    if (this.n) this.bits(0x7f, 8 - this.n); // pad with 1-bits
  }
}

const u16 = (v) => [(v >> 8) & 0xff, v & 0xff];

/**
 * Encode 8-bit RGB pixels as a baseline JPEG (quality as the Annex K tables).
 * @param {Uint8Array} rgb width * height * 3 bytes.
 * @returns {Uint8Array}
 */
export function encodeBaselineJpeg(rgb, width, height) {
  const out = new BitWriter();
  out.bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]); // SOI, APP0 JFIF
  for (const [id, q] of [[0, LUMA_Q], [1, CHROMA_Q]]) out.bytes([0xff, 0xdb, 0, 67, id, ...ZIGZAG.map((z) => q[z])]);
  out.bytes([0xff, 0xc0, 0, 17, 8, ...u16(height), ...u16(width), 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]); // SOF0
  for (const [cls, table] of [[0x00, TABLES.dcLuma], [0x10, TABLES.acLuma], [0x01, TABLES.dcChroma], [0x11, TABLES.acChroma]]) {
    out.bytes([0xff, 0xc4, ...u16(3 + 16 + table.values.length), cls, ...table.bits, ...table.values]);
  }
  out.bytes([0xff, 0xda, 0, 12, 3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]); // SOS
  const components = [
    { q: LUMA_Q, dc: huffmanCodes(TABLES.dcLuma), ac: huffmanCodes(TABLES.acLuma), pred: 0 },
    { q: CHROMA_Q, dc: huffmanCodes(TABLES.dcChroma), ac: huffmanCodes(TABLES.acChroma), pred: 0 },
    { q: CHROMA_Q, dc: huffmanCodes(TABLES.dcChroma), ac: huffmanCodes(TABLES.acChroma), pred: 0 }
  ];
  const planes = [new Float64Array(64), new Float64Array(64), new Float64Array(64)];
  const tmp = new Float64Array(64);
  const zz = new Int32Array(64);
  const emit = (codes, symbol) => {
    const [code, length] = codes.get(symbol);
    out.bits(code, length);
  };
  const category = (v) => { let a = Math.abs(v); let s = 0; while (a) { s++; a >>= 1; } return s; };
  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      for (let y = 0; y < 8; y++) {
        const sy = Math.min(by + y, height - 1);
        for (let x = 0; x < 8; x++) {
          const i = (sy * width + Math.min(bx + x, width - 1)) * 3;
          const r = rgb[i]; const g = rgb[i + 1]; const b = rgb[i + 2];
          planes[0][y * 8 + x] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
          planes[1][y * 8 + x] = -0.168736 * r - 0.331264 * g + 0.5 * b;
          planes[2][y * 8 + x] = 0.5 * r - 0.418688 * g - 0.081312 * b;
        }
      }
      for (let c = 0; c < 3; c++) {
        const f = planes[c];
        const comp = components[c];
        for (let y = 0; y < 8; y++) { // rows: tmp[y][u]
          for (let u = 0; u < 8; u++) {
            let s = 0;
            for (let x = 0; x < 8; x++) s += COS[u * 8 + x] * f[y * 8 + x];
            tmp[y * 8 + u] = s;
          }
        }
        for (let v = 0; v < 8; v++) { // columns, quantize, zigzag
          for (let u = 0; u < 8; u++) {
            let s = 0;
            for (let y = 0; y < 8; y++) s += COS[v * 8 + y] * tmp[y * 8 + u];
            zz[NATURAL_TO_ZIGZAG[v * 8 + u]] = Math.round(s / comp.q[v * 8 + u]);
          }
        }
        const diff = zz[0] - comp.pred;
        comp.pred = zz[0];
        const dcSize = category(diff);
        emit(comp.dc, dcSize);
        if (dcSize) out.bits(diff < 0 ? diff + (1 << dcSize) - 1 : diff, dcSize);
        let run = 0;
        for (let k = 1; k < 64; k++) {
          const v = zz[k];
          if (!v) { run++; continue; }
          while (run > 15) { emit(comp.ac, 0xf0); run -= 16; }
          const size = category(v);
          emit(comp.ac, (run << 4) | size);
          out.bits(v < 0 ? v + (1 << size) - 1 : v, size);
          run = 0;
        }
        if (run) emit(comp.ac, 0x00);
      }
    }
  }
  out.flush();
  out.bytes([0xff, 0xd9]);
  return out.buf.subarray(0, out.at);
}
