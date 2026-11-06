/**
 * Escaping shared by the site-config-generator test suites.
 *
 * Several of those suites match generator output with a regular expression that is built from a
 * value the test does not control: a profile key, the package version, a file name. Such a value
 * has to be escaped in full before it becomes part of a pattern. Escaping only part of the
 * metacharacter set does not fail loudly - it turns the assertion into a wildcard match, or into
 * a pattern that no longer means what the test claims.
 */

/**
 * The escape sequence that stands for a line terminator, by code point.
 *
 * The two exotic terminators are listed by code point: U+2028 and U+2029 are line terminators in
 * JavaScript source and cannot be written literally in a file.
 */
const LINE_TERMINATOR_ESCAPES = new Map([
  [10, '\\n'],
  [13, '\\r'],
  [0x2028, '\\u2028'],
  [0x2029, '\\u2029'],
]);

/**
 * Escapes `value` so that it can be used as a literal part of a regular expression.
 *
 * The result is the source of an unanchored pattern: `new RegExp(escapeRegExp(value))` matches
 * `value` literally wherever it occurs in the searched string. Add `^` and `$` when whole-string
 * matching is intended. Every metacharacter is escaped, the backslash among them, because a
 * backslash is what gives the next character its meaning. A line terminator is written as its
 * escape sequence, so that the pattern stays on one line.
 *
 * The escaped set is spelled out at the `replace` call on purpose: the escape is only complete
 * for a reader, and for the `js/incomplete-sanitization` code scanning rule, when the characters
 * that are escaped are visible where the escaping happens.
 *
 * @param {unknown} value the text to escape
 * @returns {string} the escaped text, ready for `new RegExp(...)`
 */
export function escapeRegExp(value) {
  const metacharacters = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let pattern = '';
  for (const character of metacharacters) {
    const escape = LINE_TERMINATOR_ESCAPES.get(character.codePointAt(0));
    pattern += escape === undefined ? character : escape;
  }
  return pattern;
}
