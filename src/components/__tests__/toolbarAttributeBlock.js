// File: src/components/__tests__/toolbarAttributeBlock.js
/**
 * Extract an element's OWN attribute block from a JSX source file.
 *
 * The match is anchored to the requested element name and ends at the element's OWN
 * close — `/>` for a self-closing element, or `</ElementName>` for a non-self-closing
 * element — so a prop that is deleted from the element, or moved to a LATER element
 * in the same file, is NOT found inside the returned substring. The unbounded
 * `<Element[\s\S]*?prop` idiom cannot see such a relocation; this can.
 *
 * Holes this helper closes compared with the previous hardcoded regex:
 *  - A commented-out prop (e.g. `// compareTransforms={compareTransforms}`) keeps the
 *    lock green because the prop TEXT is still in the source. We strip JS line and
 *    block comments (and JSX curly-brace block comments) BEFORE the element scan, so
 *    a commented-out prop is invisible to the assertion.
 *  - A `<` inside an attribute expression (e.g. `tinyZoom={zoom < 0.5}`) used to
 *    confuse the helper because `[^<]*` could not cross it. Stripping comments and
 *    anchoring on the element's own close — not on the next `<` — removes that
 *    false positive.
 *  - The pattern used to be a prefix match, so `<DocumentViewerToolbarV2 ... />`
 *    counted as the toolbar. We require the element name to end at a word
 *    boundary.
 *  - A first-match-wins scan used to silently anchor to a commented-out element or
 *    an unrelated earlier element. We fail loudly if 0 or >1 uncommented match
 *    exists.
 *
 * Usage:
 *   elementAttributeBlock(source, 'DocumentViewerToolbar')   // self-closing
 *   elementAttributeBlock(source, 'CompareOverlayView')      // self-closing
 *   elementAttributeBlock(source, 'SomeContainer', { selfClosing: false })  // pair-tag
 *
 * The `toolbarAttributeBlock(source)` thin wrapper keeps the three already-hardened
 * toolbar call sites unchanged.
 */
import { expect } from 'vitest';

/**
 * Strip JS line and block comments (incl. JSX curly-brace block comments) from source text.
 * Does NOT touch strings or template literals, so any element written as plain
 * text inside a string still matches. That is intentional: a developer who
 * disables a prop by writing it inside a template string is doing something
 * exotic that vitest cannot statically reason about anyway; we only aim to
 * catch the realistic mutations.
 *
 * @param {string} source
 * @returns {string}
 */
function stripJsComments(source) {
  // Block comments (also covers JSX {/ * ... * /}). The [\s\S]*? is non-greedy so
  // two adjacent block comments are matched separately rather than as one.
  let stripped = source.replace(/\/\*[\s\S]*?\*\//g, '');
  // Line comments: everything from `//` to the next newline.
  stripped = stripped.replace(/\/\/[^\n]*/g, '');
  return stripped;
}

/**
 * @param {string} source the (possibly comment-containing) JSX source
 * @param {string} elementName the element to anchor on (e.g. 'DocumentViewerToolbar')
 * @param {{ selfClosing?: boolean }} [options] when selfClosing is false, match
 *   the pair-tag form (`<Name ...> ... </Name>`); when omitted or true, match
 *   `<Name ... />`. Default true.
 * @returns {string} the matched element including its tag
 */
export function elementAttributeBlock(source, elementName, options = {}) {
  const selfClosing = options.selfClosing !== false;
  // Escape regex metacharacters in the element name.
  const escaped = elementName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Comment-strip first so commented-out elements disappear and `<` inside an
  // attribute expression no longer confuses the scan.
  const stripped = stripJsComments(source);
  // Word boundary after the element name so `DocumentViewerToolbarV2` does not
  // match as `DocumentViewerToolbar`. Self-closing form: `<Name ... />` where
  // the `...` is any non-`>` characters (attributes may legitimately contain
  // `<`, e.g. `tinyZoom={zoom < 0.5}`).
  const pattern = selfClosing
    ? new RegExp(`<${escaped}\\b[^>]*?/>`)
    : new RegExp(`<${escaped}\\b[^>]*?>[\\s\\S]*?<\\/${escaped}>`);
  // matchAll so we can fail loudly on 0 or >1 match — first-match-wins would
  // let a commented-out element earlier in the file keep the lock green.
  const matches = [...stripped.matchAll(new RegExp(pattern.source, 'g'))];
  expect(
    matches.length,
    `expected exactly one ${selfClosing ? 'self-closing' : 'pair-tag'} <${elementName} ...> element, found ${matches.length}`
  ).toBe(1);
  return matches[0][0];
}

/**
 * Thin wrapper kept for the three already-hardened toolbar call sites. New
 * call sites should use elementAttributeBlock directly with the element name.
 *
 * @param {string} viewerSource the DocumentViewer.jsx source text
 * @returns {string}
 */
export function toolbarAttributeBlock(viewerSource) {
  return elementAttributeBlock(viewerSource, 'DocumentViewerToolbar');
}
