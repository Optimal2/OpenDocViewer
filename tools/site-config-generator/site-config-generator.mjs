#!/usr/bin/env node
// File: tools/site-config-generator/site-config-generator.mjs
/**
 * OpenDocViewer — site configuration generator (developer/operator tool)
 *
 * PURPOSE
 *   Turns the shipped sample `public/odv.site.config.sample.js` plus a small JSON "site profile"
 *   into a ready site configuration file (`odv.site.config.js`), and verifies an existing site
 *   configuration against the current sample after an upgrade. Dependency-free Node ESM.
 *
 *   This folder is a convenience for developers and operators. It is NOT part of the Vite build
 *   output (`dist/`), the OMP package or the release zip, which are all produced from `dist/` only.
 *
 * COMMANDS
 *   generate    --profile <file> --out <file> [--force] [--sample <file>] [--loader <file>]
 *       Writes the site configuration from the CURRENT sample plus the profile. `--out` is
 *       required on purpose: the tool never picks a destination itself, so it can never silently
 *       overwrite `public/odv.site.config.js` or any other live file. An existing `--out` file is
 *       only replaced when it carries this tool's generated header, or when `--force` is given.
 *   check       --profile <file> --config <file> [--sample <file>] [--loader <file>]
 *       Regenerates in memory and compares with the existing configuration. Exit 0 when
 *       identical, exit 1 with a per-key and per-line diff summary when it differs.
 *   new-profile --out <file> [--force]
 *       Writes a commented example profile to start from.
 *
 * PROFILE FORMAT (JSON)
 *   {
 *     "name": "Example Hospital",                 // required, shown in the generated header
 *     "description": "Free text",                 // optional, shown in the generated header
 *     "set":   { "print.defaultPageMode": "all",  // dotted path -> new value
 *                "+viewer.exampleFlag": true },   // "+" prefix = deliberate addition
 *     "unset": [ "showPerfOverlay" ]              // dotted paths to comment out
 *   }
 *   Keys starting with "//" or "$" at the top level, and keys starting with "//" inside `set`,
 *   are treated as comments and ignored, because JSON has no comment syntax.
 *
 *   Dotted paths address the configuration OBJECT, resolved level by level through brace
 *   nesting, so `shortcuts.print.ctrlOrCmdP` and `print.defaultPageMode` never collide even
 *   though both contain a `print` key. Array elements are not addressable; set the whole array.
 *
 *   ADD MARKER (per key): a `set` key prefixed with "+" inserts a key that does not exist in the
 *   sample. Its parent path must exist in the sample as an object literal, and the key itself
 *   must NOT exist (use a plain key to change an existing value). The key is appended as the last
 *   entry of its parent block with a one-line marker comment. A plain key that does not exist in
 *   the sample is always an error; nothing is ever silently ignored.
 *
 *   UNSET: the property is commented out (`// key: value`), following the sample's own convention
 *   for intentionally inactive keys, so the built-in default from `odv.config.js` applies and the
 *   documentation stays in place. A property that shares a line with other code is removed inline.
 *
 * GUARANTEES
 *   - Values are edited in the TEXT of the sample; comments and layout are preserved and only the
 *     addressed values change.
 *   - CRLF and LF input are both supported. The output keeps the line endings of the existing
 *     output file when there is one, otherwise those of the sample.
 *   - The output starts with a header naming the profile and actual sample. The shipped sample also
 *     names the repository package.json version; a custom --sample omits that version.
 *   - After generating, the text is executed in `node:vm` with a stub `window`, and every profile
 *     value is asserted on `window.__ODV_SITE_CONFIG__`; then `public/odv.config.js` is executed on
 *     top of it and every set/added value is asserted on the merged `window.__ODV_CONFIG__`.
 *
 * LIMITATIONS
 *   - The sample object literal may contain plain `key: value` properties only (no spread,
 *     shorthand, methods or computed keys). Values may be expressions; they are replaced as a
 *     whole and serialized as JS literals (strings single-quoted). The scanner decides regex
 *     versus division from the previous token, so a regex literal directly after ')' (for example
 *     `if (x) /re/.test(s)`) is misread; see the README for the exact residual limits.
 *   - Profile values must be JSON values: string, number, boolean, null, array or object.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(TOOL_DIR, '..', '..');
export const DEFAULT_SAMPLE = path.join(REPO_ROOT, 'public', 'odv.site.config.sample.js');
export const DEFAULT_LOADER = path.join(REPO_ROOT, 'public', 'odv.config.js');
export const DEFAULT_PACKAGE_JSON = path.join(REPO_ROOT, 'package.json');

/** First line of every generated file; used to recognise files this tool may replace. */
export const HEADER_MARKER = '// Generated by OpenDocViewer tools/site-config-generator.';
const ADD_PREFIX = '+';
const ASSIGNMENT_TARGET = '__ODV_SITE_CONFIG__';

/** Error type for problems the operator must fix (bad profile, unknown path, ...). */
export class GeneratorError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GeneratorError';
  }
}

// ---------------------------------------------------------------------------------------------
// Line endings
// ---------------------------------------------------------------------------------------------

/**
 * Detect the dominant line ending of a text.
 * @param {string} text
 * @returns {'\r\n'|'\n'}
 */
export function detectEol(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/\n/g) || []).length - crlf;
  return crlf > lf ? '\r\n' : '\n';
}

function toLf(text) {
  return text.replace(/\r\n/g, '\n');
}

function fromLf(text, eol) {
  return eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
}

// ---------------------------------------------------------------------------------------------
// Text scanner: locates properties of the site config object literal through brace nesting
// ---------------------------------------------------------------------------------------------

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[\w$]/;
const DIGIT = /[0-9]/;
const BRACKET_PAIRS = { '{': '}', '[': ']', '(': ')' };

/**
 * Reserved words that can be followed by an expression, so a '/' after them starts a regular
 * expression. After any other identifier a '/' is division.
 */
const REGEX_AFTER_WORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'delete', 'void', 'new', 'do', 'else', 'case',
  'yield', 'await', 'throw',
]);

/**
 * Whether a '/' after a closing bracket starts a regular expression. After ')' and ']' it is
 * division. '}' is ambiguous in JavaScript (block end or object-literal end); it is read as a
 * block end, so a '/' after it starts a regex. That reading is the one the top-level scan already
 * used, and when it is wrong (an object literal divided by something, which is never useful) the
 * regex scan fails loudly instead of silently swallowing the brackets of a real regex.
 */
function regexAllowedAfterClose(c) {
  return c === '}';
}

/**
 * Minimal JavaScript scanner over a source text. It understands whitespace, comments, string
 * and template literals (including `${}` nesting), regular-expression literals and bracket
 * nesting. That is all the sample needs; it is not a general JS parser.
 *
 * Whether a '/' starts a regular expression or is division is decided from the last significant
 * TOKEN, as a JavaScript lexer does (see scanPlainToken and regexAllowedAfterClose); comments and
 * whitespace between tokens do not change it.
 */
class Scanner {
  constructor(text) {
    this.text = text;
  }

  fail(pos, message) {
    const before = this.text.slice(0, pos);
    const line = before.split('\n').length;
    const column = pos - before.lastIndexOf('\n');
    throw new GeneratorError(`Sample parse error at line ${line}, column ${column}: ${message}`);
  }

  /** Skip whitespace and comments; return the next significant position. */
  skipTrivia(pos) {
    const t = this.text;
    for (;;) {
      while (pos < t.length && /\s/.test(t[pos])) pos++;
      if (t.startsWith('//', pos)) {
        const nl = t.indexOf('\n', pos);
        pos = nl === -1 ? t.length : nl;
      } else if (t.startsWith('/*', pos)) {
        const close = t.indexOf('*/', pos + 2);
        if (close === -1) this.fail(pos, 'unterminated block comment');
        pos = close + 2;
      } else {
        return pos;
      }
    }
  }

  /**
   * Consume one plain token at pos: an identifier or reserved word, a number, or a punctuator
   * (callers handle strings, templates, regular expressions and nested brackets themselves).
   * Returns the position after the token and whether a following '/' starts a regex:
   *   - after an identifier, a number, '++' or '--': no (division);
   *   - after a word in REGEX_AFTER_WORDS: yes, unless it is a property name after '.';
   *   - after ')' or ']': no; after '}': see regexAllowedAfterClose;
   *   - after any other punctuator or operator: yes.
   * @param {number} pos
   * @param {boolean} afterDot  the previous significant token was '.'
   * @returns {{ next: number, regexAllowed: boolean, dot: boolean }}
   */
  scanPlainToken(pos, afterDot) {
    const t = this.text;
    const c = t[pos];
    if (IDENT_START.test(c)) {
      let i = pos + 1;
      while (i < t.length && IDENT_PART.test(t[i])) i++;
      return { next: i, regexAllowed: !afterDot && REGEX_AFTER_WORDS.has(t.slice(pos, i)), dot: false };
    }
    if (DIGIT.test(c) || (c === '.' && DIGIT.test(t[pos + 1] || ''))) {
      let i = pos + 1;
      while (i < t.length && (IDENT_PART.test(t[i]) || t[i] === '.')) i++;
      return { next: i, regexAllowed: false, dot: false };
    }
    if ((c === '+' || c === '-') && t[pos + 1] === c) {
      return { next: pos + 2, regexAllowed: false, dot: false };
    }
    if (c === ')' || c === ']' || c === '}') {
      return { next: pos + 1, regexAllowed: regexAllowedAfterClose(c), dot: false };
    }
    return { next: pos + 1, regexAllowed: true, dot: c === '.' };
  }

  /** Skip a '...' or "..." string starting at pos; return the position after it. */
  skipString(pos) {
    const t = this.text;
    const quote = t[pos];
    for (let i = pos + 1; i < t.length; i++) {
      if (t[i] === '\\') { i++; continue; }
      if (t[i] === quote) return i + 1;
      if (t[i] === '\n') break;
    }
    return this.fail(pos, 'unterminated string literal');
  }

  /** Skip a template literal starting at pos; return the position after it. */
  skipTemplate(pos) {
    const t = this.text;
    for (let i = pos + 1; i < t.length; i++) {
      if (t[i] === '\\') { i++; continue; }
      if (t[i] === '`') return i + 1;
      if (t[i] === '$' && t[i + 1] === '{') {
        i = this.skipBalanced(i + 1) - 1;
      }
    }
    return this.fail(pos, 'unterminated template literal');
  }

  /** Skip a regular-expression literal starting at pos; return the position after it. */
  skipRegex(pos) {
    const t = this.text;
    let inClass = false;
    for (let i = pos + 1; i < t.length; i++) {
      const c = t[i];
      if (c === '\\') { i++; continue; }
      if (c === '\n') break;
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) {
        i++;
        while (i < t.length && IDENT_PART.test(t[i])) i++;
        return i;
      }
    }
    return this.fail(pos, 'unterminated regular expression literal');
  }

  /** Skip a bracketed group ({, [ or ( at pos) including nested content; return position after. */
  skipBalanced(pos) {
    const t = this.text;
    const stack = [BRACKET_PAIRS[t[pos]]];
    let i = pos + 1;
    let regexAllowed = true;
    let afterDot = false;
    while (i < t.length) {
      i = this.skipTrivia(i);
      const c = t[i];
      if (c === undefined) break;
      if (c === '\'' || c === '"') { i = this.skipString(i); regexAllowed = false; afterDot = false; continue; }
      if (c === '`') { i = this.skipTemplate(i); regexAllowed = false; afterDot = false; continue; }
      if (c === '/' && regexAllowed) { i = this.skipRegex(i); regexAllowed = false; afterDot = false; continue; }
      if (BRACKET_PAIRS[c]) { stack.push(BRACKET_PAIRS[c]); i++; regexAllowed = true; afterDot = false; continue; }
      if (c === '}' || c === ']' || c === ')') {
        if (stack.pop() !== c) this.fail(i, `unbalanced '${c}'`);
        i++;
        if (stack.length === 0) return i;
        regexAllowed = regexAllowedAfterClose(c);
        afterDot = false;
        continue;
      }
      ({ next: i, regexAllowed, dot: afterDot } = this.scanPlainToken(i, afterDot));
    }
    return this.fail(pos, 'unbalanced bracket');
  }

  /**
   * Scan one property value starting at pos (first significant character of the value).
   * Stops at a top-level ',' or '}' without consuming it.
   * @returns {{ end: number, stop: number, child: ObjectNode|null }}
   *   end: position after the last significant character of the value,
   *   stop: position of the terminating ',' or '}'.
   */
  scanValue(pos) {
    const t = this.text;
    let i = pos;
    let end = pos;
    let child = null;
    let tokens = 0;
    let regexAllowed = true;
    let afterDot = false;
    for (;;) {
      i = this.skipTrivia(i);
      const c = t[i];
      if (c === undefined) this.fail(pos, 'unexpected end of text inside a value');
      if (c === ',' || c === '}') {
        if (tokens === 0) this.fail(i, 'missing property value');
        return { end, stop: i, child };
      }
      if (c === ']' || c === ')') this.fail(i, `unexpected '${c}'`);
      if (BRACKET_PAIRS[c]) {
        if (c === '{' && tokens === 0) child = this.tryParseObject(i);
        i = this.skipBalanced(i);
        regexAllowed = regexAllowedAfterClose(BRACKET_PAIRS[c]);
        afterDot = false;
      } else if (c === '\'' || c === '"') {
        i = this.skipString(i);
        regexAllowed = false;
        afterDot = false;
      } else if (c === '`') {
        i = this.skipTemplate(i);
        regexAllowed = false;
        afterDot = false;
      } else if (c === '/' && regexAllowed) {
        i = this.skipRegex(i);
        regexAllowed = false;
        afterDot = false;
      } else {
        ({ next: i, regexAllowed, dot: afterDot } = this.scanPlainToken(i, afterDot));
      }
      tokens++;
      end = i;
      // An object literal followed by anything other than the end of the value (for example a
      // method call) is not a plain nested block, so it is not addressable by deeper paths.
      if (child && tokens > 1) child = null;
    }
  }

  /** Parse a nested object literal; null when it is not a plain "key: value" literal. */
  tryParseObject(pos) {
    try {
      return this.parseObject(pos);
    } catch (err) {
      if (err instanceof GeneratorError) return null;
      throw err;
    }
  }

  /**
   * Parse an object literal whose '{' is at pos.
   * @returns {ObjectNode}
   */
  parseObject(pos) {
    const t = this.text;
    /** @type {ObjectNode} */
    const node = { open: pos, close: -1, props: [] };
    let i = pos + 1;
    for (;;) {
      i = this.skipTrivia(i);
      const c = t[i];
      if (c === '}') { node.close = i; return node; }
      if (c === undefined) this.fail(pos, 'unterminated object literal');
      const keyStart = i;
      let key;
      if (c === '\'' || c === '"') {
        i = this.skipString(i);
        key = vm.runInNewContext(t.slice(keyStart, i));
      } else if (IDENT_START.test(c) || /[0-9]/.test(c)) {
        while (i < t.length && IDENT_PART.test(t[i])) i++;
        key = t.slice(keyStart, i);
      } else {
        this.fail(i, `unsupported property syntax starting with '${c}' (only "key: value" is supported)`);
      }
      i = this.skipTrivia(i);
      if (t[i] !== ':') this.fail(i, `expected ':' after key '${key}' (shorthand and methods are not supported)`);
      const valueStart = this.skipTrivia(i + 1);
      const scanned = this.scanValue(valueStart);
      /** @type {PropNode} */
      const prop = {
        key,
        keyStart,
        valueStart,
        valueEnd: scanned.end,
        comma: t[scanned.stop] === ',' ? scanned.stop : -1,
        child: scanned.child,
      };
      node.props.push(prop);
      i = scanned.stop;
      if (t[i] === ',') i++;
    }
  }
}

/**
 * @typedef {Object} ObjectNode
 * @property {number} open   index of '{'
 * @property {number} close  index of '}'
 * @property {PropNode[]} props
 *
 * @typedef {Object} PropNode
 * @property {string} key
 * @property {number} keyStart
 * @property {number} valueStart
 * @property {number} valueEnd   position after the last significant character of the value
 * @property {number} comma      index of the trailing ',' or -1
 * @property {ObjectNode|null} child  nested object literal when the value is one
 */

/**
 * Locate and parse the object literal assigned to `__ODV_SITE_CONFIG__` in a (LF) text.
 * @param {string} text
 * @returns {ObjectNode}
 */
export function parseSiteConfigText(text) {
  const scanner = new Scanner(text);
  let i = 0;
  let regexAllowed = true;
  let afterDot = false;
  while (i < text.length) {
    i = scanner.skipTrivia(i);
    const c = text[i];
    if (c === undefined) break;
    if (c === '\'' || c === '"') {
      i = scanner.skipString(i);
      regexAllowed = false;
      afterDot = false;
    } else if (c === '`') {
      i = scanner.skipTemplate(i);
      regexAllowed = false;
      afterDot = false;
    } else if (c === '/' && regexAllowed) {
      i = scanner.skipRegex(i);
      regexAllowed = false;
      afterDot = false;
    } else {
      const start = i;
      ({ next: i, regexAllowed, dot: afterDot } = scanner.scanPlainToken(i, afterDot));
      if (IDENT_START.test(c) && text.slice(start, i) === ASSIGNMENT_TARGET) {
        let cursor = scanner.skipTrivia(i);
        if (text[cursor] === '=' && text[cursor + 1] !== '=' && text[cursor + 1] !== '>') {
          cursor = scanner.skipTrivia(cursor + 1);
          if (text[cursor] === '{') return scanner.parseObject(cursor);
        }
      }
    }
  }
  throw new GeneratorError(`Could not find "${ASSIGNMENT_TARGET} = {" in the sample.`);
}

/** Find a property by key in an object node. JavaScript keeps the last duplicate; so do we. */
function findProp(node, key) {
  for (let i = node.props.length - 1; i >= 0; i--) {
    if (node.props[i].key === key) return node.props[i];
  }
  return null;
}

/**
 * Resolve a dotted path to its property node, level by level.
 * @returns {{ prop: PropNode|null, parent: ObjectNode|null, missingAt: number }}
 *   missingAt: index of the first path segment that does not exist (-1 when found).
 */
function resolvePath(root, segments) {
  let node = root;
  for (let i = 0; i < segments.length; i++) {
    const prop = findProp(node, segments[i]);
    if (!prop) return { prop: null, parent: node, missingAt: i };
    if (i === segments.length - 1) return { prop, parent: node, missingAt: -1 };
    if (!prop.child) {
      throw new GeneratorError(
        `Path "${segments.join('.')}": "${segments.slice(0, i + 1).join('.')}" is not an object literal in the sample, so it has no nested keys.`
      );
    }
    node = prop.child;
  }
  return { prop: null, parent: null, missingAt: 0 };
}

// ---------------------------------------------------------------------------------------------
// Value serialization
// ---------------------------------------------------------------------------------------------

const PLAIN_KEY = /^[A-Za-z_$][\w$]*$/;
const INLINE_LIMIT = 80;

function quoteString(s) {
  let out = '\'';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (ch === '\\') out += '\\\\';
    else if (ch === '\'') out += '\\\'';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x2028 || code === 0x2029 || code === 0x7f ||
      (code >= 0xd800 && code <= 0xdfff)) {
      // A lone surrogate must be escaped: UTF-8 output would otherwise replace it with U+FFFD.
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else out += ch;
  }
  return `${out}'`;
}

function formatKey(key) {
  return PLAIN_KEY.test(key) ? key : quoteString(key);
}

/**
 * Serialize a JSON value as a JavaScript literal in the sample's style (single quotes, two-space
 * indentation, short objects/arrays on one line).
 * @param {*} value
 * @param {string} indent  indentation of the line the value starts on
 * @returns {string}  LF text
 */
export function toJsLiteral(value, indent = '') {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string': return quoteString(value);
    case 'boolean': return String(value);
    case 'number':
      if (!Number.isFinite(value)) throw new GeneratorError(`Non-finite number ${value} cannot be written.`);
      return Object.is(value, -0) ? '-0' : String(value);
    case 'object': break;
    default: throw new GeneratorError(`Unsupported value type "${typeof value}".`);
  }
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v) => toJsLiteral(v, inner));
    const inline = `[${items.join(', ')}]`;
    if (!inline.includes('\n') && inline.length + indent.length <= INLINE_LIMIT) return inline;
    return `[\n${items.map((v) => `${inner}${v}`).join(',\n')}\n${indent}]`;
  }
  const keys = Object.keys(value);
  if (keys.includes('__proto__')) {
    throw new GeneratorError('Profile object values cannot contain a "__proto__" key; the configuration loader cannot merge it safely.');
  }
  if (keys.length === 0) return '{}';
  const entries = keys.map((k) => `${formatKey(k)}: ${toJsLiteral(value[k], inner)}`);
  const inline = `{ ${entries.join(', ')} }`;
  if (!inline.includes('\n') && inline.length + indent.length <= INLINE_LIMIT) return inline;
  return `{\n${entries.map((e) => `${inner}${e}`).join(',\n')}\n${indent}}`;
}

// ---------------------------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {Object} Operation
 * @property {'set'|'add'|'unset'} kind
 * @property {string} path      dotted path without the add marker
 * @property {string[]} segments
 * @property {*} [value]
 */

function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function validatePathText(raw, where) {
  const segments = raw.split('.');
  if (!raw || segments.some((s) => s === '')) {
    throw new GeneratorError(`${where}: "${raw}" is not a valid dotted path.`);
  }
  return segments;
}

/**
 * Validate a parsed profile and turn it into a flat list of operations.
 * @param {*} profile
 * @returns {{ name: string, description: string, operations: Operation[] }}
 */
export function normalizeProfile(profile) {
  if (!isPlainObject(profile)) throw new GeneratorError('The profile must be a JSON object.');
  const known = new Set(['name', 'description', 'set', 'unset']);
  for (const key of Object.keys(profile)) {
    if (!known.has(key) && !key.startsWith('//') && !key.startsWith('$')) {
      throw new GeneratorError(`Unknown top-level profile key "${key}". Allowed: name, description, set, unset.`);
    }
  }
  if (typeof profile.name !== 'string' || profile.name.trim() === '') {
    throw new GeneratorError('The profile needs a non-empty "name" string.');
  }
  if (profile.description !== undefined && typeof profile.description !== 'string') {
    throw new GeneratorError('"description" must be a string when present.');
  }
  const set = profile.set === undefined ? {} : profile.set;
  const unset = profile.unset === undefined ? [] : profile.unset;
  if (!isPlainObject(set)) throw new GeneratorError('"set" must be an object mapping dotted paths to values.');
  if (!Array.isArray(unset) || unset.some((p) => typeof p !== 'string')) {
    throw new GeneratorError('"unset" must be an array of dotted path strings.');
  }

  /** @type {Operation[]} */
  const operations = [];
  for (const [rawKey, value] of Object.entries(set)) {
    if (rawKey.startsWith('//')) continue;
    const isAdd = rawKey.startsWith(ADD_PREFIX);
    const p = isAdd ? rawKey.slice(ADD_PREFIX.length) : rawKey;
    const segments = validatePathText(p, 'set');
    toJsLiteral(value); // rejects unsupported values early
    // Clone the parsed JSON data without JSON.stringify, which would silently turn -0 into +0.
    operations.push({ kind: isAdd ? 'add' : 'set', path: p, segments, value: structuredClone(value) });
  }
  for (const p of unset) {
    operations.push({ kind: 'unset', path: p, segments: validatePathText(p, 'unset') });
  }

  // Two operations on the same path, or on a path and one of its descendants, would edit
  // overlapping text and make the result order-dependent. Refuse them.
  for (let a = 0; a < operations.length; a++) {
    for (let b = a + 1; b < operations.length; b++) {
      const pa = operations[a].path;
      const pb = operations[b].path;
      if (pa === pb || pa.startsWith(`${pb}.`) || pb.startsWith(`${pa}.`)) {
        throw new GeneratorError(`Conflicting profile entries: "${pa}" (${operations[a].kind}) and "${pb}" (${operations[b].kind}) overlap.`);
      }
    }
  }
  return { name: profile.name.trim(), description: (profile.description || '').trim(), operations };
}

/**
 * Read and normalise a profile file.
 * @param {string} file
 */
export function readProfile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new GeneratorError(`Cannot read profile "${file}": ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^﻿/, ''));
  } catch (err) {
    throw new GeneratorError(`Profile "${file}" is not valid JSON: ${err.message}`);
  }
  return normalizeProfile(parsed);
}

// ---------------------------------------------------------------------------------------------
// Text editing
// ---------------------------------------------------------------------------------------------

function lineStartOf(text, pos) {
  return text.lastIndexOf('\n', pos - 1) + 1;
}

function lineEndOf(text, pos) {
  const nl = text.indexOf('\n', pos);
  return nl === -1 ? text.length : nl;
}

function indentOf(text, pos) {
  const start = lineStartOf(text, pos);
  return /^[ \t]*/.exec(text.slice(start))[0];
}

function onlyWhitespaceBefore(text, pos) {
  return /^[ \t]*$/.test(text.slice(lineStartOf(text, pos), pos));
}

/** True when the rest of the line after pos is empty or a // comment. */
function onlyTriviaAfter(text, pos) {
  return /^[ \t]*(\/\/.*)?$/.test(text.slice(pos, lineEndOf(text, pos)));
}

/** One-line rendering of the current source text of a value, for the change listing. */
function shortSource(text) {
  const oneLine = text.replace(/\s*\n\s*/g, ' ');
  return oneLine.length > 70 ? `${oneLine.slice(0, 67)}...` : oneLine;
}

/**
 * Apply profile operations to the LF text of the sample.
 * @param {string} sampleLf
 * @param {Operation[]} operations
 * @returns {{ text: string, changes: Array<{ kind: string, path: string, before: string, after: string }> }}
 */
export function applyOperations(sampleLf, operations) {
  const root = parseSiteConfigText(sampleLf);
  /** @type {Array<{ start: number, end: number, text: string, path: string }>} */
  const edits = [];
  const changes = [];
  /** @type {Map<ObjectNode, Array<{ op: Operation }>>} */
  const additions = new Map();
  const errors = [];

  for (const op of operations) {
    let resolved;
    try {
      resolved = resolvePath(root, op.segments);
    } catch (err) {
      errors.push(err.message);
      continue;
    }
    const { prop, parent, missingAt } = resolved;
    if (op.kind === 'add') {
      if (prop) {
        errors.push(`Path "${op.path}" is marked as an addition ("${ADD_PREFIX}${op.path}") but already exists in the sample; use "${op.path}" to change it.`);
      } else if (missingAt !== op.segments.length - 1) {
        errors.push(`Path "${op.path}": parent "${op.segments.slice(0, missingAt + 1).join('.')}" does not exist in the sample; add the outermost missing key as one object instead.`);
      } else {
        if (!additions.has(parent)) additions.set(parent, []);
        additions.get(parent).push({ op });
      }
      continue;
    }
    if (!prop) {
      const hint = op.kind === 'set' ? ` Mark it as a deliberate addition with "${ADD_PREFIX}${op.path}".` : '';
      errors.push(`Path "${op.path}" does not exist in the sample (missing "${op.segments.slice(0, missingAt + 1).join('.')}").${hint}`);
      continue;
    }
    const before = sampleLf.slice(prop.valueStart, prop.valueEnd);
    if (op.kind === 'set') {
      const literal = toJsLiteral(op.value, indentOf(sampleLf, prop.keyStart));
      edits.push({ start: prop.valueStart, end: prop.valueEnd, text: literal, path: op.path });
      changes.push({ kind: 'set', path: op.path, before: shortSource(before), after: shortSource(literal) });
    } else {
      const afterProp = prop.comma === -1 ? prop.valueEnd : prop.comma + 1;
      if (onlyWhitespaceBefore(sampleLf, prop.keyStart) && onlyTriviaAfter(sampleLf, afterProp)) {
        // Comment out every line of the property, keeping indentation and layout.
        const first = lineStartOf(sampleLf, prop.keyStart);
        const last = lineEndOf(sampleLf, afterProp);
        const indent = indentOf(sampleLf, prop.keyStart);
        const block = sampleLf.slice(first, last).split('\n').map((line) => {
          const body = line.startsWith(indent) ? line.slice(indent.length) : line.trimStart();
          return `${indent}// ${body}`.replace(/[ \t]+$/, '');
        }).join('\n');
        edits.push({ start: first, end: last, text: block, path: op.path });
      } else {
        let end = afterProp;
        while (sampleLf[end] === ' ' || sampleLf[end] === '\t') end++;
        edits.push({ start: prop.keyStart, end, text: '', path: op.path });
      }
      changes.push({ kind: 'unset', path: op.path, before: shortSource(before), after: '(commented out; built-in default applies)' });
    }
  }

  for (const [parent, list] of additions) {
    const closeLineStart = lineStartOf(sampleLf, parent.close);
    const multiLine = onlyWhitespaceBefore(sampleLf, parent.close) && closeLineStart > parent.open;
    const lastProp = parent.props[parent.props.length - 1];
    if (lastProp && lastProp.comma === -1) {
      edits.push({ start: lastProp.valueEnd, end: lastProp.valueEnd, text: ',', path: list[0].op.path });
    }
    if (multiLine) {
      const indent = lastProp ? indentOf(sampleLf, lastProp.keyStart) : `${indentOf(sampleLf, parent.close)}  `;
      const lines = list.map(({ op }, i) => {
        const literal = toJsLiteral(op.value, indent);
        const comma = i < list.length - 1 ? ',' : '';
        return `${indent}// Added by the site profile: not present in the shipped sample.\n${indent}${formatKey(op.segments.at(-1))}: ${literal}${comma}\n`;
      });
      edits.push({ start: closeLineStart, end: closeLineStart, text: lines.join(''), path: list[0].op.path });
    } else {
      const parts = list.map(({ op }) => `${formatKey(op.segments.at(-1))}: ${toJsLiteral(op.value, indentOf(sampleLf, parent.open))}`);
      const insertAt = lastProp ? (lastProp.comma === -1 ? lastProp.valueEnd : lastProp.comma + 1) : parent.open + 1;
      const text = lastProp ? ` ${parts.join(', ')}` : ` ${parts.join(', ')} `;
      edits.push({ start: insertAt, end: insertAt, text, path: list[0].op.path, after: true });
    }
    for (const { op } of list) {
      changes.push({ kind: 'add', path: op.path, before: '(absent)', after: shortSource(toJsLiteral(op.value)) });
    }
  }

  if (errors.length > 0) {
    throw new GeneratorError(`The profile does not match the sample:\n  - ${errors.join('\n  - ')}`);
  }

  // Apply from the end of the text towards the start so earlier offsets stay valid.
  // At equal positions the inline addition is applied before the comma insertion, so the comma
  // ends up between the previous value and the added key.
  edits.sort((a, b) => (b.start - a.start) || ((b.after ? 1 : 0) - (a.after ? 1 : 0)) || (b.end - a.end));
  for (let i = 1; i < edits.length; i++) {
    const later = edits[i - 1];
    const earlier = edits[i];
    if (earlier.end > later.start) {
      throw new GeneratorError(`Profile entries "${earlier.path}" and "${later.path}" edit overlapping text in the sample.`);
    }
  }
  let text = sampleLf;
  for (const edit of edits) {
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  }
  const order = new Map(operations.map((op, i) => [op.path, i]));
  changes.sort((a, b) => order.get(a.path) - order.get(b.path));
  return { text, changes };
}

// ---------------------------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------------------------

function oneLine(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Build the generated header comment (LF).
 * @param {{ name: string, description: string }} profile
 * @param {string} version
 * @param {string} [samplePath] sample actually used
 */
export function buildHeader(profile, version, samplePath = DEFAULT_SAMPLE) {
  const lines = [
    HEADER_MARKER,
    `// Site profile: ${oneLine(profile.name)}`,
  ];
  if (profile.description) lines.push(`// Description:  ${oneLine(profile.description)}`);
  const builtFrom = samePath(samplePath, DEFAULT_SAMPLE)
    ? `public/odv.site.config.sample.js of OpenDocViewer ${version} (version from repository package.json)`
    : `${path.resolve(samplePath)} (custom --sample; no version inferred)`;
  lines.push(
    `// Built from:   ${builtFrom}`,
    '// Do not edit this file by hand. Change the site profile and regenerate:',
    '//   node tools/site-config-generator/site-config-generator.mjs generate --profile <profile.json> --out <this file>',
    '// After an upgrade, verify it against the new sample:',
    '//   node tools/site-config-generator/site-config-generator.mjs check --profile <profile.json> --config <this file>',
    ''
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Verification through node:vm
// ---------------------------------------------------------------------------------------------

/** Copy a vm value with JSON omission semantics, but preserve numeric negative zero. */
function toPlain(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return -0;
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    return Array.from(value, (item) => {
      const copy = toPlain(item);
      return copy === undefined ? null : copy;
    });
  }
  if (typeof value === 'object') {
    const entries = [];
    for (const key of Object.keys(value)) {
      const copy = toPlain(value[key]);
      if (copy !== undefined) entries.push([key, copy]);
    }
    return Object.fromEntries(entries);
  }
  return undefined;
}

function getPath(obj, segments) {
  let cur = obj;
  for (const s of segments) {
    if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, s)) return { found: false };
    cur = cur[s];
  }
  return { found: true, value: cur };
}

/** True when every key in `expected` is present in `actual` with an equal value (deep). */
function containsDeep(actual, expected) {
  if (isPlainObject(expected)) {
    return isPlainObject(actual) && Object.keys(expected).every((k) =>
      Object.prototype.hasOwnProperty.call(actual, k) && containsDeep(actual[k], expected[k]));
  }
  return isDeepStrictEqual(actual, expected);
}

function stubWindow() {
  return {
    location: { href: 'https://viewer.example.org/', pathname: '/' },
  };
}

function stubDocument() {
  return {
    currentScript: null,
    baseURI: 'https://viewer.example.org/',
    getElementsByTagName: () => [],
  };
}

/**
 * Execute a site configuration text the way the browser does and return the published object.
 * @param {string} text
 * @param {string} [loaderText]  odv.config.js source; when given it runs after the site config
 * @returns {{ site: *, merged: * }}
 */
export function evaluateSiteConfig(text, loaderText) {
  const window = stubWindow();
  const context = vm.createContext({ window, document: stubDocument(), URL });
  try {
    vm.runInContext(text, context, { filename: 'odv.site.config.js', timeout: 5000 });
  } catch (err) {
    throw new GeneratorError(`The generated site configuration does not execute: ${err.message}`);
  }
  const site = toPlain(window.__ODV_SITE_CONFIG__);
  if (!isPlainObject(site)) {
    throw new GeneratorError('The generated site configuration did not assign an object to window.__ODV_SITE_CONFIG__.');
  }
  let merged;
  if (loaderText !== undefined) {
    try {
      vm.runInContext(loaderText, context, { filename: 'odv.config.js', timeout: 5000 });
    } catch (err) {
      throw new GeneratorError(`odv.config.js failed on top of the generated site configuration: ${err.message}`);
    }
    merged = toPlain(window.__ODV_CONFIG__);
  }
  return { site, merged };
}

/**
 * Assert that the generated text carries every profile value.
 * Site object: set/add values equal exactly, unset keys absent, and nothing else changed compared
 * with the sample. Merged config (odv.config.js): set/add values present after deep merge.
 * @returns {number} number of assertions made
 */
export function verifyGenerated(generatedLf, sampleLf, operations, loaderText) {
  const { site, merged } = evaluateSiteConfig(generatedLf, loaderText);
  const { site: sampleSite } = evaluateSiteConfig(sampleLf);
  const failures = [];
  let count = 0;

  const expected = structuredClone(sampleSite);
  for (const op of operations) {
    const parentSegments = op.segments.slice(0, -1);
    const leaf = op.segments.at(-1);
    const parentExpected = getPath(expected, parentSegments).value;
    const got = getPath(site, op.segments);
    count++;
    if (op.kind === 'unset') {
      delete parentExpected[leaf];
      if (got.found) failures.push(`${op.path}: expected the key to be absent, found ${JSON.stringify(got.value)}`);
      continue;
    }
    parentExpected[leaf] = structuredClone(op.value);
    if (!got.found) failures.push(`${op.path}: missing from window.__ODV_SITE_CONFIG__`);
    else if (!isDeepStrictEqual(got.value, op.value)) {
      failures.push(`${op.path}: expected ${JSON.stringify(op.value)}, found ${JSON.stringify(got.value)}`);
    }
    if (merged !== undefined) {
      const m = getPath(merged, op.segments);
      count++;
      if (!m.found || !containsDeep(m.value, op.value)) {
        failures.push(`${op.path}: not effective after odv.config.js merge (found ${m.found ? JSON.stringify(m.value) : 'nothing'})`);
      }
    }
  }
  count++;
  if (failures.length === 0 && !isDeepStrictEqual(site, expected)) {
    failures.push('values not addressed by the profile differ from the sample (the text edit touched something else)');
  }
  if (failures.length > 0) {
    throw new GeneratorError(`Verification of the generated configuration failed:\n  - ${failures.join('\n  - ')}`);
  }
  return count;
}

// ---------------------------------------------------------------------------------------------
// Generate / check
// ---------------------------------------------------------------------------------------------

function readText(file, what) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new GeneratorError(`Cannot read ${what} "${file}": ${err.message}`);
  }
}

/** Read the product version from package.json. */
export function readSampleVersion(packageJsonFile = DEFAULT_PACKAGE_JSON) {
  const pkg = JSON.parse(readText(packageJsonFile, 'package.json'));
  if (typeof pkg.version !== 'string') throw new GeneratorError(`No "version" in ${packageJsonFile}.`);
  return pkg.version;
}

/**
 * Produce the site configuration text in memory.
 * @param {Object} options
 * @param {{ name: string, description: string, operations: Operation[] }} options.profile
 * @param {string} options.sampleText  sample source (any line endings)
 * @param {string} options.version
 * @param {string} [options.samplePath] sample actually used (default: the shipped sample)
 * @param {string} [options.loaderText]  odv.config.js source for the merged verification
 * @param {'\r\n'|'\n'} [options.eol]   output line ending (default: the sample's)
 */
export function generateText({ profile, sampleText, version, samplePath = DEFAULT_SAMPLE, loaderText, eol }) {
  const bom = sampleText.startsWith('﻿') ? '﻿' : '';
  const raw = bom ? sampleText.slice(1) : sampleText;
  const sampleLf = toLf(raw);
  const { text, changes } = applyOperations(sampleLf, profile.operations);
  const outputLf = buildHeader(profile, version, samplePath) + text;
  const verified = verifyGenerated(outputLf, sampleLf, profile.operations, loaderText === undefined ? undefined : toLf(loaderText));
  return { text: bom + fromLf(outputLf, eol || detectEol(raw)), changes, verified };
}

function formatChanges(changes) {
  if (changes.length === 0) return ['  (the profile has no set or unset entries)'];
  const width = Math.max(...changes.map((c) => c.path.length));
  return changes.map((c) => `  ${c.kind.padEnd(5)} ${c.path.padEnd(width)}  ${c.before} -> ${c.after}`);
}

/** Line diff (LCS) between two LF texts; returns hunks of '-'/'+' lines with line numbers. */
export function diffLines(expectedLf, actualLf, maxLines = 40) {
  const a = expectedLf.split('\n');
  const b = actualLf.split('\n');
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const am = a.slice(prefix, a.length - suffix);
  const bm = b.slice(prefix, b.length - suffix);
  const n = am.length;
  const m = bm.length;
  const out = [];
  if (n * m > 4_000_000) {
    out.push(`  (files differ in lines ${prefix + 1}-${a.length - suffix} / ${prefix + 1}-${b.length - suffix}; too large for a line diff)`);
    return out;
  }
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = am[i] === bm[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && am[i] === bm[j]) { i++; j++; continue; }
    if (i < n && (j === m || lcs[i + 1][j] >= lcs[i][j + 1])) {
      out.push(`  - ${String(prefix + i + 1).padStart(4)} | ${am[i]}`);
      i++;
    } else {
      out.push(`  + ${String(prefix + j + 1).padStart(4)} | ${bm[j]}`);
      j++;
    }
  }
  if (out.length > maxLines) {
    const more = out.length - maxLines;
    out.length = maxLines;
    out.push(`  ... ${more} more changed line(s)`);
  }
  return out;
}

/** Map every addressable path to the source text of its value. */
function collectValues(text) {
  const map = new Map();
  const walk = (node, prefix) => {
    for (const prop of node.props) {
      const p = prefix ? `${prefix}.${prop.key}` : prop.key;
      if (prop.child) walk(prop.child, p);
      else map.set(p, text.slice(prop.valueStart, prop.valueEnd));
    }
  };
  walk(parseSiteConfigText(text), '');
  return map;
}

/**
 * Compare an existing configuration text with the regenerated one.
 * @returns {{ identical: boolean, lines: string[] }}
 */
export function compareConfigs(expectedText, actualText) {
  const expectedLf = toLf(expectedText.replace(/^﻿/, ''));
  const actualLf = toLf(actualText.replace(/^﻿/, ''));
  const lines = [];
  if (expectedLf === actualLf) {
    if (expectedText !== actualText) {
      lines.push('Content is identical; only the line endings or byte-order mark differ.');
    }
    return { identical: true, lines };
  }
  try {
    const want = collectValues(expectedLf);
    const have = collectValues(actualLf);
    const keyLines = [];
    for (const [p, v] of want) {
      if (!have.has(p)) keyLines.push(`  missing   ${p}  (regenerated: ${shortSource(v)})`);
      else if (have.get(p) !== v) keyLines.push(`  changed   ${p}  regenerated: ${shortSource(v)}  existing: ${shortSource(have.get(p))}`);
    }
    for (const [p, v] of have) {
      if (!want.has(p)) keyLines.push(`  extra     ${p}  (existing: ${shortSource(v)})`);
    }
    if (keyLines.length > 0) lines.push('Keys that differ:', ...keyLines);
    else lines.push('No configuration value differs; the difference is in comments, layout or the header.');
  } catch (err) {
    lines.push(`The existing configuration could not be parsed for a per-key comparison: ${err.message}`);
  }
  lines.push('Line diff (- regenerated, + existing):', ...diffLines(expectedLf, actualLf));
  return { identical: false, lines };
}

// ---------------------------------------------------------------------------------------------
// new-profile template
// ---------------------------------------------------------------------------------------------

export const PROFILE_TEMPLATE = `{
  "//": [
    "OpenDocViewer site profile for tools/site-config-generator.",
    "set:   dotted path -> new value. The path must exist in public/odv.site.config.sample.js.",
    "       Prefix a path with '+' to deliberately add a key that the sample does not have;",
    "       its parent block must exist in the sample.",
    "unset: dotted paths to comment out, so the built-in default from odv.config.js applies.",
    "Keys starting with '//' are comments and are ignored.",
    "Values may be strings, numbers, booleans, null, arrays or objects.",
    "Arrays always replace the whole default array."
  ],
  "name": "Example Hospital",
  "description": "Fictional example site profile. Replace every value with the real site's settings.",
  "set": {
    "i18n.default": "en",
    "print.defaultPageMode": "all",
    "shortcuts.print.ctrlOrCmdP": "dialog",
    "help.about.contactEmail": "viewer-support@example.org",
    "// +viewer.exampleSetting": "an addition would look like this; remove the '// ' to use it"
  },
  "unset": []
}
`;

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

const USAGE = `Usage:
  node tools/site-config-generator/site-config-generator.mjs generate --profile <file> --out <file> [--force]
  node tools/site-config-generator/site-config-generator.mjs check --profile <file> --config <file>
  node tools/site-config-generator/site-config-generator.mjs new-profile --out <file> [--force]

Options:
  --sample <file>   sample to build from (default: public/odv.site.config.sample.js)
  --loader <file>   odv.config.js used for the merged verification (default: public/odv.config.js)
  --force           replace an existing --out file that was not produced by this tool`;

const COMMAND_OPTIONS = {
  generate: { required: ['profile', 'out'], allowed: ['profile', 'out', 'force', 'sample', 'loader'] },
  check: { required: ['profile', 'config'], allowed: ['profile', 'config', 'sample', 'loader'] },
  'new-profile': { required: ['out'], allowed: ['out', 'force'] },
};

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const spec = COMMAND_OPTIONS[command];
  if (!spec) throw new GeneratorError(command ? `Unknown command "${command}".\n\n${USAGE}` : USAGE);
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) throw new GeneratorError(`Unexpected argument "${arg}".\n\n${USAGE}`);
    const name = arg.slice(2);
    if (!spec.allowed.includes(name)) throw new GeneratorError(`Option --${name} is not valid for "${command}".\n\n${USAGE}`);
    if (name === 'force') { options.force = true; continue; }
    const value = rest[++i];
    if (value === undefined || value.startsWith('--')) throw new GeneratorError(`Option --${name} needs a value.`);
    options[name] = value;
  }
  for (const name of spec.required) {
    if (!options[name]) throw new GeneratorError(`"${command}" requires --${name}.\n\n${USAGE}`);
  }
  return { command, options };
}

function samePath(a, b) {
  const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(a) === norm(b);
}

function buildFromOptions(options, existingText) {
  const profile = readProfile(options.profile);
  const samplePath = options.sample || DEFAULT_SAMPLE;
  const sampleText = readText(samplePath, 'sample');
  const loaderPath = options.loader || DEFAULT_LOADER;
  const loaderText = readText(loaderPath, 'loader');
  const version = readSampleVersion();
  // Keep the line endings of an existing output file; otherwise follow the sample.
  const eol = existingText !== undefined ? detectEol(existingText) : undefined;
  const result = generateText({ profile, sampleText, version, samplePath, loaderText, eol });
  return { ...result, profile, samplePath, version };
}

/** Status line naming the sample; claims a version only where the generated header does. */
function sampleLine(result) {
  return samePath(result.samplePath, DEFAULT_SAMPLE)
    ? `Sample:  ${result.samplePath} (OpenDocViewer ${result.version})`
    : `Sample:  ${path.resolve(result.samplePath)} (custom --sample; no version inferred)`;
}

function runGenerate(options, log) {
  const out = path.resolve(options.out);
  const samplePath = options.sample || DEFAULT_SAMPLE;
  if (samePath(out, samplePath)) throw new GeneratorError('--out must not be the sample file itself.');
  let existing;
  if (fs.existsSync(out)) {
    existing = readText(out, 'output file');
    if (!options.force && !existing.replace(/^﻿/, '').startsWith(HEADER_MARKER)) {
      throw new GeneratorError(`"${out}" exists and was not produced by this tool. Re-run with --force to replace it.`);
    }
  }
  const result = buildFromOptions(options, existing);
  log(`Profile: ${result.profile.name}`);
  log(sampleLine(result));
  log('Changes (old -> new):');
  for (const line of formatChanges(result.changes)) log(line);
  log(`Verified ${result.verified} assertion(s) through node:vm (site object and odv.config.js merge).`);
  fs.writeFileSync(out, result.text, 'utf8');
  log(`Wrote ${out}`);
  return 0;
}

function runCheck(options, log) {
  const configText = readText(options.config, 'site configuration');
  const result = buildFromOptions(options, configText);
  const comparison = compareConfigs(result.text, configText);
  log(`Profile: ${result.profile.name}`);
  log(sampleLine(result));
  log(`Config:${path.resolve(options.config)}`);
  for (const line of comparison.lines) log(line);
  if (comparison.identical) {
    log('OK: the site configuration matches the sample plus the profile.');
    return 0;
  }
  log('DRIFT: the site configuration differs from the sample plus the profile.');
  log('Regenerate it with "generate", or update the profile if the difference is intended.');
  return 1;
}

function runNewProfile(options, log) {
  const out = path.resolve(options.out);
  if (fs.existsSync(out) && !options.force) {
    throw new GeneratorError(`"${out}" already exists. Re-run with --force to replace it.`);
  }
  fs.writeFileSync(out, PROFILE_TEMPLATE, 'utf8');
  log(`Wrote example profile ${out}`);
  return 0;
}

/**
 * CLI entry point.
 * @param {string[]} argv  arguments after the script name
 * @param {{ log?: (s: string) => void, error?: (s: string) => void }} [io]
 * @returns {number} process exit code (0 ok, 1 drift or error, 2 usage error)
 */
export function main(argv, io = {}) {
  const log = io.log || ((s) => process.stdout.write(`${s}\n`));
  const error = io.error || ((s) => process.stderr.write(`${s}\n`));
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    error(err.message);
    return 2;
  }
  try {
    if (parsed.command === 'generate') return runGenerate(parsed.options, log);
    if (parsed.command === 'check') return runCheck(parsed.options, log);
    return runNewProfile(parsed.options, log);
  } catch (err) {
    if (err instanceof GeneratorError) {
      error(`ERROR: ${err.message}`);
      return 1;
    }
    throw err;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
