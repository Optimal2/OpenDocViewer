/**
 * Web worker entry for PDF signature inspection.
 *
 * Keeps signature parsing (pdf-lib + pkijs + WebCrypto over the byte ranges)
 * and the pdf.js differential confirmation of appended revisions off the main
 * thread. Message protocol:
 *
 *   in : { type: 'collectPdfSignatures', requestId: number, bytes: Uint8Array }
 *   out: { type: 'pdfSignaturesResult', requestId: number, ok: true, report }
 *        or { type: 'pdfSignaturesResult', requestId: number, ok: false, error }
 *        and, while the pdf.js comparison runs, one
 *        { type: 'pdfSignaturesProgress', requestId: number } per compared page
 *
 * Application code should not talk to this worker directly; use
 * `getDocumentSignatures` from `utils/pdfSignatureInspector.js`.
 *
 * @module workers/pdfSignatureWorker
 */

import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { collectPdfSignatures } from '../utils/pdfSignatures.js';
import { withPdfJsDocumentOptions } from '../utils/pdfjsDocumentOptions.js';

const workerScope = self;

/** @type {Promise<any>|null} */
let pdfjsPromise = null;

/**
 * The viewer's pdf.js build, loaded only when an appended revision needs the
 * differential confirmation. Like the page worker, pdf.js starts a nested
 * worker or falls back to its in-thread loopback path.
 */
function loadPdfjs() {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf').then((pdfjsLib) => {
    if (pdfjsLib?.GlobalWorkerOptions) pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    return pdfjsLib;
  }).catch((err) => {
    pdfjsPromise = null;
    throw err;
  });
  return pdfjsPromise;
}

// The page worker's document options (utils/pdfjsDocumentOptions.js and pdfPageWorker.js).
const renderCheck = {
  loadPdfjs,
  documentOptions: withPdfJsDocumentOptions({ disableFontFace: true, useSystemFonts: false })
};

async function handleRequest(requestId, bytes) {
  try {
    // Heartbeat after every page the pdf.js comparison finishes: the inspector
    // keeps waiting for a comparison that still makes progress.
    const onProgress = () => workerScope.postMessage({ type: 'pdfSignaturesProgress', requestId });
    const report = await collectPdfSignatures(bytes, { renderCheck: { ...renderCheck, onProgress } });
    workerScope.postMessage({ type: 'pdfSignaturesResult', requestId, ok: true, report });
  } catch (err) {
    workerScope.postMessage({
      type: 'pdfSignaturesResult',
      requestId,
      ok: false,
      error: String((err && err.message) || err)
    });
  }
}

workerScope.onmessage = (event) => {
  const data = event?.data;
  if (!data || data.type !== 'collectPdfSignatures') return;
  void handleRequest(data.requestId, data.bytes);
};
