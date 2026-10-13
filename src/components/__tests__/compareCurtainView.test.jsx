// @vitest-environment jsdom
// File: src/components/__tests__/compareCurtainView.test.jsx
/**
 * Curtain view of the compare mode (CompareCurtainView): both calibrated pages in one coordinate
 * space, page B clipped to one side of a draggable border; one Horizontal/Vertical toggle, the
 * border (drag, arrow keys 1 %/Shift 10 %), side labels and Close/Escape. Also: Escape from the
 * overlay view's opacity slider, the compare-toolbar entry button, and every string in both locales.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import CompareCurtainView from '../DocumentViewer/CompareCurtainView.jsx';
import CompareOverlayView from '../DocumentViewer/CompareOverlayView.jsx';
import CompareCurtainButton from '../DocumentViewer/CompareCurtainButton.jsx';
import buttonSource from '../DocumentViewer/CompareCurtainButton.jsx?raw';
import { elementAttributeBlock } from './toolbarAttributeBlock.js';
import { INITIAL_COMPARE_OVERLAY_STATE } from '../../utils/compareOverlay.js';
import en from '../../../public/locales/en/common.json';
import sv from '../../../public/locales/sv/common.json';
import curtainSource from '../DocumentViewer/CompareCurtainView.jsx?raw';
import overlaySource from '../DocumentViewer/CompareOverlayView.jsx?raw';
import toolbarSource from '../DocumentToolbar/DocumentToolbar.jsx?raw';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options) => {
      const text = (options && options.defaultValue) || key;
      return options && options.page != null ? text.replace('{page}', String(options.page)) : text;
    },
    i18n: { language: 'en' },
  }),
}));

const renders = { count: 0 };

vi.mock('../DocumentRender.jsx', async () => {
  const React = await import('react');
  return {
    default: React.forwardRef(function MockRender(props, ref) {
      renders.count += 1;
      return React.createElement('div', {
        ref,
        className: 'mock-render',
        'data-page': String(props.pageNumber),
        'data-transform': props.surfaceTransform || '',
      });
    }),
  };
});

const IDENTITY = { scale: 1, dx: 0, dy: 0, rotation: 0 };
const IMAGE = { rotation: 0, brightness: 100, contrast: 100 };

/** @param {Object} props */
async function renderCurtain(props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onClose = vi.fn();
  const base = {
    pageNumberA: 3,
    pageNumberB: 7,
    allPages: [{}, {}],
    zoom: 1,
    setZoom: () => {},
    imagePropertiesA: IMAGE,
    imagePropertiesB: IMAGE,
    transforms: { primary: IDENTITY, compare: IDENTITY },
    onClose,
    ...props,
  };
  await act(() => root.render(createElement(CompareCurtainView, base)));
  return {
    container,
    onClose,
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

/** jsdom has no PointerEvent: a MouseEvent with pointer fields is what React reads. */
async function pointer(element, type, init = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'isPrimary', { value: true });
  await act(() => { element.dispatchEvent(event); });
  return event;
}

const layerB = (container) => /** @type {HTMLElement} */ (container.querySelector('.compare-curtain-layer.is-compare'));
const handle = (container) => /** @type {HTMLElement} */ (container.querySelector('.compare-curtain-handle'));
const modeButton = (container, label) => /** @type {HTMLButtonElement} */ (
  [...container.querySelectorAll('.compare-curtain-mode button')].find((button) => button.textContent === label)
);

describe('CompareCurtainView', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    renders.count = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draws page A below and page B above, each with its calibrated transform; B clipped at 50 %', async () => {
    const { container, cleanup } = await renderCurtain({
      transforms: { primary: { scale: 1.5, dx: 0, dy: 0, rotation: 0 }, compare: { scale: 1, dx: 4, dy: 0, rotation: 0.5 } },
    });
    const layerA = container.querySelector('.compare-curtain-layer.is-primary');
    expect(layerA.querySelector('.mock-render').getAttribute('data-page')).toBe('3');
    expect(layerB(container).querySelector('.mock-render').getAttribute('data-page')).toBe('7');
    expect(layerA.querySelector('.mock-render').getAttribute('data-transform')).toBe('scale(1.5) translate(0px, 0px) rotate(0deg)');
    expect(layerB(container).querySelector('.mock-render').getAttribute('data-transform')).toBe('scale(1) translate(4px, 0px) rotate(0.5deg)');
    expect(Number(layerB(container).style.zIndex)).toBeGreaterThan(Number(layerA.style.zIndex));
    expect(layerB(container).style.clipPath).toBe('inset(0% 0% 0% 50%)');
    expect(handle(container).style.left).toBe('50%');
    await cleanup();
  });

  it('labels which page is on which side, with page numbers', async () => {
    const { container, cleanup } = await renderCurtain();
    expect(container.querySelector('.compare-curtain-label.is-primary').textContent).toBe('A · page 3');
    expect(container.querySelector('.compare-curtain-label.is-compare').textContent).toBe('B · page 7');
    await cleanup();
  });

  it('has exactly one Horizontal/Vertical toggle and Close; nothing else', async () => {
    const { container, cleanup } = await renderCurtain();
    const toolbar = container.querySelector('.compare-curtain-toolbar');
    const controls = [...toolbar.querySelectorAll('button, input, select, textarea')];
    expect(controls.map((control) => control.textContent)).toEqual(['Horizontal', 'Vertical', 'closeClose']);
    expect(container.querySelectorAll('input, select, textarea')).toHaveLength(0);
    expect(modeButton(container, 'Vertical').getAttribute('aria-pressed')).toBe('true');
    expect(modeButton(container, 'Horizontal').getAttribute('aria-pressed')).toBe('false');
    await cleanup();
  });

  it('horizontal mode: horizontal line, B below it; each mode remembers its own position', async () => {
    const { container, cleanup } = await renderCurtain();
    await press(handle(container), 'ArrowLeft', { shiftKey: true });
    expect(layerB(container).style.clipPath).toBe('inset(0% 0% 0% 40%)');

    await act(() => modeButton(container, 'Horizontal').click());
    expect(modeButton(container, 'Horizontal').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.compare-curtain-stage').classList.contains('is-horizontal')).toBe(true);
    expect(layerB(container).style.clipPath).toBe('inset(50% 0% 0% 0%)');
    expect(handle(container).style.top).toBe('50%');
    expect(handle(container).getAttribute('aria-orientation')).toBe('vertical');
    await press(handle(container), 'ArrowDown');
    expect(layerB(container).style.clipPath).toBe('inset(51% 0% 0% 0%)');

    await act(() => modeButton(container, 'Vertical').click());
    expect(layerB(container).style.clipPath).toBe('inset(0% 0% 0% 40%)');
    expect(handle(container).getAttribute('aria-orientation')).toBe('horizontal');
    await act(() => modeButton(container, 'Horizontal').click());
    expect(layerB(container).style.clipPath).toBe('inset(51% 0% 0% 0%)');
    await cleanup();
  });

  it('keyboard: arrows 1 %, Shift 10 %, clamped at 0 % and 100 %', async () => {
    const { container, cleanup } = await renderCurtain();
    const border = handle(container);
    expect(border.getAttribute('role')).toBe('slider');
    expect(border.tabIndex).toBe(0);
    expect((await press(border, 'ArrowRight')).defaultPrevented).toBe(true);
    expect(border.getAttribute('aria-valuenow')).toBe('51');
    await press(border, 'ArrowLeft', { shiftKey: true });
    expect(border.getAttribute('aria-valuenow')).toBe('41');
    for (let i = 0; i < 6; i += 1) await press(border, 'ArrowRight', { shiftKey: true });
    expect(border.getAttribute('aria-valuenow')).toBe('100');
    expect(layerB(container).style.clipPath).toBe('inset(0% 0% 0% 100%)');
    for (let i = 0; i < 11; i += 1) await press(border, 'ArrowUp', { shiftKey: true });
    expect(border.getAttribute('aria-valuenow')).toBe('0');
    expect(layerB(container).style.clipPath).toBe('inset(0% 0% 0% 0%)');
    expect((await press(border, 'Enter')).defaultPrevented).toBe(false);
    await cleanup();
  });

  it('dragging the border moves the clip without re-rendering the pages, and commits on release', async () => {
    const { container, cleanup } = await renderCurtain();
    const stage = /** @type {HTMLElement} */ (container.querySelector('.compare-curtain-stage'));
    stage.getBoundingClientRect = () => /** @type {DOMRect} */ ({ left: 100, top: 0, width: 400, height: 300, right: 500, bottom: 300, x: 100, y: 0 });
    const border = handle(container);
    const before = renders.count;

    await pointer(border, 'pointerdown', { clientX: 300, clientY: 10 });
    await pointer(border, 'pointermove', { clientX: 200, clientY: 10 });
    expect(layerB(container).style.clipPath).toBe('inset(0% 0% 0% 25%)');
    expect(border.style.left).toBe('25%');
    await pointer(border, 'pointermove', { clientX: 900, clientY: 10 });
    expect(layerB(container).style.clipPath).toBe('inset(0% 0% 0% 100%)');
    expect(renders.count).toBe(before);

    await pointer(border, 'pointerup', { clientX: 140, clientY: 10 });
    expect(border.getAttribute('aria-valuenow')).toBe('10');
    expect(layerB(container).style.clipPath).toBe('inset(0% 0% 0% 10%)');
    expect(renders.count).toBe(before);
    await cleanup();
  });

  it('Close and Escape call onClose', async () => {
    const { container, onClose, cleanup } = await renderCurtain();
    await act(() => container.querySelector('.compare-curtain-close').click());
    expect(onClose).toHaveBeenCalledTimes(1);
    await press(handle(container), 'Escape');
    expect(onClose).toHaveBeenCalledTimes(2);
    await cleanup();
  });
});

describe('Escape from a range input (overlay view)', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  it('closes the overlay view while the opacity slider has focus', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onClose = vi.fn();
    await act(() => root.render(createElement(CompareOverlayView, {
      pageNumberA: 1,
      pageNumberB: 2,
      allPages: [{}, {}],
      zoom: 1,
      setZoom: () => {},
      imagePropertiesA: IMAGE,
      imagePropertiesB: IMAGE,
      transforms: { primary: IDENTITY, compare: IDENTITY },
      onTransformAction: () => {},
      overlay: INITIAL_COMPARE_OVERLAY_STATE,
      onOverlayAction: () => {},
      canResetToCompare: true,
      onResetToCompare: () => {},
      onClose,
      onOpenCurtain: () => {},
    })));
    await press(container.querySelector('input.compare-overlay-opacity'), 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);

    // Text fields keep Escape for themselves (fine-tuning bar inputs undo the typed value).
    const field = container.querySelector('input:not([type="range"])');
    if (field) {
      await press(field, 'Escape');
      expect(onClose).toHaveBeenCalledTimes(1);
    }

    await act(() => container.querySelector('.compare-overlay-curtain').click());
    await act(() => root.unmount());
    container.remove();
  });
});

describe('CompareCurtainButton (entry from the compare and overlay toolbars)', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  async function renderButton(props) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(() => root.render(createElement(CompareCurtainButton, props)));
    return {
      button: /** @type {HTMLButtonElement} */ (container.querySelector('button')),
      cleanup: async () => {
        await act(() => root.unmount());
        container.remove();
      },
    };
  }

  it('is enabled when a calibration exists and opens the curtain view', async () => {
    const onOpen = vi.fn();
    const { button, cleanup } = await renderButton({ calibrated: true, onOpen });
    expect(button.getAttribute('aria-disabled')).toBe('false');
    expect(button.title).toBe('Curtain: show the calibrated pages with a draggable border');
    await act(() => button.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
    await cleanup();
  });

  it('is disabled without a calibration, explains why, and ignores clicks', async () => {
    const onOpen = vi.fn();
    const { button, cleanup } = await renderButton({ calibrated: false, onOpen });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.title).toBe('Curtain: open the overlay view first – it calibrates the two pages');
    expect(button.getAttribute('aria-label')).toBe(button.title);
    await act(() => button.click());
    expect(onOpen).not.toHaveBeenCalled();
    await cleanup();
  });

  it('is wired into the compare toolbar and the overlay toolbar', () => {
    // Anchored to the CompareCurtainButton element's OWN attribute block in each
    // source file. The old `<CompareCurtainButton[\s\S]*?calibrated` idiom
    // stayed green when the prop was commented out or moved to a later
    // element in the same file. elementAttributeBlock fails loudly on >1
    // match, requires a word boundary, and strips JS comments before scanning.
    const compareToolbarButton = elementAttributeBlock(toolbarSource, 'CompareCurtainButton');
    expect(compareToolbarButton).toMatch(/calibrated=\{compareCalibrated\}/);
    const overlayToolbarButton = elementAttributeBlock(overlaySource, 'CompareCurtainButton');
    expect(overlayToolbarButton).toMatch(/calibrated\b/);
    expect(overlayToolbarButton).toMatch(/calibrated/);
  });
});

describe('curtain view strings', () => {
  const source = curtainSource + overlaySource + toolbarSource + buttonSource;
  const keys = [...new Set([...source.matchAll(/t\('((?:compareCurtain|toolbar\.compareCurtain)\.[\w.]+)'/g)].map((m) => m[1]))];

  /** @param {Object} resources @param {string} key */
  const lookup = (resources, key) => key.split('.').reduce((node, part) => (node ? node[part] : undefined), resources);

  it('every compareCurtain key used in the code exists in English and Swedish', () => {
    expect(keys).toEqual(expect.arrayContaining([
      'compareCurtain.horizontal',
      'compareCurtain.vertical',
      'compareCurtain.open',
      'compareCurtain.needsCalibration',
      'compareCurtain.border',
      'compareCurtain.close',
    ]));
    for (const key of keys) {
      expect(typeof lookup(en, key), `en: ${key}`).toBe('string');
      expect(typeof lookup(sv, key), `sv: ${key}`).toBe('string');
      expect(lookup(sv, key), `sv differs from en: ${key}`).not.toBe(lookup(en, key));
    }
    expect(lookup(sv, 'compareCurtain.horizontal')).toBe('Horisontell');
    expect(lookup(sv, 'compareCurtain.vertical')).toBe('Vertikal');
    expect(lookup(sv, 'compareCurtain.title')).toBe('Gardin');
  });
});

describe('CompareCurtainView print button', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });
  afterEach(() => {
    delete window.__ODV_CONFIG__;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('with a print handler the toolbar has the direction toggle, Print and Close', async () => {
    const { container, cleanup } = await renderCurtain({ onPrint: () => {} });
    const toolbar = container.querySelector('.compare-curtain-toolbar');
    const controls = [...toolbar.querySelectorAll('button, input, select, textarea')];
    expect(controls.map((control) => control.textContent)).toEqual(['Horizontal', 'Vertical', 'printPrint', 'closeClose']);
    await cleanup();
  });

  it('hands the shared pipeline both pages and the CURRENT border, zoom and stage', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      /** @type {DOMRect} */ ({ x: 0, y: 0, top: 0, left: 0, right: 900, bottom: 600, width: 900, height: 600, toJSON: () => ({}) })
    );
    const onPrint = vi.fn();
    const transforms = { primary: { scale: 1.2, dx: 0, dy: 0, rotation: 0 }, compare: IDENTITY };
    const { container, cleanup } = await renderCurtain({ onPrint, zoom: 0.75, transforms });
    await act(() => { modeButton(container, 'Horizontal').click(); });
    await press(handle(container), 'ArrowDown', { shiftKey: true });
    const button = /** @type {HTMLButtonElement} */ (container.querySelector('[aria-label="Print the curtain view as one page"]'));
    expect(button.classList.contains('compare-curtain-print')).toBe(true);
    expect(button.getAttribute('title')).toBe('Print the curtain view as one page');
    await act(() => { button.click(); });
    expect(onPrint).toHaveBeenCalledTimes(1);
    const target = onPrint.mock.calls[0][0];
    expect(target.view).toBe('curtain');
    expect(target.primaryRenderRef.current.getAttribute('data-page')).toBe('3');
    expect(target.compareRenderRef.current.getAttribute('data-page')).toBe('7');
    const view = target.getView();
    expect(view).toEqual({ mode: 'horizontal', position: view.position, transforms, zoom: 0.75, stage: { width: 900, height: 600 } });
    expect(view.position).toBe(Number(handle(container).getAttribute('aria-valuenow')));
    expect(view.position).not.toBe(50);
    await cleanup();
  });

  it('is absent when compare.curtain.print.enabled is false', async () => {
    window.__ODV_CONFIG__ = { compare: { curtain: { print: { enabled: false } } } };
    const { container, cleanup } = await renderCurtain({ onPrint: () => {} });
    expect(container.querySelector('.compare-curtain-print')).toBeNull();
    await cleanup();
  });
});
