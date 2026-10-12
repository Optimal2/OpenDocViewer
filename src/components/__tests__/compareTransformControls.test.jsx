// @vitest-environment jsdom
// File: src/components/__tests__/compareTransformControls.test.jsx
/**
 * Compare-view fine-tuning bar (CompareTransformControls): disclosure, fine buttons with Shift,
 * locale-aware numeric fields (decimal comma and point, Enter/Escape/ArrowUp), and the arrow-key
 * pan control that the global viewer shortcuts must leave alone.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import CompareTransformControls from '../DocumentViewer/CompareTransformControls.jsx';
import { isEditableTarget, shouldIgnoreViewerShortcut } from '../DocumentViewer/hooks/useViewerEffects.js';

const i18nState = vi.hoisted(() => ({ language: 'sv' }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options) => (options && options.defaultValue) || key,
    i18n: { language: i18nState.language },
  }),
}));

const IDENTITY = { scale: 1, dx: 0, dy: 0, rotation: 0 };
const NEUTRAL_IMAGE = { rotation: 0, brightness: 100, contrast: 100, grayscale: 0, invert: false };

function makeImageHandlers() {
  return {
    onBrightnessChange: vi.fn(),
    onContrastChange: vi.fn(),
    onGrayscaleChange: vi.fn(),
    onInvertChange: vi.fn(),
    onResetImage: vi.fn(),
    onResetPane: vi.fn(),
  };
}

async function renderBar(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onAction = vi.fn();
  const onExpandedChange = vi.fn();
  const allProps = {
    pane: 'compare', transform: IDENTITY, imageProperties: NEUTRAL_IMAGE, imageHandlers: makeImageHandlers(),
    expanded: true, onAction, onExpandedChange, ...props,
  };
  await act(() => root.render(createElement(CompareTransformControls, allProps)));
  const cleanup = async () => {
    await act(() => root.unmount());
    container.remove();
  };
  return { container, root, onAction, onExpandedChange, imageHandlers: allProps.imageHandlers, cleanup };
}

/** @param {HTMLElement} container @param {string} label */
function byLabel(container, label) {
  return /** @type {HTMLElement} */ (container.querySelector(`[aria-label="${label}"]`));
}

/** React listens to `input`; set the value through the native setter so it notices the change. */
async function typeInto(input, text) {
  await act(() => {
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function press(element, key, init = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  await act(() => { element.dispatchEvent(event); });
  return event;
}

describe('CompareTransformControls', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    i18nState.language = 'sv';
  });

  it('collapsed: one disclosure button with a summary; it asks to expand', async () => {
    const { container, onExpandedChange, cleanup } = await renderBar({
      expanded: false,
      transform: { scale: 1.255, dx: 0, dy: 0, rotation: 359.9 },
    });
    const toggle = container.querySelector('.compare-transform-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.compare-transform-controls')).toBe(null);
    expect(container.querySelector('.compare-transform-summary').textContent).toBe('125,5 % · −0,1°');
    expect(container.querySelector('[role="toolbar"]').getAttribute('aria-label')).toBe('Fine-tuning, right page');
    await act(() => toggle.click());
    expect(onExpandedChange).toHaveBeenCalledWith(true);
    await cleanup();
  });

  it('fine buttons step 0.1 % / 0.1° and ten times that with Shift', async () => {
    const { container, onAction, cleanup } = await renderBar();
    const click = async (label, init = {}) => {
      await act(() => { byLabel(container, label).dispatchEvent(new MouseEvent('click', { bubbles: true, ...init })); });
    };
    await click('Zoom in 0.1 % (Shift: 1 %)');
    await click('Zoom out 0.1 % (Shift: 1 %)', { shiftKey: true });
    await click('Rotate 0.1° clockwise (Shift: 1°)');
    await click('Rotate 0.1° counter-clockwise (Shift: 1°)', { shiftKey: true });
    expect(onAction.mock.calls.map(([action]) => action)).toEqual([
      { type: 'nudge', target: 'compare', field: 'scale', delta: 0.001 },
      { type: 'nudge', target: 'compare', field: 'scale', delta: -0.01 },
      { type: 'nudge', target: 'compare', field: 'rotation', delta: 0.1 },
      { type: 'nudge', target: 'compare', field: 'rotation', delta: -1 },
    ]);
    // At identity with neutral image values every reset is disabled: nothing to clear.
    expect(byLabel(container, 'Reset all (layout and image)').disabled).toBe(true);
    expect(byLabel(container, 'Reset layout (zoom, position, rotation)').disabled).toBe(true);
    expect(byLabel(container, 'Reset image (brightness, contrast, color)').disabled).toBe(true);
    await cleanup();
  });

  it.each([
    ['125,5', 1.255],
    ['125.5', 1.255],
    ['80 %', 0.8],
  ])('zoom field commits %j as scale %d on Enter', async (text, scale) => {
    const { container, onAction, cleanup } = await renderBar();
    const field = /** @type {HTMLInputElement} */ (byLabel(container, 'Page zoom in percent'));
    expect(field.value).toBe('100,0');
    await typeInto(field, text);
    await press(field, 'Enter');
    expect(onAction).toHaveBeenCalledWith({ type: 'set', target: 'compare', transform: { scale } });
    await cleanup();
  });

  it('offset and rotation fields accept decimal comma and point', async () => {
    const { container, onAction, cleanup } = await renderBar({ pane: 'primary' });
    await typeInto(byLabel(container, 'Horizontal offset in pixels'), '-12,25');
    await press(byLabel(container, 'Horizontal offset in pixels'), 'Enter');
    await typeInto(byLabel(container, 'Vertical offset in pixels'), '3.5');
    await press(byLabel(container, 'Vertical offset in pixels'), 'Enter');
    await typeInto(byLabel(container, 'Rotation in degrees'), '−0,3');
    await press(byLabel(container, 'Rotation in degrees'), 'Enter');
    expect(onAction.mock.calls.map(([action]) => action)).toEqual([
      { type: 'set', target: 'primary', transform: { dx: -12.25 } },
      { type: 'set', target: 'primary', transform: { dy: 3.5 } },
      { type: 'set', target: 'primary', transform: { rotation: -0.3 } },
    ]);
    await cleanup();
  });

  it('rejects text that is not a number, flags the field and keeps the value', async () => {
    const { container, onAction, cleanup } = await renderBar();
    const field = /** @type {HTMLInputElement} */ (byLabel(container, 'Rotation in degrees'));
    await typeInto(field, 'abc');
    await press(field, 'Enter');
    expect(onAction).not.toHaveBeenCalled();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.value).toBe('0,0');
    await cleanup();
  });

  it('Escape reverts a draft; ArrowUp/ArrowDown step the field (Shift: ×10); blur without edits commits nothing', async () => {
    const { container, onAction, cleanup } = await renderBar({ transform: { scale: 1, dx: 1.23, dy: 0, rotation: 0 } });
    const dx = /** @type {HTMLInputElement} */ (byLabel(container, 'Horizontal offset in pixels'));
    expect(dx.value).toBe('1,2');
    await act(() => { dx.focus(); });
    await act(() => { dx.blur(); });
    expect(onAction).not.toHaveBeenCalled();

    await typeInto(dx, '99');
    await press(dx, 'Escape');
    expect(dx.value).toBe('1,2');
    expect(onAction).not.toHaveBeenCalled();

    await press(dx, 'ArrowUp');
    await press(dx, 'ArrowDown', { shiftKey: true });
    const zoom = byLabel(container, 'Page zoom in percent');
    await press(zoom, 'ArrowUp');
    expect(onAction.mock.calls.map(([action]) => action)).toEqual([
      { type: 'nudge', target: 'compare', field: 'dx', delta: 1 },
      { type: 'nudge', target: 'compare', field: 'dx', delta: -10 },
      { type: 'nudge', target: 'compare', field: 'scale', delta: 0.001 },
    ]);
    await cleanup();
  });

  it('the pan control maps arrow keys to 1 px (Shift: 10 px) and is exempt from viewer shortcuts', async () => {
    const { container, onAction, cleanup } = await renderBar();
    const pad = byLabel(container, 'Move the page: drag it, or use the arrow keys here (Shift: 10 px)');
    expect(isEditableTarget(pad)).toBe(true);
    const right = await press(pad, 'ArrowRight');
    const up = await press(pad, 'ArrowUp', { shiftKey: true });
    const ctrl = await press(pad, 'ArrowLeft', { ctrlKey: true });
    expect(right.defaultPrevented).toBe(true);
    expect(up.defaultPrevented).toBe(true);
    expect(ctrl.defaultPrevented).toBe(false);
    expect(shouldIgnoreViewerShortcut(new KeyboardEvent('keydown', { key: 'ArrowRight' }))).toBe(false);
    expect(onAction.mock.calls.map(([action]) => action)).toEqual([
      { type: 'nudge', target: 'compare', field: 'dx', delta: 1 },
      { type: 'nudge', target: 'compare', field: 'dy', delta: -10 },
    ]);
    await cleanup();
  });

  it('collapsed: a one-character badge marks an active image adjustment; the summary text stays short', async () => {
    const neutral = await renderBar({ expanded: false, transform: { scale: 1, dx: 0, dy: 0, rotation: 94.6 } });
    expect(neutral.container.querySelector('.compare-transform-summary').textContent).toBe('100,0 % · 94,6°');
    expect(neutral.container.querySelector('.compare-transform-badge')).toBe(null);
    await neutral.cleanup();

    const adjusted = await renderBar({ expanded: false, imageProperties: { ...NEUTRAL_IMAGE, invert: true } });
    expect(adjusted.container.querySelector('.compare-transform-summary').textContent).toBe('100,0 % · 0,0°');
    const badge = adjusted.container.querySelector('.compare-transform-badge');
    expect(badge.getAttribute('title')).toBe('Image adjusted (brightness, contrast or color)');
    expect(badge.querySelector('[aria-hidden="true"]').textContent).toBe('◐');
    expect(adjusted.container.querySelector('.compare-transform-toggle').textContent)
      .toContain('Image adjusted (brightness, contrast or color)');
    await adjusted.cleanup();
  });

  it('expanded: every control shows its current value, image values included', async () => {
    const { container, cleanup } = await renderBar({
      transform: { scale: 1.015, dx: 1.5, dy: -2, rotation: 94.6 },
      imageProperties: { rotation: 90, brightness: 120, contrast: 85, grayscale: 40, invert: true },
    });
    const value = (label) => /** @type {HTMLInputElement} */ (byLabel(container, label)).value;
    expect(value('Page zoom in percent')).toBe('101,5');
    expect(value('Horizontal offset in pixels')).toBe('1,5');
    expect(value('Vertical offset in pixels')).toBe('−2,0');
    expect(value('Rotation in degrees')).toBe('94,6');
    expect(value('Brightness in percent (100 = unchanged)')).toBe('120');
    expect(value('Contrast in percent (100 = unchanged)')).toBe('85');
    expect(value('Grayscale in percent (0 = in color)')).toBe('40');
    const invert = /** @type {HTMLInputElement} */ (byLabel(container, 'Invert colors'));
    expect(invert.type).toBe('checkbox');
    expect(invert.checked).toBe(true);
    await cleanup();
  });

  it('image fields commit through the shared handlers with decimal comma, Enter, Escape and Arrow steps', async () => {
    const { container, imageHandlers, cleanup } = await renderBar({
      imageProperties: { ...NEUTRAL_IMAGE, brightness: 120 },
    });
    const brightness = byLabel(container, 'Brightness in percent (100 = unchanged)');
    await typeInto(brightness, '130,5');
    await press(brightness, 'Enter');
    expect(imageHandlers.onBrightnessChange).toHaveBeenLastCalledWith({ target: { value: 130.5 } }, 'compare');
    await press(brightness, 'ArrowUp', { shiftKey: true });
    expect(imageHandlers.onBrightnessChange).toHaveBeenLastCalledWith({ target: { value: 130 } }, 'compare');

    const contrast = byLabel(container, 'Contrast in percent (100 = unchanged)');
    await press(contrast, 'ArrowDown');
    expect(imageHandlers.onContrastChange).toHaveBeenLastCalledWith({ target: { value: 99 } }, 'compare');

    const grayscale = byLabel(container, 'Grayscale in percent (0 = in color)');
    await typeInto(grayscale, '25');
    await press(grayscale, 'Escape');
    expect(imageHandlers.onGrayscaleChange).not.toHaveBeenCalled();
    await typeInto(grayscale, '25');
    await press(grayscale, 'Enter');
    expect(imageHandlers.onGrayscaleChange).toHaveBeenLastCalledWith({ target: { value: 25 } }, 'compare');

    const invert = byLabel(container, 'Invert colors');
    await act(() => invert.click());
    expect(imageHandlers.onInvertChange).toHaveBeenCalledTimes(1);
    expect(imageHandlers.onInvertChange.mock.calls[0][1]).toBe('compare');
    await cleanup();
  });

  it('the 90 degree buttons sit with the rotation and dispatch rotate ±90 with a keep-fine-tuning tooltip', async () => {
    const { container, onAction, cleanup } = await renderBar({ pane: 'primary', transform: { ...IDENTITY, rotation: 4.6 } });
    const cw = byLabel(container, 'Rotate right 90°');
    const ccw = byLabel(container, 'Rotate left 90°');
    expect(cw.closest('[role="group"]').getAttribute('aria-label')).toBe('Rotation');
    expect(ccw.closest('[role="group"]').getAttribute('aria-label')).toBe('Rotation');
    expect(cw.getAttribute('title')).toBe('Rotates 90° and keeps the fine tuning (4.6° → 94.6°)');
    expect(ccw.getAttribute('title')).toBe('Rotates −90° and keeps the fine tuning (4.6° → −85.4°)');
    await act(() => cw.click());
    await act(() => ccw.click());
    expect(onAction.mock.calls.map(([action]) => action)).toEqual([
      { type: 'rotate', target: 'primary', delta: 90 },
      { type: 'rotate', target: 'primary', delta: -90 },
    ]);
    await cleanup();
  });

  it('three labelled resets: all (layout and image), layout only, image only', async () => {
    const { container, onAction, imageHandlers, cleanup } = await renderBar({
      transform: { scale: 1.2, dx: 3, dy: 0, rotation: 94.6 },
      imageProperties: { ...NEUTRAL_IMAGE, grayscale: 50 },
    });
    const group = container.querySelector('.compare-transform-resets');
    expect(group.getAttribute('role')).toBe('group');
    expect([...group.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Reset all (layout and image)',
      'Reset layout (zoom, position, rotation)',
      'Reset image (brightness, contrast, color)',
    ]);
    await act(() => byLabel(container, 'Reset layout (zoom, position, rotation)').click());
    expect(onAction).toHaveBeenLastCalledWith({ type: 'reset', target: 'compare' });
    expect(imageHandlers.onResetImage).not.toHaveBeenCalled();

    await act(() => byLabel(container, 'Reset image (brightness, contrast, color)').click());
    expect(imageHandlers.onResetImage).toHaveBeenCalledWith('compare');
    expect(onAction).toHaveBeenCalledTimes(1);

    await act(() => byLabel(container, 'Reset all (layout and image)').click());
    expect(imageHandlers.onResetPane).toHaveBeenCalledWith('compare');
    // No fourth, icon-only reset survives.
    expect(container.querySelectorAll('button[aria-label*="Reset"]').length).toBe(3);
    await cleanup();
  });

  it('only one part active: the matching partial reset and the full reset are enabled', async () => {
    const { container, cleanup } = await renderBar({ imageProperties: { ...NEUTRAL_IMAGE, brightness: 110 } });
    expect(byLabel(container, 'Reset all (layout and image)').disabled).toBe(false);
    expect(byLabel(container, 'Reset layout (zoom, position, rotation)').disabled).toBe(true);
    expect(byLabel(container, 'Reset image (brightness, contrast, color)').disabled).toBe(false);
    await cleanup();
  });

  it('formats with a decimal point in English', async () => {
    i18nState.language = 'en';
    const { container, cleanup } = await renderBar({ transform: { scale: 0.995, dx: -2.5, dy: 0, rotation: 12.3 } });
    expect(/** @type {HTMLInputElement} */ (byLabel(container, 'Page zoom in percent')).value).toBe('99.5');
    expect(/** @type {HTMLInputElement} */ (byLabel(container, 'Horizontal offset in pixels')).value).toBe('-2.5');
    expect(/** @type {HTMLInputElement} */ (byLabel(container, 'Rotation in degrees')).value).toBe('12.3');
    await cleanup();
  });
});
