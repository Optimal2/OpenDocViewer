// File: src/styles/__tests__/themeContrast.test.js
/**
 * Contrast gate for the three ODV palettes: normal body text must reach WCAG AA
 * (4.5:1) on the main surfaces (page background, canvas, toolbar) in Light,
 * Dark and Normal. Dialog restore and print-selection actions must also pass,
 * including disabled states, composited transparency and interaction states.
 *
 * The expected pairs are read from the application CSS so a
 * palette regression fails here before it reaches a browser.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const themeCss = readFileSync(new URL('../theme.css', import.meta.url), 'utf8');
const dialogCss = readFileSync(new URL('../dialogs.css', import.meta.url), 'utf8');
const toolbarCss = readFileSync(new URL('../toolbar.css', import.meta.url), 'utf8');
const printCss = readFileSync(new URL('../print.css', import.meta.url), 'utf8');
const layoutCss = readFileSync(new URL('../layout.css', import.meta.url), 'utf8');

function declarations(css, selector) {
  const rule = css.split('}').find((block) => block.slice(0, block.indexOf('{')).trim().endsWith(selector));
  expect(rule, `Missing CSS rule: ${selector}`).toBeTruthy();
  return Object.fromEntries([...rule.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)].map((match) => [match[1], match[2].trim()]));
}

/** Parse a #rrggbb hex colour into linear RGB channels. */
function parseHex(hex) {
  const normalized = String(hex).trim().replace(/^#/, '');
  const full = normalized.length === 3
    ? normalized.split('').map((part) => part + part).join('')
    : normalized;
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  ];
}

/** Relative luminance per WCAG 2.2. */
function luminance(hex) {
  const linear = (Array.isArray(hex) ? hex : parseHex(hex)).slice(0, 3).map((channel) => (
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** WCAG contrast ratio between two hex colours. */
function contrastRatio(foreground, background) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

const PALETTES = Object.fromEntries(['light', 'normal', 'dark'].map((name) => {
  const css = declarations(themeCss, name === 'light' ? ':root' : `[data-theme='${name}']`);
  return [name, {
    text: css['--text-color'],
    background: css['--background-color'],
    canvas: css['--canvas-background-color'],
    toolbar: css['--toolbar-background-color'],
    surface: css['--odv-surface'],
    elevated: css['--odv-surface-elevated'],
  }];
}));

describe('theme contrast gate (WCAG AA 4.5:1)', () => {
  it('overrides the inline screen color-scheme in print media', () => {
    expect(declarations(printCss, 'html')['color-scheme']).toBe('light !important');
  });
  for (const [name, palette] of Object.entries(PALETTES)) {
    it(`print media resets every theme token to light from ${name}`, () => {
      const dom = new JSDOM(`<html data-theme="${name}" style="color-scheme: dark"><head><style>${themeCss}</style><style>${printCss}</style></head><body></body></html>`);
      try {
        // jsdom has no print emulation: activate only the real print media rules.
        const printRules = [...dom.window.document.styleSheets[1].cssRules]
          .filter((rule) => rule.media?.mediaText === 'print')
          .flatMap((rule) => [...rule.cssRules]).map((rule) => rule.cssText).join('\n');
        expect(printRules).not.toBe('');
        dom.window.document.querySelectorAll('style')[1].textContent = printRules;
        const style = dom.window.getComputedStyle(dom.window.document.documentElement);
        for (const [property, value] of Object.entries(declarations(themeCss, ':root'))) {
          if (property.startsWith('--')) {
            expect(style.getPropertyValue(property).replace(/\s/g, ''), property).toBe(value.replace(/\s/g, ''));
          }
        }
      } finally {
        dom.window.close();
      }
    });
    it(`body text passes on background, canvas and toolbar in ${name}`, () => {
      for (const surface of [palette.background, palette.canvas, palette.toolbar, palette.surface, palette.elevated]) {
        expect(contrastRatio(palette.text, surface)).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it('dialog restore action keeps white text at 4.5:1', () => {
    const base = declarations(dialogCss, '.odv-prd-restoreIcon');
    for (const selector of ['.odv-prd-restoreIcon', '.odv-prd-restoreIcon:hover', '.odv-prd-restoreIcon:focus-visible']) {
      expect(contrastRatio(base.color, declarations(dialogCss, selector).background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('zoom and page inputs keep body text at 4.5:1 on their surface', () => {
    for (const selector of ['.zoom-percent-input', '.page-number-input']) {
      const css = declarations(toolbarCss, selector);
      expect(css.color).toBe('var(--text-color)');
      expect(css['background-color']).toBe('var(--odv-surface, #ffffff)');
    }
    for (const palette of Object.values(PALETTES)) {
      expect(contrastRatio(palette.text, palette.surface)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// Let the CSS engine resolve the real cascade; resolve palette colors below.
// State attributes have the same specificity as the pseudo-classes they replace.
const selectionCss = [themeCss, layoutCss, toolbarCss].join('\n')
  .replace(/:(hover|focus-visible|focus|active)\b/g, '[data-$1]');
const selectionActions = [
  'primary', 'secondary', 'secondary print-selection-history-action',
  'secondary print-selection-reset-action', 'secondary print-selection-cancel-action',
  'primary print-selection-commit-action', 'secondary print-selection-reset-draft-action',
  'primary print-selection-save-action', 'secondary print-selection-leave-action',
];
const selectionCases = [
  // Generic rules must work without the selection-workspace overrides, including
  // action classes used alone (otherwise primary/secondary can mask bad pairs).
  ...['', 'toolbar'].flatMap((parent) => selectionActions.map((action) => [[parent], `print-selection-${action}`])),
  ...['commit', 'reset-draft', 'cancel', 'reset', 'save'].map((action) => [
    [''], `print-selection-${action}-action`,
  ]),
  ...selectionActions.map((action) => [['toolbar toolbar--selection-workspace'], `print-selection-${action}`]),
  ...['print-selection-primary print-selection-save-action', 'print-selection-secondary']
    .map((action) => [['print-selection-unsaved-dialog'], action]),
  ...['', 'toolbar', 'toolbar toolbar--selection-workspace'].flatMap((parent) => (
    ['', 'is-active'].map((action) => [[parent, 'print-selection-panel-mode-actions'], action])
  )),
  [['print-selection-workspace', 'print-selection-panel'], 'print-selection-panel-preview-button'],
  [['print-selection-workspace', 'print-selection-transfer-buttons'], ''],
  ...['print-selection-lightbox-close', 'print-selection-lightbox-step']
    .map((action) => [['print-selection-lightbox'], action]),
  ...['add', 'remove'].flatMap((action) => ['', ' is-active'].map((active) => [
    ['print-selection-lightbox', 'print-selection-lightbox-actions'],
    `print-selection-lightbox-action print-selection-lightbox-${action}-action${active}`,
  ])),
];
const selectionStates = [
  [], ['hover'], ['focus'], ['focus', 'focus-visible'], ['active'],
  ['disabled'], ['disabled', 'hover'], ['disabled', 'focus', 'focus-visible'],
];

function computedColor(value) {
  if (value === 'transparent') return [0, 0, 0, 0];
  const mix = value.match(/^color-mix\(in srgb, (.+) ([\d.]+)%, (.+) ([\d.]+)%\)$/);
  if (mix) {
    const first = computedColor(mix[1]);
    const second = computedColor(mix[3]);
    const firstAlpha = first[3] * Number(mix[2]) / 100;
    const secondAlpha = second[3] * Number(mix[4]) / 100;
    const alpha = firstAlpha + secondAlpha;
    return [...first.slice(0, 3).map((channel, index) => (
      alpha ? (channel * firstAlpha + second[index] * secondAlpha) / alpha : 0
    )), alpha];
  }
  if (value.startsWith('#')) return [...parseHex(value), 1];
  const srgb = value.startsWith('color(srgb ');
  expect(srgb || /^rgba?\(/.test(value), `Unresolved CSS color: ${value}`).toBe(true);
  const channels = value.match(/[\d.]+/g).map(Number);
  return [...channels.slice(0, 3).map((channel) => srgb ? channel : channel / 255), channels[3] ?? 1];
}

function composite(foreground, background, opacity = 1) {
  const alpha = foreground[3] * opacity;
  return [...background.slice(0, 3).map((channel, index) => (
    foreground[index] * alpha + channel * (1 - alpha)
  )), 1];
}

for (const name of Object.keys(PALETTES)) {
  describe(`print-selection button contrast in ${name}`, () => {
    let dom;
    beforeAll(() => {
      const variables = { ...declarations(themeCss, ':root'),
        ...(name === 'light' ? {} : declarations(themeCss, `[data-theme='${name}']`)) };
      // jsdom does not substitute custom properties in computed colors yet.
      let css = selectionCss;
      while (/var\([^()]*\)/.test(css)) {
        css = css.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/g,
          (_, property, fallback) => variables[property] ?? fallback ?? 'initial');
      }
      dom = new JSDOM(`<html data-theme="${name}"><head><style>${css}</style></head><body></body></html>`);
    });
    afterAll(() => dom.window.close());

    for (const [parents, action] of selectionCases) {
      for (const states of selectionStates) {
        it(`${parents.join(' > ')}: ${action}, ${states.join(' + ') || 'normal'} >= 4.5:1`, () => {
          const { document } = dom.window;
          document.body.replaceChildren();
          let container = document.body;
          for (const className of parents) {
            const parent = document.createElement('div');
            parent.className = className;
            container.append(parent);
            container = parent;
          }
          const button = document.createElement('button');
          button.className = action;
          button.textContent = 'Action';
          for (const state of states) {
            button.setAttribute(state === 'disabled' ? 'disabled' : `data-${state}`, '');
          }
          container.replaceChildren(button);
          const style = dom.window.getComputedStyle(button);
          let backdrop = [...parseHex(PALETTES[name].background), 1];
          const ancestors = [];
          for (let element = container; element; element = element.parentElement) ancestors.unshift(element);
          for (const element of ancestors) {
            const ancestorStyle = dom.window.getComputedStyle(element);
            expect(Number(ancestorStyle.opacity || 1)).toBe(1);
            backdrop = composite(computedColor(ancestorStyle.backgroundColor), backdrop);
          }
          if (action === 'print-selection-panel-preview-button' && states.includes('focus-visible') && !states.includes('disabled')) {
            expect(style.outlineStyle).toBe('solid');
            expect(parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2);
            expect(parseFloat(style.outlineOffset)).toBeGreaterThanOrEqual(2);
            expect(contrastRatio(computedColor(style.outlineColor), backdrop)).toBeGreaterThanOrEqual(3);
          }
          let backgrounds = [style.backgroundColor];
          if (style.backgroundImage && style.backgroundImage !== 'none') {
            // These action gradients interpolate in sRGB; check both endpoints.
            expect(style.backgroundImage).toMatch(/^linear-gradient\(180deg,/);
            backgrounds = [...style.backgroundImage.matchAll(/(rgb\([^)]+\)|#[\da-f]+)\s+\d+%/gi)]
              .map((match) => match[1]);
            expect(backgrounds).toHaveLength(2);
          }
          const brightness = style.filter.match(/^brightness\(([\d.]+)\)$/);
          expect(!style.filter || style.filter === 'none' || brightness).toBeTruthy();
          const filtered = (color) => [...color.slice(0, 3).map((channel) => (
            Math.min(1, channel * Number(brightness?.[1] ?? 1))
          )), color[3]];
          const opacity = Number(style.opacity || 1);
          for (const color of backgrounds) {
            const background = composite(computedColor(color), backdrop);
            const text = composite(computedColor(style.color), background);
            expect(contrastRatio(composite(filtered(text), backdrop, opacity), composite(filtered(background), backdrop, opacity)))
              .toBeGreaterThanOrEqual(4.5);
          }
        });
      }
    }
  });
}
