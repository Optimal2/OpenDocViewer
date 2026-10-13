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
 *  - A `<` or `>` inside an attribute expression (e.g. `tinyZoom={zoom < 0.5}` or
 *    `tinyRange={zoom > 0.2 && zoom < 0.8}`) used to confuse the helper because the
 *    `[^>]*?` raw character class stopped at the first `>`. The attribute scan now
 *    walks the attribute region with awareness of `{...}`, `[...]`, `(...)` and
 *    string/template-literal spans, so `>` and `<` INSIDE a JSX expression container
 *    are treated as data and the element's OWN `/>` is the only stop signal.
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
 * Escape regex metacharacters in a string.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Skip over a string literal starting at index `start` (which must point at the
 * opening quote character) and return the index of the closing quote.
 * Recognises single quotes, double quotes, and template literals (the latter
 * recurse into `${...}` so any `{`/`'`/`"` inside an interpolation does not
 * terminate the outer literal scan). Returns -1 if the literal is unterminated.
 *
 * @param {string} text
 * @param {number} start index of the opening quote
 * @returns {number} index of the matching closing quote, or -1
 */
function scanStringLiteral(text, start) {
  const quote = text[start];
  for (let index = start + 1; index < text.length; index++) {
    const ch = text[index];
    if (ch === '\\') {
      // Escape: skip the escaped character unconditionally. A trailing backslash
      // at end-of-source surfaces as -1.
      continue;
    }
    if (ch === quote) {
      return index;
    }
    if (quote === '`' && ch === '$' && text[index + 1] === '{') {
      const close = findMatchingDelimiter(text, index + 1);
      if (close < 0) return -1;
      index = close;
      continue;
    }
  }
  return -1;
}

/**
 * Walk a balanced region starting at position `start` (which must point at
 * the OPENING delimiter — `{`, `[`, or `(`) and return the index of the
 * matching CLOSING delimiter. Tracks nesting and skips over string/template
 * spans so a delimiter inside a string is not counted.
 *
 * Returns -1 if no matching close exists.
 *
 * @param {string} text
 * @param {number} start index of the opening delimiter
 * @returns {number} index of the matching closing delimiter, or -1
 */
function findMatchingDelimiter(text, start) {
  const open = text[start];
  let close;
  switch (open) {
    case '{':
      close = '}';
      break;
    case '[':
      close = ']';
      break;
    case '(':
      close = ')';
      break;
    default:
      throw new Error(`findMatchingDelimiter called on non-delimiter '${open}' at index ${start}`);
  }

  let depth = 0;
  for (let index = start; index < text.length; index++) {
    const ch = text[index];
    if (ch === '\'' || ch === '"' || ch === '`') {
      const end = scanStringLiteral(text, index);
      if (end < 0) return -1;
      index = end;
      continue;
    }
    if (ch === open) {
      depth++;
      continue;
    }
    if (ch === close) {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/**
 * Walk `text[0..position-1]` and decide whether `position` falls inside a
 * string or template literal. The scan tracks string state across the full
 * source — JSX expression containers `{...}`, parenthesised groups, and
 * bracket arrays are all traversed character-by-character (we do NOT skip
 * them) so a `<Name` written INSIDE a JSX expression is correctly seen as
 * either inside or outside a string depending on the literal spans above
 * it.
 *
 * @param {string} text
 * @param {number} position
 * @returns {boolean}
 */
function isInsideStringLiteral(text, position) {
  let inString = false;
  let stringQuote = '';
  for (let i = 0; i < position; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') {
        // Skip the escaped character.
        i++;
        continue;
      }
      if (ch === stringQuote) {
        if (stringQuote === '`' && text[i + 1] === '{') {
          // Template interpolation: recurse over the balanced `{...}` so any
          // string delimiters inside the interpolation do not close the
          // outer template.
          const close = findMatchingDelimiter(text, i + 1);
          if (close < 0) return false;
          i = close;
          continue;
        }
        inString = false;
        stringQuote = '';
      }
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      inString = true;
      stringQuote = ch;
      continue;
    }
  }
  return inString;
}

/**
 * Scan the ATTRIBUTE list of a JSX element starting at position `start`,
 * looking for the element's OWN close. In self-closing form the close is
 * the literal `/>`; in pair-tag form it is a bare `>` that ends the opening
 * tag. The scan is expression-aware: when it sees `{`, `[`, or `(`, it
 * walks to the matching close, so any `<`, `>`, or `/>` inside a JSX
 * expression container, attribute group, or argument list is treated as
 * data, not as the element close.
 *
 * Returns the index JUST AFTER the element's own close (i.e. the first
 * character that does not belong to the open tag), or -1 if the element
 * is not properly terminated. In self-closing mode a bare `>` (without a
 * preceding `/`) is treated as a malformed terminator: there is no way
 * for a self-closing element to be closed any other way, and silently
 * anchoring to it would swallow a later `<Name .../>` as if it were this
 * one's attribute list.
 *
 * @param {string} text
 * @param {number} start index of the first character of the attribute list
 * @param {boolean} selfClosing when true, expect `/>`; when false, expect `>`
 * @returns {number}
 */
function scanAttributeList(text, start, selfClosing) {
  let index = start;
  while (index < text.length) {
    const ch = text[index];
    if (ch === '\'' || ch === '"' || ch === '`') {
      const end = scanStringLiteral(text, index);
      if (end < 0) return -1;
      index = end + 1;
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') {
      const end = findMatchingDelimiter(text, index);
      if (end < 0) return -1;
      index = end + 1;
      continue;
    }
    if (ch === '/' && text[index + 1] === '>') {
      if (!selfClosing) {
        // A `/>` inside the opening tag of a pair-tag element is not the
        // element close — it is data. Skip past it and keep scanning so we
        // still find the element's own `>` terminator.
        index++;
        continue;
      }
      return index + 2;
    }
    if (ch === '>') {
      if (selfClosing) {
        // A bare `>` in self-closing mode: there is no balanced delimiter
        // open around it (otherwise we'd have skipped past it), so it must
        // be data inside an attribute value or a mis-formed close. Reject it
        // so the caller does not silently swallow a later element.
        return -1;
      }
      return index + 1;
    }
    index++;
  }
  return -1;
}

/**
 * Scan the BODY of a pair-tag element until the matching closing tag
 * `</Name>` (consuming the closing tag too). Tracks nested JSX so a closing
 * tag for a CHILD element with the same name does not terminate the OUTER
 * element prematurely. Children may be either self-closing (`<Name .../>`)
 * or pair-tag themselves; their bodies are scanned recursively.
 *
 * The body starts at the index of the first character after the opening
 * tag's `>`.
 *
 * Returns the index JUST AFTER the closing `</Name>`, or -1 if the closing
 * tag is missing.
 *
 * @param {string} text
 * @param {number} start index of the first character after the opening tag's `>`
 * @param {string} name the element name (unescaped — passed to its own regex)
 * @returns {number}
 */
function scanElementBody(text, start, name) {
  const tagOpenRe = new RegExp(`<${escapeRegExp(name)}\\b`, 'g');
  const tagCloseRe = new RegExp(`</${escapeRegExp(name)}\\b`, 'g');
  let cursor = start;
  while (true) {
    tagOpenRe.lastIndex = cursor;
    tagCloseRe.lastIndex = cursor;
    const nextOpenMatch = tagOpenRe.exec(text);
    const nextCloseMatch = tagCloseRe.exec(text);
    const nextOpen = nextOpenMatch ? nextOpenMatch.index : -1;
    const nextClose = nextCloseMatch ? nextCloseMatch.index : -1;
    if (nextClose < 0) return -1;
    if (nextOpen < 0 || nextClose < nextOpen) {
      // The next significant token is the closing tag of our surface element.
      return nextClose + `</${name}>`.length;
    }
    // The next significant token is another `<Name` — recurse through its
    // own balanced form (attribute list + body) and continue.
    const afterAttrList = scanAttributeList(text, nextOpen + 1, false);
    if (afterAttrList < 0) return -1;
    const afterBody = scanElementBody(text, afterAttrList, name);
    if (afterBody < 0) return -1;
    cursor = afterBody;
  }
}

/**
 * Return all element regions in `text` whose tag name matches `name`,
 * skipping any candidate that sits inside a string or template literal.
 * Each region is the matched substring INCLUDING its tags.
 *
 * @param {string} text
 * @param {string} name element name (unescaped)
 * @returns {string[]} matched substrings
 */
function collectElements(text, name) {
  const escaped = escapeRegExp(name);
  const tagOpenRe = new RegExp(`<${escaped}\\b`, 'g');
  const blocks = [];
  let cursor = 0;
  while (cursor < text.length) {
    tagOpenRe.lastIndex = cursor;
    const match = tagOpenRe.exec(text);
    if (!match) break;
    const tagIndex = match.index;
    if (isInsideStringLiteral(text, tagIndex)) {
      // A candidate inside a string literal is plain text, not JSX. Skip it.
      cursor = tagIndex + 1;
      continue;
    }
    const afterName = tagIndex + 1 + name.length;
    // Try self-closing form first; fall back to pair-tag form if the
    // candidate does not have a self-closing terminator.
    const afterAttrList = scanAttributeList(text, afterName, true);
    if (afterAttrList < 0) {
      const pairAfterAttr = scanAttributeList(text, afterName, false);
      if (pairAfterAttr < 0) {
        cursor = tagIndex + 1;
        continue;
      }
      const afterBody = scanElementBody(text, pairAfterAttr, name);
      if (afterBody < 0) {
        cursor = tagIndex + 1;
        continue;
      }
      blocks.push(text.substring(tagIndex, afterBody));
      cursor = afterBody;
      continue;
    }
    blocks.push(text.substring(tagIndex, afterAttrList));
    cursor = afterAttrList;
  }
  return blocks;
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
  // Comment-strip first so commented-out elements disappear and `<` or `>` inside
  // an attribute expression no longer confuses the scan.
  const stripped = stripJsComments(source);
  const blocks = collectElements(stripped, elementName);
  // Self-closing callers get every match; pair-tag callers get only matches
  // that include a closing tag. collectElements already returns self-closing
  // blocks preferentially, so the pair-tag filter is just "contains </Name>".
  const matching = selfClosing
    ? blocks.filter((block) => !block.includes(`</${elementName}>`))
    : blocks.filter((block) => block.includes(`</${elementName}>`));
  expect(
    matching.length,
    `expected exactly one ${selfClosing ? 'self-closing' : 'pair-tag'} <${elementName} ...> element, found ${matching.length}`
  ).toBe(1);
  return matching[0];
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