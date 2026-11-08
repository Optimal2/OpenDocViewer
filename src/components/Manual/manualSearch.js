// File: src/components/Manual/manualSearch.js
/**
 * In-manual text search: locale-aware case folding, match collection over the rendered manual and
 * highlighting through the CSS Custom Highlight API with a `<mark>` fallback.
 */

/**
 * Minimum query length before the manual search runs. Single characters match
 * almost every paragraph and only add noise to the highlight pass.
 */
export const MANUAL_SEARCH_MIN_LENGTH = 2;

/**
 * Debounce delay before a typed query is applied to the rendered manual text.
 */
export const MANUAL_SEARCH_DEBOUNCE_MS = 200;

/**
 * Name of the shared CSS Custom Highlight covering every manual search hit.
 */
const MANUAL_SEARCH_HIGHLIGHT_NAME = 'odv-manual-search';

/**
 * Name of the CSS Custom Highlight covering only the current manual search hit.
 */
const MANUAL_SEARCH_CURRENT_HIGHLIGHT_NAME = 'odv-manual-search-current';

/**
 * Attribute marking fallback `<mark>` wrappers with their hit index. Only marks
 * carrying it belong to the search; `<mark>` elements authored in the manual
 * itself stay searchable and are never unwrapped.
 */
const MANUAL_SEARCH_MARK_ATTRIBUTE = 'data-odv-manual-mark';

/**
 * Build a case-folding function that lowers one character through the UI
 * locale, so Swedish characters such as å/ä/ö fold correctly instead of by raw
 * code units. An invalid language tag falls back to locale-independent
 * lowering.
 *
 * @param {string} language BCP-47 language tag, e.g. `sv`.
 * @returns {function(string): string}
 */
function createManualSearchFolder(language) {
  let locale = language || undefined;
  try {
    'a'.toLocaleLowerCase(locale);
  } catch {
    locale = undefined;
  }
  const cache = new Map();
  return (character) => {
    let folded = cache.get(character);
    if (folded === undefined) {
      try {
        folded = character.toLocaleLowerCase(locale);
      } catch {
        folded = character.toLowerCase();
      }
      cache.set(character, folded);
    }
    return folded;
  };
}

/**
 * Case-fold text one code point at a time and keep, for every folded code
 * unit, the original code-unit range of the character it came from.
 *
 * Lower-casing can change the length (U+0130 "İ" becomes "i" + U+0307), so an
 * offset found in the folded string is not an offset in the original text.
 * The index map translates every hit back to the original text node, which is
 * what ranges and `<mark>` wrappers need. Folding the query the same way keeps
 * both sides on identical rules, including context-free handling of
 * characters such as the Greek final sigma.
 *
 * @param {string} text
 * @param {function(string): string} fold
 * @returns {{folded: string, sourceStart: Array<number>, sourceEnd: Array<number>, foldedStartAt: Array<number>}}
 *   `sourceStart`/`sourceEnd` are indexed by folded code unit; `foldedStartAt`
 *   is indexed by original character-start offset (and `text.length`).
 */
function foldManualSearchText(text, fold) {
  let folded = '';
  const sourceStart = [];
  const sourceEnd = [];
  const foldedStartAt = [];
  let offset = 0;
  for (const character of text) {
    const end = offset + character.length;
    const lowered = fold(character);
    foldedStartAt[offset] = folded.length;
    for (let unit = 0; unit < lowered.length; unit += 1) {
      sourceStart.push(offset);
      sourceEnd.push(end);
    }
    folded += lowered;
    offset = end;
  }
  foldedStartAt[offset] = folded.length;
  return { folded, sourceStart, sourceEnd, foldedStartAt };
}

/**
 * Find every non-overlapping occurrence of the query in the rendered manual
 * text. Script/style content and the search's own leftover marks never match.
 * Returned offsets always refer to the original text node value.
 *
 * @param {Element} root Rendered manual container.
 * @param {string} query Already trimmed search text.
 * @param {string} language BCP-47 language tag used for case folding.
 * @returns {Array<{node: Text, start: number, end: number}>}
 */
export function collectManualTextMatches(root, query, language) {
  const matches = [];
  if (!root || typeof query !== 'string') return matches;
  const fold = createManualSearchFolder(language);
  const foldedQuery = foldManualSearchText(query, fold).folded;
  if (!foldedQuery) return matches;
  const doc = root.ownerDocument || document;
  const showText = typeof NodeFilter !== 'undefined' ? NodeFilter.SHOW_TEXT : 4;
  const filterAccept = typeof NodeFilter !== 'undefined' ? NodeFilter.FILTER_ACCEPT : 1;
  const filterReject = typeof NodeFilter !== 'undefined' ? NodeFilter.FILTER_REJECT : 2;
  const walker = doc.createTreeWalker(root, showText, {
    acceptNode(node) {
      if (!node || typeof node.nodeValue !== 'string' || !node.nodeValue) return filterReject;
      const parent = node.parentElement;
      if (!parent || !root.contains(parent)) return filterReject;
      const tagName = String(parent.tagName || '').toUpperCase();
      if (tagName === 'SCRIPT' || tagName === 'STYLE') return filterReject;
      if (tagName === 'MARK' && parent.hasAttribute(MANUAL_SEARCH_MARK_ATTRIBUTE)) return filterReject;
      return filterAccept;
    },
  });
  let current = walker.nextNode();
  while (current) {
    const { folded, sourceStart, sourceEnd, foldedStartAt } = foldManualSearchText(current.nodeValue, fold);
    let fromIndex = 0;
    for (;;) {
      const found = folded.indexOf(foldedQuery, fromIndex);
      if (found < 0) break;
      const start = sourceStart[found];
      const end = sourceEnd[found + foldedQuery.length - 1];
      matches.push({ node: current, start, end });
      // Continue after the last original character of the hit, so a hit that
      // ends inside a multi-unit folding never overlaps the next one.
      fromIndex = foldedStartAt[end];
    }
    current = walker.nextNode();
  }
  return matches;
}

/**
 * @returns {boolean} True when the CSS Custom Highlight API can be used.
 */
export function canUseCustomHighlight() {
  try {
    return typeof CSS !== 'undefined' && !!CSS.highlights
      && typeof Range !== 'undefined' && typeof Highlight !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * Highlight every match through the CSS Custom Highlight API without touching
 * the manual DOM at all.
 *
 * Only matches that produced a range are returned, so the caller's counter and
 * `ranges[index]` always describe the same hit.
 *
 * @param {Array<{node: Text, start: number, end: number}>} matches
 * @param {number} currentIndex
 * @returns {{matches: Array<{node: Text, start: number, end: number}>, setCurrent: function(number): void, cleanup: function(): void}}
 */
export function applyCustomHighlight(matches, currentIndex) {
  const ranges = [];
  const kept = [];
  matches.forEach((match) => {
    const { node, start, end } = match;
    try {
      const range = (node.ownerDocument || document).createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      ranges.push(range);
      kept.push(match);
    } catch {
      // Skip matches whose text node changed under us.
    }
  });
  const setCurrent = (index) => {
    try {
      if (ranges[index]) {
        CSS.highlights.set(MANUAL_SEARCH_CURRENT_HIGHLIGHT_NAME, new Highlight(ranges[index]));
      } else {
        CSS.highlights.delete(MANUAL_SEARCH_CURRENT_HIGHLIGHT_NAME);
      }
    } catch {
      // The registry write failed; the shared highlight below still marks every hit.
    }
  };
  try {
    CSS.highlights.set(MANUAL_SEARCH_HIGHLIGHT_NAME, new Highlight(...ranges));
  } catch {
    // Registry write failed; the fallback path is picked on the next search.
  }
  setCurrent(currentIndex);
  return {
    matches: kept,
    setCurrent,
    cleanup() {
      try { CSS.highlights.delete(MANUAL_SEARCH_HIGHLIGHT_NAME); } catch { /* ignore */ }
      try { CSS.highlights.delete(MANUAL_SEARCH_CURRENT_HIGHLIGHT_NAME); } catch { /* ignore */ }
    },
  };
}

/**
 * Fallback highlighter for browsers without the CSS Custom Highlight API:
 * wrap every match in a `<mark>` carrying its hit index. Only matches that
 * were actually wrapped are returned, and the marks are indexed in the same
 * order, so the counter and the current mark always describe the same hit.
 * Callers must pass the returned marks to {@link removeMarkFallback} when the
 * search ends.
 *
 * @param {Element} container Rendered manual container.
 * @param {Array<{node: Text, start: number, end: number}>} matches
 * @returns {{matches: Array<{node: Text, start: number, end: number}>, marks: Array<Element>}}
 */
export function applyMarkFallback(container, matches) {
  const doc = container.ownerDocument || document;
  const created = matches.map(() => null);
  const byNode = new Map();
  matches.forEach((match, index) => {
    if (!match || !match.node || !container.contains(match.node)) return;
    if (!byNode.has(match.node)) byNode.set(match.node, []);
    byNode.get(match.node).push({ ...match, index });
  });
  byNode.forEach((entries, node) => {
    // Descending offsets keep the earlier ranges valid while text nodes split.
    entries.sort((a, b) => b.start - a.start).forEach(({ start, end, index }) => {
      try {
        const text = node.nodeValue || '';
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || start >= end) return;
        const range = doc.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        const mark = doc.createElement('mark');
        mark.className = 'odv-manual-mark';
        range.surroundContents(mark);
        created[index] = mark;
      } catch {
        // Skip matches that no longer slice cleanly after a concurrent DOM change.
      }
    });
  });
  const kept = [];
  const marks = [];
  created.forEach((mark, index) => {
    if (!mark) return;
    mark.setAttribute(MANUAL_SEARCH_MARK_ATTRIBUTE, String(marks.length));
    marks.push(mark);
    kept.push(matches[index]);
  });
  return { matches: kept, marks };
}

/**
 * @param {Array<Element>} marks Search marks in hit-index order.
 * @param {number} index Hit index shown as current.
 */
export function setCurrentMark(marks, index) {
  (marks || []).forEach((mark, markIndex) => {
    if (!mark || !mark.isConnected) return;
    if (markIndex === index) {
      mark.classList.add('is-current');
    } else {
      mark.classList.remove('is-current');
    }
  });
}

/**
 * Unwrap fallback marks and merge the split text nodes back together. This
 * also runs on a subtree React has already detached (the dialog closed), so
 * it relies on each mark's parent rather than on document connection.
 *
 * @param {Array<Element>} marks
 * @param {Element} container Rendered manual container.
 */
export function removeMarkFallback(marks, container) {
  (marks || []).forEach((mark) => {
    try {
      if (!mark) return;
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
    } catch { /* ignore */ }
  });
  try { container?.normalize?.(); } catch { /* ignore */ }
}

/**
 * Open collapsed `<details>` ancestors of the hit and scroll it into the
 * dialog scroll container.
 *
 * @param {Element} container Rendered manual container.
 * @param {{node: Text}|null} match
 * @param {number} index Hit index to reveal.
 * @param {{useMarks: boolean, marks: (Array<Element>|null)}|null} session Active highlight session.
 */
export function revealManualMatch(container, match, index, session) {
  if (!container || !match) return;
  let target = null;
  if (session && session.useMarks) {
    target = session.marks?.[index] || null;
  }
  if (!target && match.node) target = match.node.parentElement;
  if (!target || !container.contains(target)) return;
  let ancestor = target.parentElement;
  while (ancestor && ancestor !== container) {
    if (String(ancestor.tagName || '').toUpperCase() === 'DETAILS' && ancestor.open === false) {
      try { ancestor.open = true; } catch { /* ignore */ }
    }
    ancestor = ancestor.parentElement;
  }
  if (typeof target.scrollIntoView === 'function') {
    try {
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch {
      try { target.scrollIntoView(); } catch { /* ignore */ }
    }
  }
}
