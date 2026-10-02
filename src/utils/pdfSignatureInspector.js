/**
 * PDF signature inspection - the single entry point for application code.
 *
 * `collectPdfSignatures` (utils/pdfSignatures.js) is CPU-bound (pdf-lib
 * parsing, CMS decoding, WebCrypto verification), so this inspector offloads
 * it to a dedicated ES module worker to keep the main thread free, falling
 * back to inline execution when workers are unavailable or fail. The call
 * never rejects and never throws; documents without signatures resolve to an
 * empty list. See docs-src/pdf-signatures.md for the data contract.
 *
 * Usage (one call per document, e.g. from a dialog effect):
 *
 *   import { getDocumentSignatures } from '../utils/pdfSignatureInspector.js';
 *   const report = await getDocumentSignatures(await documentBlob.arrayBuffer());
 *   // report.signatures: PdfSignatureInfo[]
 *
 * @module utils/pdfSignatureInspector
 */

import PdfSignatureWorkerConstructor from '../workers/pdfSignatureWorker.js?worker';
import { collectPdfSignatures } from './pdfSignatures.js';

const EMPTY_REPORT = { signatures: [] };

/**
 * Lazily created worker handle: { worker, broken, pending } where `pending`
 * maps requestId to its resolve/reject callbacks. Null once created;
 * `broken: true` means the worker failed and callers run inline.
 * @type {Object|null}
 */
let workerHandle = null;
let requestId = 0;

function canUseWorker() {
  return typeof Worker !== 'undefined' && typeof document !== 'undefined';
}

function ensureWorker() {
  if (workerHandle && !workerHandle.broken) return workerHandle;
  if (workerHandle && workerHandle.broken) return null;
  try {
    const worker = new PdfSignatureWorkerConstructor({ type: 'module', name: 'pdf-signature-worker' });
    const handle = { worker, broken: false, pending: new Map() };
    workerHandle = handle;
    worker.onmessage = (event) => {
      const data = event?.data;
      if (!data || data.type !== 'pdfSignaturesResult') return;
      const entry = handle.pending.get(data.requestId);
      if (!entry) return;
      handle.pending.delete(data.requestId);
      if (data.ok) {
        entry.resolve(data.report ?? EMPTY_REPORT);
      } else {
        entry.reject(new Error(data.error || 'signature worker failure'));
      }
    };
    const markBroken = () => {
      handle.broken = true;
      for (const [, entry] of handle.pending) {
        try {
          entry.reject(new Error('signature worker failed'));
        } catch {
          /* ignore */
        }
      }
      handle.pending.clear();
      try {
        worker.terminate();
      } catch {
        /* ignore */
      }
    };
    worker.onerror = (event) => {
      event?.preventDefault?.();
      markBroken();
    };
    return handle;
  } catch {
    workerHandle = { worker: null, broken: true, pending: new Map() };
    return null;
  }
}

function runInWorker(handle, bytes, timeoutMs) {
  return new Promise((resolve, reject) => {
    requestId += 1;
    const id = requestId;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      handle.pending.delete(id);
      reject(new Error(`signature worker timeout after ${timeoutMs} ms`));
    }, timeoutMs);
    handle.pending.set(id, {
      resolve: (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      reject: (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
    try {
      handle.worker.postMessage({ type: 'collectPdfSignatures', requestId: id, bytes });
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        handle.pending.delete(id);
        reject(err);
      }
    }
  });
}

async function toBytes(source) {
  if (source == null) throw new TypeError('source must be PDF bytes or a Blob');
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    return new Uint8Array(await source.arrayBuffer());
  }
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  throw new TypeError('unsupported PDF source type');
}

/**
 * Inspect the signatures of one document. Call once per document and cache
 * the returned report alongside the document state.
 *
 * @param {Uint8Array|ArrayBuffer|Blob} source Complete PDF document bytes
 * (or a Blob of them, e.g. the loader's document blob).
 * @param {Object} [options] Worker options.
 * @param {number} [options.timeoutMs] Worker timeout in ms (default 30000).
 * @returns {Promise} Resolves - never rejects - with a PdfSignatureReport
 * (`{ signatures: [] }` when the document has none or cannot be inspected).
 */
export async function getDocumentSignatures(source, options = {}) {
  let bytes;
  try {
    bytes = await toBytes(source);
  } catch {
    return EMPTY_REPORT;
  }
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 30000;
  if (canUseWorker()) {
    const handle = ensureWorker();
    if (handle) {
      try {
        return await runInWorker(handle, bytes, timeoutMs);
      } catch {
        // Any worker trouble: fall through to inline execution once.
      }
    }
  }
  try {
    return await collectPdfSignatures(bytes);
  } catch {
    return EMPTY_REPORT;
  }
}

/**
 * Terminate the signature worker (e.g. when the viewer tears down). The next
 * call transparently creates a new one.
 */
export function disposePdfSignatureWorker() {
  if (workerHandle?.worker && !workerHandle.broken) {
    try {
      workerHandle.worker.terminate();
    } catch {
      /* ignore */
    }
  }
  workerHandle = null;
}

export default getDocumentSignatures;
