// File: src/utils/manualContentsTree.js
/**
 * Runtime contents tree for the manual overlay.
 *
 * Installations mirror their own manual HTML files, so the tree is never authored in the manual.
 * It is built from the loaded, sanitised manual DOM: h2 headings form the top level and h3
 * headings nest under the preceding h2. Headings without an id get a stable one derived from their
 * text with the same rules as the WebClient help pages (section number dropped, å/ä/ö/é folded to
 * a/a/o/e, ASCII slug, numeric suffix on collisions), so tree links and in-text links can target
 * them.
 */

/**
 * @typedef {Object} ManualContentsEntry
 * @property {string} id Heading id (existing or generated).
 * @property {string} text Heading text with collapsed whitespace.
 * @property {number} level 1 for h2, 2 for h3.
 * @property {Element} element The heading element in the rendered manual.
 */

/**
 * @typedef {Object} ManualContentsGroup
 * @property {string} id
 * @property {string} text
 * @property {Element} element
 * @property {Array<ManualContentsEntry>} children h3 entries under this h2.
 */

/** Slug used when a heading text has no ASCII letters or digits left. */
const FALLBACK_SLUG = 'avsnitt';

/** Node.compareDocumentPosition flags (numeric so this also runs without a global Node). */
const POSITION_FOLLOWING = 4;
const POSITION_CONTAINED_BY = 16;

/**
 * @param {string} value
 * @returns {string} Text with whitespace runs collapsed and trimmed.
 */
function collapseWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * Derive a heading id from its text. The leading section number is dropped
 * ("2. Hitta rätt dokument" -> "hitta-ratt-dokument") so links survive a renumbering.
 *
 * @param {string} text
 * @returns {string}
 */
export function slugifyManualHeading(text) {
  let slug = collapseWhitespace(text).replace(/^\d+\.\s*/, '').toLowerCase();
  for (const [from, to] of [['å', 'a'], ['ä', 'a'], ['ö', 'o'], ['é', 'e']]) {
    slug = slug.split(from).join(to);
  }
  slug = slug.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || FALLBACK_SLUG;
}

/**
 * Build the contents tree from the rendered manual and give every listed heading a unique id.
 * One `querySelectorAll` pass, no layout reads, so manuals with hundreds of headings stay cheap.
 * Running it again on the same DOM keeps the ids from the first pass.
 *
 * @param {(Element|null|undefined)} root Rendered manual container.
 * @returns {{entries: Array<ManualContentsEntry>, groups: Array<ManualContentsGroup>}}
 */
export function buildManualContentsTree(root) {
  /** @type {Array<ManualContentsEntry>} */
  const entries = [];
  /** @type {Array<ManualContentsGroup>} */
  const groups = [];
  if (!root || typeof root.querySelectorAll !== 'function') return { entries, groups };

  const headings = Array.from(root.querySelectorAll('h2, h3'));
  if (headings.length === 0) return { entries, groups };

  const doc = root.ownerDocument || null;
  const headingSet = new Set(headings);
  // Ids carried by anything in the manual except the headings we are about to list, so a heading
  // keeps its own id but never takes one used by another element.
  const used = new Set();
  root.querySelectorAll('[id]').forEach((node) => {
    if (!headingSet.has(node) && node.id) used.add(node.id);
  });
  const isTaken = (candidate) => {
    if (used.has(candidate)) return true;
    // Ids elsewhere in the page (the viewer itself) must not be shadowed either.
    const existing = doc?.getElementById?.(candidate);
    return !!existing && !root.contains(existing);
  };
  const claim = (base) => {
    let candidate = base;
    let suffix = 2;
    while (isTaken(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  };

  headings.forEach((element) => {
    const text = collapseWhitespace(element.textContent);
    if (!text) return;
    const own = String(element.getAttribute('id') || '').trim();
    const id = claim(own || slugifyManualHeading(text));
    if (id !== own) element.setAttribute('id', id);
    const level = String(element.tagName || '').toUpperCase() === 'H3' ? 2 : 1;
    const entry = { id, text, level, element };
    entries.push(entry);
    // An h3 before the first h2 has no parent, so it is listed on the top level.
    if (level === 2 && groups.length > 0) {
      groups[groups.length - 1].children.push(entry);
    } else {
      groups.push({ id, text, element, children: [] });
    }
  });

  return { entries, groups };
}

/**
 * @param {Element} heading
 * @param {Node} node
 * @returns {boolean} True when the heading is the node, contains it or comes before it.
 */
function headingStartsAtOrBefore(heading, node) {
  if (heading === node) return true;
  const position = heading.compareDocumentPosition(node);
  return (position & (POSITION_FOLLOWING | POSITION_CONTAINED_BY)) !== 0;
}

/**
 * Id of the section that contains the node: the last listed heading at or before it in document
 * order, or `''` when the node comes before the first heading. Binary search over the entries.
 *
 * @param {Array<ManualContentsEntry>} entries Entries in document order.
 * @param {(Node|null|undefined)} node
 * @returns {string}
 */
export function findManualSectionId(entries, node) {
  if (!node || !Array.isArray(entries) || entries.length === 0) return '';
  let low = 0;
  let high = entries.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (headingStartsAtOrBefore(entries[middle].element, node)) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found >= 0 ? entries[found].id : '';
}

/**
 * Count search hits per section in a single merge pass. Both lists must be in document order
 * (the manual search collects its matches with a tree walker, so they are).
 *
 * @param {Array<ManualContentsEntry>} entries
 * @param {Array<{node: Node}>} matches
 * @returns {Map<string, number>} Section id -> hit count; sections without hits are absent.
 */
export function countManualMatchesPerSection(entries, matches) {
  const counts = new Map();
  if (!Array.isArray(entries) || entries.length === 0 || !Array.isArray(matches)) return counts;
  let current = -1;
  matches.forEach((match) => {
    const node = match?.node;
    if (!node) return;
    while (current + 1 < entries.length && headingStartsAtOrBefore(entries[current + 1].element, node)) {
      current += 1;
    }
    if (current < 0) return;
    const id = entries[current].id;
    counts.set(id, (counts.get(id) || 0) + 1);
  });
  return counts;
}
