// @vitest-environment jsdom
// File: src/components/__tests__/compareAdjustToolbarMode.test.jsx
/**
 * `compare.adjust.toolbarMode` against the real main toolbar and the real per-pane panels, wired to
 * the real pane state (hooks/usePaneImageAdjustments.js + compareTransformReducer) the way
 * DocumentViewer.jsx wires them:
 *
 *   mirror (default) -> the toolbar's coarse controls stay, write to the pane state the panel shows
 *                       and display the pane's live values.
 *   hide             -> the coarse controls are gone while any shown pane's panel is expanded and
 *                       come back when every panel is collapsed.
 *
 * Outside compare mode the key has no effect.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement, Fragment, useReducer, useState } from 'react';
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

const { default: DocumentToolbar } = await import('../DocumentToolbar/DocumentToolbar.jsx');
const { default: usePrintPipeline } = await import('../DocumentToolbar/usePrintPipeline.js');
const { default: CompareTransformControls } = await import('../DocumentViewer/CompareTransformControls.jsx');
const { usePaneImageAdjustments } = await import('../DocumentViewer/hooks/usePaneImageAdjustments.js');
const { INITIAL_COMPARE_TRANSFORM_STATE, compareTransformReducer } = await import('../../utils/compareTransform.js');

const noop = () => {};
const documentRenderRef = { current: null };
const compareRef = { current: null };
const viewerContainerRef = { current: null };

/** Coarse controls the `hide` mode removes; the PDF-resolution button is not one of them. */
const COARSE = {
  rotateLeft: '.editing-tools [aria-label="toolbar.rotateLeft90"]',
  rotateRight: '.editing-tools [aria-label="toolbar.rotateRight90"]',
  brightness: '.editing-tools [aria-label="toolbar.adjustBrightness"]',
  contrast: '.editing-tools [aria-label="toolbar.adjustContrast"]',
  reset: '.editing-tools .toolbar-reset-adjustments',
};

/** @param {boolean} isComparing */
function Viewer({ isComparing, expose }) {
  const [transforms, dispatch] = useReducer(compareTransformReducer, INITIAL_COMPARE_TRANSFORM_STATE);
  const adjustments = usePaneImageAdjustments({ isComparing, dispatchCompareTransform: dispatch });
  const [panelsExpanded, setPanelsExpanded] = useState({ primary: false, compare: false });
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
  const primaryImageProperties = { ...adjustments.primaryImageAdjustments, rotation: 0 };
  const compareImageProperties = { ...adjustments.compareImageAdjustments, rotation: 0 };
  expose.adjustments = adjustments;
  expose.transforms = transforms;

  const panel = (pane) => createElement(CompareTransformControls, {
    pane,
    transform: transforms[pane],
    imageProperties: pane === 'compare' ? compareImageProperties : primaryImageProperties,
    imageHandlers: adjustments.compareImageHandlers,
    expanded: panelsExpanded[pane],
    onExpandedChange: (expanded) => setPanelsExpanded((current) => ({ ...current, [pane]: expanded })),
    onAction: dispatch,
  });

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
      isComparing,
      comparePageNumber: isComparing ? 2 : null,
      comparePageNumberDisplay: isComparing ? 2 : null,
      primaryImageProperties,
      compareImageProperties,
      handleRotationChange: (delta, target) => dispatch({ type: 'rotate', target, delta }),
      handleBrightnessChange: adjustments.handleBrightnessChange,
      handleContrastChange: adjustments.handleContrastChange,
      resetImageProperties: adjustments.resetImageProperties,
      compareAdjustPanelsExpanded: panelsExpanded,
      allPages: [{}, {}],
    })),
    isComparing ? createElement('div', { className: 'harness-primary' }, panel('primary')) : null,
    isComparing ? createElement('div', { className: 'harness-compare' }, panel('compare')) : null,
  );
}

async function renderViewer({ isComparing = true } = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const expose = { adjustments: null, transforms: null };
  const props = { isComparing, expose };
  const render = () => act(() => root.render(createElement(Viewer, props)));
  await render();
  return {
    container,
    expose,
    /** @param {Partial<typeof props>} next */
    rerender: async (next) => { Object.assign(props, next); await render(); },
    cleanup: async () => {
      await act(() => root.unmount());
      container.remove();
    },
  };
}

/** @param {HTMLElement} container @param {'primary'|'compare'} pane */
async function togglePanel(container, pane) {
  const toggle = /** @type {HTMLButtonElement} */ (container.querySelector(`.harness-${pane} .compare-transform-toggle`));
  await act(() => { toggle.click(); });
}

/** @param {HTMLElement} container */
function coarsePresence(container) {
  return Object.fromEntries(Object.entries(COARSE).map(([key, selector]) => [key, !!container.querySelector(selector)]));
}

const ALL_PRESENT = { rotateLeft: true, rotateRight: true, brightness: true, contrast: true, reset: true };
const ALL_ABSENT = { rotateLeft: false, rotateRight: false, brightness: false, contrast: false, reset: false };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(() => {
  delete window.__ODV_CONFIG__;
  vi.unstubAllGlobals();
});

describe('compare.adjust.toolbarMode = mirror (default)', () => {
  it('keeps the coarse controls while a panel is expanded', async () => {
    const { container, cleanup } = await renderViewer();
    await togglePanel(container, 'primary');
    await togglePanel(container, 'compare');
    expect(coarsePresence(container)).toEqual(ALL_PRESENT);
    await cleanup();
  });

  it('displays the pane values the panel set, and the panel shows what the toolbar wrote', async () => {
    const { container, expose, cleanup } = await renderViewer();
    const brightnessButton = () => container.querySelector(COARSE.brightness);
    const contrastButton = () => container.querySelector(COARSE.contrast);
    const resetButton = () => container.querySelector(COARSE.reset);

    // Neutral: no value chip, nothing marked.
    expect(brightnessButton().querySelector('.toolbar-adjustment-value')).toBeNull();
    expect(resetButton().classList.contains('is-active')).toBe(false);

    // The panel writes the pane state; the toolbar displays it.
    await act(() => { expose.adjustments.compareImageHandlers.onBrightnessChange({ target: { value: 140 } }, 'primary'); });
    expect(brightnessButton().classList.contains('is-active')).toBe(true);
    expect(brightnessButton().querySelector('.toolbar-adjustment-value').textContent).toBe('140');
    expect(brightnessButton().getAttribute('title')).toBe('toolbar.adjustBrightness (140 %)');
    expect(resetButton().classList.contains('is-active')).toBe(true);

    // Grayscale and invert have no toolbar control of their own, but the toolbar still shows that
    // the pane is adjusted.
    await act(() => { expose.adjustments.clearImageAdjustments('primary'); });
    expect(resetButton().classList.contains('is-active')).toBe(false);
    await act(() => { expose.adjustments.compareImageHandlers.onInvertChange({ target: { type: 'checkbox', checked: true } }, 'primary'); });
    expect(resetButton().classList.contains('is-active')).toBe(true);
    await act(() => { expose.adjustments.clearImageAdjustments('primary'); });

    // The toolbar writes through the same handler; the expanded panel shows the new value.
    await togglePanel(container, 'primary');
    await act(() => { contrastButton().click(); });
    const slider = /** @type {HTMLInputElement} */ (container.querySelector('.toolbar-adjustment-slider'));
    expect(slider.value).toBe('100');
    await act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setValue.call(slider, '60');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(expose.adjustments.primaryImageAdjustments.contrast).toBe(60);
    expect(contrastButton().querySelector('.toolbar-adjustment-value').textContent).toBe('60');
    const panelContrast = /** @type {HTMLInputElement} */ (
      container.querySelector('.harness-primary input[aria-label="Contrast in percent (100 = unchanged)"]')
    );
    expect(panelContrast.value).toBe('60');

    // The toolbar reset is the panel's full reset for the pane.
    await act(() => { expose.adjustments.compareImageHandlers.onGrayscaleChange({ target: { value: 50 } }, 'primary'); });
    await act(() => { container.querySelector(COARSE.rotateRight).click(); });
    expect(expose.transforms.primary.rotation).toBe(90);
    await act(() => { resetButton().click(); });
    expect(expose.adjustments.primaryImageAdjustments).toMatchObject({ contrast: 100, grayscale: 0, invert: false });
    expect(expose.transforms.primary.rotation).toBe(0);
    await cleanup();
  });

  it('treats an invalid configured value as mirror', async () => {
    window.__ODV_CONFIG__ = { compare: { adjust: { toolbarMode: 'Hidden' } } };
    const { container, cleanup } = await renderViewer();
    await togglePanel(container, 'primary');
    expect(coarsePresence(container)).toEqual(ALL_PRESENT);
    await cleanup();
  });
});

describe('compare.adjust.toolbarMode = hide', () => {
  beforeEach(() => {
    window.__ODV_CONFIG__ = { compare: { adjust: { toolbarMode: 'hide' } } };
  });

  it('shows the coarse controls while every panel is collapsed', async () => {
    const { container, cleanup } = await renderViewer();
    expect(coarsePresence(container)).toEqual(ALL_PRESENT);
    await cleanup();
  });

  it('hides them while the left panel is expanded and restores them when it collapses', async () => {
    const { container, cleanup } = await renderViewer();
    await togglePanel(container, 'primary');
    expect(coarsePresence(container)).toEqual(ALL_ABSENT);
    // The PDF-resolution button is not an adjustment and stays.
    const groupIcons = [...container.querySelectorAll('.editing-tools .material-icons')].map((node) => node.textContent);
    expect(groupIcons).toEqual(['high_quality']);
    await togglePanel(container, 'primary');
    expect(coarsePresence(container)).toEqual(ALL_PRESENT);
    await cleanup();
  });

  it('hides them while the right panel is expanded, whichever pane the toolbar targets', async () => {
    const { container, cleanup } = await renderViewer();
    await togglePanel(container, 'compare');
    expect(coarsePresence(container)).toEqual(ALL_ABSENT);
    await cleanup();
  });

  it('keeps them hidden until the last expanded panel collapses', async () => {
    const { container, cleanup } = await renderViewer();
    await togglePanel(container, 'primary');
    await togglePanel(container, 'compare');
    expect(coarsePresence(container)).toEqual(ALL_ABSENT);
    await togglePanel(container, 'primary');
    expect(coarsePresence(container)).toEqual(ALL_ABSENT);
    await togglePanel(container, 'compare');
    expect(coarsePresence(container)).toEqual(ALL_PRESENT);
    await cleanup();
  });

  it('has no effect outside compare mode, even with a stale expanded panel state', async () => {
    const { container, rerender, cleanup } = await renderViewer();
    await togglePanel(container, 'primary');
    expect(coarsePresence(container)).toEqual(ALL_ABSENT);
    await rerender({ isComparing: false });
    expect(coarsePresence(container)).toEqual(ALL_PRESENT);
    // No compare-only value chips outside compare mode either.
    expect(container.querySelector('.toolbar-adjustment-value')).toBeNull();
    await cleanup();
  });
});
