// @vitest-environment jsdom
// File: src/components/__tests__/compareViewPrintGating.test.jsx
/**
 * All four config combinations per compare view (compare.<view>.enabled × compare.<view>.print.enabled):
 *
 *   view on  + print on  -> entry button present, print button present
 *   view on  + print off -> entry button present, print button ABSENT
 *   view off + print on  -> entry button ABSENT (the view cannot be reached)
 *   view off + print off -> entry button ABSENT
 *
 * In every case the OTHER view keeps its entry and its print button, and the side-by-side compare
 * print keeps its toolbar button, its dialog scope and its print path.
 *
 * The harness wires the real toolbar, the real compare views, the real dialog host and the ONE
 * print pipeline the way DocumentViewer.jsx does.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement, Fragment, useState } from 'react';
import { createRoot } from 'react-dom/client';

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
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
  }),
}));
vi.mock('../DocumentRender.jsx', async () => {
  const React = await import('react');
  return {
    default: React.forwardRef(function MockRender(props, ref) {
      return React.createElement('div', { ref, className: 'mock-render', 'data-page': String(props.pageNumber) });
    }),
  };
});

const { default: DocumentToolbar } = await import('../DocumentToolbar/DocumentToolbar.jsx');
const { default: usePrintPipeline } = await import('../DocumentToolbar/usePrintPipeline.js');
const { default: CompareOverlayView } = await import('../DocumentViewer/CompareOverlayView.jsx');
const { default: CompareCurtainView } = await import('../DocumentViewer/CompareCurtainView.jsx');
const { resolveShownCompareViews } = await import('../DocumentViewer/hooks/useCompareOverlay.js');

const IDENTITY = { scale: 1, dx: 0, dy: 0, rotation: 0 };
const IMAGE = { rotation: 0, brightness: 100, contrast: 100 };
const noop = () => {};
const documentRenderRef = { current: null };
const compareRef = { current: null };
const viewerContainerRef = { current: null };

/**
 * Viewer-shaped harness: one pipeline instance, the toolbar, the dialog host and whichever compare
 * views the runtime config lets the user reach.
 */
function Viewer({ expose }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const pipeline = usePrintPipeline({
    printEnabled: true,
    isDocumentLoading: false,
    memoryPressureStage: 'normal',
    pageNumber: 1,
    pageNumberDisplay: 1,
    totalPages: 2,
    totalPagesDisplay: 2,
    comparePageNumber: 2,
    comparePageNumberDisplay: 2,
    setComparePageNumber: noop,
    isComparing: true,
    sessionTotalPages: 2,
    allPages: [{}, {}],
    bundle: null,
    hasActiveSelection: false,
    visibleOriginalPageNumbers: [],
    selectionIncludedCount: 0,
    printSelectionSequenceLocked: false,
    documentRenderRef,
    compareRef,
    viewerContainerRef,
    isPrintDialogOpen: dialogOpen,
    openPrintDialog: () => setDialogOpen(true),
    closePrintDialog: () => setDialogOpen(false),
  });
  expose.pipeline = pipeline;
  // Both views report reachable here only when their own switch allows it (the render gate).
  const shown = resolveShownCompareViews({ overlayOpen: true, curtainOpen: true });
  const viewProps = {
    pageNumberA: 1,
    pageNumberB: 2,
    allPages: [{}, {}],
    zoom: 1,
    setZoom: noop,
    imagePropertiesA: IMAGE,
    imagePropertiesB: IMAGE,
    transforms: { primary: IDENTITY, compare: IDENTITY },
    onClose: noop,
  };
  return createElement(Fragment, null,
    createElement('div', { className: 'harness-toolbar' }, createElement(DocumentToolbar, {
      pageNumber: 1,
      totalPages: 2,
      prevPageDisabled: true,
      nextPageDisabled: false,
      firstPageDisabled: true,
      lastPageDisabled: false,
      setPageNumber: noop,
      setComparePageNumber: noop,
      zoomIn: noop,
      zoomOut: noop,
      fitToScreen: noop,
      fitToCustomWidth: noop,
      fitToWidth: noop,
      documentRenderRef,
      compareRef,
      viewerContainerRef,
      printPipeline: pipeline,
      handleCompare: noop,
      isComparing: true,
      comparePageNumber: 2,
      comparePageNumberDisplay: 2,
      primaryImageProperties: IMAGE,
      compareImageProperties: IMAGE,
      handleRotationChange: noop,
      handleBrightnessChange: noop,
      handleContrastChange: noop,
      resetImageProperties: noop,
      allPages: [{}, {}],
      canOpenCompareOverlay: true,
      openCompareOverlay: noop,
      compareCalibrated: true,
      openCompareCurtain: noop,
    })),
    shown.overlay ? createElement('div', { className: 'harness-overlay' }, createElement(CompareOverlayView, {
      ...viewProps,
      onTransformAction: noop,
      overlay: { opacity: 50, top: 'compare' },
      onOverlayAction: noop,
      canResetToCompare: false,
      onResetToCompare: noop,
      onPrint: pipeline.openComposedPrintDialog,
    })) : null,
    shown.curtain ? createElement('div', { className: 'harness-curtain' }, createElement(CompareCurtainView, {
      ...viewProps,
      onPrint: pipeline.openComposedPrintDialog,
    })) : null,
  );
}

async function renderViewer() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const expose = { pipeline: null };
  await act(() => root.render(createElement(Viewer, { expose })));
  return {
    container,
    expose,
    cleanup: async () => {
      await act(() => root.unmount());
      container.remove();
    },
  };
}

const VIEWS = {
  overlay: {
    entry: '.harness-toolbar .compare-overlay-button',
    print: '.harness-overlay .compare-overlay-print',
    region: '.compare-overlay-view',
  },
  curtain: {
    entry: '.harness-toolbar .compare-curtain-button',
    print: '.harness-curtain .compare-curtain-print',
    region: '.compare-curtain-view',
  },
};

const CASES = [
  { viewOn: true, printOn: true, entry: true, print: true },
  { viewOn: true, printOn: false, entry: true, print: false },
  { viewOn: false, printOn: true, entry: false, print: false },
  { viewOn: false, printOn: false, entry: false, print: false },
];

describe.each(['overlay', 'curtain'])('%s view: print gating (4 combinations)', (view) => {
  const other = view === 'overlay' ? 'curtain' : 'overlay';

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.clearAllMocks();
  });
  afterEach(() => {
    delete window.__ODV_CONFIG__;
    vi.unstubAllGlobals();
  });

  it.each(CASES)('view $viewOn + print $printOn -> entry $entry, print button $print', async ({ viewOn, printOn, entry, print }) => {
    window.__ODV_CONFIG__ = { compare: { [view]: { enabled: viewOn, print: { enabled: printOn } } } };
    const { container, expose, cleanup } = await renderViewer();

    // This view: entry and print button follow its two keys.
    expect(container.querySelectorAll(VIEWS[view].entry)).toHaveLength(entry ? 1 : 0);
    expect(container.querySelectorAll(VIEWS[view].region)).toHaveLength(viewOn ? 1 : 0);
    expect(container.querySelectorAll(VIEWS[view].print)).toHaveLength(print ? 1 : 0);

    // The other view is unaffected by these keys.
    expect(container.querySelectorAll(VIEWS[other].entry)).toHaveLength(1);
    expect(container.querySelectorAll(VIEWS[other].print)).toHaveLength(1);

    // The side-by-side compare print is unaffected: its button, its dialog scope and its path.
    const printButton = /** @type {HTMLButtonElement} */ (container.querySelector('.harness-toolbar .toolbar-split-main[title="toolbar.print"]'));
    expect(printButton).not.toBeNull();
    expect(printButton.disabled).toBe(false);
    expect(container.querySelector('.harness-toolbar .compare-button')).not.toBeNull();
    await act(() => { printButton.click(); });
    expect(expose.pipeline.dialogProps.isOpen).toBe(true);
    expect(expose.pipeline.dialogProps.composedView).toBeNull();
    expect(document.querySelector('input[name="activeScope"][value="compare-both"], input[name="activeScope"]')).not.toBeNull();
    await act(() => expose.pipeline.handlePrintSubmit({ mode: 'active', activeScope: 'compare-both', printBackend: 'html', printAction: 'print' }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); });
    expect(printUtils.handlePrintCurrentComparison).toHaveBeenCalledTimes(1);
    expect(submitPrint.mock.calls[0][0]).toMatchObject({ action: 'print', pageCount: 2, pages: '1,2' });

    // A present print button opens the SAME dialog for this view.
    if (print) {
      vi.clearAllMocks();
      const viewPrint = /** @type {HTMLButtonElement} */ (container.querySelector(VIEWS[view].print));
      await act(() => { viewPrint.click(); });
      expect(expose.pipeline.dialogProps.isOpen).toBe(true);
      expect(expose.pipeline.dialogProps.composedView).toBe(view);
      // The one dialog, in its compare-view mode: one composed page, no page or scope choice.
      expect(container.querySelectorAll('.odv-prd-summary')).toHaveLength(1);
      expect(container.querySelector('.odv-prd-summary').textContent)
        .toBe(`Prepare the ${view} view of pages 1 and 2 as one page.`);
      expect(container.querySelector('input[name="activeScope"]')).toBeNull();
    }
    await cleanup();
  });
});
