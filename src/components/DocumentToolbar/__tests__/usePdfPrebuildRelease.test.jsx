// @vitest-environment jsdom
// The PDF prebuild collects leased page URLs and must release them through
// its try/finally on both success and failure (review finding F5).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('../../../logging/systemLogger.js', () => ({
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));
vi.mock('../../../utils/printPdf.js', () => ({
  collectPrintablePdfSources: vi.fn(),
  createPrintPdfBlob: vi.fn(),
  releasePrintablePdfSources: vi.fn(),
}));
vi.mock('../../../utils/pdfPrebuildPlan.js', () => ({
  createPdfPrebuildAllPagesVariants: vi.fn(),
  getPdfPrebuildAllPagesLanguageDependency: () => 'ignore',
}));
vi.mock('../../../utils/pdfPrintCacheKey.js', () => ({
  getPdfPrintCacheKey: () => 'test-cache-key',
  getPdfPrintCacheKeyOptions: () => ({}),
  isFullSessionPageSequence: () => true,
}));
vi.mock('../../../utils/runtimeConfig.js', () => ({
  getRuntimeConfig: () => ({}),
}));

import usePdfPrebuildAllPages from '../usePdfPrebuildAllPages.js';
import { createPdfPrebuildAllPagesVariants } from '../../../utils/pdfPrebuildPlan.js';
import {
  collectPrintablePdfSources,
  createPrintPdfBlob,
  releasePrintablePdfSources,
} from '../../../utils/printPdf.js';

const cleanups = [];
afterEach(async () => {
  await act(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  collectPrintablePdfSources.mockReset();
  createPrintPdfBlob.mockReset();
  releasePrintablePdfSources.mockReset();
  createPdfPrebuildAllPagesVariants.mockReset();
  createPdfPrebuildAllPagesVariants.mockReturnValue({
    enabled: true,
    config: { startDelayMs: 10, maxPages: 10, concurrency: 1 },
    variants: [{ key: 'v1' }],
  });
});

async function renderPrebuild() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const probe = { api: null };
  function Probe() {
    probe.api = usePdfPrebuildAllPages({
      printEnabled: true,
      isDocumentLoading: false,
      sessionTotalPages: 2,
      documentRenderRef: { current: {} },
      makePrintOptions: () => ({}),
      paused: false,
    });
    return null;
  }
  await act(() => root.render(createElement(Probe)));
  cleanups.push(() => {
    root.unmount();
    container.remove();
  });
  return probe;
}

async function runPrebuildTimers() {
  await act(async () => {
    await vi.runAllTimersAsync();
  });
}

describe('usePdfPrebuildAllPages lease release', () => {
  it('releases the collected page URLs after a successful prebuild', async () => {
    collectPrintablePdfSources.mockResolvedValue(['blob:pre-a', 'blob:pre-b']);
    createPrintPdfBlob.mockResolvedValue(new Blob(['x'], { type: 'application/pdf' }));

    await renderPrebuild();
    expect(collectPrintablePdfSources).not.toHaveBeenCalled();
    await runPrebuildTimers();

    expect(collectPrintablePdfSources).toHaveBeenCalledTimes(1);
    expect(createPrintPdfBlob).toHaveBeenCalledTimes(1);
    expect(releasePrintablePdfSources).toHaveBeenCalledTimes(1);
    expect(releasePrintablePdfSources).toHaveBeenCalledWith({ current: {} }, ['blob:pre-a', 'blob:pre-b']);
  });

  it('releases the collected page URLs when the page count mismatches', async () => {
    // A short collection (superseded session) throws inside the try; the
    // finally must still release the single leased URL.
    collectPrintablePdfSources.mockResolvedValue(['blob:pre-only']);

    await renderPrebuild();
    await runPrebuildTimers();

    expect(createPrintPdfBlob).not.toHaveBeenCalled();
    expect(releasePrintablePdfSources).toHaveBeenCalledTimes(1);
    expect(releasePrintablePdfSources).toHaveBeenCalledWith({ current: {} }, ['blob:pre-only']);
  });
});
