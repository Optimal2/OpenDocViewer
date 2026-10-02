/**
 * PDF signature inspection - the single entry point for application code.
 *
 * `collectPdfSignatures` (utils/pdfSignatures.js) is CPU-bound (pdf-lib
 * parsing, CMS decoding, WebCrypto verification), so this inspector offloads
 * it to a dedicated ES module worker to keep the main thread free, falling
 * back to size-bounded inline execution only when no Worker API exists. The call
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
import { collectPdfSignatures, unreadableSignatureReport } from './pdfSignatures.js';

const EMPTY_REPORT = { signatures: [] };
const MAX_WORKER_RECREATIONS = 3;

/**
 * Lazily created worker handle: { worker, broken, pending } where `pending`
 * maps requestId to its resolve/reject callbacks. Null before creation;
 * A broken worker may be recreated for a later document, up to three times
 * per viewer session. Disposal resets the handle and the recreation budget.
 * @type {Object|null}
 */
let workerHandle = null;
let workerRecreations = 0;
let requestId = 0;

function canUseWorker() {
  return typeof Worker !== 'undefined';
}

function markBroken(handle, reason) {
  if (handle.broken) return;
  handle.broken = true;
  for (const entry of handle.pending.values()) entry.reject(new Error(reason));
  handle.pending.clear();
  try { handle.worker?.terminate(); } catch { /* already stopped */ }
}

function ensureWorker() {
  if (workerHandle && !workerHandle.broken) return workerHandle;
  if (workerHandle?.broken) {
    if (workerRecreations >= MAX_WORKER_RECREATIONS) return null;
    workerRecreations += 1;
  }
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
        entry.resolve(data.report ?? unreadableSignatureReport('signature worker returned no report'));
      } else {
        entry.reject(new Error(data.error || 'signature worker failure'));
      }
    };
    worker.onerror = (event) => {
      event?.preventDefault?.();
      markBroken(handle, 'signature worker failed');
    };
    worker.onmessageerror = () => markBroken(handle, 'signature worker message could not be decoded');
    return handle;
  } catch {
    workerHandle = { worker: null, broken: true, pending: new Map() };
    return null;
  }
}

function runInWorker(handle, bytes, timeoutMs, transfer) {
  return new Promise((resolve, reject) => {
    requestId += 1;
    const id = requestId;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      markBroken(handle, `signature worker timeout after ${timeoutMs} ms`);
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
      handle.worker.postMessage({ type: 'collectPdfSignatures', requestId: id, bytes }, transfer ? [bytes.buffer] : []);
    } catch (err) {
      if (!settled) {
        markBroken(handle, String(err?.message ?? err));
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
 * @param {boolean} [options.transfer=false] Transfer ownership of the input buffer to the worker.
 * Only use for disposable copies: all views of the buffer become detached.
 * @returns {Promise} Resolves - never rejects - with a PdfSignatureReport
 * (`{ signatures: [] }` only when the document has no detected signatures).
 */
export async function getDocumentSignatures(source, options = {}) {
  const sourceSize = source?.size ?? source?.byteLength;
  if (sourceSize > 64 * 1024 * 1024) return unreadableSignatureReport('PDF exceeds the 64 MiB signature inspection limit');
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
        return await runInWorker(handle, bytes, timeoutMs, options.transfer === true);
      } catch (err) {
        return unreadableSignatureReport(String(err?.message ?? err));
      }
    }
    return unreadableSignatureReport('signature worker is unavailable');
  }
  if (bytes.byteLength > 256 * 1024) {
    return unreadableSignatureReport('PDF exceeds the 256 KiB inline signature inspection limit; a Worker is required');
  }
  try {
    return await collectPdfSignatures(bytes);
  } catch (err) {
    return unreadableSignatureReport(String(err?.message ?? err));
  }
}

/**
 * Terminate the signature worker (e.g. when the viewer tears down). The next
 * call transparently creates a new one.
 */
export function disposePdfSignatureWorker() {
  if (workerHandle) markBroken(workerHandle, 'signature worker disposed');
  workerHandle = null;
  workerRecreations = 0;
}

export default getDocumentSignatures;
