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
  const frameListeners = new Map();
  const frame = {
    style: {},
    setAttribute: () => {},
    addEventListener: (name, fn) => {
      frameListeners.set(name, fn);
    },
    remove: () => {},
    get contentWindow() {
      return contentWindowGetter();
    },
  };
  const openSpy = vi.fn(() => null);
  // Timers are queued, not run inline, so a test can choose which entry path
  // fires: flushing without a load event exercises the fallback timer, while
  // dispatching 'load' first exercises the production load-event path.
  const timerQueue = [];
  const flushTimers = () => {
    while (timerQueue.length > 0) timerQueue.shift()();
  };
  vi.stubGlobal('document', { createElement: () => frame, body: { appendChild: () => {} } });
  vi.stubGlobal('window', {
    setTimeout: (fn) => {
      timerQueue.push(fn);
      return timerQueue.length;
    },
    open: openSpy,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:odv-test', revokeObjectURL: () => {} });
  const dispatchFrameEvent = (name) => {
    frameListeners.get(name)?.();
  };
  return { frame, openSpy, flushTimers, dispatchFrameEvent };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('printPdfBlob', () => {
  // NOTE: the rejection assertions alone do not separate fixed from broken
  // code — with queued timers a pre-fix uncaught throw becomes a rejection via
  // the Promise machinery. The openSpy assertions are the load-bearing ones:
  // before the fix the throw skipped the fallback entirely (verified by
  // running this file against the pre-fix printPdf.js: only they fail).
  it('rejects via the window fallback when the frame probe throws cross-origin (CSP-blocked)', async () => {
    const { openSpy, flushTimers } = stubDom(() => {
      throw securityError();
    });

    const outcome = printPdfBlob(new Blob(['%PDF'], { type: 'application/pdf' }));
    flushTimers();
    await expect(outcome).rejects.toThrow();
    expect(openSpy).toHaveBeenCalled();
  });

  it('rejects via the window fallback when the frame has no print function', async () => {
    const { openSpy, flushTimers } = stubDom(() => ({}));

    const outcome = printPdfBlob(new Blob(['%PDF'], { type: 'application/pdf' }));
    flushTimers();
    await expect(outcome).rejects.toThrow();
    expect(openSpy).toHaveBeenCalled();
  });

  it('prints and resolves via the load event when the frame window is reachable', async () => {
    const printSpy = vi.fn();
    const { openSpy, flushTimers, dispatchFrameEvent } = stubDom(() => ({
      print: printSpy,
      focus: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

    const outcome = printPdfBlob(new Blob(['%PDF'], { type: 'application/pdf' }));
    // The production entry path: the iframe load event fires, then its queued
    // focus-delay timer runs. The later fallback timer must be a no-op.
    dispatchFrameEvent('load');
    flushTimers();
    await expect(outcome).resolves.toBeUndefined();
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).not.toHaveBeenCalled();
  });
});
