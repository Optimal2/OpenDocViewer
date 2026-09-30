// @vitest-environment jsdom
/**
 * File: src/components/DocumentToolbar/__tests__/PrintRangeDialog.recipientLabel.test.js
 *
 * Renders the print dialog with the real locale files and checks that the recipient field's
 * visible label, placeholder and accessible name follow userLog.ui.fields.forWhom.required:
 * a required recipient shows the bare label with an asterisk, an optional one shows the
 * "optional" marker. Guards the dialog wiring, not only the label helper.
 */

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

// jsdom replaces the global URL, so resolve the locale files with node:path instead.
const localeDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../public/locales');
const locales = {
  sv: JSON.parse(readFileSync(resolve(localeDir, 'sv/common.json'), 'utf8')),
  en: JSON.parse(readFileSync(resolve(localeDir, 'en/common.json'), 'utf8')),
};
let currentLanguage = 'sv';

function translate(key, options = {}) {
  const value = key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), locales[currentLanguage]);
  if (typeof value === 'string') {
    return value.replace(/\{\{?(\w+)\}?\}/g, (match, name) => (options[name] !== undefined ? String(options[name]) : match));
  }
  return options.defaultValue !== undefined ? options.defaultValue : key;
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translate,
    i18n: { language: currentLanguage, resolvedLanguage: currentLanguage },
  }),
}));

const { default: PrintRangeDialog } = await import('../PrintRangeDialog.jsx');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('PrintRangeDialog recipient label', () => {
  let container = null;
  let root = null;

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    container = null;
    root = null;
    delete window.__ODV_CONFIG__;
  });

  function renderDialog(required, lng) {
    currentLanguage = lng;
    window.__ODV_CONFIG__ = {
      userLog: {
        enabled: true,
        ui: { fields: { reason: { required: false }, forWhom: { required } } },
      },
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(React.createElement(PrintRangeDialog, {
        isOpen: true,
        onClose: () => {},
        onSubmit: () => {},
        totalPages: 3,
      }));
    });
  }

  function recipientInput(label) {
    return document.querySelector(`input[aria-label="${label}"]`);
  }

  it.each([
    ['sv', 'Mottagare', 'Mottagare (valfritt)'],
    ['en', 'Recipient', 'Recipient (optional)'],
  ])('%s: required shows the bare label with an asterisk', (lng, bare, optional) => {
    renderDialog(true, lng);
    const input = recipientInput(bare);
    expect(input).not.toBeNull();
    expect(input.getAttribute('placeholder')).toBe(bare);
    expect(input.closest('label').textContent).toContain(`${bare} *`);
    expect(document.body.textContent).not.toContain(optional);
  });

  it.each([
    ['sv', 'Mottagare (valfritt)'],
    ['en', 'Recipient (optional)'],
  ])('%s: optional shows the optional marker', (lng, optional) => {
    renderDialog(false, lng);
    const input = recipientInput(optional);
    expect(input).not.toBeNull();
    expect(input.getAttribute('placeholder')).toBe(optional);
    expect(input.closest('label').textContent).not.toContain('*');
  });
});
