/**
 * File: src/components/DocumentToolbar/__tests__/printFieldLabels.test.js
 *
 * The recipient label follows the site config: a site with an optional recipient shows the
 * "optional" marker, a site that requires the recipient shows the bare label (the dialog adds
 * the asterisk). Before this, the marker was fixed in the locale text, so a required field read
 * "Mottagare (valfritt) *".
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolvePrintFieldLabel } from '../printFieldLabels.js';

function loadLocale(lng) {
  const file = fileURLToPath(new URL(`../../../../public/locales/${lng}/common.json`, import.meta.url));
  return JSON.parse(readFileSync(file, 'utf8'));
}

function translatorFor(locale) {
  return (key, options = {}) => {
    const value = key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), locale);
    if (typeof value === 'string') return value;
    return options.defaultValue !== undefined ? options.defaultValue : key;
  };
}

describe('resolvePrintFieldLabel', () => {
  it.each([
    ['sv', 'Mottagare', 'Mottagare (valfritt)'],
    ['en', 'Recipient', 'Recipient (optional)'],
  ])('%s: required shows the bare label, optional shows the marker', (lng, bare, optional) => {
    const t = translatorFor(loadLocale(lng));
    expect(resolvePrintFieldLabel(t, 'printDialog.forWhom', true)).toBe(bare);
    expect(resolvePrintFieldLabel(t, 'printDialog.forWhom', false)).toBe(optional);
  });

  it('falls back to the bare label when a locale has no optionalLabel', () => {
    const t = translatorFor({ printDialog: { forWhom: { label: 'Mottagare' } } });
    expect(resolvePrintFieldLabel(t, 'printDialog.forWhom', false)).toBe('Mottagare');
  });
});
