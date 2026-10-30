/**
 * pdf.js differential confirmation for appended revisions.
 *
 * The appended-revision classifier (utils/pdfSignatureRevisions.js) reasons
 * over pdf-lib's object graph, while the viewer renders with pdf.js. A green
 * verdict for a signature whose ByteRange ends at E before the end of the file
 * is therefore only final once pdf.js itself, loading the signed revision
 * (bytes 0..E) and the full file, produces the same document: page count and
 * per page geometry, operator list, annotations, text content and page
 * actions, plus the document-level form fields, JavaScript actions, open
 * action, attachments, outline, destinations, page labels and optional content.
 *
 * pdf.js object ids (fonts, images, patterns) are per loaded document, so the
 * comparison replaces every id with its order of first use and appends the
 * resolved object's data; a renumbered but identical resource does not differ.
 * The only difference a validation-data append may add is an invisible
 * document-timestamp signature widget and its signature field; such widgets and
 * signature-typed form fields are left out on both sides.
 *
 * Anything that prevents a complete comparison (pdf.js cannot load a revision,
 * an exception, a page or time budget) is `unavailable`, never `same`.
 * Rules and limits: docs-src/pdf-signatures.md "pdf.js differential confirmation".
 *
 * @module utils/pdfSignatureRenderCheck
 */

/** Wall-clock budget for one comparison (both revisions), in ms. */
export const RENDER_CHECK_BUDGET_MS = 20000;
/** Page budget: larger documents are not compared (fail closed). */
export const RENDER_CHECK_MAX_PAGES = 1000;

const ANNOTATION_WIDGET = 20;
const ANNOT_FLAG_HIDDEN = 2;
const ANNOT_FLAG_NOVIEW = 32;
const MAX_DEPTH = 64;
// Per-document pdf.js object ids: fonts g_d0_f1, images/masks/patterns
// img_p0_1 or g_d0_img_p0_1 (globally cached).
const RESOURCE_ID = /^(?:g_d\d+_f\d+|(?:g_d\d+_)?(?:img|mask|pattern)_p\d+_\d+)$/;
// Font properties that decide how glyphs are drawn (FontFaceObject getters).
const FONT_KEYS = ['black', 'bold', 'italic', 'isInvalidPDFjsFont', 'isType3Font', 'missingFile', 'remeasure',
  'vertical', 'bbox', 'fontMatrix', 'fallbackName', 'mimetype', 'data', 'charProcOperatorList'];

/** Raised for anything that prevents a complete comparison. */
class RenderCheckError extends Error {
  /** @param {'timeout'|'inspection-limit'|'viewer-error'} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * @typedef {Object} RenderCheckResult
 * @property {'same'|'different'|'unavailable'} outcome
 * @property {string} detail English detail line.
 * @property {('timeout'|'inspection-limit'|'viewer-error')} [code] Set for `unavailable`.
 */

/**
 * Map a comparison result to a signature verdict. `same` returns null (the
 * classifier's green verdict stands); everything else is never green.
 * @param {RenderCheckResult} check
 * @returns {({integrity: string, code: string, reason: string}|null)}
 */
export function renderCheckVerdict(check) {
  if (check?.outcome === 'same') return null;
  if (check?.outcome === 'different') {
    return { integrity: 'modified-after-signing', code: 'content-changed-after-signing',
      reason: `pdf.js shows different content in the final file than in the signed revision (${check.detail})` };
  }
  const code = ['timeout', 'inspection-limit', 'viewer-error'].includes(check?.code) ? check.code : 'viewer-error';
  return { integrity: 'indeterminate', code,
    reason: `the file was extended after signing and the pdf.js comparison with the signed revision could not be completed (${check?.detail ?? 'no result'})` };
}

/**
 * @typedef {Object} RenderComparator
 * @property {Function} compare `(signedEnd) => Promise<RenderCheckResult>`; never rejects.
 * @property {Function} destroy `() => Promise<void>`; releases every pdf.js document.
 */

/**
 * Create a comparator for one file. The full file is loaded once and its
 * fingerprints are cached, so several signatures can be compared against it.
 *
 * @param {Uint8Array} bytes Complete file bytes (never transferred or modified).
 * @param {Object} [options]
 * @param {Function} [options.loadPdfjs] Resolves to the pdf.js module (the viewer's build).
 * @param {Object} [options.documentOptions] Extra getDocument options (the viewer's options).
 * @param {number} [options.budgetMs] Wall-clock budget per comparison.
 * @param {number} [options.maxPages] Page budget.
 * @returns {RenderComparator}
 */
export function createRenderComparator(bytes, options = {}) {
  const loadPdfjs = options.loadPdfjs ?? (() => import('pdfjs-dist/legacy/build/pdf.mjs'));
  const budgetMs = Number.isFinite(options.budgetMs) && options.budgetMs > 0 ? options.budgetMs : RENDER_CHECK_BUDGET_MS;
  const maxPages = Number.isFinite(options.maxPages) && options.maxPages > 0 ? options.maxPages : RENDER_CHECK_MAX_PAGES;
  const tasks = new Set();
  let full = null;

  async function open(data) {
    const pdfjs = await loadPdfjs();
    if (typeof pdfjs?.getDocument !== 'function') throw new RenderCheckError('viewer-error', 'pdf.js is unavailable');
    const task = pdfjs.getDocument({
      ...(options.documentOptions || {}),
      data,
      // Decoded image pixels and font programs must stay readable for the comparison.
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      fontExtraProperties: true,
      verbosity: pdfjs.VerbosityLevel?.ERRORS ?? 0
    });
    tasks.add(task);
    const doc = await task.promise;
    return fingerprinted(doc, () => { tasks.delete(task); return task.destroy(); });
  }

  async function compareAll(signedEnd, deadline) {
    if (!Number.isSafeInteger(signedEnd) || signedEnd <= 0 || signedEnd >= bytes.length) {
      throw new RenderCheckError('viewer-error', 'the signed range does not end inside the file');
    }
    full ??= open(bytes.slice());
    const finalDoc = await full;
    const signedDoc = await open(bytes.slice(0, signedEnd));
    try {
      if (signedDoc.numPages !== finalDoc.numPages) {
        return { outcome: 'different', detail: `page count ${signedDoc.numPages} -> ${finalDoc.numPages}` };
      }
      if (finalDoc.numPages > maxPages) {
        throw new RenderCheckError('inspection-limit', `more than ${maxPages} pages`);
      }
      const [a, b] = await Promise.all([signedDoc.documentDigests(), finalDoc.documentDigests()]);
      const docDiff = firstDifference(a, b);
      if (docDiff) return { outcome: 'different', detail: `document ${docDiff}` };
      for (let i = 0; i < finalDoc.numPages; i++) {
        if (Date.now() > deadline) throw new RenderCheckError('timeout', `time budget of ${budgetMs} ms exceeded`);
        const [pa, pb] = await Promise.all([signedDoc.pageDigests(i), finalDoc.pageDigests(i)]);
        const pageDiff = firstDifference(pa, pb);
        if (pageDiff) return { outcome: 'different', detail: `page ${i + 1} ${pageDiff}` };
      }
      return { outcome: 'same', detail: `${finalDoc.numPages} page(s) identical in pdf.js` };
    } finally {
      await signedDoc.destroy();
    }
  }

  return {
    async compare(signedEnd) {
      const deadline = Date.now() + budgetMs;
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new RenderCheckError('timeout', `time budget of ${budgetMs} ms exceeded`)), budgetMs);
      });
      const work = compareAll(signedEnd, deadline);
      work.catch(() => {}); // still settles after a timeout; the race already decided
      try {
        return await Promise.race([work, timeout]);
      } catch (err) {
        const code = err instanceof RenderCheckError ? err.code : 'viewer-error';
        if (code === 'timeout') await this.destroy();
        return { outcome: 'unavailable', code, detail: String(err?.message ?? err) };
      } finally {
        clearTimeout(timer);
      }
    },
    async destroy() {
      full = null;
      const pending = [...tasks];
      tasks.clear();
      await Promise.allSettled(pending.map((task) => task.destroy()));
    }
  };
}

function firstDifference(a, b) {
  for (const key of Object.keys(a)) if (a[key] !== b[key]) return key;
  return null;
}

/** Wrap a loaded pdf.js document with cached, id-independent digests. */
function fingerprinted(doc, destroy) {
  const pages = new Map();
  let documentLevel = null;
  return {
    numPages: doc.numPages,
    destroy,
    documentDigests() {
      documentLevel ??= documentDigests(doc);
      return documentLevel;
    },
    pageDigests(index) {
      if (!pages.has(index)) pages.set(index, pageDigests(doc, index));
      return pages.get(index);
    }
  };
}

async function documentDigests(doc) {
  const fields = await doc.getFieldObjects();
  const optional = await doc.getOptionalContentConfig({ intent: 'display' });
  const groups = [];
  for (const [id, group] of optional) {
    groups.push({ id, name: group.name, intent: group.intent, usage: group.usage, visible: group.visible });
  }
  const sections = {
    'form fields': withoutSignatureFields(fields),
    'JavaScript actions': await doc.getJSActions(),
    'open action': await doc.getOpenAction(),
    attachments: await doc.getAttachments(),
    outline: await doc.getOutline(),
    destinations: await doc.getDestinations(),
    'page labels': await doc.getPageLabels(),
    'optional content': { name: optional.name, creator: optional.creator, order: optional.getOrder(), groups }
  };
  const digests = {};
  for (const [key, value] of Object.entries(sections)) digests[key] = await digest(encode(value));
  return digests;
}

async function pageDigests(doc, index) {
  const page = await doc.getPage(index + 1);
  try {
    const operators = await page.getOperatorList();
    const text = await page.getTextContent();
    const annotations = await page.getAnnotations({ intent: 'display' });
    const labels = new Labels();
    const ops = new Encoder(labels);
    ops.value({ fn: operators.fnArray, args: operators.argsArray });
    const textEncoder = new Encoder(labels);
    textEncoder.value(text);
    // Resolved resources are part of the drawing: append them in label order.
    for (let i = 0; i < labels.ids.length; i++) {
      ops.value(resourceValue(await resolveResource(page, labels.ids[i])));
    }
    return {
      geometry: await digest(encode({ view: page.view, rotate: page.rotate, userUnit: page.userUnit })),
      'operator list': await digest(ops.bytes()),
      annotations: await digest(encode(annotations.filter((a) => !isInvisibleSignatureWidget(a)))),
      'text content': await digest(textEncoder.bytes()),
      'page actions': await digest(encode(await page.getJSActions()))
    };
  } finally {
    page.cleanup();
  }
}

/** A widget a document-timestamp append may add: a signature field that shows nothing. */
function isInvisibleSignatureWidget(a) {
  if (a?.annotationType !== ANNOTATION_WIDGET || a.fieldType !== 'Sig') return false;
  if (a.actions || a.action || a.url || a.dest || a.unsafeUrl) return false;
  const hidden = ((a.annotationFlags ?? 0) & (ANNOT_FLAG_HIDDEN | ANNOT_FLAG_NOVIEW)) !== 0;
  const r = a.rect;
  const zeroArea = Array.isArray(r) && r.length === 4 && (r[0] === r[2] || r[1] === r[3]);
  return hidden || zeroArea;
}

/** Signature-typed form fields are dropped; what they show is in the page annotations. */
function withoutSignatureFields(fields) {
  if (!fields) return null;
  const out = {};
  for (const name of Object.keys(fields).sort()) {
    const kept = (fields[name] || []).filter((entry) => entry?.type !== 'signature');
    if (kept.length) out[name] = kept;
  }
  return out;
}

function resolveResource(page, id) {
  for (const objs of [page.commonObjs, page.objs]) {
    if (objs?.has(id)) return Promise.resolve(objs.get(id));
  }
  // Not resolved yet: whichever container receives it first (the caller's budget bounds the wait).
  return new Promise((resolve) => {
    page.commonObjs?.get(id, resolve);
    page.objs?.get(id, resolve);
  });
}

/** Plain data for a resolved pdf.js object; fonts expose their state through getters. */
function resourceValue(obj) {
  if (obj && typeof obj === 'object' && 'fontMatrix' in obj && 'loadedName' in obj) {
    const font = {};
    for (const key of FONT_KEYS) font[key] = obj[key];
    return { font };
  }
  if (typeof ImageBitmap !== 'undefined' && obj?.bitmap instanceof ImageBitmap) {
    throw new RenderCheckError('viewer-error', 'image data is not readable');
  }
  return obj;
}

/** Ids are numbered in order of first use per page. */
class Labels {
  constructor() {
    this.ids = [];
    this.map = new Map();
  }
  label(id) {
    if (!this.map.has(id)) {
      this.map.set(id, this.ids.length);
      this.ids.push(id);
    }
    return this.map.get(id);
  }
}

function encode(value) {
  const encoder = new Encoder(null);
  encoder.value(value);
  return encoder.bytes();
}

/**
 * Deterministic, type-tagged binary encoding of structured-clone data, written
 * into one growing buffer. Object keys are sorted; anything that is not plain
 * data cannot be compared and fails closed.
 */
class Encoder {
  constructor(labels) {
    this.labels = labels;
    this.buf = new Uint8Array(1 << 16);
    this.view = new DataView(this.buf.buffer);
    this.at = 0;
    this.text = new TextEncoder();
    this.strings = new Map(); // repeated keys and names are encoded once
  }
  reserve(n) {
    if (this.at + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.at + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.at));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  tag(code, length = null) {
    this.reserve(5);
    this.buf[this.at++] = code;
    if (length !== null) { this.view.setUint32(this.at, length >>> 0); this.at += 4; }
  }
  raw(bytes) {
    this.tag(0x23, bytes.byteLength); // #
    this.reserve(bytes.byteLength);
    this.buf.set(bytes, this.at);
    this.at += bytes.byteLength;
  }
  string(s) {
    if (this.labels && RESOURCE_ID.test(s)) return this.tag(0x52, this.labels.label(s)); // R
    let encoded = this.strings.get(s);
    if (!encoded) {
      encoded = this.text.encode(s);
      if (s.length <= 64) this.strings.set(s, encoded);
    }
    this.tag(0x73); // s
    return this.raw(encoded);
  }
  value(v, depth = 0) {
    if (depth > MAX_DEPTH) throw new RenderCheckError('inspection-limit', 'pdf.js data nested too deeply');
    if (v === null) return this.tag(0x6e);
    if (v === undefined) return this.tag(0x75);
    if (typeof v === 'boolean') return this.tag(v ? 0x54 : 0x46);
    if (typeof v === 'number') {
      this.tag(0x64);
      this.reserve(8);
      this.view.setFloat64(this.at, v);
      this.at += 8;
      return undefined;
    }
    if (typeof v === 'bigint') return this.string(`${v}n`);
    if (typeof v === 'string') return this.string(v);
    if (ArrayBuffer.isView(v)) {
      this.tag(0x62);
      this.string(v.constructor?.name ?? 'view');
      return this.raw(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    }
    if (v instanceof ArrayBuffer) {
      this.tag(0x42);
      return this.raw(new Uint8Array(v));
    }
    if (Array.isArray(v)) {
      this.tag(0x61, v.length);
      for (const item of v) this.value(item, depth + 1);
      return undefined;
    }
    if (v instanceof Map) {
      this.tag(0x6d, v.size);
      for (const [key, item] of v) { this.value(key, depth + 1); this.value(item, depth + 1); }
      return undefined;
    }
    if (v instanceof Set) {
      this.tag(0x53, v.size);
      for (const item of v) this.value(item, depth + 1);
      return undefined;
    }
    const proto = typeof v === 'object' ? Object.getPrototypeOf(v) : undefined;
    if (proto === Object.prototype || proto === null) {
      const keys = Object.keys(v).sort();
      this.tag(0x6f, keys.length);
      for (const key of keys) { this.string(key); this.value(v[key], depth + 1); }
      return undefined;
    }
    throw new RenderCheckError('viewer-error', `pdf.js returned data that cannot be compared (${typeof v})`);
  }
  bytes() {
    return this.buf.subarray(0, this.at);
  }
}

async function digest(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new RenderCheckError('viewer-error', 'WebCrypto is unavailable');
  const hash = new Uint8Array(await subtle.digest('SHA-256', bytes));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}
