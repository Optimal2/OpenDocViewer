// @vitest-environment jsdom
// File: src/components/__tests__/printPipeline.test.jsx
/**
 * The ONE print pipeline (DocumentToolbar/usePrintPipeline.js) shared by the toolbar and the two
 * compare views: one dialog, one options builder, one submit path and one direct/PDF decision.
 *
 * - The side-by-side compare print keeps its exact log row and print helper.
 * - The overlay and curtain views print through the same submit path with their CURRENT state
 *   ({ opacity, top, transforms, zoom, stage } / { mode, position, transforms, zoom, stage }) and
 *   log a row of the same shape with pageCount 1.
 * - Static locks: the toolbar no longer owns a dialog, an options builder or a submit path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import en from '../../../public/locales/en/common.json';
import sv from '../../../public/locales/sv/common.json';
import toolbarSource from '../DocumentToolbar/DocumentToolbar.jsx?raw';
import pipelineSource from '../DocumentToolbar/usePrintPipeline.js?raw';
import dialogsSource from '../DocumentToolbar/PrintPipelineDialogs.jsx?raw';
import viewerSource from '../DocumentViewer/DocumentViewer.jsx?raw';
import { toolbarAttributeBlock, elementAttributeBlock } from './toolbarAttributeBlock.js';
import overlaySource from '../DocumentViewer/CompareOverlayView.jsx?raw';
import curtainSource from '../DocumentViewer/CompareCurtainView.jsx?raw';
import dialogSource from '../DocumentToolbar/PrintRangeDialog.jsx?raw';

const printUtils = vi.hoisted(() => ({
  handlePrint: vi.fn(),
  handlePrintAll: vi.fn(),
  handlePrintRange: vi.fn(),
  handlePrintSequence: vi.fn(),
  handlePrintCurrentComparison: vi.fn(),
  handlePrintCompareOverlay: vi.fn(),
  handlePrintCompareCurtain: vi.fn(),
  handlePdfOutput: vi.fn(),
  handlePdfCurrent: vi.fn(),
  handlePdfCurrentComparison: vi.fn(),
  handlePdfCompareOverlay: vi.fn(),
  handlePdfCompareCurtain: vi.fn(),
  downloadPdfBlob: vi.fn(),
  printPdfBlob: vi.fn(async () => {}),
}));
const submitPrint = vi.hoisted(() => vi.fn());

vi.mock('../../utils/printUtils.js', () => printUtils);
vi.mock('../../logging/userLogger.js', () => ({ default: { submitPrint } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options) => (options && options.defaultValue) || key,
    i18n: { language: 'en' },
  }),
}));

const { default: usePrintPipeline } = await import('../DocumentToolbar/usePrintPipeline.js');

const documentRenderRef = { current: { id: 'primary-render' } };
const compareRef = { current: { id: 'compare-render' } };
const viewerContainerRef = { current: null };

/**
 * Mount the pipeline in a harness that mirrors DocumentViewer's dialog open state.
 * @param {Object=} overrides
 */
async function mountPipeline(overrides = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const state = { pipeline: null, dialogOpen: false };
  let setOpen = () => {};

  function Harness() {
    const [open, setOpenState] = useState(false);
    setOpen = setOpenState;
    state.dialogOpen = open;
    state.pipeline = usePrintPipeline({
      printEnabled: true,
      isDocumentLoading: false,
      memoryPressureStage: 'normal',
      pageNumber: 3,
      pageNumberDisplay: 3,
      totalPages: 9,
      totalPagesDisplay: 9,
      comparePageNumber: 7,
      comparePageNumberDisplay: 7,
      setComparePageNumber: () => {},
      isComparing: true,
      sessionTotalPages: 9,
      allPages: Array.from({ length: 9 }, (_v, index) => ({ documentId: `doc-${index + 1}` })),
      bundle: null,
      hasActiveSelection: false,
      visibleOriginalPageNumbers: [],
      selectionIncludedCount: 0,
      printSelectionSequenceLocked: false,
      documentRenderRef,
      compareRef,
      viewerContainerRef,
      isPrintDialogOpen: open,
      openPrintDialog: () => setOpenState(true),
      closePrintDialog: () => setOpenState(false),
      ...overrides,
    });
    return null;
  }

  await act(() => root.render(createElement(Harness)));
  return {
    state,
    setOpen: (value) => act(() => setOpen(value)),
    cleanup: async () => {
      await act(() => root.unmount());
      container.remove();
    },
  };
}

// Drive the pipeline's timers and intervening promises deterministically. A real
// 120 ms sleep can finish before a nested 50 ms timer when the event loop is busy.
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

/** Complete the submit delay, PDF start delay and their asynchronous continuations. */
async function flushPrint() {
  await act(async () => { await vi.runAllTimersAsync(); });
}

const DETAIL = Object.freeze({
  reason: 'Case review',
  forWhom: 'Clinic',
  printFormat: 'Copy',
  printFormatValue: 'COPY',
  reasonSelection: null,
  printFormatSelection: null,
  pdfOrientation: '',
});

const overlayTarget = () => ({
  view: 'overlay',
  primaryRenderRef: { current: { id: 'overlay-A' } },
  compareRenderRef: { current: { id: 'overlay-B' } },
  getView: vi.fn(() => ({
    opacity: 40,
    top: 'compare',
    transforms: { primary: { scale: 1, dx: 0, dy: 0, rotation: 0 }, compare: { scale: 1.2, dx: 4, dy: -2, rotation: 0.5 } },
    zoom: 1.25,
    stage: { width: 800, height: 600 },
  })),
});

const curtainTarget = () => ({
  view: 'curtain',
  primaryRenderRef: { current: { id: 'curtain-A' } },
  compareRenderRef: { current: { id: 'curtain-B' } },
  getView: vi.fn(() => ({
    mode: 'horizontal',
    position: 30,
    transforms: { primary: { scale: 1, dx: 0, dy: 0, rotation: 0 }, compare: { scale: 1, dx: 0, dy: 0, rotation: 0 } },
    zoom: 0.8,
    stage: { width: 700, height: 500 },
  })),
});

/** The options builder's keys: identical for the side-by-side and the composed prints. */
const OPTION_KEYS = [
  'action', 'bundle', 'documentRenderRef', 'filename', 'forWhom', 'pageContexts', 'pageNumbers',
  'pdfCfg', 'pdfOrientation', 'printFooterCfg', 'printFormat', 'printFormatCfg', 'printFormatSelection',
  'printHeaderCfg', 'reason', 'reasonSelection', 'viewerContainerRef',
];

describe('usePrintPipeline: side-by-side compare print (unchanged)', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('direct print: handlePrintCurrentComparison with both render refs and the same log row as before', async () => {
    const { state, setOpen, cleanup } = await mountPipeline();
    await setOpen(true);
    await act(() => state.pipeline.handlePrintSubmit({ ...DETAIL, mode: 'active', activeScope: 'compare-both', printBackend: 'html', printAction: 'print' }));
    expect(state.dialogOpen).toBe(false);
    expect(submitPrint).toHaveBeenCalledTimes(1);
    expect(submitPrint).toHaveBeenCalledWith({
      action: 'print',
      reason: 'Case review',
      forWhom: 'Clinic',
      printFormat: 'Copy',
      printFormatValue: 'COPY',
      docId: null,
      fileName: null,
      pageCount: 2,
      pages: '3,7',
      copies: 1,
    });
    await flushPrint();
    expect(printUtils.handlePrintCurrentComparison).toHaveBeenCalledTimes(1);
    const [primaryRef, secondRef, options] = printUtils.handlePrintCurrentComparison.mock.calls[0];
    expect(primaryRef).toBe(documentRenderRef);
    expect(secondRef).toBe(compareRef);
    expect(Object.keys(options).sort()).toEqual(OPTION_KEYS);
    expect(options.pageNumbers).toEqual([3, 7]);
    expect(options.action).toBe('print');
    expect(printUtils.handlePrintCompareOverlay).not.toHaveBeenCalled();
    expect(printUtils.handlePrintCompareCurtain).not.toHaveBeenCalled();
    await cleanup();
  });

  it('generated PDF: handlePdfCurrentComparison and a print-pdf log row', async () => {
    printUtils.handlePdfCurrentComparison.mockResolvedValueOnce(new Blob(['%PDF'], { type: 'application/pdf' }));
    const { state, cleanup } = await mountPipeline();
    await act(() => state.pipeline.handlePrintSubmit({ ...DETAIL, mode: 'active', activeScope: 'compare-both', printBackend: 'pdf', printAction: 'print' }));
    expect(submitPrint.mock.calls[0][0]).toMatchObject({ action: 'print-pdf', pageCount: 2, pages: '3,7' });
    await flushPrint();
    expect(printUtils.handlePdfCurrentComparison).toHaveBeenCalledTimes(1);
    expect(printUtils.handlePdfCurrentComparison.mock.calls[0][0]).toBe(documentRenderRef);
    expect(printUtils.handlePdfCurrentComparison.mock.calls[0][1]).toBe(compareRef);
    expect(printUtils.handlePdfCompareOverlay).not.toHaveBeenCalled();
    await cleanup();
  });

  it('the toolbar\'s own dialog open carries no compare-view target', async () => {
    const { state, cleanup } = await mountPipeline();
    await act(() => state.pipeline.openPrintDialog());
    expect(state.dialogOpen).toBe(true);
    expect(state.pipeline.dialogProps.composedView).toBeNull();
    await cleanup();
  });
});

describe('usePrintPipeline: overlay and curtain views through the same pipeline', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('overlay: opens the shared dialog for the view and prints its current state as one page', async () => {
    const { state, cleanup } = await mountPipeline();
    const target = overlayTarget();
    await act(() => state.pipeline.openComposedPrintDialog(target));
    expect(state.dialogOpen).toBe(true);
    expect(state.pipeline.dialogProps.composedView).toBe('overlay');

    await act(() => state.pipeline.handlePrintSubmit({ ...DETAIL, mode: 'active', activeScope: 'primary', printBackend: 'html', printAction: 'print' }));
    expect(state.dialogOpen).toBe(false);
    expect(target.getView).toHaveBeenCalledTimes(1);
    expect(submitPrint).toHaveBeenCalledWith({
      action: 'print',
      reason: 'Case review',
      forWhom: 'Clinic',
      printFormat: 'Copy',
      printFormatValue: 'COPY',
      docId: null,
      fileName: null,
      pageCount: 1,
      pages: '3,7',
      copies: 1,
    });
    await flushPrint();
    expect(printUtils.handlePrintCompareOverlay).toHaveBeenCalledTimes(1);
    const [refA, refB, view, options] = printUtils.handlePrintCompareOverlay.mock.calls[0];
    expect(refA).toBe(target.primaryRenderRef);
    expect(refB).toBe(target.compareRenderRef);
    expect(view).toEqual({
      opacity: 40,
      top: 'compare',
      transforms: { primary: { scale: 1, dx: 0, dy: 0, rotation: 0 }, compare: { scale: 1.2, dx: 4, dy: -2, rotation: 0.5 } },
      zoom: 1.25,
      stage: { width: 800, height: 600 },
    });
    expect(Object.keys(options).sort()).toEqual(OPTION_KEYS);
    expect(options.reason).toBe('Case review');
    expect(printUtils.handlePrintCurrentComparison).not.toHaveBeenCalled();
    expect(printUtils.handlePrint).not.toHaveBeenCalled();
    await cleanup();
  });

  it('curtain: download-pdf goes through handlePdfCompareCurtain with the view state', async () => {
    printUtils.handlePdfCompareCurtain.mockResolvedValueOnce(new Blob(['%PDF'], { type: 'application/pdf' }));
    const { state, cleanup } = await mountPipeline();
    const target = curtainTarget();
    await act(() => state.pipeline.openComposedPrintDialog(target));
    expect(state.pipeline.dialogProps.composedView).toBe('curtain');
    await act(() => state.pipeline.handlePrintSubmit({ ...DETAIL, mode: 'active', activeScope: 'primary', printBackend: 'pdf', printAction: 'download' }));
    expect(submitPrint.mock.calls[0][0]).toMatchObject({ action: 'download-pdf', pageCount: 1, pages: '3,7', reason: 'Case review', forWhom: 'Clinic', printFormat: 'Copy' });
    await flushPrint();
    expect(printUtils.handlePdfCompareCurtain).toHaveBeenCalledTimes(1);
    const [refA, refB, view, options] = printUtils.handlePdfCompareCurtain.mock.calls[0];
    expect(refA).toBe(target.primaryRenderRef);
    expect(refB).toBe(target.compareRenderRef);
    expect(view).toEqual(expect.objectContaining({ mode: 'horizontal', position: 30, zoom: 0.8, stage: { width: 700, height: 500 } }));
    expect(options).toEqual(expect.objectContaining({ action: 'download', deferOutput: true }));
    expect(printUtils.handlePdfCurrentComparison).not.toHaveBeenCalled();
    expect(printUtils.handlePdfCurrent).not.toHaveBeenCalled();
    await flushPrint();
    expect(printUtils.downloadPdfBlob).toHaveBeenCalledTimes(1);
    await cleanup();
  });

  it('curtain: print-pdf log row for a generated PDF print', async () => {
    printUtils.handlePdfCompareCurtain.mockResolvedValueOnce(new Blob(['%PDF'], { type: 'application/pdf' }));
    const { state, cleanup } = await mountPipeline();
    await act(() => state.pipeline.openComposedPrintDialog(curtainTarget()));
    await act(() => state.pipeline.handlePrintSubmit({ ...DETAIL, mode: 'active', activeScope: 'primary', printBackend: 'pdf', printAction: 'print' }));
    expect(submitPrint.mock.calls[0][0]).toMatchObject({ action: 'print-pdf', pageCount: 1 });
    await flushPrint();
    expect(printUtils.handlePdfCompareCurtain).toHaveBeenCalledTimes(1);
    await cleanup();
  });

  it('closing the dialog drops the compare-view target, so the next toolbar print is side-by-side again', async () => {
    const { state, setOpen, cleanup } = await mountPipeline();
    await act(() => state.pipeline.openComposedPrintDialog(overlayTarget()));
    await setOpen(false);
    expect(state.pipeline.dialogProps.composedView).toBeNull();
    await act(() => state.pipeline.openPrintDialog());
    await act(() => state.pipeline.handlePrintSubmit({ ...DETAIL, mode: 'active', activeScope: 'compare-both', printBackend: 'html', printAction: 'print' }));
    await flushPrint();
    expect(printUtils.handlePrintCurrentComparison).toHaveBeenCalledTimes(1);
    expect(printUtils.handlePrintCompareOverlay).not.toHaveBeenCalled();
    await cleanup();
  });

  it('refuses a compare-view print while the document is still loading', async () => {
    const { state, cleanup } = await mountPipeline({ isDocumentLoading: true });
    await act(() => state.pipeline.openComposedPrintDialog(overlayTarget()));
    expect(state.dialogOpen).toBe(false);
    expect(state.pipeline.dialogProps.composedView).toBeNull();
    await cleanup();
  });
});

describe('one pipeline, not two (static locks)', () => {
  const count = (source, pattern) => (source.match(pattern) || []).length;
  const all = [toolbarSource, pipelineSource, dialogsSource, viewerSource, overlaySource, curtainSource];

  it('exactly one dialog render, one options builder, one submit path, one direct/PDF decision', () => {
    expect(all.reduce((sum, source) => sum + count(source, /<PrintRangeDialog\b/g), 0)).toBe(1);
    expect(count(dialogsSource, /<PrintRangeDialog\b/g)).toBe(1);
    expect(all.reduce((sum, source) => sum + count(source, /const makePrintOptions = useCallback/g), 0)).toBe(1);
    expect(all.reduce((sum, source) => sum + count(source, /userLog\.submitPrint\(/g), 0)).toBe(1);
    expect(all.reduce((sum, source) => sum + count(source, /printBackend === 'pdf'\) \{/g), 0)).toBe(1);
    expect(count(pipelineSource, /userLog\.submitPrint\(/g)).toBe(1);
    expect(count(pipelineSource, /const handlePrintSubmit = useCallback/g)).toBe(1);
  });

  it('the toolbar and the compare views own no print helper calls of their own', () => {
    for (const source of [toolbarSource, overlaySource, curtainSource, viewerSource]) {
      expect(source).not.toMatch(/handlePrint(CurrentComparison|CompareOverlay|CompareCurtain)\(/);
      expect(source).not.toMatch(/handlePdf(CurrentComparison|CompareOverlay|CompareCurtain)\(/);
      expect(source).not.toMatch(/userLog\.submitPrint/);
    }
  });

  it('DocumentViewer owns the one instance and hands it to the toolbar and both views', () => {
    expect(count(viewerSource, /usePrintPipeline\(/g)).toBe(1);
    expect(viewerSource).toMatch(/<PrintPipelineDialogs pipeline=\{printPipeline\} \/>/);
    // Anchored to the toolbar element's OWN attribute block: deleting the prop here, or
    // moving it to a later element, turns this red (see toolbarAttributeBlock.js).
    expect(toolbarAttributeBlock(viewerSource)).toMatch(/printPipeline=\{printPipeline\}/);
    // Both props on the same CompareOverlayView element. The old
    // `<Element[\s\S]*?onPrint[\s\S]*?printDialogs` idiom stayed green when
    // onPrint and printDialogs sat on two different elements, or when either
    // prop was commented out. elementAttributeBlock requires exactly one
    // uncommented match and returns the element's own attribute block.
    const compareOverlayBlock = elementAttributeBlock(viewerSource, 'CompareOverlayView');
    expect(compareOverlayBlock).toMatch(/onPrint=\{printEnabled \? openComposedPrintDialog : undefined\}/);
    expect(compareOverlayBlock).toMatch(/printDialogs=\{comparePrintDialogs\}/);
    const compareCurtainBlock = elementAttributeBlock(viewerSource, 'CompareCurtainView');
    expect(compareCurtainBlock).toMatch(/onPrint=\{printEnabled \? openComposedPrintDialog : undefined\}/);
    expect(compareCurtainBlock).toMatch(/printDialogs=\{comparePrintDialogs\}/);
    for (const source of [toolbarSource, overlaySource, curtainSource]) {
      expect(source).not.toMatch(/usePrintPipeline\(/);
    }
    // The dialog host renders inside whichever `.toolbar` is shown (toolbar, overlay or curtain).
    expect(toolbarSource).toMatch(/<PrintPipelineDialogs pipeline=\{printPipeline\} \/>/);
    expect(overlaySource).toMatch(/\{printDialogs\}\s*<\/div>/);
    expect(curtainSource).toMatch(/\{printDialogs\}\s*<\/div>/);
  });

  it('the dialog has a compare-view mode (one page, no scope choice)', () => {
    expect(dialogSource).toMatch(/composedView/);
  });
});

describe('compare-view print strings', () => {
  /** @param {Object} resources @param {string} key */
  const lookup = (resources, key) => key.split('.').reduce((node, part) => (node ? node[part] : undefined), resources);
  const keys = [
    'compareOverlay.print',
    'compareOverlay.printShort',
    'compareCurtain.print',
    'compareCurtain.printShort',
    'printDialog.summaryCompareOverlay',
    'printDialog.summaryCompareCurtain',
  ];

  it('the print button label, tooltip and dialog summary exist in English and Swedish', () => {
    for (const key of keys) {
      expect(typeof lookup(en, key), `en: ${key}`).toBe('string');
      expect(typeof lookup(sv, key), `sv: ${key}`).toBe('string');
      expect(lookup(sv, key), `sv differs from en: ${key}`).not.toBe(lookup(en, key));
    }
    expect(overlaySource).toMatch(/t\('compareOverlay\.print', \{ defaultValue: /);
    expect(curtainSource).toMatch(/t\('compareCurtain\.print', \{ defaultValue: /);
  });
});
