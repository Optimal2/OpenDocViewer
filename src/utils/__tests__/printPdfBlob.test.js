// printPdfBlob: the CSP-blocked print iframe must reject through the fallback,
// never hang. A frame the CSP refused to load (frame-src/default-src without
// blob:) throws a cross-origin SecurityError on the contentWindow.print PROBE
// itself; before 2026-09-15 that probe sat outside the try block, the throw was
// uncaught and the print flow hung at "Förbereder utskrift 100 %" with no error
// (measured against ODVGateway's default CSP).
import { afterEach, describe, expect, it, vi } from 'vitest';

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

import { printPdfBlob } from '../printPdf.js';

function securityError() {
  return typeof DOMException === 'function'
    ? new DOMException(
        "Failed to read a named property 'print' from 'Window': Blocked a frame from accessing a cross-origin frame.",
        'SecurityError'
      )
    : new Error('SecurityError: cross-origin frame');
}

/** Stub document/window/URL around a fake iframe whose contentWindow is supplied per test. */
function stubDom(contentWindowGetter) {
  const frame = {
    style: {},
    setAttribute: () => {},
    addEventListener: () => {},
    remove: () => {},
    get contentWindow() {
      return contentWindowGetter();
    },
  };
  const openSpy = vi.fn(() => null);
  vi.stubGlobal('document', { createElement: () => frame, body: { appendChild: () => {} } });
  vi.stubGlobal('window', {
    // Run every timer inline so the fallback path executes synchronously.
    setTimeout: (fn) => {
      fn();
      return 1;
    },
    open: openSpy,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:odv-test', revokeObjectURL: () => {} });
  return { frame, openSpy };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('printPdfBlob', () => {
  it('rejects via the window fallback when the frame probe throws cross-origin (CSP-blocked)', async () => {
    const { openSpy } = stubDom(() => {
      throw securityError();
    });

    await expect(printPdfBlob(new Blob(['%PDF'], { type: 'application/pdf' }))).rejects.toThrow();
    expect(openSpy).toHaveBeenCalled();
  });

  it('rejects via the window fallback when the frame has no print function', async () => {
    const { openSpy } = stubDom(() => ({}));

    await expect(printPdfBlob(new Blob(['%PDF'], { type: 'application/pdf' }))).rejects.toThrow();
    expect(openSpy).toHaveBeenCalled();
  });

  it('prints and resolves when the frame window is reachable', async () => {
    const printSpy = vi.fn();
    stubDom(() => ({ print: printSpy, focus: () => {}, addEventListener: () => {}, removeEventListener: () => {} }));

    await expect(printPdfBlob(new Blob(['%PDF'], { type: 'application/pdf' }))).resolves.toBeUndefined();
    expect(printSpy).toHaveBeenCalledTimes(1);
  });
});
