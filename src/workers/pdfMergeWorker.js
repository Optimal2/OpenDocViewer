// File: src/workers/pdfMergeWorker.js
/**
 * OpenDocViewer - PDF merge worker.
 *
 * Merges already-generated partial PDFs. The dispatcher can run many instances
 * of this worker in reduction rounds: N partial PDFs become roughly N/2 merged
 * PDFs per round until one final PDF remains.
 */

import { PDFDocument } from 'pdf-lib';

const workerScope = self;

function postProgress(event) {
  workerScope.postMessage({ type: 'progress', event });
}

async function mergePdfBlobs(job) {
  const blobs = job?.blobs || [];
  const inputs = Array.isArray(blobs) ? blobs : [];
  if (!inputs.length) throw new Error('PDF merge worker received no PDF parts.');
  if (inputs.length === 1) return inputs[0];

  const target = await PDFDocument.create();
  for (let index = 0; index < inputs.length; index += 1) {
    const blob = inputs[index];
    if (!(blob instanceof Blob)) throw new Error(`PDF merge input ${index + 1} was not a Blob.`);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const source = await PDFDocument.load(bytes);
    const pages = await target.copyPages(source, source.getPageIndices());
    pages.forEach((page) => target.addPage(page));
    postProgress({
      phase: 'merging',
      current: index + 1,
      total: inputs.length,
      roundIndex: job?.roundIndex || 0,
      pairIndex: job?.pairIndex || 0,
    });
  }

  const mergedBytes = await target.save({ useObjectStreams: true });
  return new Blob([mergedBytes], { type: 'application/pdf' });
}

workerScope.onmessage = async (event) => {
  const data = event?.data || {};
  if (data.type !== 'mergePdfs') return;
  try {
    const blob = await mergePdfBlobs(data.job || { blobs: data.blobs || [] });
    workerScope.postMessage({ type: 'result', blob });
  } catch (error) {
    workerScope.postMessage({ type: 'error', error: String(error?.message || error) });
  }
};
