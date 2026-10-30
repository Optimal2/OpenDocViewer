// File: src/ocr/pdfTextProbe.js
/**
 * Reads a PDF page's own text layer through pdf.js so classify.js can decide whether OCR is
 * needed at all.
 *
 * The prober opens a document from the bytes the viewer already holds (`readSourceArrayBuffer`,
 * the file is never fetched again), keeps a few documents open so neighbouring pages reuse the
 * parse, and closes them when the document leaves the viewer or the engine goes idle. pdf.js
 * itself is the copy the viewer already ships for rendering; this module adds no second one.
 * Part of the lazy OCR chunk.
 */
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { withPdfJsDocumentOptions } from '../utils/pdfjsDocumentOptions.js';
import { assessPdfTextLayer } from './classify.js';

/** Open pdf.js documents kept for neighbouring pages before the least recently used is closed. */
export const DEFAULT_OPEN_PDF_DOCUMENTS = 2;

/**
 * pdf.js loading task for a copy of the bytes (pdf.js takes ownership of the buffer it is given).
 *
 * @param {ArrayBuffer} bytes
 * @returns {{ promise: Promise<Object>, destroy: function(): Promise<void> }}
 */
function defaultGetDocument(bytes) {
  try {
    if (pdfjsLib?.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    }
  } catch {
    // Worker-less environments: pdf.js falls back to the main thread.
  }
  return pdfjsLib.getDocument(withPdfJsDocumentOptions({ data: bytes.slice(0) }));
}

/**
 * @typedef {Object} PdfTextProber
 * @property {function(string, number): Promise<Object>} probe
 *   `probe(sourceKey, pageIndex)` resolves to a PdfTextLayerAssessment (classify.js).
 * @property {function(Set<string>): Promise<void>} retainSources  Close documents not in the set.
 * @property {function(): Promise<void>} releaseAll  Close every open document (idle shutdown).
 * @property {function(): number} openCount
 */

/**
 * @param {Object} options
 * @param {function(string): Promise<(ArrayBuffer|null)>} options.readSourceArrayBuffer
 *   The viewer's reader of already-loaded source bytes.
 * @param {function(ArrayBuffer): Object=} options.getDocument  pdf.js `getDocument` (injectable for tests).
 * @param {number=} options.maxOpenDocuments  Default DEFAULT_OPEN_PDF_DOCUMENTS.
 * @returns {PdfTextProber}
 */
export function createPdfTextProber({
  readSourceArrayBuffer,
  getDocument = defaultGetDocument,
  maxOpenDocuments = DEFAULT_OPEN_PDF_DOCUMENTS,
}) {
  const limit = Math.max(1, Math.floor(Number(maxOpenDocuments)) || DEFAULT_OPEN_PDF_DOCUMENTS);
  /** @type {Map<string, { promise: Promise<Object>, task: Object }>} */
  const open = new Map();

  async function close(sourceKey) {
    const entry = open.get(sourceKey);
    if (!entry) return;
    open.delete(sourceKey);
    try {
      const document = await entry.promise;
      await document?.destroy?.();
    } catch {
      // A document that failed to open has nothing to destroy.
    }
    try {
      await entry.task?.destroy?.();
    } catch {
      // Already destroyed.
    }
  }

  function openDocument(sourceKey) {
    const existing = open.get(sourceKey);
    if (existing) {
      open.delete(sourceKey);
      open.set(sourceKey, existing);
      return existing.promise;
    }
    const entry = { task: null, promise: null };
    entry.promise = (async () => {
      const bytes = await readSourceArrayBuffer(sourceKey);
      if (!bytes) throw new Error('PDF source bytes are unavailable');
      entry.task = getDocument(bytes);
      return entry.task.promise;
    })();
    entry.promise.catch(() => {
      if (open.get(sourceKey) === entry) open.delete(sourceKey);
    });
    open.set(sourceKey, entry);
    const closing = [];
    while (open.size > limit) {
      const oldest = open.keys().next().value;
      closing.push(close(oldest));
    }
    void Promise.all(closing);
    return entry.promise;
  }

  return {
    async probe(sourceKey, pageIndex) {
      const key = String(sourceKey || '');
      const document = await openDocument(key);
      const page = await document.getPage(Math.max(0, Math.floor(Number(pageIndex)) || 0) + 1);
      try {
        const content = await page.getTextContent({ includeMarkedContent: false });
        const strings = (Array.isArray(content?.items) ? content.items : []).map((item) => item?.str ?? '');
        return assessPdfTextLayer(strings);
      } finally {
        try {
          page.cleanup?.();
        } catch {
          // Nothing to release.
        }
      }
    },
    async retainSources(sourceKeys) {
      const closing = [];
      for (const key of [...open.keys()]) {
        if (!sourceKeys.has(key)) closing.push(close(key));
      }
      await Promise.all(closing);
    },
    async releaseAll() {
      await Promise.all([...open.keys()].map((key) => close(key)));
    },
    openCount() {
      return open.size;
    },
  };
}
