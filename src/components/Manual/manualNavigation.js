// File: src/components/Manual/manualNavigation.js
/**
 * Scrolling, focus and URL-fragment helpers for navigating inside a rendered manual.
 */

/**
 * Share of the content pane height, measured from its top, inside which a heading counts as the
 * start of the section being read.
 */
export const MANUAL_SECTION_ACTIVE_LINE = 0.25;

/** Gap in pixels kept above a heading when the content pane scrolls to it. */
export const MANUAL_SECTION_SCROLL_GAP = 8;

/**
 * Open collapsed `<details>` ancestors so a target inside them can be shown.
 *
 * @param {Element} target
 * @param {Element} container Rendered manual container.
 */
export function openDetailsAncestors(target, container) {
  let ancestor = target?.parentElement || null;
  while (ancestor && ancestor !== container) {
    if (String(ancestor.tagName || '').toUpperCase() === 'DETAILS' && ancestor.open === false) {
      try { ancestor.open = true; } catch { /* ignore */ }
    }
    ancestor = ancestor.parentElement;
  }
}

/**
 * Scroll only the given pane so the target sits at its top. Unlike `scrollIntoView` this never
 * moves any other scroll container (the contents tree, the dialog or the page).
 *
 * @param {HTMLElement} pane
 * @param {Element} target
 */
export function scrollPaneToTarget(pane, target) {
  if (typeof target?.getBoundingClientRect !== 'function'
    || typeof pane?.getBoundingClientRect !== 'function') return;
  const offset = target.getBoundingClientRect().top - pane.getBoundingClientRect().top;
  pane.scrollTop = Math.max(0, pane.scrollTop + offset - MANUAL_SECTION_SCROLL_GAP);
}

/**
 * @param {Element} container Rendered manual container.
 * @param {string} id
 * @returns {(Element|null)} Element in the manual with that id. Scoped to the manual, so an id the
 *   viewer page also uses still resolves to the manual's own element.
 */
export function findManualElementById(container, id) {
  if (!container || !id) return null;
  try {
    const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(id)
      : id.replace(/["\\]/g, '\\$&');
    return container.querySelector(`[id="${escaped}"]`);
  } catch {
    return null;
  }
}

/**
 * True when the element or one of its ancestors inside the manual is not rendered
 * (`display: none`). The bundled manuals use that for a script-free image lightbox: `.lb` is hidden
 * until it is the URL fragment target (`.lb:target { display: block }`), so links to it must set
 * the fragment instead of scrolling. Collapsed `<details>` content keeps its own display value and
 * is not counted as hidden; navigation opens it instead.
 *
 * @param {Element} target
 * @param {Element} container Rendered manual container.
 * @returns {boolean}
 */
export function isHiddenInManual(target, container) {
  const view = target?.ownerDocument?.defaultView;
  if (!view || typeof view.getComputedStyle !== 'function') return false;
  let node = target;
  while (node && node !== container) {
    if (view.getComputedStyle(node).display === 'none') return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * False for an element the browser does not render: one with `display: none`, or one inside
 * content the browser skips (`content-visibility: hidden`). The content of a collapsed
 * `<details>` is the case that matters. A browser that hides it with `content-visibility: hidden`
 * still reports a box for what is inside, placed below the summary where it would have been
 * shown, so a box without size cannot be the only test. That test is the fallback where
 * `checkVisibility()` does not exist, and it is enough for a browser that hides the content with
 * `display: none`. `visibility` and `opacity` are not looked at, here or before.
 *
 * @param {(Element|null|undefined)} element
 * @returns {boolean}
 */
export function isManualElementRendered(element) {
  if (!element) return false;
  if (typeof element.checkVisibility === 'function') return element.checkVisibility() !== false;
  if (typeof element.getBoundingClientRect !== 'function') return false;
  const box = element.getBoundingClientRect();
  return !(box.width === 0 && box.height === 0);
}

/**
 * The section being read: the last rendered heading at or above the active line of the content
 * pane. Headings that are not rendered are passed over. Without that, the headings of a
 * collapsed chapter count from where they would have been shown, which is on top of the chapters
 * after it, and one of them is taken for the section being read.
 *
 * @param {Array<{id: string, element: Element}>} entries Contents entries in document order.
 * @param {number} line Viewport y coordinate of the active line.
 * @returns {string} The entry id, the first entry's id above every heading, or '' without entries.
 */
export function findManualSectionAtLine(entries, line) {
  const list = Array.isArray(entries) ? entries : [];
  let active = list[0]?.id || '';
  for (const entry of list) {
    if (!isManualElementRendered(entry.element)) continue;
    const box = entry.element.getBoundingClientRect();
    // Rendered, but without a box of its own: nothing to compare with the line.
    if (box.width === 0 && box.height === 0) continue;
    if (box.top > line) break;
    active = entry.id;
  }
  return active;
}

/**
 * Record the scroll positions of the page and of every ancestor of `from`, so a fragment
 * navigation (which the browser may scroll for) can be undone.
 *
 * @param {(Element|null)} from Innermost element whose scroll containers are recorded.
 * @returns {function(): void} Restores the recorded positions.
 */
export function captureScrollPositions(from) {
  const saved = [];
  let node = from;
  while (node) {
    saved.push([node, node.scrollLeft, node.scrollTop]);
    node = node.parentElement;
  }
  const view = from?.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
  const pageX = view?.scrollX || 0;
  const pageY = view?.scrollY || 0;
  return () => {
    saved.forEach(([element, left, top]) => {
      if (element.scrollLeft !== left) element.scrollLeft = left;
      if (element.scrollTop !== top) element.scrollTop = top;
    });
    if (view && typeof view.scrollTo === 'function' && (view.scrollX !== pageX || view.scrollY !== pageY)) {
      try { view.scrollTo(pageX, pageY); } catch { /* ignore */ }
    }
  };
}

/**
 * Replace the URL fragment without adding a history entry. A fragment-only `location.replace` is a
 * same-document navigation, so `:target` follows it (`history.replaceState` would not update
 * `:target`). The viewer keeps no state of its own in the URL fragment.
 *
 * @param {string} fragment Fragment without `#`; empty leaves a bare `#`.
 */
export function replaceUrlFragment(fragment) {
  try {
    const base = String(window.location.href).split('#')[0];
    window.location.replace(`${base}#${fragment ? encodeURIComponent(fragment) : ''}`);
  } catch {
    // Leave the URL as it is; the lightbox simply does not open.
  }
}
