// @vitest-environment jsdom
// File: src/utils/__tests__/standardManual.test.js

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { filterStandardManual } from '../standardManual.js';
import { standardManualRuleIds } from '../standardManualRules.js';

const manualSv = readFileSync(path.resolve('public/help/default/manual.sv.html'), 'utf8');
const manualEn = readFileSync(path.resolve('public/help/default/manual.en.html'), 'utf8');
const compareSv = readFileSync(path.resolve('public/help/default/manual-jamforelse.sv.html'), 'utf8');
const compareEn = readFileSync(path.resolve('public/help/default/manual-jamforelse.en.html'), 'utf8');

function filterToDocument(html, config = {}) {
  const filtered = filterStandardManual(html, config);
  expect(typeof filtered).toBe('string');
  return new DOMParser().parseFromString(filtered, 'text/html');
}

function heading(doc, id) {
  return doc.getElementById(id)?.textContent || '';
}

function fragmentLinks(doc, fragment) {
  return Array.from(doc.querySelectorAll('a[href]')).filter((anchor) => {
    const href = anchor.getAttribute('href') || '';
    try {
      return href.startsWith('#') && decodeURIComponent(href.slice(1)) === fragment;
    } catch {
      return false;
    }
  });
}

const COMPARE_RULE_IDS = [
  'kalibrera', 'finjustera', 'overlagring', 'gardin', 'avstangt',
  'jmf-kalibrera', 'jmf-finjustera', 'jmf-overlagring', 'jmf-gardin', 'jmf-avstangt',
  'calibrate', 'finetune', 'overlay', 'curtain', 'disabled',
  'jmf-calibrate', 'jmf-finetune', 'jmf-overlay', 'jmf-curtain', 'jmf-disabled',
];

describe('standardManualRules', () => {
  it('exports a flat, unique manifest of every exact element id used by the rules', () => {
    expect(standardManualRuleIds.every((id) => typeof id === 'string')).toBe(true);
    expect(new Set(standardManualRuleIds).size).toBe(standardManualRuleIds.length);
    expect(standardManualRuleIds).toEqual(expect.arrayContaining(COMPARE_RULE_IDS));
  });
});

describe('filterStandardManual with the real bundled manuals', () => {
  it.each([
    ['Swedish combined', manualSv, 'jmf-avstangt', 'jmf-tangenter', '7. Tangenterna i jämförelsen'],
    ['English combined', manualEn, 'jmf-disabled', 'jmf-keys', '7. The keys in the comparison'],
    ['Swedish standalone', compareSv, 'avstangt', 'tangenter', '7. Tangenterna i jämförelsen'],
    ['English standalone', compareEn, 'disabled', 'keys', '7. The keys in the comparison'],
  ])('always removes the installation-switch section in the %s manual', (_label, html, removedId, lastId, lastText) => {
    const doc = filterToDocument(html);
    expect(doc.getElementById(removedId)).toBeNull();
    expect(heading(doc, lastId)).toBe(lastText);
    expect(fragmentLinks(doc, removedId)).toHaveLength(0);
    expect(doc.body.textContent).toContain(removedId === 'avstangt' || removedId === 'jmf-avstangt'
      ? 'Det här kan din organisation ha stängt av'
      : 'What your organization may have switched off');
    expect(doc.body.textContent).not.toContain('compare.overlay.print.enabled');
  });

  it('removes standalone and embedded overlay sections, their lightboxes and their fragment links', () => {
    const doc = filterToDocument(manualSv, { compare: { overlay: { enabled: false } } });
    expect(doc.getElementById('jmf-overlagring')).toBeNull();
    expect(doc.getElementById('lb-overlagring')).toBeNull();
    expect(doc.getElementById('jmf-gardin')).not.toBeNull();
    expect(doc.body.textContent).not.toContain('Kopiera kalibreringen som JSON');
    expect(fragmentLinks(doc, 'jmf-overlagring')).toHaveLength(0);
    expect(doc.body.textContent).toContain('Lägg sidorna på varandra');
    expect(heading(doc, 'jmf-gardin')).toMatch(/^4\./);
    expect(heading(doc, 'jmf-utskrift')).toMatch(/^5\./);
    expect(heading(doc, 'jmf-tangenter')).toMatch(/^6\./);
    expect(heading(doc, 'urval-tabort')).toMatch(/^2\./);
    expect(doc.querySelector('a[href="#lb-stang"]')).not.toBeNull();
  });

  it('removes the curtain section independently in a standalone manual', () => {
    const doc = filterToDocument(compareEn, { compare: { curtain: { enabled: false } } });
    expect(doc.getElementById('curtain')).toBeNull();
    expect(doc.getElementById('lb-gardin')).toBeNull();
    expect(doc.getElementById('overlay')).not.toBeNull();
    expect(fragmentLinks(doc, 'curtain')).toHaveLength(0);
    expect(doc.body.textContent).toContain('Drag a border between the pages');
    expect(heading(doc, 'print')).toMatch(/^5\./);
    expect(heading(doc, 'keys')).toMatch(/^6\./);
  });

  it('applies the fineTune master gate without removing ordinary compare and print help', () => {
    const doc = filterToDocument(manualSv, { fineTune: { enabled: false } });
    for (const id of ['jmf-kalibrera', 'jmf-finjustera', 'jmf-overlagring', 'jmf-gardin']) {
      expect(doc.getElementById(id)).toBeNull();
    }
    expect(doc.getElementById('jmf-oppna')).not.toBeNull();
    expect(doc.getElementById('jmf-utskrift')).not.toBeNull();
    expect(doc.getElementById('bild')).not.toBeNull();
    expect(doc.body.textContent).toContain('Sida vid sida');
    expect(doc.body.textContent).not.toContain('Skriv ut överlagringsvyn:');
    expect(doc.body.textContent).not.toContain('Skriv ut gardinvyn:');
    expect(heading(doc, 'jmf-utskrift')).toMatch(/^2\./);
    expect(heading(doc, 'jmf-tangenter')).toMatch(/^3\./);
  });

  it('filters only the disabled view print instructions and their figure', () => {
    const doc = filterToDocument(manualSv, {
      compare: { overlay: { print: { enabled: false } } },
    });
    expect(doc.getElementById('jmf-overlagring')).not.toBeNull();
    expect(doc.getElementById('jmf-gardin')).not.toBeNull();
    expect(doc.body.textContent).not.toContain('Skriv ut överlagringsvyn:');
    expect(doc.body.textContent).toContain('Skriv ut gardinvyn:');
    expect(doc.body.textContent).toContain('Sida vid sida');
    expect(doc.body.textContent).not.toContain('Det finns tre sätt att få jämförelsen');
    expect(doc.getElementById('lb-utskrift-overlagring')).toBeNull();
    expect(doc.body.textContent).toContain('När du skriver ut från en av de två vyerna');
  });

  it('removes shared composed-print details only when neither view can print', () => {
    const doc = filterToDocument(compareEn, {
      compare: {
        overlay: { print: { enabled: false } },
        curtain: { print: { enabled: false } },
      },
    });
    expect(doc.getElementById('print')).not.toBeNull();
    expect(doc.body.textContent).toContain('Side by side');
    expect(doc.body.textContent).not.toContain('Print the overlay view:');
    expect(doc.body.textContent).not.toContain('Print the curtain view:');
    expect(doc.body.textContent).not.toContain('When you print from one of the two views');
    expect(doc.getElementById('lb-utskrift-overlagring')).toBeNull();
  });

  it('uses the runtime boolean fallback rules and does not mutate the supplied config', () => {
    const config = {
      fineTune: { enabled: null },
      compare: {
        overlay: { enabled: 'false', print: { enabled: 0 } },
        curtain: { enabled: true, print: { enabled: 'false' } },
      },
    };
    const snapshot = JSON.parse(JSON.stringify(config));
    const doc = filterToDocument(compareSv, config);
    expect(config).toEqual(snapshot);
    expect(doc.getElementById('finjustera')).not.toBeNull();
    expect(doc.getElementById('overlagring')).not.toBeNull();
    expect(doc.body.textContent).toContain('Skriv ut överlagringsvyn:');
    expect(doc.body.textContent).toContain('Skriv ut gardinvyn:');
  });

  it('sanitizes the returned manual while filtering it', () => {
    const doc = filterToDocument([
      '<div class="odv-manual"><script>window.bad = true</script>',
      '<h2 id="overview">1. Safe</h2><p><img src="x" onerror="window.bad = true">',
      '<a href="javascript:window.bad = true">Unsafe</a></p>',
      '<h2 id="avstangt">2. Switches</h2><p>Secret install details</p></div>',
    ].join(''));
    expect(doc.querySelector('script')).toBeNull();
    expect(doc.querySelector('[onerror]')).toBeNull();
    expect(doc.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(doc.getElementById('overview')).not.toBeNull();
    expect(doc.getElementById('avstangt')).toBeNull();
    expect(doc.body.textContent).not.toContain('Secret install details');
  });
});

const OCR_HTML = [
  '<div class="odv-manual" id="top">',
  '<h2 id="overview">1. Overview</h2><p>Ordinary help</p>',
  '<h2 id="ocr-search">2. Search recognised text</h2><p>Search-only marker</p>',
  '<h3 id="ocr-search-details">Details</h3><p>Nested search marker</p>',
  '<h2 id="ocr-read-aloud">3. Read recognised text aloud</h2><p>Speech-only marker</p>',
  '<h2 id="following">4. After OCR</h2><p>After marker</p>',
  '<details class="embedded" id="guide-fler"><summary>More features</summary>',
  '<h2 id="fler-ocr-search">1. Embedded search</h2><p>Embedded search marker</p>',
  '<h2 id="fler-ocr-read-aloud">2. Embedded speech</h2><p>Embedded speech marker</p>',
  '<h2 id="fler-following">3. Embedded following</h2><p>Embedded following marker</p>',
  '</details></div>',
].join('');

describe('filterStandardManual OCR and DOM boundaries', () => {
  it('gates standalone and embedded OCR search sections, including nested subsections', () => {
    const doc = filterToDocument(OCR_HTML, {
      ocr: { enabled: true, search: { enabled: false } },
    });
    for (const id of ['ocr-search', 'ocr-search-details', 'fler-ocr-search']) {
      expect(doc.getElementById(id)).toBeNull();
    }
    expect(doc.getElementById('ocr-read-aloud')).not.toBeNull();
    expect(doc.getElementById('fler-ocr-read-aloud')).not.toBeNull();
    expect(doc.body.textContent).not.toContain('Search-only marker');
    expect(doc.body.textContent).not.toContain('Nested search marker');
    expect(doc.body.textContent).not.toContain('Embedded search marker');
    expect(heading(doc, 'ocr-read-aloud')).toMatch(/^2\./);
    expect(heading(doc, 'following')).toMatch(/^3\./);
    expect(heading(doc, 'fler-ocr-read-aloud')).toMatch(/^1\./);
    expect(heading(doc, 'fler-following')).toMatch(/^2\./);
  });

  it('gates read-aloud independently and applies the opt-in OCR master switch', () => {
    const speechOff = filterToDocument(OCR_HTML, {
      ocr: { enabled: true, speech: { enabled: false } },
    });
    expect(speechOff.getElementById('ocr-search')).not.toBeNull();
    expect(speechOff.getElementById('ocr-read-aloud')).toBeNull();
    expect(speechOff.getElementById('fler-ocr-read-aloud')).toBeNull();
    expect(speechOff.body.textContent).not.toContain('Speech-only marker');

    const ocrOff = filterToDocument(OCR_HTML, {
      ocr: { enabled: false, search: { enabled: true }, speech: { enabled: true } },
    });
    expect(ocrOff.getElementById('ocr-search')).toBeNull();
    expect(ocrOff.getElementById('ocr-read-aloud')).toBeNull();
    expect(ocrOff.getElementById('overview')).not.toBeNull();
    expect(ocrOff.getElementById('following')).not.toBeNull();
  });

  it('fails open for malformed child switches and unreadable config state', () => {
    const malformed = filterToDocument(OCR_HTML, {
      ocr: { enabled: true, search: { enabled: 'false' }, speech: { enabled: 0 } },
    });
    expect(malformed.getElementById('ocr-search')).not.toBeNull();
    expect(malformed.getElementById('ocr-read-aloud')).not.toBeNull();

    const unreadable = new Proxy({}, { get() { throw new Error('Unreadable host config'); } });
    const doc = filterToDocument(OCR_HTML, unreadable);
    expect(doc.getElementById('ocr-search')).not.toBeNull();
    expect(doc.getElementById('ocr-read-aloud')).not.toBeNull();
    expect(doc.getElementById('fler-ocr-search')).not.toBeNull();
  });

  it('removes a heading segment through the next equal-or-higher heading only', () => {
    const html = [
      '<div class="odv-manual"><h2 id="overview">1. Before</h2><p>Before</p>',
      '<h2 id="overlay">2. Overlay</h2><p>Remove me</p>',
      '<h3 id="overlay-child">Child</h3><p>Remove child</p><h4>Grandchild</h4><p>Remove grandchild</p>',
      '<h2 id="curtain">3. Curtain</h2><p>Keep curtain</p>',
      '<details class="embedded" id="guide-jamforelse"><summary>Guide</summary>',
      '<h2 id="jmf-overlay">1. Embedded overlay</h2><p>Remove embedded</p><h3>Nested</h3><p>Remove nested</p>',
      '</details><h2 id="following">4. After</h2><p>Keep following</p></div>',
    ].join('');
    const doc = filterToDocument(html, { compare: { overlay: { enabled: false } } });
    expect(doc.getElementById('overview')).not.toBeNull();
    expect(doc.getElementById('overlay')).toBeNull();
    expect(doc.getElementById('overlay-child')).toBeNull();
    expect(doc.getElementById('curtain')).not.toBeNull();
    expect(doc.getElementById('jmf-overlay')).toBeNull();
    expect(doc.getElementById('guide-jamforelse')).not.toBeNull();
    expect(doc.getElementById('following')).not.toBeNull();
    expect(doc.body.textContent).toContain('Keep curtain');
    expect(doc.body.textContent).toContain('Keep following');
    expect(doc.body.textContent).not.toContain('Remove grandchild');
  });

  it('decodes fragment targets before unlinking them and tolerates malformed escapes', () => {
    const html = [
      '<div class="odv-manual"><p><a href="#jmf-%6Fverlagring"><strong>Overlay cross-link</strong></a>',
      '<a href="#jmf-%E0%A4%A">Malformed escape</a></p>',
      '<details class="embedded"><summary>Compare</summary>',
      '<h2 id="jmf-overlay">1. Overlay</h2><p>Overlay body</p>',
      '<h2 id="jmf-curtain">2. Curtain</h2><p>Curtain body</p></details></div>',
    ].join('');
    const doc = filterToDocument(html, { compare: { overlay: { enabled: false } } });
    expect(fragmentLinks(doc, 'jmf-overlay')).toHaveLength(0);
    expect(doc.querySelector('p strong')?.textContent).toBe('Overlay cross-link');
    expect(doc.querySelector('a[href="#jmf-%E0%A4%A"]')).not.toBeNull();
    expect(doc.getElementById('jmf-curtain')).not.toBeNull();
  });
});
