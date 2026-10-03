// @vitest-environment jsdom
// File: src/utils/__tests__/manualContentsTree.test.js
//
// The manual overlay builds its contents tree at runtime from the loaded, sanitised manual HTML
// (installations mirror their own manual files, so the files themselves are never edited). These
// tests pin the heading-id slugging (same rules as the WebClient help's navtrad.py) and the
// two-level tree built from h2/h3 headings in document order.
import { describe, expect, it } from 'vitest';
import {
  buildManualContentsTree,
  countManualMatchesPerSection,
  findManualSectionId,
  slugifyManualHeading,
} from '../manualContentsTree.js';

/** @param {string} html @returns {HTMLDivElement} */
function mount(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe('slugifyManualHeading', () => {
  it('drops the section number, folds å/ä/ö/é and joins words with dashes', () => {
    expect(slugifyManualHeading('2. Hitta rätt dokument')).toBe('hitta-ratt-dokument');
    expect(slugifyManualHeading('Öppna  urvalet — snabbt!')).toBe('oppna-urvalet-snabbt');
    expect(slugifyManualHeading('Café & Åtgärder')).toBe('cafe-atgarder');
    expect(slugifyManualHeading('  10. Vill du veta mer?  ')).toBe('vill-du-veta-mer');
  });

  it('falls back to "avsnitt" when nothing ASCII is left', () => {
    expect(slugifyManualHeading('')).toBe('avsnitt');
    expect(slugifyManualHeading('— ? —')).toBe('avsnitt');
    expect(slugifyManualHeading('日本語')).toBe('avsnitt');
  });
});

describe('buildManualContentsTree', () => {
  it('builds a two-level tree from h2/h3 in document order and keeps existing ids', () => {
    const root = mount([
      '<h1>Manual</h1>',
      '<h2 id="start">1. Kom igång</h2><p>a</p>',
      '<h3>Första steget</h3><h3>Andra steget</h3>',
      '<section><h2>2. Skriva ut</h2></section>',
      '<h4>Ignored</h4>',
    ].join(''));
    const tree = buildManualContentsTree(root);
    expect(tree.entries.map((entry) => [entry.level, entry.id, entry.text])).toEqual([
      [1, 'start', '1. Kom igång'],
      [2, 'forsta-steget', 'Första steget'],
      [2, 'andra-steget', 'Andra steget'],
      [1, 'skriva-ut', '2. Skriva ut'],
    ]);
    expect(tree.groups.map((group) => [group.id, group.children.map((child) => child.id)])).toEqual([
      ['start', ['forsta-steget', 'andra-steget']],
      ['skriva-ut', []],
    ]);
    // The ids are written to the headings so tree links and in-text links can target them.
    expect(root.querySelector('h3').id).toBe('forsta-steget');
    expect(tree.entries[3].element).toBe(root.querySelector('section h2'));
    root.remove();
  });

  it('de-duplicates repeated heading texts and ids already used in the manual', () => {
    const root = mount([
      '<p id="tips">x</p>',
      '<h2>Tips</h2><h3>Tips</h3><h2>Tips</h2>',
      '<h2 id="dup">Egen</h2><h2 id="dup">Egen igen</h2>',
    ].join(''));
    const ids = buildManualContentsTree(root).entries.map((entry) => entry.id);
    expect(ids).toEqual(['tips-2', 'tips-3', 'tips-4', 'dup', 'dup-2']);
    expect(new Set(ids).size).toBe(ids.length);
    expect(root.querySelectorAll('h2')[3].id).toBe('dup-2');
    root.remove();
  });

  it('never reuses an id that already exists elsewhere in the document', () => {
    const outside = document.createElement('div');
    outside.id = 'oversikt';
    document.body.appendChild(outside);
    const root = mount('<h2>Översikt</h2>');
    expect(buildManualContentsTree(root).entries[0].id).toBe('oversikt-2');
    root.remove();
    outside.remove();
  });

  it('puts an h3 before the first h2 on the top level and skips empty headings', () => {
    const root = mount('<h3>Inledning</h3><h2>   </h2><h2>Del <em>ett</em></h2><h3>Sub</h3>');
    const tree = buildManualContentsTree(root);
    expect(tree.groups.map((group) => [group.text, group.children.map((child) => child.text)])).toEqual([
      ['Inledning', []],
      ['Del ett', ['Sub']],
    ]);
    root.remove();
  });

  it('returns an empty tree for a manual without h2/h3', () => {
    const root = mount('<h1>Only a title</h1><p>Text</p><h4>Small</h4>');
    expect(buildManualContentsTree(root)).toEqual({ entries: [], groups: [] });
    expect(buildManualContentsTree(null)).toEqual({ entries: [], groups: [] });
    root.remove();
  });

  it('is idempotent: a second pass keeps the ids from the first', () => {
    const root = mount('<h2>Ett</h2><h2>Ett</h2>');
    const first = buildManualContentsTree(root).entries.map((entry) => entry.id);
    const second = buildManualContentsTree(root).entries.map((entry) => entry.id);
    expect(second).toEqual(first);
    root.remove();
  });

  it('handles hundreds of headings in one pass', () => {
    const parts = [];
    for (let index = 0; index < 600; index += 1) {
      parts.push(index % 3 === 0 ? `<h2>Avsnitt ${index}</h2>` : '<h3>Detalj</h3>');
    }
    const root = mount(parts.join('<p>text</p>'));
    const tree = buildManualContentsTree(root);
    expect(tree.entries).toHaveLength(600);
    expect(tree.groups).toHaveLength(200);
    expect(new Set(tree.entries.map((entry) => entry.id)).size).toBe(600);
    root.remove();
  });
});

describe('section lookup and hit counts', () => {
  const html = '<p>intro hit</p><h2>A</h2><p>hit hit</p><h3>B</h3><p>hit</p><h2>C</h2><p>none</p>';

  it('finds the section that contains a node', () => {
    const root = mount(html);
    const { entries } = buildManualContentsTree(root);
    const paragraphs = root.querySelectorAll('p');
    expect(findManualSectionId(entries, paragraphs[0].firstChild)).toBe('');
    expect(findManualSectionId(entries, paragraphs[1].firstChild)).toBe('a');
    expect(findManualSectionId(entries, paragraphs[2].firstChild)).toBe('b');
    expect(findManualSectionId(entries, paragraphs[3])).toBe('c');
    expect(findManualSectionId(entries, entries[1].element)).toBe('b');
    root.remove();
  });

  it('counts search hits per section in one merge pass', () => {
    const root = mount(html);
    const { entries } = buildManualContentsTree(root);
    const paragraphs = root.querySelectorAll('p');
    const matches = [
      { node: paragraphs[0].firstChild },
      { node: paragraphs[1].firstChild },
      { node: paragraphs[1].firstChild },
      { node: paragraphs[2].firstChild },
    ];
    expect(Object.fromEntries(countManualMatchesPerSection(entries, matches))).toEqual({ a: 2, b: 1 });
    expect(countManualMatchesPerSection(entries, []).size).toBe(0);
    root.remove();
  });
});
