// @vitest-environment jsdom
// File: src/hooks/__tests__/useDocumentLoadSettled.test.jsx
/**
 * useDocumentLoadSettled: the load is settled when the loader's run is over and every page has
 * been rendered (or has failed) at least once. Evictions afterwards do not unsettle it, a pass
 * that stalls settles after the stall time, a new run or a new session unsettles it, and with
 * OCR off the hook does nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import useDocumentLoadSettled, { DOCUMENT_LOAD_STALL_MS } from '../useDocumentLoadSettled.js';

const page = (index, overrides = {}) => ({ sourceKey: 'doc', pageIndex: index, status: 1, fullSizeStatus: 1, ...overrides });
const unrendered = (index) => page(index, { fullSizeStatus: 0 });

let root;
let container;
let latest;

function Harness(props) {
  latest = useDocumentLoadSettled(props);
  return null;
}

async function render(props) {
  await act(async () => { root.render(createElement(Harness, props)); });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  latest = undefined;
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useDocumentLoadSettled', () => {
  it('does nothing and reports settled while OCR is off, whatever the load does', async () => {
    await render({ enabled: false, pages: [unrendered(0)], loadingRunActive: true });
    expect(latest).toBe(true);
    await render({ enabled: false, pages: [], loadingRunActive: true });
    expect(latest).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is settled with nothing loaded and no run, and unsettled as soon as a run starts', async () => {
    await render({ enabled: true, pages: [], loadingRunActive: false });
    expect(latest).toBe(true);
    await render({ enabled: true, pages: [], loadingRunActive: true });
    expect(latest).toBe(false);
  });

  it('stays unsettled through the run and through the rendering that follows it, until every page has been rendered once', async () => {
    await render({ enabled: true, pages: [page(0), unrendered(1), unrendered(2)], loadingRunActive: true });
    expect(latest).toBe(false);
    // The run ends with two pages still to render: the tail belongs to the load.
    await render({ enabled: true, pages: [page(0), unrendered(1), unrendered(2)], loadingRunActive: false });
    expect(latest).toBe(false);
    await render({ enabled: true, pages: [page(0), page(1), unrendered(2)], loadingRunActive: false });
    expect(latest).toBe(false);
    // A failed page counts: nothing more is coming for it.
    await render({ enabled: true, pages: [page(0), page(1), page(2, { fullSizeStatus: -1 })], loadingRunActive: false });
    expect(latest).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stays settled when pages are evicted and rendered again afterwards (the memory modes)', async () => {
    await render({ enabled: true, pages: [page(0), page(1), page(2)], loadingRunActive: false });
    expect(latest).toBe(true);
    await render({ enabled: true, pages: [unrendered(0), page(1), unrendered(2)], loadingRunActive: false });
    expect(latest).toBe(true);
    await act(async () => { vi.advanceTimersByTime(DOCUMENT_LOAD_STALL_MS * 2); });
    expect(latest).toBe(true);
  });

  it('settles a first pass that never held every page at once, as a small full-image cache gives', async () => {
    // Two pages fit in the cache: page 0 is evicted before page 2 is rendered.
    await render({ enabled: true, pages: [page(0), page(1), unrendered(2)], loadingRunActive: false });
    expect(latest).toBe(false);
    await render({ enabled: true, pages: [unrendered(0), page(1), page(2)], loadingRunActive: false });
    expect(latest).toBe(true);
  });

  it('settles after the stall time when a page neither renders nor fails, counted from the last page that did', async () => {
    expect(DOCUMENT_LOAD_STALL_MS).toBe(20000);
    await render({ enabled: true, pages: [page(0), unrendered(1), unrendered(2)], loadingRunActive: false, stallMs: 1000 });
    expect(latest).toBe(false);
    await act(async () => { vi.advanceTimersByTime(900); });
    expect(latest).toBe(false);
    // Progress: the clock starts again.
    await render({ enabled: true, pages: [page(0), page(1), unrendered(2)], loadingRunActive: false, stallMs: 1000 });
    await act(async () => { vi.advanceTimersByTime(900); });
    expect(latest).toBe(false);
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(latest).toBe(true);
  });

  it('does not let a re-render without progress restart the stall clock', async () => {
    const props = { enabled: true, loadingRunActive: false, stallMs: 1000 };
    await render({ ...props, pages: [page(0), unrendered(1)] });
    await act(async () => { vi.advanceTimersByTime(600); });
    // The page list changes identity (a thumbnail arrived), nothing new is rendered.
    await render({ ...props, pages: [page(0, { thumbnailStatus: 1 }), unrendered(1)] });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(latest).toBe(true);
  });

  it('is unsettled again by a new run and by a new session', async () => {
    await render({ enabled: true, pages: [page(0), page(1)], loadingRunActive: false });
    expect(latest).toBe(true);
    // More documents are loaded into the same session.
    await render({ enabled: true, pages: [page(0), page(1), { sourceKey: 'other', pageIndex: 0, status: 0, fullSizeStatus: 0 }], loadingRunActive: true });
    expect(latest).toBe(false);
    await render({ enabled: true, pages: [page(0), page(1), { sourceKey: 'other', pageIndex: 0, status: 1, fullSizeStatus: 1 }], loadingRunActive: false });
    expect(latest).toBe(true);
    // A new session: the list is emptied while its run starts, and what was seen is forgotten.
    await render({ enabled: true, pages: [], loadingRunActive: true });
    expect(latest).toBe(false);
    await render({ enabled: true, pages: [unrendered(0), unrendered(1)], loadingRunActive: false });
    expect(latest).toBe(false);
  });

  it('clears its stall timer on unmount', async () => {
    await render({ enabled: true, pages: [unrendered(0)], loadingRunActive: false });
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => { root.unmount(); });
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(container);
  });
});
