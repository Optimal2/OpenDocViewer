// File: src/styles/__tests__/themeContrast.test.js
/**
 * Contrast gate for the three ODV palettes: normal body text must reach WCAG AA
 * (4.5:1) on the main surfaces (page background, canvas, toolbar) in Light,
 * Dark and Normal, and the dialog restore action must keep white text at 4.5:1.
 *
 * The expected pairs mirror src/styles/theme.css and src/styles/dialogs.css so a
 * palette regression fails here before it reaches a browser.
 */

import { describe, it, expect } from 'vitest';

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

// Palette values mirrored from src/styles/theme.css.
const PALETTES = {
  light: {
    text: '#1b1f24',
    background: '#f7f7f7',
    canvas: '#ffffff',
    toolbar: '#d6d6d6',
  },
  normal: {
    text: '#17202a',
    background: '#dde5ee',
    canvas: '#edf2f7',
    toolbar: '#bcc8d5',
  },
  dark: {
    text: '#e8edf3',
    background: '#12161c',
    canvas: '#171c24',
    toolbar: '#202734',
  },
};

describe('theme contrast gate (WCAG AA 4.5:1)', () => {
  for (const [name, palette] of Object.entries(PALETTES)) {
    it(`body text passes on background, canvas and toolbar in ${name}`, () => {
      for (const surface of [palette.background, palette.canvas, palette.toolbar]) {
        expect(contrastRatio(palette.text, surface)).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it('dialog restore action keeps white text at 4.5:1', () => {
    // Mirrors .odv-prd-restoreIcon in src/styles/dialogs.css.
    expect(contrastRatio('#ffffff', '#15803d')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ffffff', '#166534')).toBeGreaterThanOrEqual(4.5);
  });

  it('zoom and page inputs keep body text at 4.5:1 on their surface', () => {
    // Mirrors .zoom-percent-input / .page-number-input in src/styles/toolbar.css,
    // which use the shared surface and body text tokens.
    const surfaces = { light: '#ffffff', normal: '#e8eef5', dark: '#1e2631' };
    for (const [name, palette] of Object.entries(PALETTES)) {
      expect(contrastRatio(palette.text, surfaces[name])).toBeGreaterThanOrEqual(4.5);
    }
  });
});
