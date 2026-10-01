import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const stylesRoot = new URL('../', import.meta.url);
const printCss = readFileSync(new URL('print.css', stylesRoot), 'utf8');

// Ignore token names (which can contain color words), but retain every literal
// fallback, including nested var(), mixes, gradients and shadows.
function withoutVariableNames(value) {
  return value.replace(/var\(\s*--[\w-]+\s*(?:,\s*)?/g, '(');
}

function* printApplicableRules(rules) {
  for (const rule of rules) {
    if (rule.media && /screen|forced-colors/.test(rule.media.mediaText)) continue;
    if (rule.selectorText) yield rule;
    else if (rule.cssRules) yield* printApplicableRules(rule.cssRules);
  }
}

describe('live-DOM print theme reset', () => {
  it.each([
    ['var(--surface, #123456)', '#123456'],
    ['var(--surface, rgb(1, 2, 3))', 'rgb(1, 2, 3)'],
    ['var(--surface, var(--other, navy))', 'navy'],
  ])('preserves hard-coded fallback colors for the theme-rule audit: %s', (value, color) => {
    expect(withoutVariableNames(value)).toContain(color);
  });

  it('covers every hard-coded theme color with an important print override', () => {
    const dom = new JSDOM(`<style>${printCss}</style><style></style>`);
    try {
      const [printStyle, sourceStyle] = dom.window.document.querySelectorAll('style');
      // Resolve the print tokens before CSSOM expands background/border
      // shorthands; jsdom cannot expand shorthands containing var() itself.
      const tokens = [...printApplicableRules(printStyle.sheet.cssRules)]
        .find((rule) => rule.selectorText.includes(':root')).style;
      printStyle.textContent = printCss.replace(/var\((--[\w-]+)\)/g,
        (_, property) => tokens.getPropertyValue(property));
      const resetRules = [...printApplicableRules(printStyle.sheet.cssRules)];
      const probe = dom.window.document.createElement('span');
      const missing = [];
      let checked = 0;
      for (const file of readdirSync(stylesRoot, { recursive: true }).filter((file) => file.endsWith('.css') && file !== 'print.css')) {
        sourceStyle.textContent = readFileSync(new URL(file.replaceAll('\\', '/'), stylesRoot), 'utf8');
        for (const rule of printApplicableRules(sourceStyle.sheet.cssRules)) {
          if (!rule.selectorText.includes('[data-theme')) continue;
          for (const property of Array.from(rule.style)) {
            if (property.startsWith('--')) continue; // Token reset is tested separately.
            const value = withoutVariableNames(rule.style.getPropertyValue(property));
            const hasColor = /#[\da-f]+|(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(/i.test(value)
              || (value.match(/[a-z]+/gi) || []).some((word) => {
                probe.style.color = '';
                probe.style.color = word;
                return probe.style.color && !/^(inherit|initial|unset|revert|currentcolor)$/i.test(word);
              });
            if (!hasColor) continue;
            for (const selector of rule.selectorText.split(',').map((part) => part.trim())) {
              checked += 1;
              const reset = resetRules.find((candidate) => candidate.selectorText.split(',').map((part) => part.trim()).includes(selector)
                && candidate.style.getPropertyPriority(property) === 'important');
              if (!reset) missing.push(`${file}: ${selector} { ${property}: ${value} }`);
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(15);
      expect(missing).toEqual([]);
    } finally {
      dom.window.close();
    }
  });
});
