// @vitest-environment jsdom
// File: src/components/__tests__/compareToolbarAdapterPropChain.test.jsx
/**
 * Adapter prop-chain lock: renders the compare toolbar THROUGH DocumentViewerToolbar (the
 * DocumentViewer.jsx -> DocumentViewerToolbar.jsx -> DocumentToolbar.jsx adapter) instead of
 * DocumentToolbar directly, so a dropped prop forwarding in the adapter turns red here.
 *
 * Background: DocumentToolbar reads `selectCompareTransform(compareTransforms, editingTargetMode)`
 * for its reset marker, and a missing `compareTransforms` prop silently reads as the identity
 * transform (compareTransform.js) — so deleting the adapter's `compareTransforms={compareTransforms}`
 * forwarding leaves every direct-DocumentToolbar test green while the real app loses the marker.
 * This file is the net for that failure mode. It also clicks the reset button through the
 * adapter (asserting the target pane's resulting transform state) and source-locks the UPPER
 * link (DocumentViewer.jsx -> DocumentViewerToolbar.jsx) for compareTransforms/resetImageProperties.
 *
 * The pane state (hooks/usePaneImageAdjustments.js + compareTransformReducer) is wired exactly the
 * way compareAdjustToolbarMode.test.jsx wires it; only the render target changes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement, useReducer } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('../../utils/printUtils.js', () => Object.fromEntries([
  'handlePrint', 'handlePrintAll', 'handlePrintRange', 'handlePrintSequence', 'handlePrintCurrentComparison',
  'handlePrintCompareOverlay', 'handlePrintCompareCurtain', 'handlePdfOutput', 'handlePdfCurrent',
  'handlePdfCurrentComparison', 'handlePdfCompareOverlay', 'handlePdfCompareCurtain', 'downloadPdfBlob',
  'printPdfBlob',
].map((name) => [name, vi.fn()])));
vi.mock('../../logging/userLogger.js', () => ({ default: { submitPrint: vi.fn() } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options) => (options && options.defaultValue) || key,
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
  }),
}));

const { default: DocumentViewerToolbar } = await import('../DocumentViewer/DocumentViewerToolbar.jsx');
const { default: usePrintPipeline } = await import('../DocumentToolbar/usePrintPipeline.js');
const { usePaneImageAdjustments } = await import('../DocumentViewer/hooks/usePaneImageAdjustments.js');
const { INITIAL_COMPARE_TRANSFORM_STATE, compareTransformReducer, isIdentityCompareTransform } = await import('../../utils/compareTransform.js');
import viewerSource from '../DocumentViewer/DocumentViewer.jsx?raw';
import { toolbarAttributeBlock } from './toolbarAttributeBlock.js';

const noop = () => {};
const documentRenderRef = { current: null };
const compareRef = { current: null };
const viewerContainerRef = { current: null };
const NAVIGATION = { canGoPrevious: false, canGoNext: false, canGoFirst: false, canGoLast: false };
const FIT_LIMITS = { widthFactorPercent: 100, heightFactorPercent: null, actualSizeFactorPercent: null };

const RESET = '.editing-tools .toolbar-reset-adjustments';

/** @param {{ activePane: 'primary'|'compare', expose: Object }} props */
function Viewer({ activePane, expose }) {
  const isComparing = true;
  const [transforms, dispatch] = useReducer(compareTransformReducer, INITIAL_COMPARE_TRANSFORM_STATE);
  const adjustments = usePaneImageAdjustments({ isComparing, dispatchCompareTransform: dispatch });
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
    isComparing,
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
    isPrintDialogOpen: false,
    openPrintDialog: noop,
    closePrintDialog: noop,
  });
  expose.adjustments = adjustments;
  expose.transforms = transforms;
  expose.dispatch = dispatch;

  return createElement(DocumentViewerToolbar, {
    runtimeStatusLedState: 'ready',
    runtimeStatusLedTitle: 'Runtime ready',
    pageNumber: 1,
    pageNumberDisplay: 1,
    totalPages: 2,
    isDocumentLoading: false,
    pageLoadState: null,
    setPageNumber: noop,
    setVisiblePageNumber: noop,
    setComparePageNumber: noop,
    setVisibleComparePageNumber: noop,
    goToPreviousPage: noop,
    goToNextPage: noop,
    goToFirstPage: noop,
    goToLastPage: noop,
    goToPreviousDocument: noop,
    goToNextDocument: noop,
    goToFirstDocument: noop,
    goToLastDocument: noop,
    zoomIn: noop,
    zoomOut: noop,
    actualSize: noop,
    fitToScreen: noop,
    fitToCustomWidth: noop,
    fitToWidth: noop,
    zoom: 1,
    zoomState: { mode: 'FIT_PAGE', scale: 1 },
    setZoomMode: noop,
    customFitWidthFactorPercent: 100,
    customFitSizeLimits: FIT_LIMITS,
    configuredCustomFitSizeLimits: FIT_LIMITS,
    userCustomFitSizeLimits: FIT_LIMITS,
    configuredCustomFitWidthFactorPercent: 100,
    userDefaultZoomMode: null,
    configuredDefaultZoomMode: 'FIT_PAGE',
    setCustomFitWidthFactorPercent: noop,
    setCustomFitSizeLimits: noop,
    setDefaultZoomModePreference: noop,
    setZoom: noop,
    handleCompare: noop,
    isComparing,
    activePane,
    comparePageNumber: 2,
    comparePageNumberDisplay: 2,
    navigationModifierState: { shift: false, ctrl: false },
    primaryImageProperties: { ...adjustments.primaryImageAdjustments, rotation: 0 },
    compareImageProperties: { ...adjustments.compareImageAdjustments, rotation: 0 },
    compareTransforms: transforms,
    handleRotationChange: (delta, target) => dispatch({ type: 'rotate', target, delta }),
    handleBrightnessChange: adjustments.handleBrightnessChange,
    handleContrastChange: adjustments.handleContrastChange,
    resetImageProperties: adjustments.resetImageProperties,
    documentRenderRef,
    printPipeline: pipeline,
    allPages: [{}, {}],
    documentNavigationEnabled: false,
    primaryDocumentNavigation: NAVIGATION,
    compareDocumentNavigation: NAVIGATION,
    isExpanded: false,
    setIsExpanded: noop,
    prevPageDisabled: true,
    nextPageDisabled: false,
    firstPageDisabled: true,
    lastPageDisabled: false,
    compareAdjustPanelsExpanded: { primary: false, compare: false },
  });
}

/** Mounted roots awaiting unmount; drained in afterEach so a thrown assertion
 *  mid-case never leaves a React root mounted. */
const mounted = [];

/** @param {{ activePane?: 'primary'|'compare' }} options */
async function renderViewer({ activePane = 'primary' } = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const expose = { adjustments: null, transforms: null, dispatch: null };
  await act(() => root.render(createElement(Viewer, { activePane, expose })));
  const handle = {
    container,
    expose,
    cleanup: async () => {
      await act(() => root.unmount());
      container.remove();
    },
  };
  mounted.push(handle);
  return handle;
}

/** @param {HTMLElement} container */
function isResetMarked(container) {
  return container.querySelector(RESET).classList.contains('is-active');
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(async () => {
  delete window.__ODV_CONFIG__;
  vi.unstubAllGlobals();
  for (const handle of mounted.splice(0)) {
    await handle.cleanup();
  }
});

describe('DocumentViewerToolbar adapter prop chain', () => {
  it('lights the reset marker from the primary pane transform forwarded through the adapter', async () => {
    const { container, expose } = await renderViewer({ activePane: 'primary' });

    // Identity transform: the marker starts off.
    expect(isResetMarked(container)).toBe(false);

    // A non-identity primary transform must reach DocumentToolbar through the adapter: without the
    // adapter's compareTransforms forwarding the marker silently reads identity and stays off.
    await act(() => { expose.dispatch({ type: 'set', target: 'primary', transform: { scale: 1.5 } }); });
    expect(isResetMarked(container)).toBe(true);

    // Back to identity clears it again.
    await act(() => { expose.dispatch({ type: 'reset', target: 'primary' }); });
    expect(isResetMarked(container)).toBe(false);
  });

  it('lights the reset marker for the compare pane when the compare pane is the edit target', async () => {
    const { container, expose } = await renderViewer({ activePane: 'compare' });

    // Non-identity COMPARE transform, identity primary: the marker must read the target pane's
    // transform, so it lights only if editingTargetMode resolves to 'compare' end to end.
    await act(() => { expose.dispatch({ type: 'set', target: 'compare', transform: { dx: 12, dy: -7 } }); });
    expect(isResetMarked(container)).toBe(true);

    // Negative control: a non-identity PRIMARY transform alone must NOT light the marker while the
    // compare pane is the edit target (the marker tracks the target pane, not any pane).
    await act(() => { expose.dispatch({ type: 'reset', target: 'compare' }); });
    expect(isResetMarked(container)).toBe(false);
    await act(() => { expose.dispatch({ type: 'set', target: 'primary', transform: { scale: 2 } }); });
    expect(isResetMarked(container)).toBe(false);
  });

  it('resets the target pane transform when the reset button is clicked through the adapter', async () => {
    const { container, expose } = await renderViewer({ activePane: 'compare' });
    const resetButton = () => container.querySelector(RESET);

    // Both panes non-identity: the click must reset the EDITING TARGET pane's transform state
    // (not merely call a spy) while the other pane is untouched.
    await act(() => {
      expose.dispatch({ type: 'set', target: 'compare', transform: { dx: 12, dy: -7 } });
      expose.dispatch({ type: 'set', target: 'primary', transform: { scale: 2 } });
    });
    expect(isResetMarked(container)).toBe(true);
    await act(() => { resetButton().click(); });
    expect(isIdentityCompareTransform(expose.transforms.compare)).toBe(true);
    expect(isResetMarked(container)).toBe(false);
    expect(isIdentityCompareTransform(expose.transforms.primary)).toBe(false);
  });

  it('resets the primary pane transform when the reset button is clicked with the primary pane active', async () => {
    const { container, expose } = await renderViewer({ activePane: 'primary' });
    const resetButton = () => container.querySelector(RESET);

    // Both panes non-identity: the click must reset the EDITING TARGET pane's transform
    // state (not merely call a spy) while the other pane is untouched. This is the mirror
    // of the activePane='compare' case above: a hardcoded reset target in the
    // DocumentViewerToolbar adapter leaves the compare case green while this one turns red.
    await act(() => {
      expose.dispatch({ type: 'set', target: 'primary', transform: { scale: 2 } });
      expose.dispatch({ type: 'set', target: 'compare', transform: { dx: 12, dy: -7 } });
    });
    expect(isResetMarked(container)).toBe(true);
    await act(() => { resetButton().click(); });
    expect(isIdentityCompareTransform(expose.transforms.primary)).toBe(true);
    expect(isResetMarked(container)).toBe(false);
    expect(isIdentityCompareTransform(expose.transforms.compare)).toBe(false);
  });
});

describe('DocumentViewer -> DocumentViewerToolbar upper link (source lock)', () => {
  // Rendering the full DocumentViewer here is deliberately avoided: it needs ViewerContext plus
  // the whole useDocumentViewer hook (workers, canvas, thumbnails). The lower link is locked
  // behaviourally above; these source assertions lock the upper link to the toolbar
  // element's OWN attribute block (see toolbarAttributeBlock.js). They see TEXT,
  // not behaviour: they cannot see a prop that is forwarded but computed
  // wrong — that computation (ViewerContext compareTransforms) is covered by the reducer/hook
  // unit tests instead.
  it('forwards compareTransforms to the toolbar adapter', () => {
    // Anchored to the toolbar element's OWN attribute block: deleting the prop here, or
    // moving it to a later element, turns this red (see toolbarAttributeBlock.js).
    expect(toolbarAttributeBlock(viewerSource)).toMatch(/compareTransforms=\{compareTransforms\}/);
  });

  it('forwards resetImageProperties to the toolbar adapter', () => {
    // Anchored to the toolbar element's OWN attribute block: deleting the prop here, or
    // moving it to a later element, turns this red (see toolbarAttributeBlock.js).
    expect(toolbarAttributeBlock(viewerSource)).toMatch(/resetImageProperties=\{resetImageProperties\}/);
  });
});
