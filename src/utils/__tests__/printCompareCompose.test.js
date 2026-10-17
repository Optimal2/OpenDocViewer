// Overlay and curtain printing: what the user sees in the two compare views is composed onto ONE
// offscreen canvas and printed as ONE page. Page B over page A at the current opacity and top page
// (overlay), page B clipped at the current border (curtain), each page with its own compare
// transform. The canvas is a recording fake: every 2D call is logged with the globalAlpha in force.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('i18next', () => ({ default: { t: (key, options) => options?.defaultValue ?? key } }));
vi.mock('dompurify', () => ({ default: { sanitize: (value) => value } }));
vi.mock('../../logging/systemLogger.js', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../printDom.js', () => ({ renderSingleDocument: vi.fn(), renderMultiDocument: vi.fn() }));
vi.mock('../printTemplate.js', () => ({
  applyTemplateTokensEscaped: () => '',
  makeBaseTokenContext: vi.fn(() => ({ base: true })),
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

import logger from '../../logging/systemLogger.js';
import { renderSingleDocument, renderMultiDocument } from '../printDom.js';
import { makeBaseTokenContext } from '../printTemplate.js';
import { handlePrintCompareCurtain, handlePrintCompareOverlay, handlePrintCurrentComparison } from '../printCore.js';
import { handlePdfCompareCurtain, handlePdfCompareOverlay } from '../printPdf.js';
import * as printUtils from '../printUtils.js';
import { buildImageFilter, needsCanvas } from '../imageAdjustments.js';
import renderSource from '../../components/DocumentRender.jsx?raw';
import paneRenderSource from '../../components/DocumentViewer/DocumentViewerRender.jsx?raw';
import overlaySource from '../../components/DocumentViewer/CompareOverlayView.jsx?raw';
import curtainSource from '../../components/DocumentViewer/CompareCurtainView.jsx?raw';

const IDENTITY = { scale: 1, dx: 0, dy: 0, rotation: 0 };
const IDENTITY_TRANSFORMS = { primary: IDENTITY, compare: IDENTITY };
const RECORDED = ['save', 'restore', 'setTransform', 'translate', 'scale', 'rotate', 'beginPath', 'rect', 'clip', 'fillRect', 'drawImage'];

/** A source page surface as DocumentRender.getActiveCanvas() returns it. */
function sourceCanvas(name, width, height) {
  return { tagName: 'CANVAS', name, width, height, toDataURL: () => `data:image/png;base64,${name}` };
}

/** Render handle around a surface (null = no active canvas). */
function renderRef(node) {
  return { current: { getActiveCanvas: () => node } };
}

let created;

/** The composed canvases created by the code under test, each with its call log. */
function makeOutputCanvas() {
  const log = [];
  const ctx = { globalAlpha: 1, fillStyle: '' };
  RECORDED.forEach((op) => {
    ctx[op] = (...args) => { log.push({ op, args, alpha: ctx.globalAlpha }); };
  });
  // A filter on the composed canvas would apply the colour a second time (or undo it); log it.
  let filter = 'none';
  Object.defineProperty(ctx, 'filter', {
    get: () => filter,
    set: (value) => { filter = value; log.push({ op: 'filter', args: [value], alpha: ctx.globalAlpha }); },
  });
  const canvas = {
    tagName: 'CANVAS',
    width: 0,
    height: 0,
    log,
    getContext: () => ctx,
    toDataURL: () => 'data:image/png;base64,COMPOSED',
  };
  created.push(canvas);
  return canvas;
}

function draws(canvas) {
  return canvas.log.filter((entry) => entry.op === 'drawImage');
}

/** The transform calls applied to one page: from its setTransform up to its drawImage. */
function opsBeforeDraw(canvas, node) {
  const index = canvas.log.findIndex((entry) => entry.op === 'drawImage' && entry.args[0] === node);
  let start = index;
  while (start > 0 && canvas.log[start].op !== 'setTransform') start -= 1;
  return canvas.log.slice(start + 1, index + 1).map(({ op, args }) => [op, ...args.filter((arg) => arg !== node)]);
}

function clipRect(canvas) {
  const index = canvas.log.findIndex((entry) => entry.op === 'clip');
  return index > 0 ? canvas.log[index - 1].args : null;
}

const A = sourceCanvas('A', 200, 100);
const B = sourceCanvas('B', 200, 100);

describe('ordinary active-page geometry', () => {
  it('prints scale, CSS offset and residual rotation inside the original page frame', async () => {
    const { composePagePrintCanvas } = await import('../printCore.js');
    const canvas = composePagePrintCanvas(A, { scale: 1.2, dx: 16, dy: -8, rotation: 90.5 }, 2);
    expect([canvas.width, canvas.height]).toEqual([200, 100]);
    expect(opsBeforeDraw(canvas, A)).toEqual([
      ['translate', 100, 50], ['scale', 1.2, 1.2], ['translate', 8, -4],
      ['rotate', 0.5 * Math.PI / 180], ['translate', -100, -50], ['drawImage', 0, 0, 200, 100],
    ]);
    expect(canvas.log.find((entry) => entry.op === 'fillRect').args).toEqual([0, 0, 200, 100]);
  });
  it('ordinary print and PDF use the fine-tuned surface; composed views keep raw surfaces', async () => {
    const { resolvePrintableSurface } = await import('../printCore.js');
    const tuned = sourceCanvas('TUNED', 200, 100);
    const getPrintableSurface = vi.fn(() => tuned);
    const ref = { current: { getActiveCanvas: () => A, getPrintableSurface } };
    expect(resolvePrintableSurface(ref)).toBe(tuned);
    const { handlePdfCurrent } = await import('../printPdf.js');
    const controller = new AbortController();
    await expect(handlePdfCurrent(ref, { deferOutput: true,
      signal: controller.signal, onProgress: () => controller.abort(),
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(getPrintableSurface).toHaveBeenCalledTimes(2);
    handlePrintCompareOverlay(ref, renderRef(B), { opacity: 50, transforms: IDENTITY_TRANSFORMS });
    expect(draws(created[0]).map((entry) => entry.args[0])).toContain(A);
  });
});

beforeEach(() => {
  created = [];
  vi.clearAllMocks();
  vi.useFakeTimers();
  const frame = { style: {}, setAttribute: () => {}, remove: () => {}, contentDocument: { iframe: true }, contentWindow: null };
  vi.stubGlobal('document', {
    createElement: (tag) => (tag === 'canvas' ? makeOutputCanvas() : frame),
    body: { appendChild: () => {} },
  });
  vi.stubGlobal('window', {
    __ODV_CONFIG__: { printHeader: { enabled: true }, printFooter: { enabled: false }, print: { format: { watermark: {} } } },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('handlePrintCompareOverlay', () => {
  it.each([0, 50, 100])('draws the top page at %i %% opacity over an opaque bottom page', (opacity) => {
    handlePrintCompareOverlay(renderRef(A), renderRef(B), { opacity, top: 'compare', transforms: IDENTITY_TRANSFORMS });

    const [bottom, top] = draws(created[0]);
    expect(bottom.args[0]).toBe(A);
    expect(bottom.alpha).toBe(1);
    expect(top.args[0]).toBe(B);
    expect(top.alpha).toBeCloseTo(opacity / 100, 10);
  });

  it('puts the page chosen as top on top (swap)', () => {
    handlePrintCompareOverlay(renderRef(A), renderRef(B), { opacity: 30, top: 'primary', transforms: IDENTITY_TRANSFORMS });

    const [bottom, top] = draws(created[0]);
    expect(bottom.args[0]).toBe(B);
    expect(bottom.alpha).toBe(1);
    expect(top.args[0]).toBe(A);
    expect(top.alpha).toBeCloseTo(0.3, 10);
  });

  it('applies each page its own transform (scale, pan in page pixels, residual rotation)', () => {
    const transforms = {
      // 90.5 degrees: the canvas already carries the quarter turn, the composition adds 0.5.
      primary: { scale: 2, dx: 10, dy: -4, rotation: 90.5 },
      // 359 degrees: residual -1.
      compare: { scale: 0.5, dx: -20, dy: 6, rotation: 359 },
    };
    const pageA = sourceCanvas('A', 100, 50);
    const pageB = sourceCanvas('B', 80, 40);
    handlePrintCompareOverlay(renderRef(pageA), renderRef(pageB), { opacity: 50, top: 'compare', transforms, zoom: 2 });

    const canvas = created[0];
    const toRad = (deg) => (deg * Math.PI) / 180;
    const opsA = opsBeforeDraw(canvas, pageA);
    expect(opsA.slice(0, 4)).toEqual([['translate', 50, 25], ['scale', 2, 2], ['translate', 5, -2], ['rotate', expect.any(Number)]]);
    expect(opsA[3][1]).toBeCloseTo(toRad(0.5), 10);
    expect(opsA.slice(4)).toEqual([['translate', -50, -25], ['drawImage', 0, 0, 100, 50]]);

    const opsB = opsBeforeDraw(canvas, pageB);
    expect(opsB.slice(0, 3)).toEqual([['translate', 40, 20], ['scale', 0.5, 0.5], ['translate', -10, 3]]);
    expect(opsB[3][0]).toBe('rotate');
    expect(opsB[3][1]).toBeCloseTo(toRad(-1), 10);
    expect(opsB.slice(4)).toEqual([['translate', -40, -20], ['drawImage', 0, 0, 80, 40]]);
  });

  it('sizes the composed page to cover both transformed pages', () => {
    const pageA = sourceCanvas('A', 100, 100);
    const pageB = sourceCanvas('B', 100, 100);
    const transforms = { primary: IDENTITY, compare: { ...IDENTITY, dx: 50, dy: -20 } };
    handlePrintCompareOverlay(renderRef(pageA), renderRef(pageB), { opacity: 50, top: 'compare', transforms });

    const canvas = created[0];
    expect([canvas.width, canvas.height]).toEqual([150, 120]);
    // The frame starts at the top-most page edge: everything moves 20 px down.
    expect(canvas.log.find((entry) => entry.op === 'setTransform').args).toEqual([1, 0, 0, 1, 0, 20]);
  });

  it('uses the visible stage as the composed page when the stage size is given', () => {
    handlePrintCompareOverlay(renderRef(A), renderRef(B), {
      opacity: 50, top: 'compare', transforms: IDENTITY_TRANSFORMS, zoom: 2, stage: { width: 300, height: 120 },
    });
    expect([created[0].width, created[0].height]).toEqual([150, 60]);
  });

  it('prints ONE composed page with the same config, base context and log line as the side-by-side print', () => {
    const options = {
      printDelayMs: 25,
      reason: 'Audit',
      forWhom: 'Clinic',
      printFormat: 'Copy',
      reasonSelection: { id: 'r' },
      printFormatSelection: { id: 'f' },
      bundle: { documents: [] },
      pageContexts: [{ page: 1 }, { page: 2 }],
    };
    const primaryRef = renderRef(A);
    handlePrintCompareOverlay(primaryRef, renderRef(B), { opacity: 50, top: 'compare', transforms: IDENTITY_TRANSFORMS }, options);

    expect(logger.info.mock.calls[0][0]).toBe('handlePrintCompareOverlay invoked');
    expect(makeBaseTokenContext).toHaveBeenCalledWith(primaryRef.current, 'Audit', 'Clinic', 'Copy', {
      bundle: options.bundle, reasonSelection: options.reasonSelection, printFormatSelection: options.printFormatSelection,
    });
    expect(renderMultiDocument).not.toHaveBeenCalled();
    expect(renderSingleDocument).toHaveBeenCalledTimes(1);
    const [doc, opts] = renderSingleDocument.mock.calls[0];
    expect(doc).toEqual({ iframe: true });
    expect(opts).toEqual({
      dataUrl: 'data:image/png;base64,COMPOSED',
      orientation: 'landscape',
      printDelayMs: 25,
      printHeaderCfg: { enabled: true },
      printFooterCfg: { enabled: false },
      printFormatCfg: { watermark: {} },
      tokenContext: { base: true },
      pageContexts: [{ page: 1 }],
    });
  });

  it.each([
    ['primary', null, B],
    ['compare', A, null],
  ])('refuses safely when the %s canvas is missing', (_side, nodeA, nodeB) => {
    handlePrintCompareOverlay(renderRef(nodeA), renderRef(nodeB), { opacity: 50, top: 'compare', transforms: IDENTITY_TRANSFORMS });

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(0);
    expect(renderSingleDocument).not.toHaveBeenCalled();
  });
});

describe('handlePrintCompareCurtain', () => {
  // Both pages 200 x 100 with identity transforms: the composed page is 200 x 100.
  it.each([
    ['vertical', 0, [0, 0, 200, 100]],
    ['vertical', 50, [100, 0, 100, 100]],
    ['vertical', 100, [200, 0, 0, 100]],
    ['horizontal', 0, [0, 0, 200, 100]],
    ['horizontal', 50, [0, 50, 200, 50]],
    ['horizontal', 100, [0, 100, 200, 0]],
  ])('clips page B for a %s border at %i %%', (mode, position, rect) => {
    handlePrintCompareCurtain(renderRef(A), renderRef(B), { mode, position, transforms: IDENTITY_TRANSFORMS });

    const canvas = created[0];
    expect([canvas.width, canvas.height]).toEqual([200, 100]);
    expect(clipRect(canvas)).toEqual(rect);
    // Page A first, unclipped; page B after the clip, fully opaque.
    const ops = canvas.log.map((entry) => entry.op);
    const [drawA, drawB] = draws(canvas);
    expect(drawA.args[0]).toBe(A);
    expect(drawB.args[0]).toBe(B);
    expect(drawB.alpha).toBe(1);
    expect(ops.indexOf('clip')).toBeGreaterThan(canvas.log.indexOf(drawA));
    expect(ops.indexOf('clip')).toBeLessThan(canvas.log.indexOf(drawB));
  });

  it('maps the border on the visible stage when the stage size is given', () => {
    handlePrintCompareCurtain(renderRef(A), renderRef(B), {
      mode: 'vertical', position: 25, transforms: IDENTITY_TRANSFORMS, zoom: 2, stage: { width: 800, height: 200 },
    });
    const canvas = created[0];
    expect([canvas.width, canvas.height]).toEqual([400, 100]);
    expect(clipRect(canvas)).toEqual([100, 0, 300, 100]);
  });

  it('applies both pages their own transform under the curtain', () => {
    const transforms = { primary: { ...IDENTITY, scale: 1.5 }, compare: { ...IDENTITY, dx: 12, dy: 8 } };
    handlePrintCompareCurtain(renderRef(A), renderRef(B), { mode: 'vertical', position: 50, transforms });

    const canvas = created[0];
    expect(opsBeforeDraw(canvas, A).slice(0, 3)).toEqual([['translate', 100, 50], ['scale', 1.5, 1.5], ['translate', 0, 0]]);
    expect(opsBeforeDraw(canvas, B).slice(0, 3)).toEqual([['translate', 100, 50], ['scale', 1, 1], ['translate', 12, 8]]);
  });

  it('prints ONE composed page with the curtain log line', () => {
    handlePrintCompareCurtain(renderRef(A), renderRef(B), { mode: 'horizontal', position: 40, transforms: IDENTITY_TRANSFORMS }, {
      pageContexts: [{ page: 1 }, { page: 2 }],
    });
    expect(logger.info.mock.calls[0][0]).toBe('handlePrintCompareCurtain invoked');
    expect(renderMultiDocument).not.toHaveBeenCalled();
    expect(renderSingleDocument).toHaveBeenCalledTimes(1);
    expect(renderSingleDocument.mock.calls[0][1].dataUrl).toBe('data:image/png;base64,COMPOSED');
    expect(renderSingleDocument.mock.calls[0][1].pageContexts).toEqual([{ page: 1 }]);
  });

  it('refuses safely when a canvas is missing', () => {
    handlePrintCompareCurtain(renderRef(A), renderRef(null), { mode: 'vertical', position: 50, transforms: IDENTITY_TRANSFORMS });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(0);
    expect(renderSingleDocument).not.toHaveBeenCalled();
  });
});

describe('generated-PDF siblings', () => {
  /** Stop the PDF job right after it reports the page count, before any image loading. */
  function stopAfterFirstProgress() {
    const controller = new AbortController();
    const events = [];
    return {
      events,
      options: {
        signal: controller.signal,
        onProgress: (event) => { events.push(event); controller.abort(); },
      },
    };
  }

  it.each([
    ['overlay', handlePdfCompareOverlay, { opacity: 40, top: 'primary', transforms: IDENTITY_TRANSFORMS }],
    ['curtain', handlePdfCompareCurtain, { mode: 'horizontal', position: 30, transforms: IDENTITY_TRANSFORMS }],
  ])('composes the %s view into a ONE-page PDF', async (_name, handler, view) => {
    const { events, options } = stopAfterFirstProgress();
    await expect(handler(renderRef(A), renderRef(B), view, options)).rejects.toThrow();

    expect(created).toHaveLength(1);
    expect(draws(created[0]).map((entry) => entry.args[0])).toEqual(_name === 'overlay' ? [B, A] : [A, B]);
    expect(events[0]).toMatchObject({ total: 1 });
  });

  it.each([
    ['overlay', handlePdfCompareOverlay, { opacity: 40, top: 'compare', transforms: IDENTITY_TRANSFORMS }],
    ['curtain', handlePdfCompareCurtain, { mode: 'vertical', position: 50, transforms: IDENTITY_TRANSFORMS }],
  ])('rejects the %s PDF when a canvas is missing', async (_name, handler, view) => {
    await expect(handler(renderRef(A), renderRef(null), view, {})).rejects.toThrow(/compare/);
    expect(created).toHaveLength(0);
  });
});

// Grayscale and invert reach print through the EXISTING canvas: a page with any colour adjustment
// is drawn on its canvas with the filter baked into the pixels, getActiveCanvas() returns that
// canvas, and all three print paths read only that surface. These locks keep a later change from
// printing the unfiltered page (the <img> or the asset URL) or filtering the composed page again.
describe('grayscale and invert reach all three print paths through the filtered canvas', () => {
  const COLOUR = { rotation: 0, brightness: 100, contrast: 100, grayscale: 100, invert: true };
  // The pixels the viewer canvas holds after drawing with the colour filter.
  const FILTERED_A = sourceCanvas('FILTERED-A', 200, 100);
  const FILTERED_B = sourceCanvas('FILTERED-B', 200, 100);
  /** A render handle whose canvas is filtered while its <img> still holds the original page. */
  function filteredRenderRef(canvas) {
    const img = { tagName: 'IMG', src: 'blob:original-unfiltered', currentSrc: 'blob:original-unfiltered', naturalWidth: 200, naturalHeight: 100 };
    return { current: { getActiveCanvas: () => (needsCanvas(COLOUR) ? canvas : img) } };
  }

  it('the colour adjustment selects the canvas and is part of its filter', () => {
    expect(needsCanvas({ grayscale: 1 })).toBe(true);
    expect(needsCanvas({ invert: true })).toBe(true);
    expect(buildImageFilter(COLOUR)).toBe('brightness(100%) contrast(100%) grayscale(100%) invert(100%)');
  });

  it('side by side: prints each pane\'s filtered canvas pixels', () => {
    handlePrintCurrentComparison(filteredRenderRef(FILTERED_A), filteredRenderRef(FILTERED_B), {});
    expect(renderMultiDocument).toHaveBeenCalledTimes(1);
    expect(renderMultiDocument.mock.calls[0][1].dataUrls).toEqual([
      'data:image/png;base64,FILTERED-A',
      'data:image/png;base64,FILTERED-B',
    ]);
  });

  it.each([
    ['overlay', handlePrintCompareOverlay, { opacity: 50, top: 'compare', transforms: IDENTITY_TRANSFORMS }],
    ['curtain', handlePrintCompareCurtain, { mode: 'vertical', position: 50, transforms: IDENTITY_TRANSFORMS }],
  ])('%s: composes the filtered canvases and never sets a filter on the composed page', (_name, handler, view) => {
    handler(filteredRenderRef(FILTERED_A), filteredRenderRef(FILTERED_B), view, {});
    expect(created).toHaveLength(1);
    const sources = draws(created[0]).map((entry) => entry.args[0]);
    expect(sources).toHaveLength(2);
    expect(sources).toEqual(expect.arrayContaining([FILTERED_A, FILTERED_B]));
    expect(created[0].log.filter((entry) => entry.op === 'filter')).toEqual([]);
    expect(renderSingleDocument.mock.calls[0][1].dataUrl).toBe('data:image/png;base64,COMPOSED');
  });

  it('the render surface: getActiveCanvas() is the canvas whenever the canvas is enabled', () => {
    expect(renderSource).toMatch(/getActiveCanvas\(\)\s*\{\s*return isCanvasEnabled \? canvasRef\.current : imgRef\.current;/);
  });

  it('the canvas draw sizes the canvas, then sets the colour filter, then draws the page', () => {
    // Assigning canvas.width/height resets the 2D state, ctx.filter included: the resize must come first.
    const filterAt = renderSource.indexOf('ctx.filter = buildImageFilter(imageProperties);');
    expect(filterAt).toBeGreaterThan(0);
    const drawAt = renderSource.indexOf('ctx.drawImage(image,', filterAt);
    expect(drawAt).toBeGreaterThan(filterAt);
    const resize = 'canvas.height = requestedCanvasSize.height;';
    const resizeAt = renderSource.lastIndexOf(resize, filterAt);
    expect(resizeAt).toBeGreaterThan(0);
    expect(renderSource.slice(resizeAt + resize.length, drawAt)).not.toMatch(/\bcanvas\.(?:width|height)\s*=[^=]/);
  });

  it('every compare view enables the canvas from the same image properties it draws with', () => {
    expect(paneRenderSource).toMatch(/const primaryCanvasEnabled = needsCanvas\(primaryImageProperties\);/);
    expect(paneRenderSource).toMatch(/const compareCanvasEnabled = needsCanvas\(compareImageProperties\);/);
    expect(overlaySource).toMatch(/imageProperties=\{imageProperties\}\s*isCanvasEnabled=\{needsCanvas\(imageProperties\)\}/);
    expect(curtainSource).toMatch(/imageProperties=\{imagePropertiesA\}\s*isCanvasEnabled=\{needsCanvas\(imagePropertiesA\)\}/);
    expect(curtainSource).toMatch(/imageProperties=\{imagePropertiesB\}\s*isCanvasEnabled=\{needsCanvas\(imagePropertiesB\)\}/);
  });
});

describe('printUtils facade', () => {
  it('exports the four compare-view print functions', () => {
    for (const name of ['handlePrintCompareOverlay', 'handlePrintCompareCurtain', 'handlePdfCompareOverlay', 'handlePdfCompareCurtain']) {
      expect(typeof printUtils[name]).toBe('function');
      expect(typeof printUtils.default[name]).toBe('function');
    }
  });
});
