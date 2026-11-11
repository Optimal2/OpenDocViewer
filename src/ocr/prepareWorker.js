// File: src/ocr/prepareWorker.js
/**
 * OpenDocViewer — OCR image preparation worker.
 *
 * Runs src/ocr/prepareImageCore.js off the main thread: decode the rendered page image, copy it
 * to a canvas, remove the ruling lines of tables and forms, encode the clean copy. On the main
 * thread this chain cost 100 to 130 ms per page on a four-core client and several seconds per
 * ruled page when many engines asked for pages at once (the band yields of the line removal
 * were starved), and it was the reason the viewer's worst event-loop lag grew with the number
 * of OCR engines. Here nothing waits for it, so the line removal runs straight through without
 * yielding.
 *
 * One request per message; several may be in flight, each answered by its `id`. The worker is
 * created by imagePreparer.js only, from the lazy OCR chunk, so with `ocr.enabled` off this
 * file is never fetched. It lives in src/ocr/ rather than src/workers/ because it imports from
 * this folder, and nothing outside the folder may (src/utils/__tests__/ocrLoader.test.js checks). It is a dedicated worker of the viewer's own origin: the image
 * comes from the page and the clean copy goes back to it, nothing else.
 *
 * Request:  { type: 'prepare', id, blob, removeRulingLines, fallbackSize, maxPixels }
 * Response: { type: 'prepared', id, ok: true, blob, width, height, rulingLinePixels, log }
 *           { type: 'prepared', id, ok: false, error }             the image could not be decoded
 *           { type: 'prepared', id, ok: false, unsupported: true }  this scope has no decoder or canvas
 *
 * `log` carries the debug lines and the one possible warning of the core as
 * `{ level, message, details }`, for the main thread's logger (a worker has none).
 */
import { removeRulingLines } from './lineRemoval.js';
import { canPrepareImagesHere, prepareOcrImageCore } from './prepareImageCore.js';

/** @type {(DedicatedWorkerGlobalScope|*)} */
const workerScope = self;

/** Collects the core's log lines for the reply. */
function createLogCollector() {
  const entries = [];
  return {
    entries,
    debug: (message, details) => entries.push({ level: 'debug', message, details }),
    warn: (message, details) => entries.push({ level: 'warn', message, details }),
  };
}

/**
 * @param {Object} request
 * @returns {Promise<Object>}  The reply, never a rejection.
 */
export async function handlePrepareRequest(request) {
  const id = request?.id;
  // A scope whose canvas constructor itself throws counts as having none: the reply must come.
  let supported;
  try { supported = canPrepareImagesHere(); } catch { supported = false; }
  if (!supported) {
    return { type: 'prepared', id, ok: false, unsupported: true };
  }
  const log = createLogCollector();
  try {
    const prepared = await prepareOcrImageCore(request.blob, {
      removeRulingLines: request.removeRulingLines === true,
      fallbackSize: request.fallbackSize || null,
      maxPixels: request.maxPixels,
      // Nothing waits on this thread: the synchronous removal, no yields between bands.
      removeLines: (imageData) => Promise.resolve(removeRulingLines(imageData)),
      log,
    });
    return { type: 'prepared', id, ok: true, ...prepared, log: log.entries };
  } catch (error) {
    return { type: 'prepared', id, ok: false, error: String(error?.message || error), log: log.entries };
  }
}

workerScope.onmessage = async (event) => {
  const request = event?.data;
  if (!request || request.type !== 'prepare') return;
  workerScope.postMessage(await handlePrepareRequest(request));
};
