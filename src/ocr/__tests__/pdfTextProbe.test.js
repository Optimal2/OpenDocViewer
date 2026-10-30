// File: src/ocr/__tests__/pdfTextProbe.test.js
// @vitest-environment jsdom
/**
 * The PDF text prober opens a document from the viewer's own bytes once, reuses it for
 * neighbouring pages, bounds the number of open documents, closes documents that leave the
 * viewer, and turns a page's text items into a text-layer assessment. pdf.js is replaced by an
 * injected getDocument, so no PDF is parsed here.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('pdfjs-dist/legacy/build/pdf', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.js' }));

const { DEFAULT_OPEN_PDF_DOCUMENTS, createPdfTextProber } = await import('../pdfTextProbe.js');

function makeFakePdf(pagesText) {
  const destroyed = { document: 0, task: 0 };
  const cleanups = [];
  const getTextContent = vi.fn();
  const document = {
    getPage: vi.fn(async (number) => ({
      getTextContent: async (options) => {
        getTextContent(options);
        const strings = pagesText[number - 1] || [];
        return { items: strings.map((str) => ({ str, dir: 'ltr' })) };
      },
      cleanup: () => cleanups.push(number),
    })),
    destroy: async () => { destroyed.document += 1; },
  };
  const task = { promise: Promise.resolve(document), destroy: async () => { destroyed.task += 1; } };
  return { task, document, destroyed, cleanups, getTextContent };
}

describe('createPdfTextProber', () => {
  it('reads the page text through pdf.js from the viewer bytes and assesses it', async () => {
    const pdf = makeFakePdf([['Första sidan med riktig text som duger.', 'Den har tillräckligt många tecken för att räknas.'], ['7']]);
    const readSourceArrayBuffer = vi.fn(async () => new ArrayBuffer(16));
    const getDocument = vi.fn(() => pdf.task);
    const prober = createPdfTextProber({ readSourceArrayBuffer, getDocument });

    await expect(prober.probe('doc', 0)).resolves.toMatchObject({ usable: true, verdict: 'usable' });
    await expect(prober.probe('doc', 1)).resolves.toMatchObject({ usable: false, verdict: 'empty' });

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
