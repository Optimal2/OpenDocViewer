// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTrackedObjectUrl, revokeTrackedObjectUrl } from '../objectUrlRegistry.js';

const pdf = vi.hoisted(() => ({
  addImage: vi.fn(),
  output: vi.fn(() => new Blob(['%PDF'], { type: 'application/pdf' })),
}));

vi.mock('jspdf', () => {
  class JsPdfMock {
    addImage(...args) { return pdf.addImage(...args); }
    output(...args) { return pdf.output(...args); }
  }
  return { jsPDF: JsPdfMock, default: { jsPDF: JsPdfMock } };
});
vi.mock('i18next', () => ({ default: { t: (key, options) => options?.defaultValue ?? key } }));
vi.mock('dompurify', () => ({ default: { sanitize: (value) => value } }));
vi.mock('../../logging/systemLogger.js', () => ({
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));
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

import { createPrintPdfBlob } from '../printPdf.js';

class ImmediateImage {
  constructor() {
    this.naturalWidth = 32;
    this.naturalHeight = 24;
    this.width = 32;
    this.height = 24;
    this.currentSrc = '';
    this._src = '';
  }
  set src(value) {
    this._src = value;
    this.currentSrc = value;
    queueMicrotask(() => this.onload?.());
  }
  get src() { return this._src; }
}

beforeEach(() => {
  vi.stubGlobal('Image', ImmediateImage);
  pdf.addImage.mockReset();
  pdf.output.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('generated PDF image fallback formats', () => {
  it('degrades an ordinary PNG to JPEG when native PNG embedding fails', async () => {
    pdf.addImage.mockImplementation((_image, format) => {
      if (format === 'PNG') throw new Error('PNG embed failed');
    });
    const result = await createPrintPdfBlob(['data:image/png;base64,AA==']);
    expect(result.type).toBe('application/pdf');
    expect(pdf.addImage.mock.calls.map(([, format]) => format)).toEqual(['PNG', 'JPEG']);
  });

  it('keeps tracked JPEG XL output lossless-only and names the source when PNG embedding fails', async () => {
    const url = createTrackedObjectUrl(
      new Blob(['decoded PNG'], { type: 'image/png' }),
      { sourceFormat: 'image/jxl' }
    );
    pdf.addImage.mockImplementation(() => { throw new Error('PNG embed failed'); });
    try {
      await expect(createPrintPdfBlob([url])).rejects.toThrow(/JPEG XL.*losslessly/i);
      expect(pdf.addImage.mock.calls.map(([, format]) => format)).toEqual(['PNG']);
    } finally {
      revokeTrackedObjectUrl(url);
    }
  });

  it('keeps AVIF lossless-only and names AVIF when PNG embedding fails', async () => {
    pdf.addImage.mockImplementation(() => { throw new Error('PNG embed failed'); });
    await expect(createPrintPdfBlob(['data:image/avif;base64,AA=='])).rejects.toThrow(/AVIF.*losslessly/i);
    expect(pdf.addImage.mock.calls.map(([, format]) => format)).toEqual(['PNG']);
  });

  it('converts a native AVIF display image to PNG for jsPDF without JPEG degradation', async () => {
    pdf.addImage.mockImplementation((image) => {
      if (typeof image !== 'string') throw new Error('Native AVIF element cannot be embedded');
    });
    vi.stubGlobal('document', { createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ clearRect: vi.fn(), drawImage: vi.fn() }),
      toDataURL: (type) => `data:${type};base64,AA==`,
    }) });

    const result = await createPrintPdfBlob(['data:image/avif;base64,AA==']);

    expect(result.type).toBe('application/pdf');
    expect(pdf.addImage.mock.calls.map(([, format]) => format)).toEqual(['PNG', 'PNG']);
    expect(pdf.addImage.mock.calls[1][0]).toMatch(/^data:image\/png/);
  });
});
