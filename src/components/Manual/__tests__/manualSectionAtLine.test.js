// File: src/components/Manual/__tests__/manualSectionAtLine.test.js
//
// The section being read is the last rendered heading at or above the active line. A collapsed
// `<details>` chapter must not take part: a browser that hides its content with
// `content-visibility: hidden` still reports a box for every heading inside, placed below the
// summary where it would have been shown, which is on top of the chapters after it. Counted,
// one of those headings is taken for the section being read as soon as the reader scrolls.
// jsdom has no layout, so the headings here are stand-ins with the two things the helper asks an
// element for. tests/ui/manual-section-tracking.spec.mjs proves the same in a real browser.
import { describe, expect, it } from 'vitest';
import { findManualSectionAtLine, isManualElementRendered } from '../manualNavigation.js';

/**
 * A heading stand-in.
 * @param {string} id
 * @param {number} top Viewport y of the heading.
 * @param {{ shown?: boolean, size?: number, legacy?: boolean }} [options] `legacy: true` leaves
 *   out `checkVisibility()`, like a browser without it. `size: 0` gives a box without size.
 * @returns {{ id: string, element: Object }}
 */
function heading(id, top, { shown = true, size = 20, legacy = false } = {}) {
  const element = {
    getBoundingClientRect: () => ({ top, width: size, height: size }),
  };
  if (!legacy) element.checkVisibility = () => shown;
  return { id, element };
}

describe('isManualElementRendered', () => {
  it('follows checkVisibility() where the browser has it, whatever the box says', () => {
    expect(isManualElementRendered(heading('a', 10).element)).toBe(true);
    // Inside a collapsed <details>: a box with size, and not shown.
    expect(isManualElementRendered(heading('a', 10, { shown: false }).element)).toBe(false);
    // Rendered by the browser's own account, even without a box of its own.
    expect(isManualElementRendered(heading('a', 10, { size: 0 }).element)).toBe(true);
  });

  it('falls back to the size of the box where checkVisibility() does not exist', () => {
    expect(isManualElementRendered(heading('a', 10, { legacy: true }).element)).toBe(true);
    expect(isManualElementRendered(heading('a', 10, { legacy: true, size: 0 }).element)).toBe(false);
  });

  it('is false without an element', () => {
    expect(isManualElementRendered(null)).toBe(false);
    expect(isManualElementRendered(undefined)).toBe(false);
    expect(isManualElementRendered({})).toBe(false);
  });
});

describe('findManualSectionAtLine', () => {
  it('returns the last heading at or above the line', () => {
    const entries = [heading('one', -900), heading('two', -300), heading('three', 150), heading('four', 700)];
    expect(findManualSectionAtLine(entries, 158)).toBe('three');
    expect(findManualSectionAtLine(entries, 149)).toBe('two');
  });

  it('returns the first entry above every heading, and an empty id without entries', () => {
    expect(findManualSectionAtLine([heading('one', 400), heading('two', 900)], 158)).toBe('one');
    expect(findManualSectionAtLine([], 158)).toBe('');
    expect(findManualSectionAtLine(null, 158)).toBe('');
  });

  it('passes over the headings of a collapsed chapter that overlap the chapter being read', () => {
    // Positions like those measured in the bundled manual with the reader at "jmf-curtain" (a
    // shortened list): the selection guide before it is collapsed, and its headings report
    // positions from its summary downwards, across the open comparison guide. "urval-reset" lands
    // below the line and used to end the search there.
    const entries = [
      heading('overview', -17000),
      heading('urval-open', -6332, { shown: false }),
      heading('urval-print', -638, { shown: false }),
      heading('urval-reset', 578, { shown: false }),
      heading('jmf-open', -6303),
      heading('jmf-overlay', -1561),
      heading('jmf-curtain', 8),
      heading('jmf-print', 1427),
    ];
    expect(findManualSectionAtLine(entries, 158)).toBe('jmf-curtain');
    // The same positions with every heading counted give the wrong section: this is the fault.
    const counted = entries.map((entry) => heading(entry.id, entry.element.getBoundingClientRect().top));
    expect(findManualSectionAtLine(counted, 158)).toBe('urval-print');
  });

  it('passes over a heading without a box, as before', () => {
    const entries = [heading('one', -300), heading('hidden', 0, { size: 0 }), heading('two', 100), heading('three', 600)];
    expect(findManualSectionAtLine(entries, 158)).toBe('two');
    const legacy = [heading('one', -300, { legacy: true }), heading('closed', 500, { legacy: true, size: 0 }), heading('two', 100, { legacy: true })];
    expect(findManualSectionAtLine(legacy, 158)).toBe('two');
  });
});
