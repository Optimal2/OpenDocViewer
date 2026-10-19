// @vitest-environment jsdom
// Lease release paths for print flows: every captured print URL lease must have a
// release path (review findings F1/F2 on the leased print URL fix).
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('i18next', () => ({ default: { t: (key, options) => options?.defaultValue ?? key } }));
vi.mock('dompurify', () => ({ default: { sanitize: (value) => value } }));
vi.mock('../../logging/systemLogger.js', () => ({
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));
vi.mock('../printDom.js', () => ({ renderSingleDocument: vi.fn(), renderMultiDocument: vi.fn() }));
vi.mock('../printTemplate.js', () => ({
  applyTemplateTokensEscaped: () => '',
  makeBaseTokenContext: () => ({}),
  makePageTokenContext: () => ({}),
  resolveCopyMarkerText: () => '',
}));
vi.mock('../localizedValue.js', () => ({ resolveLocalizedValue: (value) => value }));
vi.mock('../printSanitize.js', () => ({ isSafeImageSrc: () => true }));
vi.mock('../printWatermark.js', () => ({ resolveWatermarkAssetSrc: () => null }));
vi.mock('../documentLoadingConfig.js', () => ({ resolveRecommendedWorkerCount: () => 1 }));
vi.mock('../pdfWorkerDispatcher.js', () => ({
  createPdfWithWorkerDispatcher: () => null,
  resolveAutoPdfWorkerBatchSize: () => 1,
}));

import { handlePrintAll, handlePrintSequence } from '../printCore.js';
import { renderMultiDocument } from '../printDom.js';
import { createPdfFromDocumentHandle, handlePdfOutput } from '../printPdf.js';

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

/** Render handle whose getAllPrintableDataUrls hands out leased blob URLs. */
function makeHandle(urls, onCollect) {
  const releasePrintableDataUrls = vi.fn();
  const getAllPrintableDataUrls = vi.fn(async () => {
    onCollect?.();
    return [...urls];
  });
  return {
    current: { getAllPrintableDataUrls, releasePrintableDataUrls },
    releasePrintableDataUrls,
    getAllPrintableDataUrls,
  };
}

describe('handlePrintSequence lease release', () => {
  it('releases leased URLs when the sequence is empty', async () => {
    const ref = makeHandle(['blob:seq-a', 'blob:seq-b']);
    await handlePrintSequence(ref, [], {});
    expect(ref.getAllPrintableDataUrls).toHaveBeenCalledTimes(1);
    expect(ref.releasePrintableDataUrls).toHaveBeenCalledTimes(1);
    expect(ref.releasePrintableDataUrls).toHaveBeenCalledWith(['blob:seq-a', 'blob:seq-b']);
  });

  it('releases leased URLs when a page number is out of range', async () => {
    const ref = makeHandle(['blob:seq-a', 'blob:seq-b']);
    await handlePrintSequence(ref, [1, 99], {});
    expect(ref.releasePrintableDataUrls).toHaveBeenCalledTimes(1);
    expect(ref.releasePrintableDataUrls).toHaveBeenCalledWith(['blob:seq-a', 'blob:seq-b']);
  });
});

describe('print iframe cleanup lease release', () => {
  it('releases leased URLs when the print iframe cleans up', async () => {
    vi.useFakeTimers();
    const ref = makeHandle(['blob:all-a', 'blob:all-b']);
    await handlePrintAll(ref, {});
    expect(renderMultiDocument).toHaveBeenCalledTimes(1);
    expect(ref.releasePrintableDataUrls).not.toHaveBeenCalled();
    const frame = document.querySelector('iframe');
    expect(frame).not.toBeNull();
    frame.contentWindow.dispatchEvent(new Event('afterprint'));
    expect(ref.releasePrintableDataUrls).toHaveBeenCalledTimes(1);
    expect(ref.releasePrintableDataUrls).toHaveBeenCalledWith(['blob:all-a', 'blob:all-b']);
  });
});

describe('aborted PDF export lease release', () => {
  it('createPdfFromDocumentHandle releases URLs collected before the abort', async () => {
    const controller = new AbortController();
    const ref = makeHandle(['blob:pdf-a', 'blob:pdf-b'], () => controller.abort());
    await expect(createPdfFromDocumentHandle(ref, [1, 2], { signal: controller.signal })).rejects.toThrow();
    expect(ref.releasePrintableDataUrls).toHaveBeenCalledTimes(1);
    expect(ref.releasePrintableDataUrls).toHaveBeenCalledWith(['blob:pdf-a', 'blob:pdf-b']);
  });

  it('handlePdfOutput releases URLs collected before the abort', async () => {
    const controller = new AbortController();
    const ref = makeHandle(['blob:pdf-a', 'blob:pdf-b'], () => controller.abort());
    await expect(handlePdfOutput(ref, [1, 2], { signal: controller.signal })).rejects.toThrow();
    expect(ref.releasePrintableDataUrls).toHaveBeenCalledTimes(1);
    expect(ref.releasePrintableDataUrls).toHaveBeenCalledWith(['blob:pdf-a', 'blob:pdf-b']);
  });
});
