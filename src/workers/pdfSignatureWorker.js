/**
 * Web worker entry for PDF signature inspection.
 *
 * Keeps signature parsing (pdf-lib + pkijs + WebCrypto over the byte ranges)
 * off the main thread. Message protocol:
 *
 *   in : { type: 'collectPdfSignatures', requestId: number, bytes: Uint8Array }
 *   out: { type: 'pdfSignaturesResult', requestId: number, ok: true, report }
 *        or { type: 'pdfSignaturesResult', requestId: number, ok: false, error }
 *
 * Application code should not talk to this worker directly; use
 * `getDocumentSignatures` from `utils/pdfSignatureInspector.js`.
 *
 * @module workers/pdfSignatureWorker
 */

import { collectPdfSignatures } from '../utils/pdfSignatures.js';

const workerScope = self;

async function handleRequest(requestId, bytes) {
  try {
    const report = await collectPdfSignatures(bytes);
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
