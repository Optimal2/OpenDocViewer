// @vitest-environment jsdom
// File: src/components/__tests__/printSelectionTiles.test.jsx
/**
 * Page tiles in the print selection workspace: a tile is a button, so its "Show page" button
 * must be the tile's sibling and not its child (a button must not contain another control,
 * WCAG 4.1.2). Proves the structure, that the Show page button opens the page preview from the
 * keyboard path (a click, which is what Enter and Space produce on a button) without changing
 * the selection, and that a key pressed on it no longer reaches the tile's own key handler.
 * tests/ui/selection-tiles.spec.mjs proves the placement, hover and drag in a real browser.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import PrintSelectionWorkspace from '../PrintSelectionWorkspace.jsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options) => (options && options.defaultValue) || key,
    i18n: { language: 'en' },
  }),
}));

const PAGES = [
  { documentId: 'A', documentNumber: 1, totalDocuments: 2, documentPageNumber: 1, documentPageCount: 2, thumbnailStatus: 1 },
  { documentId: 'A', documentNumber: 1, totalDocuments: 2, documentPageNumber: 2, documentPageCount: 2, thumbnailStatus: 1 },
  { documentId: 'B', documentNumber: 2, totalDocuments: 2, documentPageNumber: 1, documentPageCount: 1, thumbnailStatus: 1 },
];
const BUNDLE = { documents: [{ documentId: 'A' }, { documentId: 'B' }] };
const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex], [role="button"]';

let mounted = null;

/**
 * @param {Array<number>} [initialSequence] Selected pages as 1-based page numbers.
 * @returns {Promise<HTMLElement>}
 */
async function renderWorkspace(initialSequence = [1, 2]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(() => root.render(createElement(PrintSelectionWorkspace, {
    allPages: PAGES,
    bundle: BUNDLE,
    initialSequence,
    onSave: () => {},
    onCancel: () => {},
  })));
  mounted = { container, root };
  return container;
}

afterEach(async () => {
  if (!mounted) return;
  await act(() => mounted.root.unmount());
  mounted.container.remove();
  mounted = null;
});

const tilesOf = (container) => Array.from(container.querySelectorAll('.print-selection-tile'));
const pressed = (container) => tilesOf(container).map((tile) => tile.getAttribute('aria-pressed'));

describe('print selection workspace tiles', () => {
  it('renders every tile as a button with no control inside, followed by its Show page button', async () => {
    const container = await renderWorkspace();
    const tiles = tilesOf(container);
    // Three pages under "Available pages" and the two selected ones.
    expect(tiles).toHaveLength(5);
    for (const tile of tiles) {
      expect(tile.getAttribute('role')).toBe('button');
      expect(tile.querySelectorAll(FOCUSABLE)).toHaveLength(0);
      expect(tile.parentElement.classList.contains('print-selection-tile-frame')).toBe(true);
      const show = tile.nextElementSibling;
      expect(show?.tagName).toBe('BUTTON');
      expect(show.classList.contains('print-selection-tile-preview')).toBe(true);
      expect(show.getAttribute('aria-label')).toBe('Show page');
      expect(show.parentElement).toBe(tile.parentElement);
    }
  });

  it('puts the drag source and the dimming of an included page on the frame', async () => {
    const container = await renderWorkspace([1]);
    const [includedLeft, freeLeft] = Array.from(container.querySelectorAll('.print-selection-panel-left .print-selection-tile'));
    // Page 1 is in the selection: its tile under "Available pages" is dimmed and cannot be dragged.
    expect(includedLeft.getAttribute('aria-disabled')).toBe('true');
    expect(includedLeft.parentElement.classList.contains('is-included')).toBe(true);
    expect(includedLeft.parentElement.getAttribute('draggable')).toBe('false');
    expect(freeLeft.getAttribute('aria-disabled')).toBe('false');
    expect(freeLeft.parentElement.classList.contains('is-included')).toBe(false);
    expect(freeLeft.parentElement.getAttribute('draggable')).toBe('true');
    // The tile itself is no longer the drag source; the frame is, so a drag can start on either control.
    expect(freeLeft.hasAttribute('draggable')).toBe(false);
  });

  it('opens the page preview from the Show page button and leaves the selection alone', async () => {
    const container = await renderWorkspace();
    const rightTiles = Array.from(container.querySelectorAll('.print-selection-panel-right .print-selection-tile'));
    await act(() => {
      rightTiles[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    const before = pressed(container);
    expect(before.filter((value) => value === 'true')).toHaveLength(1);

    const show = rightTiles[0].nextElementSibling;
    // A key pressed on the Show page button must not be cancelled by the tile, or the button's
    // own activation would never happen (it was, while the button was inside the tile).
    const keydown = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await act(() => { show.dispatchEvent(keydown); });
    expect(keydown.defaultPrevented).toBe(false);
    expect(pressed(container)).toEqual(before);

    expect(container.querySelector('.print-selection-lightbox')).toBeNull();
    await act(() => { show.click(); });
    expect(container.querySelector('.print-selection-lightbox')).not.toBeNull();
    expect(pressed(container)).toEqual(before);
  });
});
