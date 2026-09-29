import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// The manual search field shows focus through its parent's box-shadow, which
// forced-colors (Windows high contrast) mode does not paint. A forced-colors
// rule must draw a real outline instead.
const css = readFileSync(resolve(import.meta.dirname, '..', 'dialogs.css'), 'utf8');

/**
 * Bodies of every `@media (forced-colors: active)` block, found by brace matching.
 *
 * @param {string} source
 * @returns {Array<string>}
 */
function forcedColorsBlocks(source) {
  const blocks = [];
  const pattern = /@media\s*\(\s*forced-colors\s*:\s*active\s*\)\s*\{/g;
  for (const found of source.matchAll(pattern)) {
    const bodyStart = found.index + found[0].length;
    let depth = 1;
    let index = bodyStart;
    while (index < source.length && depth > 0) {
      if (source[index] === '{') depth += 1;
      else if (source[index] === '}') depth -= 1;
      index += 1;
    }
    blocks.push(source.slice(bodyStart, index - 1));
  }
  return blocks;
}

describe('dialogs.css forced-colors focus', () => {
  it('draws a visible outline around the focused manual search field', () => {
    const rule = forcedColorsBlocks(css)
      .map((body) => body.match(/\.odv-manual-searchbar-field:focus-within\s*\{([^}]*)\}/))
      .find(Boolean);
    expect(rule).toBeTruthy();
    const declarations = rule[1];
    expect(declarations).toMatch(/outline\s*:\s*(?!none)[^;]*\b\d+px\b[^;]*solid/);
    expect(declarations).not.toMatch(/outline\s*:\s*none/);
  });
});
