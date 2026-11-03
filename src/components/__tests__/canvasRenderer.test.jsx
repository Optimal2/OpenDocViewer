// @vitest-environment jsdom
// File: src/components/__tests__/canvasRenderer.test.jsx
/**
 * CanvasRenderer owns the bitmap size of its <canvas> imperatively and touches it only when the
 * requested size differs from the canvas's current size. Setting a canvas's width or height
 * clears the bitmap even when the value is unchanged (HTML specification), and the parent learns
 * the size it drew only after drawing — so a size re-applied after the draw wiped the page.
 * The 90° → 180° rotation showed an empty page for that reason. jsdom keeps no bitmap, so these
 * tests watch the width/height setters instead; the pixel proof is tests/ui/rotate-quarter-turns.spec.mjs.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import CanvasRenderer from '../CanvasRenderer.jsx';
import { applyCanvasBitmapSize } from '../../utils/canvasBitmapSize.js';

/** Spy on the bitmap size setters of every canvas; returns the recorded (property, value) pairs. */
function watchBitmapSetters() {
  const calls = [];
  const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
  const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height');
  Object.defineProperty(HTMLCanvasElement.prototype, 'width', {
    configurable: true,
    get: widthDescriptor.get,
    set(value) { calls.push(['width', value]); widthDescriptor.set.call(this, value); },
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'height', {
    configurable: true,
    get: heightDescriptor.get,
    set(value) { calls.push(['height', value]); heightDescriptor.set.call(this, value); },
  });
  return {
    calls,
    restore() {
      Object.defineProperty(HTMLCanvasElement.prototype, 'width', widthDescriptor);
      Object.defineProperty(HTMLCanvasElement.prototype, 'height', heightDescriptor);
    },
  };
}

describe('applyCanvasBitmapSize', () => {
  let watcher;
  beforeEach(() => { watcher = watchBitmapSetters(); });
  afterEach(() => { watcher.restore(); });

  it('sets the size the first time and reports the resize', () => {
    const canvas = document.createElement('canvas');
    expect(applyCanvasBitmapSize(canvas, 1654, 2339)).toBe(true);
    expect(canvas.width).toBe(1654);
    expect(canvas.height).toBe(2339);
  });

  it('leaves a canvas of the requested size alone (no setter call, bitmap survives)', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2339;
    canvas.height = 1654;
    watcher.calls.length = 0;
    expect(applyCanvasBitmapSize(canvas, 2339, 1654)).toBe(false);
    expect(watcher.calls).toEqual([]);
  });

  it('touches only the dimension that changed', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 200;
    watcher.calls.length = 0;
    expect(applyCanvasBitmapSize(canvas, 100, 250)).toBe(true);
    expect(watcher.calls).toEqual([['height', 250]]);
  });

  it('floors fractional sizes and clamps missing or negative values to 0', () => {
    const canvas = document.createElement('canvas');
    applyCanvasBitmapSize(canvas, 10.9, -4);
    expect([canvas.width, canvas.height]).toEqual([10, 0]);
    applyCanvasBitmapSize(canvas, undefined, NaN);
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
    expect(applyCanvasBitmapSize(null, 5, 5)).toBe(false);
  });
});

describe('CanvasRenderer', () => {
  let container;
  let root;
  let watcher;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    watcher = watchBitmapSetters();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    watcher.restore();
  });

  const render = (props) => act(() => {
    root.render(createElement(CanvasRenderer, { zoom: 1, pageNumber: 1, ...props }));
  });

  it('exposes the canvas through the forwarded ref and sizes the bitmap on mount, not as attributes', () => {
    const ref = createRef();
    render({ ref, naturalWidth: 1654, naturalHeight: 2339 });
    const canvas = container.querySelector('canvas');
    expect(ref.current).toBe(canvas);
    expect(canvas.width).toBe(1654);
    expect(canvas.height).toBe(2339);
    expect(canvas.getAttribute('data-page-number')).toBe('1');
    expect(canvas.style.transform).toBe('scale(1)');
  });

  it('does not touch the bitmap when the parent re-renders with the size the canvas already has', () => {
    const ref = createRef();
    render({ ref, naturalWidth: 1654, naturalHeight: 2339 });
    // The parent draws a rotated page: it resizes the bitmap itself, then reports that size back.
    ref.current.width = 2339;
    ref.current.height = 1654;
    watcher.calls.length = 0;

    render({ ref, naturalWidth: 2339, naturalHeight: 1654, zoom: 0.5 });

    expect(watcher.calls).toEqual([]);
    expect([ref.current.width, ref.current.height]).toEqual([2339, 1654]);
    expect(ref.current.style.transform).toBe('scale(0.5)');
  });

  it('resizes the bitmap when the requested size really changes', () => {
    const ref = createRef();
    render({ ref, naturalWidth: 1654, naturalHeight: 2339 });
    watcher.calls.length = 0;

    render({ ref, naturalWidth: 800, naturalHeight: 600 });

    expect(watcher.calls).toEqual([['width', 800], ['height', 600]]);
  });

  it('re-rendering with unchanged props and zoom leaves the bitmap untouched', () => {
    const ref = createRef();
    render({ ref, naturalWidth: 1654, naturalHeight: 2339 });
    watcher.calls.length = 0;
    render({ ref, naturalWidth: 1654, naturalHeight: 2339 });
    render({ ref, naturalWidth: 1654, naturalHeight: 2339, zoom: 2 });
    expect(watcher.calls).toEqual([]);
    expect(ref.current.style.transform).toBe('scale(2)');
  });
});
