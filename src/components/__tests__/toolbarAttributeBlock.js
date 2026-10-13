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
 * Holes this helper closes compared with the previous hand-written scanner:
 *  - A commented-out prop is invisible to the assertion. A unified tokenizer
 *    (`tokenizeStateAt`) tracks comment / string / template spans as it walks,
 *    so a `//` inside a string is never a comment, an apostrophe in JSX text
 *    is never a string delimiter, and a `//` in real code IS a comment.
 *  - A `<` or `>` inside an attribute expression (e.g. `tinyZoom={zoom < 0.5}`
 *    or `tinyRange={zoom > 0.2 && zoom < 0.8}`) used to confuse the helper
 * because the `[^>]*?` raw character class stopped at the first `>`. The
 *    attribute scan now walks the attribute region with awareness of `{...}`,
 *    `[...]`, `(...)` and string/template-literal spans.
 *  - `<DocumentViewerToolbarV2 ... />` no longer counts as `<Foo/>`: the
 *    member-expression test rejects a `.` or `:` directly after the name.
 *  - The first-match-wins scan used to silently anchor to a commented-out
 *    element. We fail loudly if 0 or >1 uncommented match exists.
 *  - Backslash escapes inside a string literal were handled inconsistently
 *    between `scanStringLiteral` and `isInsideStringLiteral`. The single
 *    `tokenizeStateAt` helper now consumes the character after a backslash
 *    for every code path that reads a string.
 *  - Self-closing nested children with the same name used to be treated as a
 *    pair tag and required a `</Name>` that does not exist. The body scan
 *    now tries self-closing form BEFORE pair-tag form, matching the order
 *    the outer scan uses.
 *  - Closing tags like `</Name >` or `</Name\n>` used to truncate the block
 *    because the offset advance was hardcoded to `name.length + 3`. The
 *    closing tag offset is now derived from the actual match length.
 *  - Pathological nesting used to surface as `RangeError: Maximum call stack
 *    size exceeded`. The body scan is now iterative with a depth bound.
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

/** Lex states the unified tokenizer distinguishes. */
const STATE = Object.freeze({
  CODE: 'code',
  LINE_COMMENT: 'lineComment',
  BLOCK_COMMENT: 'blockComment',
  STRING: 'string',
  TEMPLATE: 'template',
});

/**
 * Classify the lex state at offset `position` in `text`. The walk tracks
 * strings (single AND double quotes with the same rules — backslash consumes
 * the next character), template literals (with `${...}` interpolation
 * recursion so any string delimiter inside the interpolation does not close
 * the outer template), JS line and block comments, and JSX/JS expression
 * containers so a `<Name` written inside an expression is classified in the
 * state of the enclosing source.
 *
 * For simplicity we treat `'` and `"` identically: any backslash inside a
 * string consumes the next character and any matching quote closes the
 * string. JSX has no other delimiter that matters for the locks we ship.
 *
 * @param {string} text
 * @param {number} position
 * @returns {typeof STATE[keyof typeof STATE]}
 */
function tokenizeStateAt(text, position) {
  let i = 0;
  let state = STATE.CODE;
  let stringQuote = '';
  while (i < position && i < text.length) {
    const ch = text[i];
    if (state === STATE.LINE_COMMENT) {
      if (ch === '\n') state = STATE.CODE;
      i++;
      continue;
    }
    if (state === STATE.BLOCK_COMMENT) {
      if (ch === '*' && text[i + 1] === '/') { state = STATE.CODE; i += 2; continue; }
      i++;
      continue;
    }
    if (state === STATE.STRING) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === stringQuote) { state = STATE.CODE; stringQuote = ''; i++; continue; }
      i++;
      continue;
    }
    if (state === STATE.TEMPLATE) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === '`') { state = STATE.CODE; i++; continue; }
      if (ch === '$' && text[i + 1] === '{') {
        // Self-contained brace walk — no recursion into skipBalancedBraces.
        // (skipBalancedBraces -> lexStateAt -> tokenizeStateAt would loop
        // through here again and overflow the stack on large source files.)
        // We start at depth=1 to account for the opening `{` we just saw,
        // and j = i + 2 (the first char after the opening `{`).
        let depth = 1;
        let j = i + 2;
        for (; j < text.length; j++) {
          const c = text[j];
          if (c === '{') depth++;
          else if (c === '}') {
            depth--;
            if (depth === 0) { j++; break; }
          }
        }
        if (depth !== 0) return STATE.TEMPLATE;
        i = j;
        continue;
      }
      i++;
      continue;
    }
    // CODE state.
    if (ch === '/' && text[i + 1] === '/') { state = STATE.LINE_COMMENT; i += 2; continue; }
    if (ch === '/' && text[i + 1] === '*') { state = STATE.BLOCK_COMMENT; i += 2; continue; }
    if (ch === '\'') {
      // FP2: in JSX text, `'` is plain text. Check the cached JSX text
      // ranges (a single linear pass over the source built once and
      // reused for every quote) to decide whether this apostrophe is in
      // a JSX text context.
      if (isJsxTextPosition(text, i)) { i++; continue; }
      state = STATE.STRING;
      stringQuote = ch;
      i++;
      continue;
    }
    if (ch === '"') {
      if (isJsxTextPosition(text, i)) { i++; continue; }
      state = STATE.STRING;
      stringQuote = ch;
      i++;
      continue;
    }
    if (ch === '`') { state = STATE.TEMPLATE; i++; continue; }
    i++;
  }
  return state;
}

/**
 * Cached JSX text ranges for a given source. A position is "JSX text"
 * when it sits between the `>` of a non-self-closing JSX opening tag
 * and the next `<` (a child element or closing tag) or `{` (a JSX
 * expression container). In JSX text, `'` and `"` are plain text and
 * must not open a string — the FP2 fix.
 *
 * The cache is a Set of start positions in the source. The text
 * extends from each start position to the next start position (or the
 * end of the source). The list is built by a single linear pass with
 * full string/comment/template awareness, O(n) once and then O(log n)
 * per query.
 */
/**
 * Walk the source from `from` until the end of a JSX opening tag, returning
 * the index of the `>` of `/>`. Self-contained state machine — no recursion
 * into other tokenizers — so the JSX text cache builder never re-enters
 * `tokenizeStateAt` and the stack stays shallow.
 */
function findJsxOpeningTagEndInline(text, startIndex) {
  let i = startIndex + 1;
  const n = text.length;
  let state = STATE.CODE;
  let stringQuote = '';
  while (i < n) {
    const ch = text[i];
    if (state === STATE.LINE_COMMENT) {
      if (ch === '\n') state = STATE.CODE;
      i++;
      continue;
    }
    if (state === STATE.BLOCK_COMMENT) {
      if (ch === '*' && text[i + 1] === '/') { state = STATE.CODE; i += 2; continue; }
      i++;
      continue;
    }
    if (state === STATE.STRING) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === stringQuote) { state = STATE.CODE; stringQuote = ''; i++; continue; }
      i++;
      continue;
    }
    if (state === STATE.TEMPLATE) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === '`') { state = STATE.CODE; i++; continue; }
      if (ch === '$' && text[i + 1] === '{') {
        // Self-contained brace walk — no recursion into skipBalancedBraces.
        // Start at depth=1 (we just saw the opening `{`) and j past it.
        let depth = 1;
        let j = i + 2;
        for (; j < n; j++) {
          if (text[j] === '{') depth++;
          else if (text[j] === '}') {
            depth--;
            if (depth === 0) { j++; break; }
          }
        }
        i = j;
        continue;
      }
      i++;
      continue;
    }
    // CODE state.
    if (ch === '/' && text[i + 1] === '/') { state = STATE.LINE_COMMENT; i += 2; continue; }
    if (ch === '/' && text[i + 1] === '*') { state = STATE.BLOCK_COMMENT; i += 2; continue; }
    if (ch === '\'' || ch === '"') { state = STATE.STRING; stringQuote = ch; i++; continue; }
    if (ch === '`') { state = STATE.TEMPLATE; i++; continue; }
    if (ch === '{') {
      // Self-contained brace walk — no recursion.
      let depth = 0;
      let j = i;
      for (; j < n; j++) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') {
          depth--;
          if (depth === 0) { j++; break; }
        }
      }
      i = j;
      continue;
    }
    if (ch === '[' || ch === '(') {
      const inner = ch === '[' ? ']' : ')';
      let depth = 0;
      let j = i;
      for (; j < n; j++) {
        if (text[j] === ch) depth++;
        else if (text[j] === inner) {
          depth--;
          if (depth === 0) { j++; break; }
        }
      }
      i = j;
      continue;
    }
    if (ch === '/' && text[i + 1] === '>') return i + 1;
    if (ch === '>') return i;
    i++;
  }
  return -1;
}

const JSX_TEXT_CACHE = new Map();
function getJsxTextStarts(text) {
  let cached = JSX_TEXT_CACHE.get(text);
  if (cached) return cached;
  const starts = [];
  // Set BEFORE building to short-circuit re-entrant calls.
  JSX_TEXT_CACHE.set(text, starts);
  const n = text.length;
  let i = 0;
  // Walk the source tracking strings/comments/templates with the same
  // state machine as tokenizeStateAt. For each opening tag we find,
  // we determine whether it opens a JSX text region (non-self-closing,
  // next char not `<` or `{`).
  let state = STATE.CODE;
  let stringQuote = '';
  while (i < n) {
    const ch = text[i];
    if (state === STATE.LINE_COMMENT) {
      if (ch === '\n') state = STATE.CODE;
      i++;
      continue;
    }
    if (state === STATE.BLOCK_COMMENT) {
      if (ch === '*' && text[i + 1] === '/') { state = STATE.CODE; i += 2; continue; }
      i++;
      continue;
    }
    if (state === STATE.STRING) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === stringQuote) { state = STATE.CODE; stringQuote = ''; i++; continue; }
      i++;
      continue;
    }
    if (state === STATE.TEMPLATE) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === '`') { state = STATE.CODE; i++; continue; }
      if (ch === '$' && text[i + 1] === '{') {
        // Self-contained brace walk — no recursion.
        // Start at depth=1 (we just saw the opening `{`) and j past it.
        let depth = 1;
        let j = i + 2;
        for (; j < n; j++) {
          if (text[j] === '{') depth++;
          else if (text[j] === '}') {
            depth--;
            if (depth === 0) { j++; break; }
          }
        }
        i = j;
        continue;
      }
      i++;
      continue;
    }
    // CODE state.
    if (ch === '/' && text[i + 1] === '/') { state = STATE.LINE_COMMENT; i += 2; continue; }
    if (ch === '/' && text[i + 1] === '*') { state = STATE.BLOCK_COMMENT; i += 2; continue; }
    if (ch === '\'' || ch === '"') { state = STATE.STRING; stringQuote = ch; i++; continue; }
    if (ch === '`') { state = STATE.TEMPLATE; i++; continue; }
    if (ch === '<') {
      // Closing tag `</Name>` is not an opening tag — skip past it.
      if (text[i + 1] === '/') {
        const close = text.indexOf('>', i + 2);
        i = close < 0 ? i + 1 : close + 1;
        continue;
      }
      // Find the matching `>` or `/>` of this opening tag (inline; no recursion).
      const tagEnd = findJsxOpeningTagEndInline(text, i);
      if (tagEnd < 0) { i++; continue; }
      const prevChar = tagEnd > 0 ? text[tagEnd - 1] : '';
      const isSelfClosing = prevChar === '/';
      i = tagEnd + 1;
      if (isSelfClosing) continue;
      // Find the matching closing tag of THIS element. Walk iteratively.
      // The opening tag `<name ...>` is at some position before `tagEnd`.
      // Search backward from `tagEnd` to find the `<` and extract the name.
      let elementName = '';
      for (let j = tagEnd - 1; j >= 0; j--) {
        const c = text[j];
        if (c === '<') {
          const after = text.slice(j + 1);
          const m = after.match(/^(\w+)/);
          if (m) elementName = m[1];
          break;
        }
        if (c === '>' || c === '/') break; // hit end of attribute region without finding <
      }
      if (!elementName) continue;
      const bodyStart = i;
      const nextChar = bodyStart < n ? text[bodyStart] : '';
      if (nextChar === '<' || nextChar === '{') continue;
      const bodyEnd = walkJsxTextBody(text, bodyStart, elementName);
      if (bodyEnd < 0) continue;
      // Record JSX text run starts within the body.
      recordJsxTextRuns(starts, text, bodyStart, bodyEnd);
      i = bodyEnd;
      continue;
    }
    i++;
  }
  return starts;
}

/**
 * Walk the body of a non-self-closing JSX element iteratively, returning
 * the index JUST AFTER the matching closing tag. Same-name nested
 * pair-tag children are recursed into so the OUTER closing tag is found.
 * Other child elements, JSX expression containers `{...}` and JSX text
 * are consumed in place. Returns -1 on missing close.
 *
 * Self-contained: no call back into `tokenizeStateAt` or `lexStateAt`,
 * so the JSX text cache builder stays shallow.
 */
function walkJsxTextBody(text, start, name) {
  let cursor = start;
  let depth = 0;
  while (cursor < text.length) {
    const ch = text[cursor];
    if (ch === '{') {
      // Self-contained brace walk.
      let d = 0;
      let j = cursor;
      for (; j < text.length; j++) {
        if (text[j] === '{') d++;
        else if (text[j] === '}') {
          d--;
          if (d === 0) { j++; break; }
        }
      }
      cursor = j;
      continue;
    }
    if (ch === '<' && text[cursor + 1] === '/') {
      if (depth === 0) {
        const endOfClose = text.indexOf('>', cursor);
        if (endOfClose < 0) return -1;
        return endOfClose + 1;
      }
      depth--;
      const endOfClose = text.indexOf('>', cursor);
      if (endOfClose < 0) return -1;
      cursor = endOfClose + 1;
      continue;
    }
    if (ch === '<') {
      // Could be a child element, a JSX fragment `<>...`, or a comment.
      if (text.startsWith('<!--', cursor)) {
        const end = text.indexOf('-->', cursor + 4);
        if (end < 0) return -1;
        cursor = end + 3;
        continue;
      }
      if (text[cursor + 1] === '>') {
        cursor += 2;
        continue;
      }
      // Find the child's opening tag end (inline, no recursion).
      const tagEnd = findJsxOpeningTagEndInline(text, cursor);
      if (tagEnd < 0) return -1;
      const prevChar = tagEnd > 0 ? text[tagEnd - 1] : '';
      const isSelfClosing = prevChar === '/';
      if (isSelfClosing) { cursor = tagEnd + 1; continue; }
      // Pair-tag child. Recurse into its body to find ITS closing tag
      // so we don't mistake it for the outer closing tag. Track depth
      // for same-name pair-tags (FN3 case: `<T><T/></T>` is depth 1).
      const afterLT = cursor + 1;
      const childNameMatch = text.slice(afterLT).match(/^(\w+)/);
      const childName = childNameMatch ? childNameMatch[1] : '';
      const childBodyStart = tagEnd + 1;
      const childBodyEnd = walkJsxTextBody(text, childBodyStart, name);
      if (childBodyEnd < 0) return -1;
      cursor = childBodyEnd;
      if (childName === name) depth++;
      continue;
    }
    cursor++;
  }
  return -1;
}

/**
 * Record starts of JSX text runs within `text[from..until]`. A run is
 * a maximal sequence of non-`<`, non-`{` characters surrounded by code
 * boundaries (start of body, `<`, `{`, or `}`).
 */
function recordJsxTextRuns(starts, text, from, until) {
  let i = from;
  while (i < until) {
    const ch = text[i];
    if (ch === '<' || ch === '{') {
      // Skip past child element / expression container.
      if (ch === '{') {
        // We are inside a body; the body walk already consumed
        // expressions. This shouldn't happen here.
        i++;
        continue;
      }
      if (text[i + 1] === '/') {
        // Closing tag: stop.
        break;
      }
      if (text.startsWith('<!--', i)) {
        const end = text.indexOf('-->', i + 4);
        i = end < 0 ? until : end + 3;
        continue;
      }
      const tagEnd = findJsxOpeningTagEndInline(text, i);
      i = tagEnd < 0 ? until : tagEnd + 1;
      continue;
    }
    if (/\s/.test(ch)) { i++; continue; }
    // Non-whitespace raw text char. Record the start.
    starts.push(i);
    // Skip to the next boundary.
    while (i < until) {
      const c = text[i];
      if (c === '<' || c === '{') break;
      i++;
    }
  }
}

/** True if `position` is in a JSX text context. */
function isJsxTextPosition(text, position) {
  const starts = getJsxTextStarts(text);
  // Binary search for the largest start <= position.
  let lo = 0;
  let hi = starts.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= position) { best = mid; lo = mid + 1; }
    else { hi = mid - 1; }
  }
  return best >= 0;
}

/**
 * Find the index of the matching `}` for a `{` at `start` (must point at the
 * `{`). Tracks nesting. Strings, template literals (with their `${...}`
 * interpolations) and block comments are treated as single tokens so a
 * delimiter inside them is not counted.
 *
 * Returns -1 if no matching `}` exists.
 *
 * @param {string} text
 * @param {number} start index of the opening `{`
 * @returns {number}
 */
function skipBalancedBraces(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    // Walk the source token-by-token so a `{` or `}` inside a string /
    // template / comment is not counted. We use classifyAt-like rules
    // inline instead of calling tokenizeStateAt per char (which is O(n^2)).
    // The trick: we keep a `lex` state as we walk and only increment
    // depth when we see a `{` that is at CODE-lex state.
    //
    // We track a simple per-character state. When the state is STRING or
    // TEMPLATE we skip to the matching closing delimiter; when LINE_COMMENT
    // we skip to the next newline; when BLOCK_COMMENT to `*/`.
    const lex = lexStateAt(text, i);
    if (lex === STATE.STRING) {
      // We are at the OPENING quote of a string (i.e. the previous
      // char is not in a string lex state).
      const quote = ch;
      i++;
      while (i < text.length) {
        const c = text[i];
        if (c === '\\') { i += 2; continue; }
        if (c === quote) { i++; break; }
        i++;
      }
      // i is past the closing quote; for-loop's i++ would over-advance,
      // so subtract 1.
      i--;
      continue;
    }
    if (lex === STATE.TEMPLATE) {
      i++;
      while (i < text.length) {
        const c = text[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '`') { i++; break; }
        if (c === '$' && text[i + 1] === '{') {
          const close = skipBalancedBraces(text, i + 1);
          if (close < 0) return -1;
          i = close + 1;
          continue;
        }
        i++;
      }
      i--;
      continue;
    }
    if (lex === STATE.LINE_COMMENT) {
      const newline = text.indexOf('\n', i);
      if (newline < 0) return -1;
      i = newline; // for-loop i++ advances past newline
      continue;
    }
    if (lex === STATE.BLOCK_COMMENT) {
      const end = text.indexOf('*/', i);
      if (end < 0) return -1;
      i = end + 1; // for-loop i++ lands past '/'
      continue;
    }
    // CODE state.
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Lex state AT position i (the state machine's interpretation of the
 * char at i). Returns STATE.STRING for the OPENING quote of a string,
 * STATE.TEMPLATE for the opening backtick, etc.
 *
 * @param {string} text
 * @param {number} i
 * @returns {typeof STATE[keyof typeof STATE]}
 */
function lexStateAt(text, i) {
  const stateBefore = tokenizeStateAt(text, i);
  if (stateBefore !== STATE.CODE) return stateBefore;
  const ch = text[i];
  if (ch === '\'' || ch === '"') return STATE.STRING;
  if (ch === '`') return STATE.TEMPLATE;
  if (ch === '/' && text[i + 1] === '/') return STATE.LINE_COMMENT;
  if (ch === '/' && text[i + 1] === '*') return STATE.BLOCK_COMMENT;
  return STATE.CODE;
}

/**
 * Test whether the offset at `tagIndex` (pointing at `<`) starts an unescaped
 * `<Name` element. Anchors to CODE state so commented-out and string-text
 * candidates are not counted. The next character after the name must be a
 * legal JSX-following character so `<Foo.Bar/>` does not match `<Foo\b` and
 * silently anchor to the wrong element.
 *
 * @param {string} text
 * @param {number} tagIndex index of `<`
 * @param {string} name element name
 * @returns {boolean}
 */
function isCandidateTag(text, tagIndex, name) {
  // The state at the position OF the `<` may be JSX_TEXT (when the
  // candidate is a child element of a JSX text context). We check the
  // state at the position AFTER `<` (the name) — that is reliably CODE
  // for a real, unescaped element tag.
  const afterLT = tagIndex + 1;
  if (tokenizeStateAt(text, afterLT) !== STATE.CODE) return false;
  if (text.startsWith(name, afterLT) === false) return false;
  const boundary = afterLT + name.length;
  const next = text[boundary];
  // Member expression boundary: `<Foo.Bar/>` must not count as `<Foo/>`.
  if (next === '.' || next === ':') return false;
  // Legal character after the element name in JSX.
  return next === undefined || /[\s/>={<]/.test(next);
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
 * preceding `/`) is treated as a malformed terminator.
 *
 * @param {string} text
 * @param {number} start index of the first character of the attribute list
 * @param {boolean} selfClosing when true, expect `/>`; when false, expect `>`
 * @returns {number}
 */
function scanAttributeList(text, start, selfClosing) {
  let index = start;
  while (index < text.length) {
    // The lex state BEFORE the current char matters: if the current char
    // is the OPENING quote of a string or template, the state just before
    // it is CODE (state transition happens AFTER reading the opening
    // character). If it is INSIDE a string, the state is STRING. We treat
    // both the same way: when we see the opening quote of a literal, we
    // walk the literal to its closing delimiter.
    const ch = text[index];
    // The lex state just BEFORE this character. tokenizeStateAt returns
    // the state AT position (which is the state just before the position),
    // so that is what we want.
    const stateBefore = tokenizeStateAt(text, index);
    if (stateBefore === STATE.LINE_COMMENT) {
      const newline = text.indexOf('\n', index);
      if (newline < 0) return -1;
      index = newline + 1;
      continue;
    }
    if (stateBefore === STATE.BLOCK_COMMENT) {
      const end = text.indexOf('*/', index);
      if (end < 0) return -1;
      index = end + 2;
      continue;
    }
    if (stateBefore === STATE.STRING && (ch === '\'' || ch === '"')) {
      // We are AT the closing quote of a string. Skip past it.
      index++;
      continue;
    }
    if (stateBefore === STATE.TEMPLATE && ch === '`') {
      // We are AT the closing backtick of a template. Skip past it.
      index++;
      continue;
    }
    if (stateBefore === STATE.STRING) {
      // Inside a string but on a non-delimiter char. Just advance.
      index++;
      continue;
    }
    if (stateBefore === STATE.TEMPLATE) {
      // Inside a template. Watch for `${`.
      if (ch === '$' && text[index + 1] === '{') {
        const close = skipBalancedBraces(text, index + 1);
        if (close < 0) return -1;
        index = close + 1;
        continue;
      }
      index++;
      continue;
    }
    // CODE state — ch is a code char.
    if (ch === '\'' || ch === '"') {
      // Walk the string manually using the same escape rules as
      // tokenizeStateAt.
      const quote = ch;
      index++; // past the opening quote
      while (index < text.length) {
        const c = text[index];
        if (c === '\\') { index += 2; continue; }
        if (c === quote) { index++; break; }
        index++;
      }
      continue;
    }
    if (ch === '`') {
      // Walk a template literal.
      index++; // past the opening backtick
      while (index < text.length) {
        const c = text[index];
        if (c === '\\') { index += 2; continue; }
        if (c === '`') { index++; break; }
        if (c === '$' && text[index + 1] === '{') {
          const close = skipBalancedBraces(text, index + 1);
          if (close < 0) return -1;
          index = close + 1;
          continue;
        }
        index++;
      }
      continue;
    }
    if (ch === '/' && text[index + 1] === '/') {
      const newline = text.indexOf('\n', index);
      if (newline < 0) return -1;
      index = newline + 1;
      continue;
    }
    if (ch === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index);
      if (end < 0) return -1;
      index = end + 2;
      continue;
    }
    if (ch === '{') {
      const close = skipBalancedBraces(text, index);
      if (close < 0) return -1;
      index = close + 1;
      continue;
    }
    // `[` and `(` can also appear inside a JSX attribute list (e.g. an
    // array literal or function call). The matcher MUST skip them so an
    // unbalanced `>` inside `[...]` or `(...)` is not treated as the
    // element close.
    if (ch === '[' || ch === '(') {
      const inner = ch === '[' ? ']' : ')';
      const close = skipBalancedGeneric(text, index, ch, inner);
      if (close < 0) return -1;
      index = close + 1;
      continue;
    }
    if (ch === '/' && text[index + 1] === '>') {
      if (!selfClosing) {
        // `/>` inside the opening tag of a pair-tag element is data, not
        // the element close. Skip past it and keep scanning.
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
 * Walk a balanced region of `text` starting at the OPEN delimiter (which
 * must be one of `{`, `[`, `(`) and return the index of the matching close.
 * Tracks nesting. Strings, template literals (with their `${...}`
 * interpolations) and block comments are treated as single tokens so a
 * delimiter inside them is not counted.
 *
 * @param {string} text
 * @param {number} start index of the opening delimiter
 * @param {'{'|'['|'('} open
 * @param {'}'|']'|')'} close
 * @returns {number}
 */
function skipBalancedGeneric(text, start, open, close) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const state = tokenizeStateAt(text, i);
    if (state !== STATE.CODE) {
      if (state === STATE.LINE_COMMENT) {
        const newline = text.indexOf('\n', i);
        if (newline < 0) return -1;
        i = newline;
        continue;
      }
      if (state === STATE.BLOCK_COMMENT) {
        const end = text.indexOf('*/', i);
        if (end < 0) return -1;
        i = end + 1;
        continue;
      }
      if (state === STATE.STRING) {
        const quote = text[i];
        i++; // past the opening quote
        while (i < text.length) {
          const c = text[i];
          if (c === '\\') { i += 2; continue; }
          if (c === quote) { i++; break; }
          i++;
        }
        i--;
        continue;
      }
      if (state === STATE.TEMPLATE) {
        i++; // past the opening backtick
        while (i < text.length) {
          const c = text[i];
          if (c === '\\') { i += 2; continue; }
          if (c === '`') { i++; break; }
          if (c === '$' && text[i + 1] === '{') {
            const interpClose = skipBalancedBraces(text, i + 1);
            if (interpClose < 0) return -1;
            i = interpClose + 1;
            continue;
          }
          i++;
        }
        i--;
        continue;
      }
    }
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Walk the BODY of a pair-tag element iteratively until the matching closing
 * tag `</Name>`. Tracks nested same-name JSX so a closing tag for a CHILD
 * element with the same name does not terminate the OUTER element
 * prematurely. Children may be either self-closing (`<Name .../>`) or
 * pair-tag themselves.
 *
 * The body starts at the index of the first character after the opening
 * tag's `>`. Returns the index JUST AFTER the closing `</Name>`, or -1 if
 * the closing tag is missing.
 *
 * @param {string} text
 * @param {number} start index of the first character after the opening tag's `>`
 * @param {string} name the element name
 * @returns {number}
 */
function scanElementBody(text, start, name) {
  let cursor = start;
  let depth = 0;
  while (cursor < text.length) {
    // Find the next `<Name` and the next `</Name` from `cursor`. The one that
    // comes first determines what we do.
    const openIdx = indexOfCandidateTag(text, cursor, name);
    const closeIdx = indexOfClosingTag(text, cursor, name);
    if (closeIdx < 0) return -1;
    if (openIdx < 0 || closeIdx < openIdx) {
      // Closing tag is next for our surface element (the depth stack is
      // already empty here).
      if (depth === 0) {
        const endOfClose = text.indexOf('>', closeIdx);
        if (endOfClose < 0) return -1;
        return endOfClose + 1;
      }
      // A closing tag for a same-name element we are nested INSIDE: pop.
      depth--;
      const endOfClose = text.indexOf('>', closeIdx);
      if (endOfClose < 0) return -1;
      cursor = endOfClose + 1;
      continue;
    }
    // Next token is a nested `<Name`. Try self-closing first (FN3 fix).
    const afterName = openIdx + 1 + name.length;
    const afterSelfClose = scanAttributeList(text, afterName, true);
    if (afterSelfClose >= 0) {
      cursor = afterSelfClose;
      continue;
    }
    const afterAttrList = scanAttributeList(text, afterName, false);
    if (afterAttrList < 0) return -1;
    // Body of the nested element begins right after the opening `>`. We do
    // NOT scan INTO the nested body here: the outer loop's `closeIdx`
    // search finds the next closing tag and the depth stack tracks whether
    // it is ours or the nested element's.
    cursor = afterAttrList;
    depth++;
  }
  return -1;
}

/**
 * Find the next `<Name` starting at or after `from`, skipping any candidate
 * inside a string or template literal. Returns the offset of `<`, or -1.
 *
 * @param {string} text
 * @param {number} from
 * @param {string} name
 * @returns {number}
 */
function indexOfCandidateTag(text, from, name) {
  const re = new RegExp(`<${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  re.lastIndex = from;
  while (true) {
    const m = re.exec(text);
    if (!m) return -1;
    if (isCandidateTag(text, m.index, name)) return m.index;
    re.lastIndex = m.index + 1;
  }
}

/**
 * Find the next `</Name>` (or `</Name >`, `</Name\n>`) starting at or after
 * `from`, skipping any candidate inside a string or template literal.
 * Returns the offset of `<`, or -1.
 *
 * @param {string} text
 * @param {number} from
 * @param {string} name
 * @returns {number}
 */
function indexOfClosingTag(text, from, name) {
  let i = from;
  while (i < text.length - 1) {
    if (text[i] === '<' && text[i + 1] === '/') {
      // Check the state at the `/` (i+1) — the position OF `<` may be
      // JSX_TEXT when the closing tag sits inside a JSX text context.
      if (tokenizeStateAt(text, i + 1) !== STATE.CODE) { i++; continue; }
      const afterSlash = i + 2;
      if (text.startsWith(name, afterSlash) === false) { i++; continue; }
      const boundary = afterSlash + name.length;
      const next = text[boundary];
      if (next === '.' || next === ':') { i++; continue; }
      if (next === undefined || /[\s>]/.test(next)) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Return all element regions in `text` whose tag name matches `name`,
 * skipping any candidate that sits inside a string or template literal.
 * Each region is the matched substring INCLUDING its tags.
 *
 * Self-closing form is tried first; pair-tag form is tried only when the
 * self-closing scan fails. This order matches the source rule that
 * `<Name />` always wins over `<Name>...</Name>` when both could match.
 *
 * Candidates that cannot be scanned are counted and reported back via the
 * discarded-reason returned alongside the blocks.
 *
 * @param {string} text
 * @param {string} name element name
 * @returns {{ blocks: string[], discarded: number, discardedReason: string }}
 */
function collectElements(text, name) {
  const blocks = [];
  let discarded = 0;
  let discardedReason = '';
  let cursor = 0;
  while (cursor < text.length) {
    const tagIndex = indexOfCandidateTag(text, cursor, name);
    if (tagIndex < 0) break;
    const afterName = tagIndex + 1 + name.length;
    // Try self-closing form first; fall back to pair-tag form.
    const afterAttrList = scanAttributeList(text, afterName, true);
    if (afterAttrList >= 0) {
      blocks.push(text.substring(tagIndex, afterAttrList));
      cursor = afterAttrList;
      continue;
    }
    const pairAfterAttr = scanAttributeList(text, afterName, false);
    if (pairAfterAttr < 0) {
      discarded++;
      discardedReason = `unterminated opening tag at offset ${tagIndex}`;
      cursor = tagIndex + 1;
      continue;
    }
    const afterBody = scanElementBody(text, pairAfterAttr, name);
    if (afterBody < 0) {
      discarded++;
      discardedReason = `unterminated pair-tag body for <${name}> starting at offset ${tagIndex}`;
      cursor = tagIndex + 1;
      continue;
    }
    blocks.push(text.substring(tagIndex, afterBody));
    cursor = afterBody;
  }
  return { blocks, discarded, discardedReason };
}

/**
 * Strip JS line and block comments (incl. JSX curly-brace block comments)
 * from `text` so the returned element block does not contain commented-out
 * props. We do NOT strip strings or template literals — a `//` inside a
 * string is not a comment, and stripping would corrupt a string that
 * contains the literal characters `* /`. The tokenizer has already
 * classified each comment span, so we can scan the text once and drop
 * characters whose `tokenizeStateAt` is LINE_COMMENT or BLOCK_COMMENT.
 *
 * @param {string} text
 * @returns {string}
 */
function stripCommentsFromBlock(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const state = tokenizeStateAt(text, i);
    if (state === STATE.LINE_COMMENT) {
      const newline = text.indexOf('\n', i);
      if (newline < 0) break;
      out += '\n';
      i = newline + 1;
      continue;
    }
    if (state === STATE.BLOCK_COMMENT) {
      const end = text.indexOf('*/', i);
      if (end < 0) break;
      // Replace the comment with a single space so a token boundary that
      // was previously inside the comment does not glue two adjacent
      // identifiers together.
      out += ' ';
      i = end + 2;
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

/**
 * @param {string} source the (possibly comment-containing) JSX source
 * @param {string} elementName the element to anchor on (e.g. 'DocumentViewerToolbar')
 * @param {{ selfClosing?: boolean }} [options] when selfClosing is false, match
 *   the pair-tag form (`<Name ...> ... </Name>`); when omitted or true, match
 *   `<Name ... />`. Default true.
 * @returns {string} the matched element including its tag, with comments stripped
 */
export function elementAttributeBlock(source, elementName, options = {}) {
  const selfClosing = options.selfClosing !== false;
  const { blocks, discarded, discardedReason } = collectElements(source, elementName);
  // A pair-tag form contains the closing tag `</Name>` or `</Name >` / `</Name\n>`
  // (whitespace/newline may sit between the name and the `>`). A self-closing
  // form NEVER contains the closing tag.
  const hasClosingTag = (block) => new RegExp(`</${elementName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s>]`).test(block);
  const matching = selfClosing
    ? blocks.filter((block) => !hasClosingTag(block))
    : blocks.filter(hasClosingTag);
  const formLabel = selfClosing ? 'self-closing' : 'pair-tag';
  if (matching.length !== 1) {
    const otherForm = selfClosing ? 'pair-tag' : 'self-closing';
    const otherCount = selfClosing
      ? blocks.filter(hasClosingTag).length
      : blocks.length - matching.length;
    if (matching.length === 0 && discarded > 0) {
      expect.fail(
        `expected exactly one ${formLabel} <${elementName} ...> element, found 0; ` +
        `${discarded} candidate(s) discarded (${discardedReason})`
      );
    }
    if (matching.length === 0 && otherCount > 0) {
      expect.fail(
        `expected exactly one ${formLabel} <${elementName} ...> element, found 0; ` +
        `${otherCount} candidate(s) exist but in ${otherForm} form`
      );
    }
    expect(
      matching.length,
      `expected exactly one ${formLabel} <${elementName} ...> element, found ${matching.length}`
    ).toBe(1);
  }
  // Strip comments from the returned block so a commented-out prop is not
  // visible in the substring and the assertion `not.toMatch(/propName/)`
  // stays green on the user's mutation that disables the prop.
  return stripCommentsFromBlock(matching[0]);
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