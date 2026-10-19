// @vitest-environment jsdom
// Surface-capture print paths must lease the live <img> blob URL they consume
// (review findings F1/F3/F4 on the leased print URL fix). Every test below
// fails against the pre-fix code, which never leases surface URLs, never
// releases the all-pages lease when token-context creation throws, and
// releases duplicate page selections per occurrence instead of per lease.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('i18next', () => ({ default: { t: (key, options) => options?.defaultValue ?? key } }));
vi.mock('dompurify', () => ({ default: { sanitize: (value) => value } }));
vi.mock('../../logging/systemLogger.js', () => ({
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));
vi.mock('../printDom.js', () => ({ renderSingleDocument: vi.fn(), renderMultiDocument: vi.fn() }));
vi.mock('../printTemplate.js', () => ({
  applyTemplateTokensEscaped: () => '',
  makeBaseTokenContext: vi.fn(() => ({})),
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

import {
  handlePrint,
  handlePrintAll,
  handlePrintCurrentComparison,
  handlePrintSequence,
} from '../printCore.js';
import { renderMultiDocument, renderSingleDocument } from '../printDom.js';
import { makeBaseTokenContext } from '../printTemplate.js';
import {
  createPdfFromDocumentHandle,
  handlePdfCurrent,
  handlePdfCurrentComparison,
} from '../printPdf.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

/** Render handle whose printable surface is a live <img> with a blob URL. */
function makeImgSurfaceRef(url, extraCurrent = {}) {
  const img = document.createElement('img');
  Object.defineProperty(img, 'currentSrc', { value: url, configurable: true });
  const leasePrintablePageUrl = vi.fn();
  const releasePrintableDataUrls = vi.fn();
  return {
    img,
    current: {
      getPrintableSurface: () => img,
      leasePrintablePageUrl,
      releasePrintableDataUrls,
      ...extraCurrent,
    },
    leasePrintablePageUrl,
    releasePrintableDataUrls,
  };
}

/** Render handle whose getAllPrintableDataUrls hands out leased blob URLs. */
function makeCollectionHandle(urls) {
  const releasePrintableDataUrls = vi.fn();
  const getAllPrintableDataUrls = vi.fn(async () => [...urls]);
  return {
    current: { getAllPrintableDataUrls, releasePrintableDataUrls },
    releasePrintableDataUrls,
    getAllPrintableDataUrls,
  };
}

/** Stub global Image so PDF image loading always fails fast (never hangs). */
function stubFailingImage() {
  class FailingImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
    }

    set src(_value) {
      queueMicrotask(() => {
        try {
          this.onerror?.(new Error('image load failed'));
        } catch {}
      });
    }

    get src() {
      return '';
    }

    addEventListener() {}

    removeEventListener() {}
  }
  vi.stubGlobal('Image', FailingImage);
}

describe('F1: single-page print leases the live surface URL', () => {
  it('leases the img blob URL and releases it when the print iframe cleans up', () => {
    vi.useFakeTimers();
    const ref = makeImgSurfaceRef('blob:single-page');
    handlePrint(ref, {});
    expect(renderSingleDocument).toHaveBeenCalledTimes(1);
    expect(ref.leasePrintablePageUrl).toHaveBeenCalledTimes(1);
    expect(ref.leasePrintablePageUrl).toHaveBeenCalledWith('blob:single-page');
    expect(ref.releasePrintableDataUrls).not.toHaveBeenCalled();
    const frame = document.querySelector('iframe');
    expect(frame).not.toBeNull();
    frame.contentWindow.dispatchEvent(new Event('afterprint'));
    expect(ref.releasePrintableDataUrls).toHaveBeenCalledTimes(1);
    expect(ref.releasePrintableDataUrls).toHaveBeenCalledWith(['blob:single-page']);
  });

  it('releases the surface lease when token-context creation throws', () => {
    const ref = makeImgSurfaceRef('blob:single-token');
    makeBaseTokenContext.mockImplementationOnce(() => {
      throw new Error('token context boom');
    });
    expect(() => handlePrint(ref, {})).toThrow('token context boom');
    expect(ref.leasePrintablePageUrl).toHaveBeenCalledWith('blob:single-token');
    expect(renderSingleDocument).not.toHaveBeenCalled();
    expect(ref.releasePrintableDataUrls).toHaveBeenCalledTimes(1);
    expect(ref.releasePrintableDataUrls).toHaveBeenCalledWith(['blob:single-token']);
  });

  it('does not lease a canvas snapshot (data URL, nothing to revoke)', () => {
    const canvas = { tagName: 'CANVAS', width: 100, height: 100, toDataURL: () => 'data:image/png;base64,AAA' };
    const leasePrintablePageUrl = vi.fn();
    const releasePrintableDataUrls = vi.fn();
    const ref = {
      current: { getPrintableSurface: () => canvas, leasePrintablePageUrl, releasePrintableDataUrls },
    };
    handlePrint(ref, {});
    expect(renderSingleDocument).toHaveBeenCalledTimes(1);
    expect(leasePrintablePageUrl).not.toHaveBeenCalled();
    expect(releasePrintableDataUrls).not.toHaveBeenCalled();
  });
});

describe('F1: side-by-side compare print leases both pane URLs', () => {
  it('leases both img blob URLs and releases them on iframe cleanup', () => {
    vi.useFakeTimers();
    const primary = makeImgSurfaceRef('blob:compare-a');
    const compare = makeImgSurfaceRef('blob:compare-b');
    handlePrintCurrentComparison(primary, compare, {});
    expect(renderMultiDocument).toHaveBeenCalledTimes(1);
    expect(primary.leasePrintablePageUrl).toHaveBeenCalledWith('blob:compare-a');
    expect(compare.leasePrintablePageUrl).toHaveBeenCalledWith('blob:compare-b');
    const frame = document.querySelector('iframe');
    expect(frame).not.toBeNull();
    frame.contentWindow.dispatchEvent(new Event('afterprint'));
    expect(primary.releasePrintableDataUrls).toHaveBeenCalledWith(['blob:compare-a']);
    expect(compare.releasePrintableDataUrls).toHaveBeenCalledWith(['blob:compare-b']);
  });

  it('releases both pane leases when token-context creation throws', () => {
    const primary = makeImgSurfaceRef('blob:compare-token-a');
    const compare = makeImgSurfaceRef('blob:compare-token-b');
    makeBaseTokenContext.mockImplementationOnce(() => {
      throw new Error('token context boom');
    });
    expect(() => handlePrintCurrentComparison(primary, compare, {})).toThrow('token context boom');
    expect(renderMultiDocument).not.toHaveBeenCalled();
    expect(primary.releasePrintableDataUrls).toHaveBeenCalledWith(['blob:compare-token-a']);
    expect(compare.releasePrintableDataUrls).toHaveBeenCalledWith(['blob:compare-token-b']);
  });
});

describe('F1: current-page PDF export leases the img branch URL', () => {
  it('handlePdfCurrent leases and releases the live img URL even when generation fails', async () => {
    stubFailingImage();
    const ref = makeImgSurfaceRef('blob:pdf-current');
    await expect(handlePdfCurrent(ref, {})).rejects.toThrow();
    expect(ref.leasePrintablePageUrl).toHaveBeenCalledTimes(1);
    expect(ref.leasePrintablePageUrl).toHaveBeenCalledWith('blob:pdf-current');
    expect(ref.releasePrintableDataUrls).toHaveBeenCalledTimes(1);
    expect(ref.releasePrintableDataUrls).toHaveBeenCalledWith(['blob:pdf-current']);
  });

  it('handlePdfCurrentComparison leases and releases both live img URLs on failure', async () => {
    stubFailingImage();
    const primary = makeImgSurfaceRef('blob:pdf-compare-a');
    const compare = makeImgSurfaceRef('blob:pdf-compare-b');
    await expect(handlePdfCurrentComparison(primary, compare, {})).rejects.toThrow();
    expect(primary.leasePrintablePageUrl).toHaveBeenCalledWith('blob:pdf-compare-a');
    expect(compare.leasePrintablePageUrl).toHaveBeenCalledWith('blob:pdf-compare-b');
    expect(primary.releasePrintableDataUrls).toHaveBeenCalledWith(['blob:pdf-compare-a']);
    expect(compare.releasePrintableDataUrls).toHaveBeenCalledWith(['blob:pdf-compare-b']);
  });
});

describe('F3: all-pages lease released when token-context creation throws', () => {
  it('handlePrintAll releases the collected lease when makeBaseTokenContext throws', async () => {
    const ref = makeCollectionHandle(['blob:all-a', 'blob:all-b']);
    makeBaseTokenContext.mockImplementationOnce(() => {
      throw new Error('token context boom');
    });
    await expect(handlePrintAll(ref, {})).rejects.toThrow('token context boom');
    expect(ref.getAllPrintableDataUrls).toHaveBeenCalledTimes(1);
    expect(renderMultiDocument).not.toHaveBeenCalled();
    expect(ref.releasePrintableDataUrls).toHaveBeenCalledTimes(1);
    expect(ref.releasePrintableDataUrls).toHaveBeenCalledWith(['blob:all-a', 'blob:all-b']);
  });

  it('handlePrintSequence releases the collected lease when makeBaseTokenContext throws', async () => {
    const ref = makeCollectionHandle(['blob:seq-a', 'blob:seq-b']);
    makeBaseTokenContext.mockImplementationOnce(() => {
      throw new Error('token context boom');
    });
    await expect(handlePrintSequence(ref, [1], {})).rejects.toThrow('token context boom');
    expect(ref.releasePrintableDataUrls).toHaveBeenCalledTimes(1);
    expect(ref.releasePrintableDataUrls).toHaveBeenCalledWith(['blob:seq-a', 'blob:seq-b']);
  });
});

describe('F4: duplicate page selection releases per lease, not per occurrence', () => {
  it('legacy zero-arg handle with [1,1] keeps a concurrent lease alive', async () => {
    stubFailingImage();
    // A concurrent flow already holds one lease on blob:u1.
    const outstanding = new Map([['blob:u1', 1]]);
    const releaseCalls = [];
    const ref = {
      current: {
        // Zero declared parameters: the legacy subset path (one lease per URL).
        async getAllPrintableDataUrls() {
          for (const url of ['blob:u1', 'blob:u2']) {
            outstanding.set(url, (outstanding.get(url) || 0) + 1);
          }
          return ['blob:u1', 'blob:u2'];
        },
        releasePrintableDataUrls(urls) {
          releaseCalls.push([...urls]);
          for (const url of urls) {
            const count = outstanding.get(url) || 0;
            if (count > 0) outstanding.set(url, count - 1);
          }
        },
      },
    };
    expect(ref.current.getAllPrintableDataUrls.length).toBe(0);
    await expect(createPdfFromDocumentHandle(ref, [1, 1], {})).rejects.toThrow();
    // The unselected URL is released, and the selected URL is released exactly
    // once for its single lease — never twice for its two occurrences.
    expect(releaseCalls).toContainEqual(['blob:u2']);
    expect(releaseCalls).toContainEqual(['blob:u1']);
    expect(releaseCalls.some((call) => call.length === 2 && call[0] === 'blob:u1' && call[1] === 'blob:u1')).toBe(false);
    expect(outstanding.get('blob:u1')).toBe(1);
  });
});
