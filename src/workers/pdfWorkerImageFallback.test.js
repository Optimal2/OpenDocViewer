// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const worker = { postMessage: vi.fn() };
beforeEach(async () => {
  vi.stubGlobal('self', worker);
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    blob: async () => new Blob(['image'], { type: 'image/png' }),
  })));
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 32, height: 24, close: vi.fn() })));
  worker.FileReaderSync = class { readAsDataURL() { return 'data:image/png;base64,AA=='; } };
  pdf.addImage.mockReset();
  pdf.output.mockClear();
  worker.postMessage.mockClear();
  await import('./pdfWorker.js');
});
afterEach(() => vi.unstubAllGlobals());

async function runJob(sourceFormat) {
  await worker.onmessage({ data: { type: 'createPdf', job: {
    urls: ['blob:odv-print-image'],
    sourceFormats: sourceFormat ? [sourceFormat] : [],
    pagePlans: [{}],
    pdfCfg: {},
    workerPlan: { imageLoadConcurrency: 1 },
  } } });
  return worker.postMessage.mock.calls.map(([message]) => message)
    .filter((message) => message.type === 'result' || message.type === 'error')
    .at(-1);
}

describe('PDF worker image fallback formats', () => {
  it('degrades an ordinary PNG to JPEG when native PNG embedding fails', async () => {
    pdf.addImage.mockImplementation((_image, format) => {
      if (format === 'PNG') throw new Error('PNG embed failed');
    });
    const result = await runJob('image/png');
    expect(result.type).toBe('result');
    expect(pdf.addImage.mock.calls.map(([, format]) => format)).toEqual(['PNG', 'JPEG']);
  });

  it('keeps JPEG XL output lossless-only when its PNG embed fails', async () => {
    pdf.addImage.mockImplementation(() => { throw new Error('PNG embed failed'); });
    const result = await runJob('image/jxl');
    expect(result).toMatchObject({ type: 'error' });
    expect(result.error).toMatch(/JPEG XL.*losslessly/i);
    expect(pdf.addImage.mock.calls.map(([, format]) => format)).toEqual(['PNG']);
  });

  it('converts native AVIF input to PNG for jsPDF without JPEG degradation', async () => {
    pdf.addImage.mockImplementationOnce(() => { throw new Error('Native AVIF cannot be embedded'); });
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(width, height) { this.width = width; this.height = height; }
      getContext() { return { clearRect: vi.fn(), drawImage: vi.fn() }; }
      async convertToBlob({ type }) { return new Blob(['converted'], { type }); }
    });

    const result = await runJob('image/avif');

    expect(result.type).toBe('result');
    expect(pdf.addImage.mock.calls.map(([, format]) => format)).toEqual(['PNG', 'PNG']);
  });
});
