// File: scripts/web-config-manual.test.mjs
/**
 * public/web.config must serve the stand-alone manual page (`manual/index.html`) under IIS:
 *
 * - the request `/manual` becomes `/manual/` through IIS itself: `manual/` is a real directory, so
 *   the generic AddTrailingSlash rule skips it (its IsFile/IsDirectory conditions are negated) and
 *   the directory courtesy redirect of IIS (with the default document below) adds the slash,
 * - the `/manual/` directory answers with its `index.html` through an explicit default document
 *   (independent of the server-level list),
 * - the SPA fallback rewrite only applies when the request maps to neither an existing file nor
 *   an existing directory, so real `manual/` assets and the `manual/` directory itself are never
 *   rewritten to the viewer shell,
 * - the unhashed `manual/index.html` entry is excluded from the global one-year immutable cache,
 *   like the viewer entry and the runtime config,
 * - `manual/index.html` gets the same Content-Security-Policy header as the viewer entry, minus
 *   only the inline-script hash (the manual page ships no inline script), so the new page is not
 *   left without an IIS-level CSP while the viewer entry has one.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Parse public/web.config as XML; a malformed file fails the suite, not the assertions. */
function parseWebConfig() {
  const xml = fs.readFileSync(path.join(ROOT, 'public', 'web.config'), 'utf8');
  const { document } = new JSDOM(xml, { contentType: 'text/xml' }).window;
  const errors = Array.from(document.getElementsByTagName('parsererror'));
  expect(errors.map((node) => node.textContent)).toEqual([]);
  return document;
}

/** @returns {Array<Element>} */
function childElements(node) {
  return Array.from(node.childNodes).filter((child) => child.nodeType === 1);
}

/** Find the rewrite <rule> with the given name. */
function findRule(document, name) {
  const rules = Array.from(document.getElementsByTagName('rule'));
  const rule = rules.find((candidate) => candidate.getAttribute('name') === name);
  expect(rule, `rewrite rule "${name}" exists`).toBeTruthy();
  return rule;
}

/** Find the <location> block with the given path. */
function findLocation(document, locationPath) {
  const locations = Array.from(document.getElementsByTagName('location'));
  const location = locations.find((candidate) => candidate.getAttribute('path') === locationPath);
  expect(location, `<location path="${locationPath}"> exists`).toBeTruthy();
  return location;
}

function conditionsOf(rule) {
  const conditions = rule.getElementsByTagName('conditions')[0];
  expect(conditions, 'rule has <conditions>').toBeTruthy();
  return Array.from(conditions.getElementsByTagName('add'));
}

/** The Content-Security-Policy header value a <location> block sets (after its <remove>). */
function cspOfLocation(location) {
  const headers = Array.from(location.getElementsByTagName('add')).filter(
    (node) => node.getAttribute('name') === 'Content-Security-Policy',
  );
  expect(headers.length, '<location> sets exactly one Content-Security-Policy').toBe(1);
  return headers[0].getAttribute('value');
}

/** Collapse incidental whitespace so policy strings compare independent of formatting. */
function normaliseCsp(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

/** sha256-* tokens allowlisted in the script-src of a CSP value. */
function scriptHashes(cspValue) {
  const scriptSrc = (String(cspValue).match(/script-src[^;]*/) || [''])[0];
  return new Set((scriptSrc.match(/'sha256-[^']*'/) || []).map((token) => token.slice(1, -1)));
}

/**
 * Bodies of the inline (no src) classic scripts in an HTML source file. Vite passes classic
 * inline scripts through to dist/ unchanged, so hashing the committed source covers the built
 * page too (verified against dist/manual/index.html and dist/index.html for the current entries).
 */
function inlineScriptBodies(relativeHtmlPath) {
  const html = fs.readFileSync(path.join(ROOT, relativeHtmlPath), 'utf8');
  const { document } = new JSDOM(html).window;
  return Array.from(document.querySelectorAll('script'))
    .filter((node) => !node.getAttribute('src'))
    .map((node) => node.textContent ?? '');
}

/** CSP hash of an inline script body: sha256 over the exact text, base64-encoded. */
function cspHash(body) {
  return `sha256-${crypto.createHash('sha256').update(body, 'utf8').digest('base64')}`;
}

describe('web.config stand-alone manual page', () => {
  it('serves folder index files with index.html as the default document', () => {
    const document = parseWebConfig();
    const defaults = document.getElementsByTagName('defaultDocument');
    expect(defaults.length).toBe(1);
    const files = defaults[0].getElementsByTagName('files')[0];
    expect(files, 'defaultDocument lists files').toBeTruthy();
    const adds = childElements(files).filter((node) => node.tagName === 'add');
    expect(adds.length).toBeGreaterThan(0);
    // First entry wins in IIS, so index.html must lead regardless of server-level defaults.
    expect(adds[0].getAttribute('value')).toBe('index.html');
  });

  it('keeps the generic AddTrailingSlash rule off real files and directories such as manual/', () => {
    const document = parseWebConfig();
    const rule = findRule(document, 'AddTrailingSlash');
    const action = rule.getElementsByTagName('action')[0];
    expect(action.getAttribute('type')).toBe('Redirect');
    const conditions = conditionsOf(rule);
    const has = (input, matchType) => conditions.some(
      (condition) => condition.getAttribute('input') === input
        && condition.getAttribute('matchType') === matchType
        && condition.getAttribute('negate') === 'true',
    );
    // The rule only redirects extensionless paths without a trailing slash that are neither a file
    // nor a directory. /manual maps to the real manual/ directory, so the rule skips it; IIS's own
    // directory courtesy redirect turns it into /manual/ and the default document serves index.html.
    expect(has('{REQUEST_FILENAME}', 'IsFile')).toBe(true);
    expect(has('{REQUEST_FILENAME}', 'IsDirectory')).toBe(true);
    expect(conditions.some((condition) => condition.getAttribute('input') === '{REQUEST_URI}'
      && (condition.getAttribute('pattern') || '').includes('.+\\..+'))).toBe(true);
    expect(conditions.some((condition) => condition.getAttribute('input') === '{REQUEST_URI}'
      && (condition.getAttribute('pattern') || '').includes('/$'))).toBe(true);
  });

  it('keeps the SPA fallback away from existing manual/ files and the manual/ directory', () => {
    const document = parseWebConfig();
    const rule = findRule(document, 'SPA fallback');
    const action = rule.getElementsByTagName('action')[0];
    expect(action.getAttribute('type')).toBe('Rewrite');
    expect(action.getAttribute('url')).toBe('index.html');
    const conditions = conditionsOf(rule);
    // Every condition is negated: the rewrite only fires when the request maps to neither an
    // existing file (a manual/ asset) nor an existing directory (manual/ itself).
    expect(conditions.length).toBeGreaterThan(0);
    for (const condition of conditions) {
      expect(condition.getAttribute('negate')).toBe('true');
    }
    expect(conditions.some((condition) => condition.getAttribute('input') === '{REQUEST_FILENAME}'
      && condition.getAttribute('matchType') === 'IsFile')).toBe(true);
    expect(conditions.some((condition) => condition.getAttribute('input') === '{REQUEST_FILENAME}'
      && condition.getAttribute('matchType') === 'IsDirectory')).toBe(true);
  });

  it('excludes the unhashed manual/index.html entry from the immutable cache', () => {
    const document = parseWebConfig();
    const location = findLocation(document, 'manual/index.html');
    const headers = Array.from(location.getElementsByTagName('add')).filter(
      (node) => node.getAttribute('name') === 'Cache-Control',
    );
    expect(headers.length).toBe(1);
    expect(headers[0].getAttribute('value')).toContain('no-store');
  });

  it('grants manual/index.html the viewer entry CSP, minus only the inline-script hash', () => {
    const document = parseWebConfig();
    const viewerCsp = cspOfLocation(findLocation(document, 'index.html'));
    const manualCsp = cspOfLocation(findLocation(document, 'manual/index.html'));
    // The viewer entry must keep its inline-script allowance: this suite never weakens the root.
    expect(scriptHashes(viewerCsp).size).toBeGreaterThan(0);
    const viewerWithoutHashes = normaliseCsp(viewerCsp.replace(/ 'sha256-[^']*'/g, ''));
    expect(normaliseCsp(manualCsp)).toBe(viewerWithoutHashes);
  });

  it('allowlist every manual CSP script hash from a real inline script, and vice versa', () => {
    const document = parseWebConfig();
    const manualCsp = cspOfLocation(findLocation(document, 'manual/index.html'));
    const allowed = scriptHashes(manualCsp);
    const actual = new Set(inlineScriptBodies('manual/index.html').map(cspHash));
    for (const hash of allowed) {
      expect(actual.has(hash), `CSP hash ${hash} matches an inline script in manual/index.html`).toBe(true);
    }
    for (const hash of actual) {
      expect(allowed.has(hash), `inline script ${hash} is allowlisted in the manual CSP`).toBe(true);
    }
  });

  it('control: the viewer entry hash matches its inline i18n script', () => {
    // Guards the hashing method above: if JSDOM ever normalised script text, this fails first.
    const document = parseWebConfig();
    const viewerCsp = cspOfLocation(findLocation(document, 'index.html'));
    const allowed = scriptHashes(viewerCsp);
    const actual = inlineScriptBodies('index.html').map(cspHash);
    expect(actual.length).toBeGreaterThan(0);
    for (const hash of actual) {
      expect(allowed.has(hash), `inline script ${hash} is allowlisted in the viewer CSP`).toBe(true);
    }
  });
});
