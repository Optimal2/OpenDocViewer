// @vitest-environment jsdom
// File: src/components/__tests__/compareOverlayView.test.jsx
/**
 * Overlay view of the compare mode (CompareOverlayView): both pages stacked with their own
 * transforms, the top page's opacity slider (bounds, keyboard), swap, nudge mode for the top page,
 * reset to the compare-view calibration, copy calibration, close; and every UI string present in
 * both locales.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import CompareOverlayView from '../DocumentViewer/CompareOverlayView.jsx';
import { INITIAL_COMPARE_OVERLAY_STATE, compareOverlayReducer } from '../../utils/compareOverlay.js';
import en from '../../../public/locales/en/common.json';
import sv from '../../../public/locales/sv/common.json';
import overlaySource from '../DocumentViewer/CompareOverlayView.jsx?raw';
import toolbarSource from '../DocumentToolbar/DocumentToolbar.jsx?raw';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options) => (options && options.defaultValue) || key,
    i18n: { language: 'en' },
  }),
}));

// The real renderer needs page assets from the viewer context; the view only wires its props.
vi.mock('../DocumentRender.jsx', async () => {
  const React = await import('react');
  return {
    default: React.forwardRef(function MockRender(props, ref) {
      return React.createElement('div', {
        ref,
        className: 'mock-render',
        'data-page': String(props.pageNumber),
        'data-transform': props.surfaceTransform || '',
        'data-rotation': String(props.imageProperties?.rotation ?? ''),
      });
    }),
  };
});

const IDENTITY = { scale: 1, dx: 0, dy: 0, rotation: 0 };
const IMAGE = { rotation: 0, brightness: 100, contrast: 100 };

/**
 * Render the view with a live overlay state, so slider/swap changes re-render like in the viewer.
 * @param {Object} props
 */
async function renderView(props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onTransformAction = vi.fn();
  const onClose = vi.fn();
  const onResetToCompare = vi.fn();
  let overlay = props.overlay || INITIAL_COMPARE_OVERLAY_STATE;
  const onOverlayAction = vi.fn();
  const base = {
    pageNumberA: 1,
    pageNumberB: 2,
    allPages: [{}, {}],
    zoom: 1,
    setZoom: () => {},
    imagePropertiesA: IMAGE,
    imagePropertiesB: IMAGE,
    transforms: { primary: IDENTITY, compare: IDENTITY },
    onTransformAction,
    canResetToCompare: true,
    onResetToCompare,
    onClose,
    ...props,
  };
  const draw = () => root.render(createElement(CompareOverlayView, { ...base, overlay, onOverlayAction }));
  onOverlayAction.mockImplementation((action) => {
    overlay = compareOverlayReducer(overlay, action);
    draw();
  });
  await act(() => draw());
  return {
    container,
    onTransformAction,
    onOverlayAction,
    onClose,
    onResetToCompare,
    getOverlay: () => overlay,
    cleanup: async () => {
      await act(() => root.unmount());
      container.remove();
    },
  };
}

async function press(element, key, init = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  await act(() => { element.dispatchEvent(event); });
  return event;
}

/** @param {HTMLElement} container @param {string} label */
function byLabel(container, label) {
  return /** @type {HTMLElement} */ (container.querySelector(`[aria-label="${label}"]`));
}

describe('CompareOverlayView', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stacks page A below page B, each with its own transform; B at 50 % by default', async () => {
    const { container, cleanup } = await renderView({
      transforms: { primary: { scale: 1.5, dx: 0, dy: 0, rotation: 0 }, compare: { scale: 1, dx: 4, dy: 0, rotation: 90.5 } },
      imagePropertiesB: { ...IMAGE, rotation: 90 },
    });
    const layerA = container.querySelector('.compare-overlay-layer.is-primary');
    const layerB = container.querySelector('.compare-overlay-layer.is-compare');
    expect(layerA.querySelector('.mock-render').getAttribute('data-page')).toBe('1');
    expect(layerB.querySelector('.mock-render').getAttribute('data-page')).toBe('2');
    expect(layerA.querySelector('.mock-render').getAttribute('data-transform')).toBe('scale(1.5) translate(0px, 0px) rotate(0deg)');
    expect(layerB.querySelector('.mock-render').getAttribute('data-transform')).toBe('scale(1) translate(4px, 0px) rotate(0.5deg)');
    expect(layerB.querySelector('.mock-render').getAttribute('data-rotation')).toBe('90');
    expect(layerB.classList.contains('is-top')).toBe(true);
    expect(layerA.classList.contains('is-top')).toBe(false);
    expect(layerB.style.opacity).toBe('0.5');
    expect(layerA.style.opacity).toBe('1');
    expect(Number(layerB.style.zIndex)).toBeGreaterThan(Number(layerA.style.zIndex));
    await cleanup();
  });

  it('opacity slider: 0–100, default 50; Left/Right 1 %, Shift 10 %, clamped at the bounds', async () => {
    const { container, getOverlay, cleanup } = await renderView();
    const slider = /** @type {HTMLInputElement} */ (container.querySelector('input.compare-overlay-opacity'));
    expect(slider.type).toBe('range');
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('100');
    expect(slider.value).toBe('50');

    expect((await press(slider, 'ArrowRight')).defaultPrevented).toBe(true);
    expect(getOverlay().opacity).toBe(51);
    await press(slider, 'ArrowLeft', { shiftKey: true });
    expect(getOverlay().opacity).toBe(41);
    await press(slider, 'End');
    expect(getOverlay().opacity).toBe(100);
    await press(slider, 'ArrowRight', { shiftKey: true });
    expect(getOverlay().opacity).toBe(100);
    expect(container.querySelector('.compare-overlay-layer.is-compare').style.opacity).toBe('1');
    await press(slider, 'Home');
    await press(slider, 'ArrowLeft');
    expect(getOverlay().opacity).toBe(0);
    expect(container.querySelector('.compare-overlay-layer.is-compare').style.opacity).toBe('0');
    expect(container.querySelector('.compare-overlay-opacity-value').textContent).toBe('0 %');
    await cleanup();
  });

  it('swap puts page A on top and the slider then sets page A', async () => {
    const { container, getOverlay, cleanup } = await renderView();
    await act(() => byLabel(container, 'Swap which page is on top').click());
    expect(getOverlay().top).toBe('primary');
    const layerA = container.querySelector('.compare-overlay-layer.is-primary');
    const layerB = container.querySelector('.compare-overlay-layer.is-compare');
    expect(layerA.classList.contains('is-top')).toBe(true);
    expect(layerA.style.opacity).toBe('0.5');
    expect(layerB.style.opacity).toBe('1');
    expect(Number(layerA.style.zIndex)).toBeGreaterThan(Number(layerB.style.zIndex));
    await cleanup();
  });

  it('nudge mode: arrow keys move only the top page; off by default', async () => {
    const { container, onTransformAction, cleanup } = await renderView();
    const stage = container.querySelector('.compare-overlay-stage');
    await press(stage, 'ArrowRight');
    expect(onTransformAction).not.toHaveBeenCalled();

    const nudge = byLabel(container, 'Nudge mode: arrow keys move the top page (Shift: 10 px)');
    expect(nudge.getAttribute('aria-pressed')).toBe('false');
    await act(() => nudge.click());
    expect(nudge.getAttribute('aria-pressed')).toBe('true');
    await press(stage, 'ArrowRight');
    await press(stage, 'ArrowUp', { shiftKey: true });
    expect(onTransformAction.mock.calls.map((call) => call[0])).toEqual([
      { type: 'nudge', target: 'compare', field: 'dx', delta: 1 },
      { type: 'nudge', target: 'compare', field: 'dy', delta: -10 },
    ]);

    // Arrow keys in the opacity slider still change the opacity, not the page.
    onTransformAction.mockClear();
    await press(container.querySelector('input.compare-overlay-opacity'), 'ArrowLeft');
    expect(onTransformAction).not.toHaveBeenCalled();
    await cleanup();
  });

  it('reset to compare and close call back; reset is disabled without a saved calibration', async () => {
    const { container, onResetToCompare, onClose, cleanup } = await renderView();
    await act(() => byLabel(container, 'Reset to the alignment from the compare view').click());
    expect(onResetToCompare).toHaveBeenCalledTimes(1);
    await act(() => byLabel(container, 'Close the overlay view and return to the compare view').click());
    expect(onClose).toHaveBeenCalledTimes(1);
    await press(container.querySelector('.compare-overlay-stage'), 'Escape');
    expect(onClose).toHaveBeenCalledTimes(2);
    await cleanup();

    const second = await renderView({ canResetToCompare: false });
    expect(byLabel(second.container, 'Reset to the alignment from the compare view').disabled).toBe(true);
    await second.cleanup();
  });

  it('each page has the compare view\'s transform controls, writing its own target', async () => {
    const { container, onTransformAction, cleanup } = await renderView();
    const bars = container.querySelectorAll('.compare-transform-bar');
    expect(bars).toHaveLength(2);
    const barB = container.querySelector('.compare-transform-bar.is-compare');
    expect(barB.querySelector('.compare-transform-toggle').getAttribute('aria-expanded')).toBe('true');
    await act(() => byLabel(barB, 'Rotate 0.1° clockwise (Shift: 1°)').click());
    expect(onTransformAction).toHaveBeenLastCalledWith({ type: 'nudge', target: 'compare', field: 'rotation', delta: 0.1 });
    await cleanup();
  });

  it('copy calibration writes { version, A, B } JSON with each page\'s image adjustment and reports it', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...window.navigator, clipboard: { writeText } });
    const { container, cleanup } = await renderView({
      transforms: { primary: { scale: 1.25, dx: 3, dy: -2, rotation: 0.5 }, compare: IDENTITY },
      imagePropertiesB: { rotation: 0, brightness: 130, contrast: 70, grayscale: 40, invert: true },
    });
    await act(async () => { byLabel(container, 'Copy the calibration as JSON (for support)').click(); });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(JSON.parse(writeText.mock.calls[0][0])).toEqual({
      version: 2,
      A: { scale: 1.25, dx: 3, dy: -2, rotation: 0.5, brightness: 100, contrast: 100, grayscale: 0, invert: false },
      B: { ...IDENTITY, brightness: 130, contrast: 70, grayscale: 40, invert: true },
    });
    expect(container.querySelector('.compare-overlay-status').textContent).toBe('Calibration copied');
    await cleanup();
  });

  it('copy calibration reports a failure when the clipboard is unavailable', async () => {
    vi.stubGlobal('navigator', { ...window.navigator, clipboard: undefined });
    const { container, cleanup } = await renderView();
    await act(async () => { byLabel(container, 'Copy the calibration as JSON (for support)').click(); });
    expect(container.querySelector('.compare-overlay-status').textContent).toBe('Could not copy the calibration');
    await cleanup();
  });
});

describe('CompareOverlayView availability gating', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  afterEach(() => {
    delete window.__ODV_CONFIG__;
    vi.unstubAllGlobals();
  });

  it('shows the curtain entry by default', async () => {
    const { container, cleanup } = await renderView({ onOpenCurtain: () => {} });
    expect(container.querySelector('.compare-overlay-curtain')).not.toBeNull();
    await cleanup();
  });

  it('does not render the curtain entry when compare.curtain.enabled is false', async () => {
    window.__ODV_CONFIG__ = { compare: { curtain: { enabled: false } } };
    const { container, cleanup } = await renderView({ onOpenCurtain: () => {} });
    expect(container.querySelector('.compare-overlay-curtain')).toBeNull();
    expect(container.querySelector('.compare-curtain-button')).toBeNull();
    await cleanup();
  });

  it('keeps the curtain entry for a non-boolean compare.curtain.enabled', async () => {
    window.__ODV_CONFIG__ = { compare: { curtain: { enabled: 'false' } } };
    const { container, cleanup } = await renderView({ onOpenCurtain: () => {} });
    expect(container.querySelector('.compare-overlay-curtain')).not.toBeNull();
    await cleanup();
  });

  it('gates the compare-toolbar entries on their own switch, never the compare button', () => {
    expect(toolbarSource).toMatch(/showCompareOverlayEntry\s*=\s*canOpenCompareOverlay\s*&&\s*isCompareOverlayEnabled\(\)/);
    expect(toolbarSource).toMatch(/showCompareCurtainEntry\s*=\s*canOpenCompareOverlay\s*&&\s*isCompareCurtainEnabled\(\)/);
    expect(toolbarSource).toMatch(/\{showCompareOverlayEntry \? \(\s*<button[\s\S]*?compare-overlay-button/);
    expect(toolbarSource).toMatch(/\{showCompareCurtainEntry \? \(\s*<CompareCurtainButton/);
    // The compare button itself stays unconditional.
    expect(toolbarSource).toMatch(/\{\/\* Compare mode \*\/\}\s*<button/);
  });
});

describe('overlay view strings', () => {
  const source = overlaySource + toolbarSource;
  const keys = [...new Set([...source.matchAll(/t\('((?:compareOverlay|toolbar\.compareOverlay)\.[\w.]+)'/g)].map((m) => m[1]))];

  /** @param {Object} resources @param {string} key */
  const lookup = (resources, key) => key.split('.').reduce((node, part) => (node ? node[part] : undefined), resources);

  it('every compareOverlay key used in the code exists in English and Swedish', () => {
    expect(keys.length).toBeGreaterThan(10);
    expect(keys).toContain('toolbar.compareOverlay.open');
    for (const key of keys) {
      expect(typeof lookup(en, key), `en: ${key}`).toBe('string');
      expect(typeof lookup(sv, key), `sv: ${key}`).toBe('string');
      expect(lookup(sv, key), `sv differs from en: ${key}`).not.toBe('');
    }
  });
});

describe('CompareOverlayView print button', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });
  afterEach(() => {
    delete window.__ODV_CONFIG__;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('is absent without a print handler', async () => {
    const { container, cleanup } = await renderView();
    expect(container.querySelector('.compare-overlay-print')).toBeNull();
    await cleanup();
  });

  it('hands the shared pipeline both pages and the CURRENT view state, including zoom and stage', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      /** @type {DOMRect} */ ({ x: 0, y: 0, top: 0, left: 0, right: 640, bottom: 480, width: 640, height: 480, toJSON: () => ({}) })
    );
    const onPrint = vi.fn();
    const transforms = { primary: IDENTITY, compare: { scale: 1.1, dx: 3, dy: -1, rotation: 0.4 } };
    const { container, cleanup } = await renderView({ onPrint, zoom: 1.5, transforms });
    const button = byLabel(container, 'Print the overlay view as one page');
    expect(button.classList.contains('compare-overlay-print')).toBe(true);
    expect(button.getAttribute('title')).toBe('Print the overlay view as one page');
    expect(button.textContent).toContain('Print');

    // The slider moves after the button rendered: the print reads the state at print time.
    await press(container.querySelector('.compare-overlay-opacity'), 'ArrowLeft', { shiftKey: true });
    await act(() => { button.click(); });
    expect(onPrint).toHaveBeenCalledTimes(1);
    const target = onPrint.mock.calls[0][0];
    expect(target.view).toBe('overlay');
    expect(target.primaryRenderRef.current.getAttribute('data-page')).toBe('1');
    expect(target.compareRenderRef.current.getAttribute('data-page')).toBe('2');
    expect(target.getView()).toEqual({ opacity: 40, top: 'compare', transforms, zoom: 1.5, stage: { width: 640, height: 480 } });
    await cleanup();
  });

  it('is absent when compare.overlay.print.enabled is false; disabled while printing is unavailable', async () => {
    window.__ODV_CONFIG__ = { compare: { overlay: { print: { enabled: false } } } };
    const hidden = await renderView({ onPrint: () => {} });
    expect(hidden.container.querySelector('.compare-overlay-print')).toBeNull();
    await hidden.cleanup();

    delete window.__ODV_CONFIG__;
    const onPrint = vi.fn();
    const busy = await renderView({ onPrint, printDisabled: true });
    const button = /** @type {HTMLButtonElement} */ (busy.container.querySelector('.compare-overlay-print'));
    expect(button.disabled).toBe(true);
    await act(() => { button.click(); });
    expect(onPrint).not.toHaveBeenCalled();
    await busy.cleanup();
  });
});
