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
});
