import { expect, it, vi } from 'vitest';
import { PdfPageWorkerPool } from '../pdfPageWorkerPool.js';

it('preserves effective resolution metadata in both worker response paths', () => {
  const pool = Object.create(PdfPageWorkerPool.prototype);
  pool.workers = [];
  pool.clearPendingTimeout = vi.fn();
  pool.schedulePump = vi.fn();
  const resolve = vi.fn();
  pool.pending = new Map([[1, { resolve }]]);
  const data = {
    type: 'renderPdfPageAssetResult', taskId: 1, ok: true, blob: new Blob(), width: 1875, height: 2654,
    pdfResolution: { scale: 3.1512605042016806, pageWidthPt: 595, pageHeightPt: 842 },
  };
  pool.handleMessage(0, { data });
  expect(resolve.mock.calls[0][0].pdfResolution).toEqual(data.pdfResolution);
  const onItemResult = vi.fn();
  pool.pending.set(2, { type: 'batch', results: [], onItemResult });
  pool.handleMessage(0, { data: { ...data, type: 'renderPdfPageAssetBatchItem', taskId: 2, itemId: 0, itemIndex: 0 } });
  expect(onItemResult.mock.calls[0][0].pdfResolution).toEqual(data.pdfResolution);
});
