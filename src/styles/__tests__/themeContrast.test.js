// File: src/styles/__tests__/themeContrast.test.js
/**
 * Contrast gate for the three ODV palettes: normal body text must reach WCAG AA
 * (4.5:1) on the main surfaces (page background, canvas, toolbar) in Light,
 * Dark and Normal, and the dialog restore action must keep white text at 4.5:1.
 *
 * The expected pairs are read from the application CSS so a
 * palette regression fails here before it reaches a browser.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const themeCss = readFileSync(new URL('../theme.css', import.meta.url), 'utf8');
const dialogCss = readFileSync(new URL('../dialogs.css', import.meta.url), 'utf8');
const toolbarCss = readFileSync(new URL('../toolbar.css', import.meta.url), 'utf8');
const printCss = readFileSync(new URL('../print.css', import.meta.url), 'utf8');

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
  const linear = parseHex(hex).map((channel) => (
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
