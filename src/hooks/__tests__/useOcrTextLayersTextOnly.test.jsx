// @vitest-environment jsdom
// File: src/hooks/__tests__/useOcrTextLayersTextOnly.test.jsx
/**
 * useOcrTextLayers with the OCR module's text-only entry (`pdfTextLayer.enabled` with OCR off):
 * no engine is built and no page image is ever asked for or fetched; the whole document is
 * planned whatever `ocr.recognizeWholeDocument` says, each page as soon as it is loaded (its
 * render is not waited for); a PDF page gets its own text, every other page is skipped with
 * the reason `recognition-off`; loading and the pauses still come first; no boost is attached
 * even with `ocr.boost` on; and the prober is released after the idle time. The module is the
 * real text-only entry with a fake prober, so the test also shows the entry is enough.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import useOcrTextLayers, { OCR_IDLE_SHUTDOWN_MS, PDF_TEXT_ONLY_CONCURRENCY } from '../useOcrTextLayers.js';
import { OCR_BOOST_DEFAULTS } from '../../utils/runtimeConfig.js';
import { makeOcrPageKey } from '../../utils/ocrPageKey.js';

vi.mock('../../logging/systemLogger.js', () => ({ default: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() } }));
// The real entry, with pdf.js kept out of the test: the prober is a fake (below).
vi.mock('../../ocr/pdfTextProbe.js', () => ({ DEFAULT_OPEN_PDF_DOCUMENTS: 2, createPdfTextProber: vi.fn() }));

const textEntry = await import('../../ocr/pdfText.js');

const word = (text) => ({ text, confidence: 100, bbox: { x0: 10, y0: 10, x1: 60, y1: 24 } });
const usable = (text) => ({ usable: true, verdict: 'usable', characters: 80, letters: 70, privateUse: 0, words: [word(text)], text, pageWidth: 595, pageHeight: 842 });

function makeProber(answer = async (sourceKey, pageIndex) => usable(`${sourceKey} sida ${pageIndex + 1}`)) {
  return {
    probe: vi.fn(answer),
    retainSources: vi.fn(async () => {}),
    releaseAll: vi.fn(async () => {}),
  };
}

/** The text-only entry as the loader hands it over, with the fake prober. */
const makeModule = (prober) => ({ ...textEntry, createPdfTextProber: () => prober });

function page(sourceKey, pageIndex, overrides = {}) {
  return { sourceKey, pageIndex, fileExtension: 'pdf', status: 1, fullSizeStatus: 0, ...overrides };
}

const flush = () => act(async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); });

let root;
let container;
let latest;

function Harness(props) {
  latest = useOcrTextLayers(props);
  return null;
}

async function render(props) {
  await act(async () => { root.render(createElement(Harness, props)); });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no page image may be fetched'); }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  latest = null;
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const baseProps = (overrides = {}) => ({
  ocrModule: null,
  allPages: [],
  focusPageIndexes: [0],
  ready: true,
  paused: false,
  readSourceArrayBuffer: async () => new ArrayBuffer(8),
  ensurePageAsset: vi.fn(async () => { throw new Error('no page image may be asked for'); }),
  ...overrides,
});

describe('useOcrTextLayers with the text-only entry', () => {
  it('has no engine to build: the entry exports no engine factory', () => {
    expect(textEntry.createConfiguredOcrEngine).toBeUndefined();
    expect(textEntry.createOcrEngine).toBeUndefined();
    expect(textEntry.prepareOcrImage).toBeUndefined();
    expect(typeof textEntry.createOcrQueue).toBe('function');
    expect(typeof textEntry.createOcrResultCache).toBe('function');
    expect(typeof textEntry.planOcrWindow).toBe('function');
    expect(typeof textEntry.detectTextLanguage).toBe('function');
    expect(PDF_TEXT_ONLY_CONCURRENCY).toBe(2);
  });

  it('gives every PDF page of the whole document its own text without a page image', async () => {
    const prober = makeProber();
    // Twelve pages, none rendered at full size: far beyond the window around the shown page.
    const allPages = Array.from({ length: 12 }, (_, index) => page('doc', index));
    const props = baseProps({ ocrModule: makeModule(prober), allPages, wholeDocument: false });
    await render(props);
    await flush();
    await flush();

    expect(prober.probe).toHaveBeenCalledTimes(12);
    for (let index = 0; index < 12; index += 1) {
      expect(latest.ocrPages[makeOcrPageKey('doc', index)]).toMatchObject({ status: 'done', source: 'pdf-text', text: `doc sida ${index + 1}` });
    }
    expect(props.ensurePageAsset).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(latest.ocrEngineFailure).toBeNull();
    expect(latest.ocrBoost).toBeNull();
  });

  it('reads two pages at a time, starting from the shown page', async () => {
    const waiting = [];
    const prober = makeProber(() => new Promise((resolve) => { waiting.push(resolve); }));
    const allPages = Array.from({ length: 6 }, (_, index) => page('doc', index));
    await render(baseProps({ ocrModule: makeModule(prober), allPages, focusPageIndexes: [3] }));
    await flush();
    expect(prober.probe).toHaveBeenCalledTimes(2);
    expect(prober.probe.mock.calls[0]).toEqual(['doc', 3]);
    waiting[0](usable('a'));
    await flush();
    expect(prober.probe).toHaveBeenCalledTimes(3);
  });

  it('skips raster pages and PDF pages without usable text, with the reason recognition-off', async () => {
    const prober = makeProber(async (_sourceKey, pageIndex) => (pageIndex === 0 ? usable('egen text') : { usable: false, verdict: 'empty', characters: 0, letters: 0, privateUse: 0 }));
    const allPages = [page('doc', 0), page('doc', 1), page('scan', 0, { fileExtension: 'tif' }), page('bild', 0, { fileExtension: 'png', fullSizeStatus: 1 })];
    const props = baseProps({ ocrModule: makeModule(prober), allPages });
    await render(props);
    await flush();
    await flush();
    expect(latest.ocrPages[makeOcrPageKey('doc', 0)]).toMatchObject({ status: 'done', source: 'pdf-text' });
    expect(latest.ocrPages[makeOcrPageKey('doc', 1)]).toMatchObject({ status: 'skipped', reason: 'recognition-off' });
    expect(latest.ocrPages[makeOcrPageKey('scan', 0)]).toEqual({ status: 'skipped', reason: 'recognition-off' });
    expect(latest.ocrPages[makeOcrPageKey('bild', 0)]).toEqual({ status: 'skipped', reason: 'recognition-off' });
    // Only the PDF pages were read.
    expect(prober.probe).toHaveBeenCalledTimes(2);
    expect(props.ensurePageAsset).not.toHaveBeenCalled();
  });

  it('waits for a page to be loaded, but not for its render', async () => {
    const prober = makeProber();
    const loading = [page('doc', 0, { status: 0 }), page('doc', 1, { status: 0 })];
    const props = baseProps({ ocrModule: makeModule(prober), allPages: loading });
    await render(props);
    await flush();
    expect(prober.probe).not.toHaveBeenCalled();

    await render({ ...props, allPages: [page('doc', 0, { status: 1, fullSizeStatus: 0 }), page('doc', 1, { status: 0 })] });
    await flush();
    expect(prober.probe).toHaveBeenCalledTimes(1);
    expect(prober.probe.mock.calls[0]).toEqual(['doc', 0]);
  });

  it('reads nothing while the document loads, while paused or before the first page is shown', async () => {
    const prober = makeProber();
    const allPages = [page('doc', 0), page('doc', 1)];
    const props = baseProps({ ocrModule: makeModule(prober), allPages, loading: true });
    await render(props);
    await flush();
    expect(prober.probe).not.toHaveBeenCalled();

    await render({ ...props, loading: false, paused: true });
    await flush();
    expect(prober.probe).not.toHaveBeenCalled();

    await render({ ...props, loading: false, paused: false, ready: false });
    await flush();
    expect(prober.probe).not.toHaveBeenCalled();

    await render({ ...props, loading: false, paused: false, ready: true });
    await flush();
    expect(prober.probe).toHaveBeenCalledTimes(2);
  });

  it('attaches no boost and listens to no input, even with the boost configured', async () => {
    const added = vi.spyOn(window, 'addEventListener');
    const prober = makeProber();
    const allPages = Array.from({ length: 8 }, (_, index) => page('doc', index));
    await render(baseProps({ ocrModule: makeModule(prober), allPages, boost: { ...OCR_BOOST_DEFAULTS, enabled: true }, hardwareThreads: 16 }));
    await flush();
    expect(latest.ocrBoost).toBeNull();
    expect(added.mock.calls.filter(([type]) => ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'].includes(type))).toEqual([]);
    added.mockRestore();
  });

  it('drops a document that leaves and releases the prober after the idle time', async () => {
    vi.useFakeTimers();
    const prober = makeProber();
    const props = baseProps({ ocrModule: makeModule(prober), allPages: [page('one', 0), page('two', 0)] });
    await render(props);
    await flush();
    expect(Object.keys(latest.ocrPages).sort()).toEqual([makeOcrPageKey('one', 0), makeOcrPageKey('two', 0)].sort());

    await render({ ...props, allPages: [page('two', 0)] });
    await flush();
    expect(Object.keys(latest.ocrPages)).toEqual([makeOcrPageKey('two', 0)]);
    expect(prober.retainSources).toHaveBeenLastCalledWith(new Set(['two']));

    expect(prober.releaseAll).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(OCR_IDLE_SHUTDOWN_MS + 1); });
    expect(prober.releaseAll).toHaveBeenCalledTimes(1);
  });

  it('reads own text only with the full module too when recognition is turned off by hand', async () => {
    const prober = makeProber(async () => ({ usable: false, verdict: 'empty' }));
    const createConfiguredOcrEngine = vi.fn();
    const full = { ...makeModule(prober), createConfiguredOcrEngine, prepareOcrImage: vi.fn() };
    const props = baseProps({ ocrModule: full, allPages: [page('doc', 0), page('scan', 0, { fileExtension: 'jpg' })], recognition: false });
    await render(props);
    await flush();
    expect(createConfiguredOcrEngine).not.toHaveBeenCalled();
    expect(latest.ocrPages[makeOcrPageKey('doc', 0)]).toMatchObject({ status: 'skipped', reason: 'recognition-off' });
    expect(latest.ocrPages[makeOcrPageKey('scan', 0)]).toEqual({ status: 'skipped', reason: 'recognition-off' });
    expect(props.ensurePageAsset).not.toHaveBeenCalled();
  });
});
