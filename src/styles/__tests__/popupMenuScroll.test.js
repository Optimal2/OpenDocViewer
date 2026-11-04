// File: src/styles/__tests__/popupMenuScroll.test.js
/**
 * The toolbar's popup menus (styles/toolbar.css) are bounded by the window's height and scroll
 * inside their own frame, so a menu with many entries (a read-aloud language list on an
 * installation with many languages) never runs off the bottom of the window.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const toolbarCss = readFileSync(new URL('../toolbar.css', import.meta.url), 'utf8');

describe('toolbar popup menus', () => {
  it('scroll inside a height bounded by the window', () => {
    const dom = new JSDOM(`<style>${toolbarCss}</style>`);
    const rules = [...dom.window.document.querySelector('style').sheet.cssRules];
    const menu = rules.find((rule) => rule.selectorText === '.toolbar-popup-menu');
    expect(menu).toBeDefined();
    expect(menu.style.getPropertyValue('overflow-y')).toBe('auto');
    expect(menu.style.getPropertyValue('max-height')).toMatch(/100vh/);
    expect(menu.style.getPropertyValue('overscroll-behavior')).toBe('contain');
    // The bound covers padding and border, so the box itself never ends below the window.
    expect(menu.style.getPropertyValue('box-sizing')).toBe('border-box');
  });
});
