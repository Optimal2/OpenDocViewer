// File: src/ocr/__tests__/pdfTextProbe.test.js
// @vitest-environment jsdom
/**
 * The PDF text prober opens a document from the viewer's own bytes once, reuses it for
 * neighbouring pages, bounds the number of open documents, closes documents that leave the
 * viewer, and turns a page's text items into a text-layer assessment, with the words of a usable
 * layer placed in the page's base viewport. pdf.js is replaced by an injected getDocument, so no
 * PDF is parsed here.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('pdfjs-dist/legacy/build/pdf', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.js' }));

const { DEFAULT_OPEN_PDF_DOCUMENTS, createPdfTextProber } = await import('../pdfTextProbe.js');

/** A portrait A4 base viewport (scale 1): PDF y up, viewport y down. */
const BASE_VIEWPORT = { width: 595.28, height: 841.89, transform: [1, 0, 0, -1, 0, 841.89] };

/**
 * @param {Array<Array<(string|Object)>>} pagesText  Per page: strings (placed items with a
 *   transform of a 12 pt baseline at x 60, one line each) or full pdf.js items.
 */
function makeFakePdf(pagesText) {
  const destroyed = { document: 0, task: 0 };
  const cleanups = [];
  const getTextContent = vi.fn();
  const getViewport = vi.fn(() => BASE_VIEWPORT);
  const document = {
    getPage: vi.fn(async (number) => ({
      getTextContent: async (options) => {
        getTextContent(options);
        const entries = pagesText[number - 1] || [];
        const items = entries.map((entry, index) => (typeof entry === 'string'
          ? { str: entry, dir: 'ltr', transform: [12, 0, 0, 12, 60, 780 - index * 20], width: entry.length * 6, height: 12, fontName: 'f1', hasEOL: true }
          : entry));
        return { items, styles: { f1: { ascent: 0.75, descent: -0.25, vertical: false } } };
      },
      getViewport,
      cleanup: () => cleanups.push(number),
    })),
    destroy: async () => { destroyed.document += 1; },
  };
  const task = { promise: Promise.resolve(document), destroy: async () => { destroyed.task += 1; } };
  return { task, document, destroyed, cleanups, getTextContent, getViewport };
}

describe('createPdfTextProber', () => {
  it('reads the page text through pdf.js from the viewer bytes and assesses it', async () => {
    const pdf = makeFakePdf([['Första sidan med riktig text som duger.', 'Den har tillräckligt många tecken för att räknas.'], ['7']]);
    const readSourceArrayBuffer = vi.fn(async () => new ArrayBuffer(16));
    const getDocument = vi.fn(() => pdf.task);
    const prober = createPdfTextProber({ readSourceArrayBuffer, getDocument });

    const usable = await prober.probe('doc', 0);
    expect(usable).toMatchObject({ usable: true, verdict: 'usable', text: 'Första sidan med riktig text som duger.\nDen har tillräckligt många tecken för att räknas.' });
    // A usable layer comes with its words placed in the base viewport (PDF points, y down):
    // the first line's baseline at 780 from the bottom lies 61.89 from the top, its top one
    // ascent (0.75 × 12) higher; the page size is the viewport's.
    expect(usable.pageWidth).toBeCloseTo(595.28);
    expect(usable.pageHeight).toBeCloseTo(841.89);
    expect(usable.words.map((word) => word.text)).toEqual(['Första', 'sidan', 'med', 'riktig', 'text', 'som', 'duger.', 'Den', 'har', 'tillräckligt', 'många', 'tecken', 'för', 'att', 'räknas.']);
    expect(usable.words[0].bbox.x0).toBeCloseTo(60);
    expect(usable.words[0].bbox.y0).toBeCloseTo(841.89 - 780 - 9);
    expect(usable.words[0].bbox.y1).toBeCloseTo(841.89 - 780 + 3);
    expect(usable.words[7].bbox.y0).toBeCloseTo(841.89 - 760 - 9);
    expect(pdf.getViewport).toHaveBeenCalledWith({ scale: 1 });
    // An unusable layer is only assessed: no words, no page size, no viewport asked for.
    const empty = await prober.probe('doc', 1);
    expect(empty).toEqual(expect.objectContaining({ usable: false, verdict: 'empty' }));
    expect(empty).not.toHaveProperty('words');
    expect(pdf.getViewport).toHaveBeenCalledTimes(1);

    expect(readSourceArrayBuffer).toHaveBeenCalledTimes(1);
    expect(getDocument).toHaveBeenCalledTimes(1);
    expect(pdf.document.getPage).toHaveBeenNthCalledWith(1, 1);
    expect(pdf.document.getPage).toHaveBeenNthCalledWith(2, 2);
    expect(pdf.getTextContent).toHaveBeenCalledWith({ includeMarkedContent: false });
    expect(pdf.cleanups).toEqual([1, 2]);
    expect(prober.openCount()).toBe(1);
  });

  it('rejects when the source bytes are gone and forgets the failed document', async () => {
    const prober = createPdfTextProber({ readSourceArrayBuffer: async () => null, getDocument: vi.fn() });
    await expect(prober.probe('gone', 0)).rejects.toThrow('PDF source bytes are unavailable');
    expect(prober.openCount()).toBe(0);
  });

  it('keeps at most the configured number of documents open, closing the least recently used', async () => {
    expect(DEFAULT_OPEN_PDF_DOCUMENTS).toBe(2);
    const pdfs = { a: makeFakePdf([['x']]), b: makeFakePdf([['y']]), c: makeFakePdf([['z']]) };
    // The injected getDocument is driven by call order: a, b, then a again (reused), then c.
    const order = ['a', 'b', 'c'];
    let calls = 0;
    const prober = createPdfTextProber({
      readSourceArrayBuffer: async () => new ArrayBuffer(8),
      getDocument: () => pdfs[order[calls++]].task,
      maxOpenDocuments: 2,
    });
    await prober.probe('a', 0);
    await prober.probe('b', 0);
    await prober.probe('a', 0);
    expect(calls).toBe(2);
    await prober.probe('c', 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(prober.openCount()).toBe(2);
    expect(pdfs.b.destroyed).toEqual({ document: 1, task: 1 });
    expect(pdfs.a.destroyed).toEqual({ document: 0, task: 0 });
  });

  it('closes documents that are no longer retained and everything on releaseAll', async () => {
    const pdfs = [makeFakePdf([['one']]), makeFakePdf([['two']])];
    let calls = 0;
    const prober = createPdfTextProber({
      readSourceArrayBuffer: async () => new ArrayBuffer(8),
      getDocument: () => pdfs[calls++].task,
    });
    await prober.probe('keep', 0);
    await prober.probe('drop', 0);
    await prober.retainSources(new Set(['keep']));
    expect(prober.openCount()).toBe(1);
    expect(pdfs[1].destroyed).toEqual({ document: 1, task: 1 });
    expect(pdfs[0].destroyed).toEqual({ document: 0, task: 0 });
    await prober.releaseAll();
    expect(prober.openCount()).toBe(0);
    expect(pdfs[0].destroyed).toEqual({ document: 1, task: 1 });
    // Probing again reopens the document from the bytes.
    pdfs.push(makeFakePdf([['again']]));
    await prober.probe('keep', 0);
    expect(calls).toBe(3);
  });

  /** A fake PDF whose page text arrives when the test says so. */
  function makeSlowPdf(line) {
    const destroyed = { document: 0, task: 0 };
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const document = {
      getPage: vi.fn(async () => {
        if (destroyed.document > 0) throw new Error('Transport destroyed');
        return {
          getTextContent: async () => {
            await gate;
            if (destroyed.document > 0) throw new Error('Transport destroyed');
            return {
              items: [{ str: line, dir: 'ltr', transform: [12, 0, 0, 12, 60, 780], width: line.length * 6, height: 12, fontName: 'f1', hasEOL: true }],
              styles: { f1: { ascent: 0.75, descent: -0.25, vertical: false } },
            };
          },
          getViewport: () => BASE_VIEWPORT,
          cleanup: () => {},
        };
      }),
      destroy: async () => { destroyed.document += 1; },
    };
    const task = { promise: Promise.resolve(document), destroy: async () => { destroyed.task += 1; } };
    return { task, destroyed, release };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('never closes a document a probe is reading: several documents are probed at once, and the ones over the bound close as their probes end', async () => {
    const text = 'En rad med text som är lång nog för att räknas som en riktig textsida i provet.';
    const pdfs = { a: makeSlowPdf(text), b: makeSlowPdf(text), c: makeSlowPdf(text), d: makeSlowPdf(text) };
    // Each source opens its own document, whatever order the bytes arrive in.
    const bySource = createPdfTextProber({
      readSourceArrayBuffer: async (sourceKey) => new TextEncoder().encode(sourceKey).buffer,
      getDocument: (bytes) => pdfs[new TextDecoder().decode(bytes)].task,
      maxOpenDocuments: 2,
    });
    // Four pages in flight, each from a document of its own, with room for two.
    const probes = ['a', 'b', 'c', 'd'].map((key) => bySource.probe(key, 0));
    await settle();
    expect(bySource.openCount()).toBe(4);
    for (const pdf of Object.values(pdfs)) expect(pdf.destroyed).toEqual({ document: 0, task: 0 });
    // The probes end one by one: every page gets its text, and the documents over the bound go.
    pdfs.a.release();
    await expect(probes[0]).resolves.toMatchObject({ usable: true });
    await settle();
    expect(bySource.openCount()).toBe(3);
    expect(pdfs.a.destroyed).toEqual({ document: 1, task: 1 });
    pdfs.c.release();
    await expect(probes[2]).resolves.toMatchObject({ usable: true });
    await settle();
    expect(bySource.openCount()).toBe(2);
    expect(pdfs.c.destroyed).toEqual({ document: 1, task: 1 });
    pdfs.b.release();
    pdfs.d.release();
    await expect(probes[1]).resolves.toMatchObject({ usable: true });
    await expect(probes[3]).resolves.toMatchObject({ usable: true });
    await settle();
    // Within the bound again: the last two stay open for their neighbouring pages.
    expect(bySource.openCount()).toBe(2);
    expect(pdfs.b.destroyed).toEqual({ document: 0, task: 0 });
    expect(pdfs.d.destroyed).toEqual({ document: 0, task: 0 });
  });

  it('closes a document that leaves the viewer, or everything at the idle shutdown, only when its probe has ended', async () => {
    const text = 'En rad med text som är lång nog för att räknas som en riktig textsida i provet.';
    const pdfs = { a: makeSlowPdf(text), b: makeSlowPdf(text) };
    const prober = createPdfTextProber({
      readSourceArrayBuffer: async (sourceKey) => new TextEncoder().encode(sourceKey).buffer,
      getDocument: (bytes) => pdfs[new TextDecoder().decode(bytes)].task,
    });
    const a = prober.probe('a', 0);
    const b = prober.probe('b', 0);
    await settle();
    await prober.retainSources(new Set(['b']));
    await prober.releaseAll();
    expect(pdfs.a.destroyed).toEqual({ document: 0, task: 0 });
    expect(pdfs.b.destroyed).toEqual({ document: 0, task: 0 });
    pdfs.a.release();
    await expect(a).resolves.toMatchObject({ usable: true });
    await settle();
    expect(pdfs.a.destroyed).toEqual({ document: 1, task: 1 });
    expect(prober.openCount()).toBe(1);
    // Wanted again before its probe ended: the document stays.
    const again = prober.probe('b', 0);
    pdfs.b.release();
    await expect(b).resolves.toMatchObject({ usable: true });
    await expect(again).resolves.toMatchObject({ usable: true });
    await settle();
    expect(pdfs.b.destroyed).toEqual({ document: 0, task: 0 });
    expect(prober.openCount()).toBe(1);
  });
});
