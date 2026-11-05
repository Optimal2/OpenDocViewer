import assert from 'node:assert/strict';
import { test } from 'vitest';
import { escapeRegExp } from './test-fixture-escaping.mjs';

/**
 * The values the site-config-generator suites embed into a regular expression: profile keys, the
 * package version and file names. They are ordinary today; the escaping must not depend on that.
 */
const VALUES = [
  '',
  'i18n.default',
  'theme.bridge',
  'a.b',
  'a*b',
  'a+b',
  'a?b',
  'a^b',
  'a$b',
  'a{b}c',
  'a(b)c',
  'a|b',
  'a[b]c',
  'a\\b',
  'trailing\\',
  'C:\\temp\\file.js',
  "single ' quote",
  'double " quote',
  'both \' and " quotes',
  'back`tick',
  'template ${interpolation}',
  'line\nbreak',
  'carriage\rreturn',
  'crlf\r\nbreak',
  '.*+?^${}()|[]\\',
  'åäö',
  `line separator${String.fromCodePoint(0x2028)}end`,
  `paragraph separator${String.fromCodePoint(0x2029)}end`,
  `emoji ${String.fromCodePoint(0x1f600)}`,
];

/**
 * The escaping the three suites used before this helper: a dot-only escape and a
 * parenthesis-only escape. They are the reason the helper exists, so the test below keeps them
 * visible: each of them turns a value into a pattern that means something else.
 */
const LEGACY_DOT_ESCAPE = (value) => value.replace(/\./g, '\\.');
const LEGACY_PAREN_ESCAPE = (value) => value.replace(/[()]/g, '\\$&');

test('an escaped value matches itself', () => {
  for (const value of VALUES) {
    assert.ok(new RegExp(escapeRegExp(value)).test(value), `must match ${JSON.stringify(value)}`);
  }
});

test('an escaped value matches nothing else', () => {
  // Each near miss differs from the value in one character that the pattern must not read as a
  // wildcard, a repetition, a group or an escape.
  const nearMisses = [
    ['a.b', 'axb'],
    ['a*b', 'b'],
    ['a+b', 'b'],
    ['a?b', 'b'],
    ['a^b', 'b'],
    ['a$b', 'ab'],
    ['a{b}c', 'ac'],
    ['a(b)c', 'abc'],
    ['a|b', 'a'],
    ['a[b]c', 'ac'],
    ['a\\b', 'aXb'],
    ['C:\\temp\\file.js', 'C:tempfile.js'],
  ];
  for (const [value, nearMiss] of nearMisses) {
    const pattern = new RegExp(escapeRegExp(value));
    assert.equal(pattern.test(nearMiss), false, `${JSON.stringify(value)} must not match ${JSON.stringify(nearMiss)}`);
    assert.ok(pattern.test(value), `must match ${JSON.stringify(value)}`);
  }
});

test('an escaped value survives a template literal', () => {
  // The suites embed the escaped value into a template literal. A backtick or an interpolation in
  // the value must not change the pattern.
  for (const value of VALUES) {
    const pattern = new RegExp(`\\s${escapeRegExp(value)}\\s`);
    assert.ok(pattern.test(` ${value} `), `must match ${JSON.stringify(value)}`);
  }
});

test('a line terminator becomes an escape sequence, so the pattern stays on one line', () => {
  assert.equal(escapeRegExp('a\nb'), 'a\\nb');
  assert.equal(escapeRegExp('a\rb'), 'a\\rb');
  assert.equal(escapeRegExp('a\r\nb'), 'a\\r\\nb');
  assert.equal(escapeRegExp(`a${String.fromCodePoint(0x2028)}b`), 'a\\u2028b');
  assert.equal(escapeRegExp(`a${String.fromCodePoint(0x2029)}b`), 'a\\u2029b');
});

test('a quote is left alone: a pattern may not use a non-standard escape', () => {
  // `\'` is a syntax error in a unicode pattern, so a quote must not be escaped.
  assert.equal(escapeRegExp(`it's "quoted"`), `it's "quoted"`);
});

test('the previous inline escaping was incomplete', () => {
  // A dot-only escape leaves every other metacharacter active.
  assert.equal(new RegExp(LEGACY_DOT_ESCAPE('a*b')).test('b'), true);
  // A parenthesis-only escape leaves the dot a wildcard.
  assert.equal(new RegExp(LEGACY_PAREN_ESCAPE('a.b')).test('axb'), true);
  // Neither of them escapes a backslash.
  assert.equal(new RegExp(LEGACY_DOT_ESCAPE('C:\\temp')).test('C:\\temp'), false);
  assert.equal(new RegExp(LEGACY_PAREN_ESCAPE('C:\\temp')).test('C:\\temp'), false);
});
