/**
 * Appended-revision classifier for PDF signatures.
 *
 * A signature whose ByteRange does not reach the end of the file was followed
 * by one or more incremental updates. This module decides what those unsigned
 * updates changed, comparing the final state NET against the state at the end
 * of the signed range (E):
 *
 * - only validation data or metadata (catalog `/DSS`, `/Metadata`,
 *   `/Extensions`, trailer `/Info`, invisible document timestamp fields, or a
 *   byte-identical rewrite) -> `intact` / `extended-with-validation-data`;
 * - signed content (pages, content streams, annotations, form fields, other
 *   catalog entries, deleted objects) -> `modified-after-signing` /
 *   `content-changed-after-signing`;
 * - anything it cannot classify with certainty (broken revision chain,
 *   cross-reference data that disagrees with the parsed objects, orphan
 *   objects, missing parser hooks) -> `modified-after-signing` /
 *   `unclassified-change-after-signing`.
 *
 * pdf-lib resolves "the last physical definition wins" while pdf.js follows
 * the signed revision's active /Prev chain, nearest entry first. The
 * cross-reference consistency check rejects unlinked pre-E sections and makes
 * both views agree before any object is compared, so a shadow object cannot
 * make a content change look harmless. Rules: docs-src/pdf-signatures.md
 * "Appended revisions".
 *
 * @module utils/pdfSignatureRevisions
 */

/**
 * @typedef {Object} RevisionVerdict
 * @property {'intact'|'modified-after-signing'} integrity
 * @property {'extended-with-validation-data'|'content-changed-after-signing'|'unclassified-change-after-signing'} code
 * @property {string} reason English detail line.
 */

/** Catalog entries an unsigned update may add or change without touching content. */
const EXEMPT_CATALOG_KEYS = ['DSS', 'Metadata', 'Extensions'];
/** Keys a new document-timestamp field (merged with its widget) may carry. */
const DTS_FIELD_KEYS = new Set(['Type', 'Subtype', 'FT', 'T', 'TU', 'TM', 'V', 'P', 'Rect', 'F', 'Ff', 'Kids', 'M', 'NM']);
/** Keys a separate widget of a new document-timestamp field may carry. */
const DTS_WIDGET_KEYS = new Set(['Type', 'Subtype', 'Parent', 'P', 'Rect', 'F', 'M', 'NM']);
const ANNOT_FLAG_HIDDEN = 2;
const ANNOT_FLAG_NOVIEW = 32;
const MAX_REACHABLE = 100000; // objects, the same cap as signature discovery
const MAX_VALUE_VISITS = 50 * MAX_REACHABLE;
const MAX_XREF_ENTRIES = 1000000;

/**
 * Create an empty revision log. `hooked` stays false unless every parser hook
 * could be installed; the classifier never returns green for an unhooked log.
 */
export function createRevisionLog() {
  return {
    hooked: false,
    shapeError: null,
    unattributed: false,
    // Object definitions {num, start, object, container} in assign order (pdf-lib's view).
    records: [],
    // ObjStm / XRef stream containers: {num, start, type, members}.
    structural: [],
    // Cross-reference sections: {offset, kind, entries|null, dict|null, content|null, trailer}.
    xrefs: [],
    // Trailer dictionaries: {offset, dict, section}.
    trailers: [],
    // startxref keywords: {at, value}.
    startxrefs: [],
    current: null,
    /**
     * Called by the structural-stream decoder for a top-level ObjStm/XRef stream.
     * @param {'ObjStm'|'XRef'} type
     * @param {any} dict Original stream dictionary (with /DecodeParms).
     * @param {Uint8Array} content Filter-decoded stream data.
     * @param {number} depth Parser object depth (1 = top level of an indirect object).
     */
    noteStream(type, dict, content, depth) {
      const rec = this.current;
      if (!rec || depth !== 1 || rec.type) return;
      rec.type = type;
      rec.dict = dict;
      rec.content = content;
    }
  };
}

/**
 * Install the revision-log hooks on a pdf-lib PDFParser INSTANCE (never on a
 * prototype). When the parser does not have the expected shape (a different
 * pdf-lib build, design flag F-f) nothing is installed and `log.hooked` stays
 * false, so the classifier reports a warning instead of guessing.
 * Must run after any other `context.assign` hook so records see the final object.
 *
 * @param {any} parser pdf-lib PDFParser instance.
 * @param {Object} log Revision log from createRevisionLog().
 */
export function installRevisionLogHooks(parser, log) {
  const methods = ['parseIndirectObject', 'maybeParseCrossRefSection', 'maybeParseTrailerDict',
    'maybeParseTrailer', 'parseDict', 'skipWhitespaceAndComments'];
  if (methods.some((m) => typeof parser?.[m] !== 'function') ||
    typeof parser.bytes?.offset !== 'function' || typeof parser.context?.assign !== 'function') return;

  const parseIndirectObject = parser.parseIndirectObject;
  parser.parseIndirectObject = async function () {
    const rec = { num: null, start: this.bytes.offset(), type: null, members: new Map() };
    log.current = rec;
    try {
      const ref = await parseIndirectObject.call(this);
      rec.num = typeof ref?.objectNumber === 'number' ? ref.objectNumber : null;
      if (rec.num === null) log.shapeError ??= 'indirect object without a reference';
      if (rec.type === 'ObjStm') log.structural.push(rec);
      if (rec.type === 'XRef') {
        log.structural.push(rec);
        log.xrefs.push({ offset: rec.start, kind: 'stream', entries: null, dict: rec.dict, content: rec.content, trailer: rec.dict });
      }
      return ref;
    } finally { log.current = null; }
  };

  const assign = parser.context.assign;
  parser.context.assign = function (ref, object) {
    const rec = log.current;
    if (!rec || typeof ref?.objectNumber !== 'number') log.unattributed = true;
    else {
      const inStream = rec.type === 'ObjStm';
      if (inStream) rec.members.set(ref.objectNumber, (rec.members.get(ref.objectNumber) ?? 0) + 1);
      log.records.push({ num: ref.objectNumber, start: rec.start, object, container: inStream ? rec : null });
    }
    return assign.call(this, ref, object);
  };

  const parseXref = parser.maybeParseCrossRefSection;
  parser.maybeParseCrossRefSection = function () {
    this.skipWhitespaceAndComments();
    const offset = this.bytes.offset();
    const section = parseXref.call(this);
    if (section) {
      if (!Array.isArray(section.subsections)) log.shapeError ??= 'cross-reference section shape';
      else {
        const entries = [];
        for (const sub of section.subsections) {
          for (const e of sub) {
            entries.push({ num: e.ref.objectNumber, type: e.deleted ? 0 : 1, offset: e.offset });
          }
        }
        log.xrefs.push({ offset, kind: 'table', entries, dict: null, content: null, trailer: null });
      }
    }
    return section;
  };

  let trailerDict = null;
  let inTrailer = false;
  const parseDict = parser.parseDict;
  parser.parseDict = function () {
    const dict = parseDict.call(this);
    if (inTrailer) trailerDict = dict; // the outermost dictionary returns last
    return dict;
  };
  const parseTrailerDict = parser.maybeParseTrailerDict;
  parser.maybeParseTrailerDict = function () {
    this.skipWhitespaceAndComments();
    const offset = this.bytes.offset();
    trailerDict = null;
    inTrailer = true;
    let result;
    try { result = parseTrailerDict.call(this); } finally { inTrailer = false; }
    if (trailerDict) {
      const last = log.xrefs.at(-1);
      const lastStartxref = log.startxrefs.at(-1);
      const owner = last && last.kind === 'table' && !last.trailer && last.offset < offset &&
        !(lastStartxref && lastStartxref.at > last.offset) ? last : null;
      if (owner) owner.trailer = trailerDict;
      log.trailers.push({ offset, dict: trailerDict, section: owner });
    }
    return result;
  };

  const parseTrailer = parser.maybeParseTrailer;
  parser.maybeParseTrailer = function () {
    this.skipWhitespaceAndComments();
    const at = this.bytes.offset();
    const trailer = parseTrailer.call(this);
    if (trailer) {
      const value = Number(trailer.lastXRefOffset);
      if (!Number.isSafeInteger(value)) log.shapeError ??= 'startxref shape';
      else log.startxrefs.push({ at, value });
    }
    return trailer;
  };

  log.hooked = true;
}

class Verdict {
  /** @param {RevisionVerdict} result */
  constructor(result) { this.result = result; }
}
const unclassified = (reason) => ({ integrity: 'modified-after-signing', code: 'unclassified-change-after-signing',
  reason: `file was extended after signing and the change cannot be classified: ${reason}` });
const contentChanged = (reason) => ({ integrity: 'modified-after-signing', code: 'content-changed-after-signing',
  reason: `a later unsigned revision changed signed content: ${reason}` });
function stop(reason) { throw new Verdict(unclassified(reason)); }

/**
 * Classify the unsigned data appended after a signature's covered range.
 * Never throws; anything unexpected is `unclassified-change-after-signing`.
 *
 * @param {Object|null|undefined} log Revision log from createRevisionLog().
 * @param {number} signedEnd E = ByteRange[2] + ByteRange[3].
 * @param {any} pdfLib The pdf-lib module the log was recorded with.
 * @returns {RevisionVerdict}
 */
export function classifyAppendedRevisions(log, signedEnd, pdfLib) {
  if (!log?.hooked) return unclassified('the revision structure could not be recorded by this parser');
  if (log.shapeError) return unclassified(`unexpected parser data (${log.shapeError})`);
  if (log.unattributed) return unclassified('an object could not be attributed to its file position');
  try {
    return classify(log, signedEnd, pdfLib);
  } catch (err) {
    if (err instanceof Verdict) return err.result;
    return unclassified(`revision classification failed (${String(err?.message ?? err)})`);
  }
}

function classify(log, E, pdfLib) {
  const { PDFName, PDFRef, PDFDict, PDFArray, PDFNumber, PDFRawStream } = pdfLib;
  const name = (s) => PDFName.of(s);
  const refNum = (v) => (v instanceof PDFRef ? v.objectNumber : null);
  const str = (v) => (v === undefined ? '' : String(v));

  // --- 1. revision structure --------------------------------------------------
  const sections = log.xrefs;
  for (const s of sections) {
    if (s.kind === 'stream' && !s.entries) {
      try { s.entries = decodeXrefStream(s.dict, s.content, pdfLib); } catch (err) { s.error = String(err?.message ?? err); }
    }
  }
  const signedStartxref = log.startxrefs.filter((s) => s.at < E).at(-1);
  if (!signedStartxref) stop('the signed revision has no startxref');
  const physicalPreSections = sections.filter((s) => s.offset < E);
  const tail = sections.filter((s) => s.offset >= E);
  const signedSection = physicalPreSections.find((s) => s.offset === signedStartxref.value);
  if (!signedSection) stop('the signed revision startxref does not point at a cross-reference section');
  if (physicalPreSections.some((s) => s.error)) stop('a signed cross-reference stream cannot be decoded');
  if (!tail.length) stop('no cross-reference section was appended after the signed range');
  if (log.trailers.some((t) => t.offset >= E && !t.section)) stop('an appended trailer does not belong to a cross-reference table');
  const tailStartxrefs = log.startxrefs.filter((s) => s.at >= E);
  if (tailStartxrefs.length !== tail.length) stop('the appended revisions do not each end with one startxref');
  tail.forEach((section, i) => {
    const sx = tailStartxrefs[i];
    if (sx.value !== section.offset || sx.at < section.offset || (tail[i + 1] && sx.at > tail[i + 1].offset)) {
      stop('an appended startxref does not point at its cross-reference section');
    }
    if (section.error) stop(`an appended cross-reference stream cannot be decoded (${section.error})`);
    const trailer = section.trailer;
    if (!(trailer instanceof PDFDict)) stop('an appended cross-reference section has no trailer');
    const prev = trailer.get(name('Prev'));
    const expected = i === 0 ? signedSection.offset : tail[i - 1].offset;
    if (!(prev instanceof PDFNumber) || prev.asNumber() !== expected) stop('the /Prev chain of the appended revisions is broken');
    if (trailer.has(name('XRefStm'))) stop('an appended trailer uses /XRefStm (hybrid cross-reference)');
    if (trailer.has(name('Encrypt'))) stop('an appended trailer adds /Encrypt');
  });
  if (!(signedSection.trailer instanceof PDFDict)) stop('the signed revision has no trailer');
  const preSections = activeXrefChain(physicalPreSections, signedSection, pdfLib);
  const rootNum = refNum(signedSection.trailer.get(name('Root')));
  if (rootNum === null) stop('the signed revision trailer has no /Root reference');
  for (const section of tail) {
    if (refNum(section.trailer.get(name('Root'))) !== rootNum) throw new Verdict(contentChanged('the document catalog (/Root) was replaced'));
  }
  const finalTrailer = tail.at(-1).trailer;

  // --- 2. cross-reference consistency (parser-differential guard) ---------------
  const { pre, tailRecords, post } = revisionMaps(log, E);
  assertXrefConsistent(log, E, tail, preSections, pre, tailRecords);

  // --- 3/4. net change set ----------------------------------------------------------
  const delta = [];
  for (const [n, list] of tailRecords) {
    const last = list.at(-1);
    if (last.object instanceof pdfLib.PDFInvalidObject) stop(`object ${n} after signing is not a valid PDF object`);
    if (!pre.has(n) || !sameObject(pre.get(n).object, last.object, PDFRawStream)) delta.push(n);
  }
  delta.sort((a, b) => a - b);
  const deltaSet = new Set(delta);

  const resolve = (map, v) => (v instanceof PDFRef ? map.get(v.objectNumber)?.object : v);
  const resolveArray = (map, v) => {
    if (v === undefined) return [];
    const arr = resolve(map, v);
    return arr instanceof PDFArray ? arr.asArray() : null;
  };
  const isNamed = (dict, key, value) => dict instanceof PDFDict && dict.get(name(key)) === name(value);

  // A new object that a reference signed at E already pointed at (a dangling
  // reference filled in later) changes what that signed object shows.
  const preReferenced = collectShallowRefs([...pre.values()].map((r) => r.object), pdfLib);
  for (const n of delta) {
    if (!pre.has(n) && preReferenced.has(n)) {
      throw new Verdict(contentChanged(`object ${n} was referenced at signing time and was defined only afterwards`));
    }
  }

  const preCat = resolve(pre, PDFRef.of(rootNum));
  const postCat = resolve(post, PDFRef.of(rootNum));
  if (!(preCat instanceof PDFDict) || !(postCat instanceof PDFDict)) stop('the document catalog is not a dictionary');

  // --- 6. reachability in the final state --------------------------------------------
  // The catalog itself counts as content; its exempt entries are roots of their own.
  const contentRoots = [];
  for (const [key, value] of postCat.entries()) {
    if (!EXEMPT_CATALOG_KEYS.includes(key.decodeText())) contentRoots.push(value);
  }
  const reach = (values) => reachable(values, post, pdfLib);
  const rContent = reach(contentRoots);
  rContent.add(rootNum);
  const rValidation = reach([
    ...EXEMPT_CATALOG_KEYS.map((k) => postCat.get(name(k))),
    finalTrailer.get(name('Info'))
  ].filter((v) => v !== undefined));

  // --- 7. classify every changed object -------------------------------------------------
  const accounted = new Set();
  const allowedNew = new Set();
  const allowedWidgets = new Set();
  const changes = [];
  const inconclusive = [];

  const arrayAppend = (preArr, postArr, allow) => {
    if (!preArr || !postArr || postArr.length < preArr.length) return false;
    for (let i = 0; i < preArr.length; i++) if (str(preArr[i]) !== str(postArr[i])) return false;
    return postArr.slice(preArr.length).every((v) => v instanceof PDFRef && allow(v.objectNumber));
  };
  const widgetOk = (w, keys) => {
    if (!(w instanceof PDFDict) || !isNamed(w, 'Subtype', 'Widget')) return false;
    if (w.keys().some((k) => !keys.has(k.decodeText()))) return false; // includes /AP: never allowed
    const flags = w.get(name('F'));
    const hidden = flags instanceof PDFNumber && (flags.asNumber() & (ANNOT_FLAG_HIDDEN | ANNOT_FLAG_NOVIEW)) !== 0;
    const rect = w.get(name('Rect'));
    const r = rect instanceof PDFArray && rect.size() === 4 ? rect.asArray() : null;
    const zeroArea = !!r && r.every((v) => v instanceof PDFNumber) &&
      (r[0].asNumber() === r[2].asNumber() || r[1].asNumber() === r[3].asNumber());
    return hidden || zeroArea;
  };
  // An appended AcroForm field is allowed only as an invisible document timestamp.
  const allowNewField = (n) => {
    if (pre.has(n)) return false;
    const field = post.get(n)?.object;
    if (!(field instanceof PDFDict) || !isNamed(field, 'FT', 'Sig')) return false;
    const vRef = field.get(name('V'));
    const sig = resolve(post, vRef);
    if (!(vRef instanceof PDFRef) || pre.has(vRef.objectNumber) || !isNamed(sig, 'Type', 'DocTimeStamp') ||
      !isNamed(sig, 'SubFilter', 'ETSI.RFC3161')) return false;
    const widgets = [];
    if (field.has(name('Subtype'))) {
      if (!widgetOk(field, DTS_FIELD_KEYS)) return false;
      widgets.push(n);
    } else if (field.keys().some((k) => !DTS_FIELD_KEYS.has(k.decodeText()) || ['Rect', 'F', 'P'].includes(k.decodeText()))) {
      return false;
    }
    const kids = field.get(name('Kids'));
    if (kids !== undefined) {
      if (!(kids instanceof PDFArray)) return false;
      for (const kid of kids.asArray()) {
        const kn = refNum(kid);
        if (kn === null || pre.has(kn)) return false;
        const w = post.get(kn)?.object;
        if (!widgetOk(w, DTS_WIDGET_KEYS) || refNum(w.get(name('Parent'))) !== n) return false;
        widgets.push(kn);
      }
    }
    allowedNew.add(n);
    allowedNew.add(vRef.objectNumber);
    for (const w of widgets) { allowedNew.add(w); allowedWidgets.add(w); }
    return true;
  };
  const acroFormRule = (preValue, postValue) => {
    const preAf = resolve(pre, preValue);
    const postAf = resolve(post, postValue);
    if (!(preAf instanceof PDFDict) || !(postAf instanceof PDFDict)) return false;
    const keys = new Set([...preAf.keys(), ...postAf.keys()].map((k) => k.decodeText()));
    for (const key of keys) {
      const a = preAf.get(name(key));
      const b = postAf.get(name(key));
      if (key === 'SigFlags') continue;
      if (key === 'Fields') {
        if (!arrayAppend(resolveArray(pre, a), resolveArray(post, b), allowNewField)) return false;
        if (b instanceof PDFRef) accounted.add(b.objectNumber);
        continue;
      }
      if (str(a) !== str(b)) return false;
    }
    if (postValue instanceof PDFRef) accounted.add(postValue.objectNumber);
    return true;
  };
  const pageRule = (n) => {
    const a = pre.get(n)?.object;
    const b = post.get(n)?.object;
    if (!isNamed(a, 'Type', 'Page') || !isNamed(b, 'Type', 'Page')) return false;
    const keys = new Set([...a.keys(), ...b.keys()].map((k) => k.decodeText()));
    for (const key of keys) {
      const x = a.get(name(key));
      const y = b.get(name(key));
      if (key === 'Annots') {
        if (str(x) === str(y) && !(y instanceof PDFRef && deltaSet.has(y.objectNumber))) continue;
        if (!arrayAppend(resolveArray(pre, x), resolveArray(post, y), (w) => allowedWidgets.has(w))) return false;
        if (y instanceof PDFRef) accounted.add(y.objectNumber);
        continue;
      }
      if (str(x) !== str(y)) return false;
    }
    accounted.add(n);
    return true;
  };

  // Catalog and AcroForm first: they decide which new fields/widgets are allowed.
  const afPre = preCat.get(name('AcroForm'));
  const afPost = postCat.get(name('AcroForm'));
  const afChanged = str(afPre) !== str(afPost) ||
    (afPost instanceof PDFRef && (deltaSet.has(afPost.objectNumber) ||
      deltaSet.has(refNum(resolve(post, afPost)?.get?.(name('Fields'))))));
  if (afChanged && !acroFormRule(afPre, afPost)) {
    throw new Verdict(contentChanged('the AcroForm changed beyond an invisible document timestamp field'));
  }
  if (deltaSet.has(rootNum)) {
    const keys = new Set([...preCat.keys(), ...postCat.keys()].map((k) => k.decodeText()));
    for (const key of keys) {
      if (EXEMPT_CATALOG_KEYS.includes(key) || key === 'AcroForm') continue;
      if (str(preCat.get(name(key))) !== str(postCat.get(name(key)))) {
        throw new Verdict(contentChanged(`catalog entry /${key} changed`));
      }
    }
    accounted.add(rootNum);
  }
  let annotsOwners = null;
  const ownerPageOf = (n) => {
    if (!annotsOwners) {
      annotsOwners = new Map();
      for (const [num, rec] of post) {
        const annots = isNamed(rec.object, 'Type', 'Page') ? refNum(rec.object.get(name('Annots'))) : null;
        if (annots !== null) annotsOwners.set(annots, num);
      }
    }
    return annotsOwners.get(n);
  };

  for (const n of delta) {
    if (accounted.has(n) || allowedNew.has(n)) continue;
    const owner = isNamed(post.get(n)?.object, 'Type', 'Page') ? n : ownerPageOf(n);
    if (owner !== undefined && pageRule(owner) && accounted.has(n)) continue;
    if (rContent.has(n)) changes.push(n);
    else if (!rValidation.has(n)) inconclusive.push(n);
  }

  // --- 8. result -------------------------------------------------------------------------
  if (changes.length) throw new Verdict(contentChanged(`object(s) ${changes.slice(0, 5).join(', ')} reachable from the document content`));
  if (inconclusive.length) stop(`object(s) ${inconclusive.slice(0, 5).join(', ')} are not reachable from the document`);
  return {
    integrity: 'intact',
    code: 'extended-with-validation-data',
    reason: 'file was extended after signing with validation data/metadata only'
  };
}

/**
 * The state at E (`pre`: last definition before E), the appended definitions
 * per object number, and the final state (`post`: pdf-lib's last definition).
 */
function revisionMaps(log, E) {
  const pre = new Map();
  const tailRecords = new Map();
  for (const rec of log.records) {
    if (rec.start < E) pre.set(rec.num, rec);
    else {
      if (!tailRecords.has(rec.num)) tailRecords.set(rec.num, []);
      tailRecords.get(rec.num).push(rec);
    }
  }
  const post = new Map(pre);
  for (const [n, list] of tailRecords) post.set(n, list.at(-1));
  return { pre, tailRecords, post };
}

/**
 * Return the signed revision's active cross-reference sections, newest first.
 * pdf.js follows only this chain and keeps the nearest entry per object. Any
 * physically parsed pre-E section outside it is rejected: otherwise an
 * unlinked decoy could choose the definition used by the comparison below.
 */
function activeXrefChain(physicalPreSections, signedSection, pdfLib) {
  const { PDFDict, PDFName, PDFNumber } = pdfLib;
  const byOffset = new Map();
  for (const section of physicalPreSections) {
    if (byOffset.has(section.offset)) stop(`multiple signed cross-reference sections start at offset ${section.offset}`);
    byOffset.set(section.offset, section);
  }
  const active = [];
  const activeSet = new Set();
  let section = signedSection;
  while (section) {
    if (activeSet.has(section)) stop('the signed revision /Prev chain contains a cycle');
    active.push(section);
    activeSet.add(section);
    if (!(section.trailer instanceof PDFDict)) stop('a signed cross-reference section has no trailer');
    const prev = section.trailer.get(PDFName.of('Prev'));
    if (prev === undefined) break;
    if (!(prev instanceof PDFNumber) || !Number.isSafeInteger(prev.asNumber()) || prev.asNumber() < 0) {
      stop('the signed revision has an invalid /Prev entry');
    }
    const previous = byOffset.get(prev.asNumber());
    if (!previous || previous.offset >= section.offset) stop('the signed revision /Prev chain is broken');
    section = previous;
  }
  const outside = physicalPreSections.find((candidate) => !activeSet.has(candidate));
  if (outside) stop(`cross-reference section at offset ${outside.offset} before signing is outside the active /Prev chain`);
  return active;
}

/**
 * Step 2 (mandatory, design flag F-a): every appended cross-reference entry
 * must point at the definition pdf-lib used, so pdf.js (offsets) and pdf-lib
 * (last definition) see the same objects. A deleted entry for an object in use
 * at E is a content change (F-c: pdf-lib itself ignores deletions).
 */
function assertXrefConsistent(log, E, tail, preSections, pre, tailRecords) {
  const tailStructural = log.structural.filter((c) => c.start >= E);
  const preStreamNums = new Set(log.structural.filter((c) => c.start < E && c.type === 'ObjStm').map((c) => c.num));
  const preEntry = new Map();
  for (const section of preSections) {
    for (const e of section.entries) if (!preEntry.has(e.num)) preEntry.set(e.num, e);
  }
  const inUseAtE = (n) => pre.has(n) || preStreamNums.has(n);

  // pdf.js resolves a type-2 entry through whatever the newest entry for the
  // container number points at, so container numbers must never be reused.
  for (const c of tailStructural) {
    if (inUseAtE(c.num) || tailRecords.has(c.num)) stop(`appended stream ${c.num} reuses an object number in use`);
  }
  for (const n of tailRecords.keys()) {
    if (preStreamNums.has(n)) stop(`object ${n} after signing redefines a signed object stream`);
  }

  const referenced = new Set();
  const newest = new Map();
  const preMembers = [];
  for (const section of tail) {
    const seen = new Set();
    for (const e of section.entries) {
      if (e.num === 0) continue;
      if (seen.has(e.num)) stop(`object ${e.num} is listed twice in one cross-reference section`);
      seen.add(e.num);
      const candidates = tailRecords.get(e.num) ?? [];
      const p = pre.get(e.num);
      const pe = preEntry.get(e.num);
      let target = null;
      if (e.type === 0) target = 'free';
      else if (e.type === 1) {
        target = candidates.find((r) => !r.container && r.start === e.offset) ??
          tailStructural.find((c) => c.num === e.num && c.start === e.offset) ?? null;
        if (!target && pe?.type === 1 && pe.offset === e.offset && p && !p.container && p.start === e.offset) target = 'pre';
        if (!target && pe?.type === 1 && pe.offset === e.offset &&
          log.structural.some((c) => c.start < E && c.num === e.num && c.start === e.offset)) target = 'pre';
      } else if (e.type === 2) {
        target = candidates.find((r) => r.container && r.container.num === e.stream && r.container.members.get(e.num) === 1) ?? null;
        if (!target && pe?.type === 2 && pe.stream === e.stream && pe.index === e.index && p?.container?.num === e.stream) {
          target = 'pre';
          preMembers.push(e);
        }
      }
      if (!target) stop(`the cross-reference entry for object ${e.num} does not point at its definition`);
      if (typeof target === 'object') referenced.add(target);
      newest.set(e.num, target);
    }
  }
  for (const [n, list] of tailRecords) {
    for (const rec of list) {
      if (!referenced.has(rec)) stop(`object ${n} defined after signing is not listed in the cross-reference data`);
    }
    const last = list.at(-1);
    if (newest.get(n) !== last) stop(`the final cross-reference entry for object ${n} does not point at its last definition`);
    if (last.container && newest.get(last.container.num) !== last.container) {
      stop(`the object stream holding object ${n} is not the one its cross-reference entry resolves to`);
    }
  }
  for (const e of preMembers) {
    if (typeof newest.get(e.stream) === 'object' || newest.get(e.stream) === 'free') {
      stop(`the signed object stream ${e.stream} was replaced after signing`);
    }
  }
  for (const [n, target] of newest) {
    if (target === 'free' && inUseAtE(n)) throw new Verdict(contentChanged(`object ${n} was deleted`));
  }
}

function sameObject(a, b, PDFRawStream) {
  const sa = a instanceof PDFRawStream;
  const sb = b instanceof PDFRawStream;
  if (sa !== sb) return false;
  if (!sa) return String(a) === String(b);
  if (String(a.dict) !== String(b.dict) || a.contents.length !== b.contents.length) return false;
  for (let i = 0; i < a.contents.length; i++) if (a.contents[i] !== b.contents[i]) return false;
  return true;
}

function children(value, pdfLib) {
  if (value instanceof pdfLib.PDFRawStream) return children(value.dict, pdfLib);
  if (value instanceof pdfLib.PDFDict) return value.values();
  if (value instanceof pdfLib.PDFArray) return value.asArray();
  return [];
}

/** Object numbers reachable from `values` through `map` (final state), capped. */
function reachable(values, map, pdfLib) {
  const seen = new Set();
  const stack = [...values];
  let visits = 0;
  while (stack.length) {
    if (++visits > MAX_VALUE_VISITS) stop('the document is too large to classify the appended revision');
    const value = stack.pop();
    if (value instanceof pdfLib.PDFRef) {
      const n = value.objectNumber;
      if (seen.has(n)) continue;
      seen.add(n);
      if (seen.size > MAX_REACHABLE) stop('the document is too large to classify the appended revision');
      const rec = map.get(n);
      if (rec) stack.push(rec.object);
      continue;
    }
    for (const child of children(value, pdfLib)) stack.push(child);
  }
  return seen;
}

/** Every object number referenced directly by the given objects (no resolution). */
function collectShallowRefs(objects, pdfLib) {
  const refs = new Set();
  const stack = [...objects];
  let visits = 0;
  while (stack.length) {
    if (++visits > MAX_VALUE_VISITS) stop('the signed revision is too large to classify the appended revision');
    const value = stack.pop();
    if (value instanceof pdfLib.PDFRef) refs.add(value.objectNumber);
    else for (const child of children(value, pdfLib)) stack.push(child);
  }
  return refs;
}

/**
 * Decode the entries of a cross-reference stream (ISO 32000-1 7.5.8),
 * including the PNG predictors writers commonly use. Throws on anything it
 * cannot decode with certainty; the caller turns that into a warning.
 * @param {any} dict Cross-reference stream dictionary (with /DecodeParms).
 * @param {Uint8Array} content Filter-decoded stream data.
 * @param {any} pdfLib The pdf-lib module.
 * @returns {Array<Object>} Entries `{num, type, offset}` (type 1), `{num, type, stream, index}`
 * (type 2) or `{num, type}` (type 0).
 */
export function decodeXrefStream(dict, content, pdfLib) {
  const { PDFName, PDFArray, PDFNumber, PDFDict } = pdfLib;
  const int = (v, what) => {
    if (!(v instanceof PDFNumber) || !Number.isSafeInteger(v.asNumber()) || v.asNumber() < 0) throw new Error(`invalid ${what}`);
    return v.asNumber();
  };
  if (!(dict instanceof PDFDict) || !(content instanceof Uint8Array)) throw new Error('missing stream data');
  const w = dict.get(PDFName.of('W'));
  if (!(w instanceof PDFArray) || w.size() !== 3) throw new Error('invalid /W');
  const widths = w.asArray().map((v) => int(v, '/W'));
  if (widths.some((v) => v > 8) || widths[1] === 0) throw new Error('unsupported /W');
  const rowSize = widths[0] + widths[1] + widths[2];
  const size = int(dict.get(PDFName.of('Size')), '/Size');
  const indexValue = dict.get(PDFName.of('Index'));
  const index = indexValue === undefined ? [0, size] : indexValue instanceof PDFArray ? indexValue.asArray().map((v) => int(v, '/Index')) : null;
  if (!index || index.length % 2 !== 0) throw new Error('invalid /Index');
  let parms = dict.get(PDFName.of('DecodeParms'));
  if (parms instanceof PDFArray) parms = parms.size() === 1 ? parms.get(0) : undefined;
  const data = unpredict(content, parms, pdfLib);
  let count = 0;
  for (let i = 1; i < index.length; i += 2) count += index[i];
  if (count > MAX_XREF_ENTRIES || count * rowSize > data.length) throw new Error('truncated entries');
  const entries = [];
  let p = 0;
  const field = (width) => { let v = 0; for (let i = 0; i < width; i++) v = v * 256 + data[p++]; return v; };
  for (let s = 0; s < index.length; s += 2) {
    for (let k = 0; k < index[s + 1]; k++) {
      const type = widths[0] === 0 ? 1 : field(widths[0]);
      const f2 = field(widths[1]);
      const f3 = field(widths[2]);
      const num = index[s] + k;
      if (type === 0) entries.push({ num, type: 0 });
      else if (type === 1) entries.push({ num, type: 1, offset: f2 });
      else if (type === 2) entries.push({ num, type: 2, stream: f2, index: f3 });
      else throw new Error(`unknown entry type ${type}`);
    }
  }
  return entries;
}

function unpredict(data, parms, pdfLib) {
  const { PDFName, PDFNumber, PDFDict } = pdfLib;
  if (parms === undefined) return data;
  if (!(parms instanceof PDFDict)) throw new Error('unsupported /DecodeParms');
  const get = (key, fallback) => {
    const v = parms.get(PDFName.of(key));
    if (v === undefined) return fallback;
    if (!(v instanceof PDFNumber)) throw new Error(`unsupported /${key}`);
    return v.asNumber();
  };
  const predictor = get('Predictor', 1);
  if (predictor === 1) return data;
  if (predictor < 10 || predictor > 15 || get('Colors', 1) !== 1 || get('BitsPerComponent', 8) !== 8) {
    throw new Error(`unsupported predictor ${predictor}`);
  }
  const cols = get('Columns', 1);
  if (!Number.isSafeInteger(cols) || cols < 1 || data.length % (cols + 1) !== 0) throw new Error('invalid predictor rows');
  const rows = data.length / (cols + 1);
  const out = new Uint8Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (cols + 1)];
    const src = r * (cols + 1) + 1;
    const dst = r * cols;
    for (let i = 0; i < cols; i++) {
      const x = data[src + i];
      const left = i > 0 ? out[dst + i - 1] : 0;
      const up = r > 0 ? out[dst - cols + i] : 0;
      const upLeft = r > 0 && i > 0 ? out[dst - cols + i - 1] : 0;
      let v;
      if (type === 0) v = x;
      else if (type === 1) v = x + left;
      else if (type === 2) v = x + up;
      else if (type === 3) v = x + ((left + up) >> 1);
      else if (type === 4) {
        const pa = Math.abs(up - upLeft);
        const pb = Math.abs(left - upLeft);
        const pc = Math.abs(left + up - 2 * upLeft);
        v = x + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      } else throw new Error(`unknown PNG row filter ${type}`);
      out[dst + i] = v & 0xff;
    }
  }
  return out;
}
