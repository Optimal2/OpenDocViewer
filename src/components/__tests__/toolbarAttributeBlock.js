// File: src/components/__tests__/toolbarAttributeBlock.js
/**
 * Extract an element's OWN source block from a JSX source file, for source-text
 * locks ("this prop is passed to that element").
 *
 * Mechanism: the source is PARSED with Babel (`@babel/core` `parseSync`, JSX
 * syntax), and the candidates are the JSX elements of the syntax tree. The
 * previous helpers lexed the source by hand (first regex character classes, then
 * a hand-written scanner) and every review found another lexing hole: a `//`
 * inside a string taken for a comment, an apostrophe in JSX text taken for a
 * string, a backslash escape, a template literal with `${...}`, a JSX body that
 * starts with `{`, a backtick in JSX text. A real parser removes that whole
 * class: strings, template literals, regular expressions, comments and JSX text
 * are tokenised by the same grammar the build uses.
 *
 * Rules:
 *  - A candidate is a JSX element whose name is exactly the requested
 *    identifier. `<Foo.Bar/>`, `<Foo:Bar/>` and `<FooV2/>` are not `<Foo/>`.
 *  - An element nested inside another element of the SAME name is part of that
 *    element's block and is not a candidate of its own, so a prop moved into a
 *    nested same-name child is never mistaken for the parent's.
 *  - Self-closing (`<Name ... />`, the default) and pair-tag
 *    (`<Name ...>...</Name>`, `{ selfClosing: false }`) are separate forms.
 *  - Exactly one candidate of the requested form must exist. Otherwise the
 *    assertion fails and says which case it is: "found N" (none or several),
 *    "found 0; N candidate(s) exist but in <other> form", or
 *    "found 0; N candidate(s) discarded (<reasons>)". A source that does not
 *    parse discards every textual candidate, with the parser's reason and offset,
 *    instead of silently matching a fragment of it.
 *  - The returned block is the element's source text (opening tag, and for a
 *    pair tag its children and closing tag) with every JS/JSX comment inside it
 *    removed, so a commented-out prop is not visible to the assertion.
 *
 * Usage:
 *   elementAttributeBlock(source, 'DocumentViewerToolbar')   // self-closing
 *   elementAttributeBlock(source, 'SomeContainer', { selfClosing: false })  // pair-tag
 *   elementAttributeValue(source, 'CompareCurtainButton', 'calibrated')     // true for the shorthand
 *
 * The `toolbarAttributeBlock(source)` thin wrapper keeps the three toolbar call
 * sites unchanged.
 */
import { parseSync } from '@babel/core';
import { expect } from 'vitest';

const PARSE_OPTIONS = Object.freeze({
  babelrc: false,
  configFile: false,
  sourceType: 'module',
  parserOpts: { plugins: ['jsx'] },
});

/** Parse results per source text; a test file reads the same source many times. */
const PARSE_CACHE = new Map();

/**
 * @param {string} source
 * @returns {{ ast: object | null, error: string | null }}
 */
function parseSource(source) {
  const cached = PARSE_CACHE.get(source);
  if (cached) return cached;
  let result;
  try {
    result = { ast: parseSync(source, PARSE_OPTIONS), error: null };
  } catch (error) {
    if (error instanceof RangeError) {
      result = { ast: null, error: `the source nests too deeply to parse (${error.message})` };
    } else {
      const offset = typeof error?.pos === 'number' ? error.pos : undefined;
      const reason = String(error?.message ?? error).split('\n')[0];
      result = {
        ast: null,
        error: `the source does not parse${offset === undefined ? '' : ` at offset ${offset}`}: ${reason}`,
      };
    }
  }
  PARSE_CACHE.set(source, result);
  return result;
}

/**
 * Collect the JSX elements named exactly `name` that are not nested inside
 * another element of the same name. Iterative walk, so a deep tree cannot
 * overflow the stack here.
 *
 * @param {object} ast
 * @param {string} name
 * @returns {object[]} JSXElement nodes in source order
 */
function collectElements(ast, name) {
  const found = [];
  /** @type {Array<{ node: object, insideSameName: boolean }>} */
  const stack = [{ node: ast.program, insideSameName: false }];
  while (stack.length > 0) {
    const { node, insideSameName } = stack.pop();
    const isMatch = node.type === 'JSXElement' && isExactName(node.openingElement.name, name);
    if (isMatch && !insideSameName) found.push(node);
    const childInside = insideSameName || isMatch;
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (let i = value.length - 1; i >= 0; i--) {
          if (value[i] && typeof value[i].type === 'string') stack.push({ node: value[i], insideSameName: childInside });
        }
      } else if (value && typeof value.type === 'string') {
        stack.push({ node: value, insideSameName: childInside });
      }
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/** True for a plain JSX identifier equal to `name` (never a member or namespaced name). */
function isExactName(nameNode, name) {
  return nameNode.type === 'JSXIdentifier' && nameNode.name === name;
}

/** Count `<Name` occurrences followed by a non-identifier, non-member character. */
function textualCandidateCount(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...source.matchAll(new RegExp(`<${escaped}(?![\\w$.:])`, 'g'))].length;
}

/**
 * The element's source text with every comment inside it removed. A line
 * comment is dropped (its newline stays); a block comment becomes one space so
 * two tokens around it never glue together.
 */
function sourceWithoutComments(source, node, comments) {
  let out = '';
  let cursor = node.start;
  for (const comment of comments) {
    if (comment.start < node.start || comment.end > node.end) continue;
    out += source.slice(cursor, comment.start);
    out += comment.type === 'CommentBlock' ? ' ' : '';
    cursor = comment.end;
  }
  return out + source.slice(cursor, node.end);
}

/**
 * Find exactly one element and fail loudly otherwise (see the module comment).
 *
 * @param {string} source
 * @param {string} elementName
 * @param {boolean} selfClosing
 * @returns {{ node: object, ast: object }}
 */
function findExactlyOne(source, elementName, selfClosing) {
  const formLabel = selfClosing ? 'self-closing' : 'pair-tag';
  const otherForm = selfClosing ? 'pair-tag' : 'self-closing';
  const prefix = `expected exactly one ${formLabel} <${elementName} ...> element`;
  const { ast, error } = parseSource(source);
  if (!ast) {
    const candidates = textualCandidateCount(source, elementName);
    expect.fail(`${prefix}, found 0; ${candidates} candidate(s) discarded (${error})`);
  }
  const elements = collectElements(ast, elementName);
  const matching = elements.filter((node) => node.openingElement.selfClosing === selfClosing);
  if (matching.length === 0 && elements.length > 0) {
    expect.fail(`${prefix}, found 0; ${elements.length} candidate(s) exist but in ${otherForm} form`);
  }
  if (matching.length !== 1) {
    const offsets = matching.map((node) => node.start).join(', ');
    expect(matching.length, `${prefix}, found ${matching.length}${offsets ? ` (at offsets ${offsets})` : ''}`).toBe(1);
  }
  return { node: matching[0], ast };
}

/**
 * @param {string} source the (possibly comment-containing) JSX source
 * @param {string} elementName the element to anchor on (e.g. 'DocumentViewerToolbar')
 * @param {{ selfClosing?: boolean }} [options] when selfClosing is false, match
 *   the pair-tag form (`<Name ...> ... </Name>`); when omitted or true, match
 *   `<Name ... />`. Default true.
 * @returns {string} the matched element's source text, with comments removed
 */
export function elementAttributeBlock(source, elementName, options = {}) {
  const selfClosing = options.selfClosing !== false;
  const { node, ast } = findExactlyOne(source, elementName, selfClosing);
  return sourceWithoutComments(source, node, ast.comments ?? []);
}

/**
 * The value an attribute has on exactly one element, read from the syntax
 * tree instead of the text, so a lock can assert the VALUE and not only the
 * token: `calibrated` (shorthand) and `calibrated={true}` both give `true`,
 * while `calibrated={false}`, `calibrated = {undefined}` or `calibrated={!x}`
 * do not.
 *
 * @param {string} source
 * @param {string} elementName
 * @param {string} attributeName
 * @param {{ selfClosing?: boolean }} [options]
 * @returns {{ present: boolean, value: unknown, expression: string | null }}
 *   `present` false when the element has no such attribute (a spread
 *   `{...props}` is not resolved); `value` is `true` for the shorthand, the
 *   literal's value for a string, number, boolean or null literal, and
 *   `undefined` otherwise; `expression` is the source text of a non-literal
 *   expression.
 */
export function elementAttributeValue(source, elementName, attributeName, options = {}) {
  const selfClosing = options.selfClosing !== false;
  const { node } = findExactlyOne(source, elementName, selfClosing);
  const attribute = node.openingElement.attributes.find(
    (attr) => attr.type === 'JSXAttribute' && attr.name.type === 'JSXIdentifier' && attr.name.name === attributeName,
  );
  if (!attribute) return { present: false, value: undefined, expression: null };
  if (attribute.value === null) return { present: true, value: true, expression: null };
  const valueNode = attribute.value.type === 'JSXExpressionContainer' ? attribute.value.expression : attribute.value;
  switch (valueNode.type) {
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return { present: true, value: valueNode.value, expression: null };
    case 'NullLiteral':
      return { present: true, value: null, expression: null };
    default:
      return { present: true, value: undefined, expression: source.slice(valueNode.start, valueNode.end) };
  }
}

/**
 * Thin wrapper kept for the three toolbar call sites. New call sites should use
 * elementAttributeBlock directly with the element name.
 *
 * @param {string} viewerSource the DocumentViewer.jsx source text
 * @returns {string}
 */
export function toolbarAttributeBlock(viewerSource) {
  return elementAttributeBlock(viewerSource, 'DocumentViewerToolbar');
}
