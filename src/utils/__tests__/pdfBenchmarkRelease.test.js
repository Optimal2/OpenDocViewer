// @vitest-environment jsdom
// The PDF benchmark collects leased page URLs and must release them through
// its try/finally on both success and failure (review finding F5).
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../logging/systemLogger.js', () => ({
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));
vi.mock('../printPdf.js', () => ({
  collectPrintablePdfSources: vi.fn(),
  createPrintPdfBlob: vi.fn(),
  releasePrintablePdfSources: vi.fn(),
}));
vi.mock('../supportDiagnostics.js', () => ({
  collectSupportDiagnostics: () => ({}),
  saveLatestPdfBenchmarkResult: vi.fn(),
}));

import { runPdfGenerationBenchmark } from '../pdfBenchmark.js';
import {
  collectPrintablePdfSources,
  createPrintPdfBlob,
  releasePrintablePdfSources,
} from '../printPdf.js';

afterEach(() => {
  vi.useRealTimers();
});

const BENCHMARK_CONFIG = {
  print: {
    pdf: {
      benchmark: {
        enabled: true,
        profile: 'focused',
        strategies: ['main-thread'],
        imageLoadConcurrencies: [0],
        iterations: 1,
        delayBetweenRunsMs: 0,
        maxRuns: 40,
        pageLimit: 80,
      },
    },
  },
};

describe('runPdfGenerationBenchmark lease release', () => {
  it('releases the collected source URLs when the benchmark completes', async () => {
    collectPrintablePdfSources.mockResolvedValue(['blob:bench-a', 'blob:bench-b']);
    createPrintPdfBlob.mockResolvedValue(new Blob(['x'], { type: 'application/pdf' }));
    const ref = { current: {} };

    const result = await runPdfGenerationBenchmark({
      documentRenderRef: ref,
      pageNumbers: [1, 2],
      baseOptions: {},
      config: BENCHMARK_CONFIG,
    });

    expect(result.pageCount).toBe(2);
    expect(createPrintPdfBlob).toHaveBeenCalledTimes(1);
    expect(releasePrintablePdfSources).toHaveBeenCalledTimes(1);
    expect(releasePrintablePdfSources).toHaveBeenCalledWith(ref, ['blob:bench-a', 'blob:bench-b']);
  });

  it('releases the collected source URLs when PDF generation fails', async () => {
    collectPrintablePdfSources.mockResolvedValue(['blob:bench-a', 'blob:bench-b']);
    createPrintPdfBlob.mockRejectedValue(new Error('generation boom'));
    const ref = { current: {} };

    await expect(
      runPdfGenerationBenchmark({
        documentRenderRef: ref,
        pageNumbers: [1, 2],
        baseOptions: {},
        config: BENCHMARK_CONFIG,
      })
    ).rejects.toThrow('generation boom');
    expect(releasePrintablePdfSources).toHaveBeenCalledTimes(1);
    expect(releasePrintablePdfSources).toHaveBeenCalledWith(ref, ['blob:bench-a', 'blob:bench-b']);
  });
});
