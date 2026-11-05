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
const advancedSv = readFileSync(path.resolve('public/help/default/manual-avancerat.sv.html'), 'utf8');
const advancedEn = readFileSync(path.resolve('public/help/default/manual-avancerat.en.html'), 'utf8');
const selectionSv = readFileSync(path.resolve('public/help/default/manual-urval.sv.html'), 'utf8');
const selectionEn = readFileSync(path.resolve('public/help/default/manual-urval.en.html'), 'utf8');

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

describe('standard manual authored navigation cleanup', () => {
  it.each([
    ['Swedish', manualSv, 'jmf-overlagring', 'Lägg sidorna på varandra (överlagring)'],
    ['English', manualEn, 'jmf-overlay', 'Lay the pages on top of each other (overlay)'],
  ])('removes the hidden %s section title from searchable text and authored contents', (_label, html, id, title) => {
    const disabled = filterToDocument(html, { compare: { overlay: { enabled: false } } });
    expect(disabled.getElementById(id)).toBeNull();
    expect(disabled.body.textContent).not.toContain(title);
    for (const nav of disabled.querySelectorAll('nav.sidonav, nav.toc')) {
      expect(nav.textContent).not.toContain(title);
    }

    const enabled = filterToDocument(html, { compare: { overlay: { enabled: true } } });
    expect(enabled.getElementById(id)).not.toBeNull();
    expect(enabled.body.textContent).toContain(title);
    expect(Array.from(enabled.querySelectorAll('nav.sidonav, nav.toc'))
      .some((nav) => nav.textContent.includes(title))).toBe(true);
  });

  it.each([
    ['Swedish combined', manualSv, 'jmf-avstangt', 'Det här kan din organisation ha stängt av'],
    ['English combined', manualEn, 'jmf-disabled', 'What your organization may have switched off'],
    ['Swedish standalone', compareSv, 'avstangt', 'Det här kan din organisation ha stängt av'],
    ['English standalone', compareEn, 'disabled', 'What your organization may have switched off'],
  ])('removes the never-show %s title from authored contents without deleting prose', (_label, html, id, title) => {
    const doc = filterToDocument(html);
    expect(doc.getElementById(id)).toBeNull();
    for (const nav of doc.querySelectorAll('nav.sidonav, nav.toc')) {
      expect(nav.textContent).not.toContain(title);
    }
    expect(doc.body.textContent).toContain(title);
  });

  it('removes navigation entries and wrapper items but preserves ordinary prose cross-link text', () => {
    const title = 'Lay the pages on top of each other (overlay)';
    const html = [
      '<div class="odv-manual"><nav class="sidonav"><ol>',
      `<li id="overlay-nav-item"><a href="#overlay">4. ${title}</a></li>`,
      '<li><a href="#curtain">5. Curtain</a></li></ol></nav>',
      `<nav class="toc"><a href="#overlay">4. ${title}</a><a href="#curtain">5. Curtain</a></nav>`,
      '<p>Ordinary <a href="#overlay"><strong>overlay cross-link text</strong></a> survives.</p>',
      `<h2 id="overlay">4. ${title}</h2><p>Hidden section body</p>`,
      '<h2 id="curtain">5. Curtain</h2><p>Visible curtain body</p></div>',
    ].join('');
    const doc = filterToDocument(html, { compare: { overlay: { enabled: false } } });

    expect(doc.getElementById('overlay-nav-item')).toBeNull();
    expect(doc.body.textContent).not.toContain(title);
    expect(doc.querySelector('p strong')?.textContent).toBe('overlay cross-link text');
    expect(fragmentLinks(doc, 'overlay')).toHaveLength(0);
    expect(doc.getElementById('curtain')).not.toBeNull();
  });
});

describe('standard manual metadata and signature capability sections', () => {
  it.each([
    ['Swedish combined', manualSv, 'fler-metadata', 'fler-signaturer', 'fler-hq',
      'Se dokumentets metadata', 'Kontrollera signaturer i PDF-dokument'],
    ['English combined', manualEn, 'fler-metadata', 'fler-signatures', 'fler-hq',
      "View the document's metadata", 'Check signatures in PDF documents'],
    ['Swedish standalone', advancedSv, 'metadata', 'signaturer', 'hq',
      'Se dokumentets metadata', 'Kontrollera signaturer i PDF-dokument'],
    ['English standalone', advancedEn, 'metadata', 'signatures', 'hq',
      "View the document's metadata", 'Check signatures in PDF documents'],
  ])('removes disabled %s capability segments, contents and links while preserving unrelated help',
    (_label, html, metadataId, signatureId, unrelatedId, metadataTitle, signatureTitle) => {
      const doc = filterToDocument(html, {
        metadata: { enabled: false },
        pdfSignatures: { enabled: false },
      });

      expect(doc.getElementById(metadataId)).toBeNull();
      expect(doc.getElementById(signatureId)).toBeNull();
      expect(doc.getElementById(unrelatedId)).not.toBeNull();
      expect(fragmentLinks(doc, metadataId)).toHaveLength(0);
      expect(fragmentLinks(doc, signatureId)).toHaveLength(0);
      for (const nav of doc.querySelectorAll('nav.sidonav, nav.toc')) {
        expect(nav.textContent).not.toContain(metadataTitle);
        expect(nav.textContent).not.toContain(signatureTitle);
      }
    });

  it('gates metadata and PDF signatures independently and keeps enabled sections', () => {
    const metadataOff = filterToDocument(manualEn, { metadata: { enabled: false } });
    expect(metadataOff.getElementById('fler-metadata')).toBeNull();
    expect(metadataOff.getElementById('fler-signatures')).not.toBeNull();

    const signaturesOff = filterToDocument(manualEn, { pdfSignatures: { enabled: false } });
    expect(signaturesOff.getElementById('fler-metadata')).not.toBeNull();
    expect(signaturesOff.getElementById('fler-signatures')).toBeNull();

    const enabled = filterToDocument(advancedEn, {
      metadata: { enabled: true },
      pdfSignatures: { enabled: true },
    });
    expect(enabled.getElementById('metadata')).not.toBeNull();
    expect(enabled.getElementById('signatures')).not.toBeNull();
  });

  it('fails open for malformed and unreadable metadata/signature configuration', () => {
    const malformed = filterToDocument(advancedEn, {
      metadata: { enabled: 'false' },
      pdfSignatures: { enabled: 0 },
    });
    expect(malformed.getElementById('metadata')).not.toBeNull();
    expect(malformed.getElementById('signatures')).not.toBeNull();

    const unreadable = new Proxy({}, { get() { throw new Error('Unreadable host config'); } });
    const doc = filterToDocument(advancedEn, unreadable);
    expect(doc.getElementById('metadata')).not.toBeNull();
    expect(doc.getElementById('signatures')).not.toBeNull();
  });

  it('requires the real capability aliases without inventing required OCR section ids', async () => {
    const { standardManualLogicalRules } = await import('../standardManualRules.js');
    expect(Array.isArray(standardManualLogicalRules)).toBe(true);
    const states = standardManualLogicalRules.map((rule) => rule.state);
    expect(states).toEqual(expect.arrayContaining(['metadata', 'pdfSignatures']));
    const ids = standardManualLogicalRules.flatMap((rule) => (
      Object.values(rule.documents).flatMap((documents) => documents.map((document) => document.id))
    ));
    expect(ids).toEqual(expect.arrayContaining(['metadata', 'signaturer', 'signatures', 'fler-signaturer']));
    expect(ids.some((id) => id.includes('ocr'))).toBe(false);
  });
});

describe('standard manual selection workspace capability', () => {
  it.each([
    ['Swedish standalone', selectionSv,
      ['oppna', 'laggtill', 'ordning', 'forhandsvisa', 'spara'],
      [['tabort', 'Ta bort sidor ur urvalet'], ['aktivt', 'Så ser du att ett urval är aktivt'],
        ['skrivut', 'Skriv ut urvalet'], ['aterstall', 'Ta bort urvalet']],
      'Öppna urvalsarbetsytan', 'Dölj denna sida', 'Från arbetsytan:'],
    ['English standalone', selectionEn,
      ['open', 'add', 'order', 'preview', 'save'],
      [['remove', 'Remove pages from the selection'], ['active', 'How to tell that a selection is active'],
        ['print', 'Print the selection'], ['reset', 'Remove the selection']],
      'Open the selection workspace', 'Hide this page', 'From the workspace:'],
    ['Swedish embedded', manualSv,
      ['urval-oppna', 'urval-laggtill', 'urval-ordning', 'urval-forhandsvisa', 'urval-spara'],
      [['urval-tabort', 'Ta bort sidor ur urvalet'], ['urval-aktivt', 'Så ser du att ett urval är aktivt'],
        ['urval-skrivut', 'Skriv ut urvalet'], ['urval-aterstall', 'Ta bort urvalet']],
      'Öppna urvalsarbetsytan', 'Dölj denna sida', 'Från arbetsytan:'],
    ['English embedded', manualEn,
      ['urval-open', 'urval-add', 'urval-order', 'urval-preview', 'urval-save'],
      [['urval-remove', 'Remove pages from the selection'], ['urval-active', 'How to tell that a selection is active'],
        ['urval-print', 'Print the selection'], ['urval-reset', 'Remove the selection']],
      'Open the selection workspace', 'Hide this page', 'From the workspace:'],
  ])('removes only workspace-specific %s help when the workspace is switched off',
    (_label, html, removedIds, remainingSections, openingTitle, ordinaryHideText, workspaceResetText) => {
      const doc = filterToDocument(html, { print: { selectionWorkspace: { enabled: false } } });

      for (const id of removedIds) {
        expect(doc.getElementById(id)).toBeNull();
        expect(fragmentLinks(doc, id)).toHaveLength(0);
      }
      remainingSections.forEach(([id, title], index) => {
        const preservedHeading = doc.getElementById(id) || Array.from(doc.querySelectorAll('h2'))
          .find((candidate) => candidate.textContent.includes(title));
        expect(preservedHeading, title).not.toBeUndefined();
        expect(preservedHeading?.textContent).toMatch(new RegExp(`^${index + 1}\\.`));
      });
      expect(doc.getElementById('lb-urval-oversikt')).toBeNull();
      expect(doc.getElementById('lb-urval-verktygsfalt')).toBeNull();
      expect(doc.getElementById('lb-urval-forhandsvisning')).toBeNull();
      expect(doc.getElementById('lb-huvudvy-efter-urval')).not.toBeNull();
      expect(doc.getElementById('lb-panel-efter-urval')).not.toBeNull();
      expect(doc.querySelector('a[href="#lb-miniatyr-hogerklick"]')).not.toBeNull();
      expect(doc.querySelector('a[href="#lb-sida-hogerklick"]')).not.toBeNull();
      expect(doc.body.textContent).toContain(ordinaryHideText);
      expect(doc.body.textContent).toContain('Delete');
      expect(doc.body.textContent).not.toContain(workspaceResetText);
      for (const nav of doc.querySelectorAll('nav.sidonav, nav.toc')) {
        expect(nav.textContent).not.toContain(openingTitle);
      }
    });

  it('keeps every selection guide section when the workspace is enabled, malformed or unreadable', () => {
    for (const config of [
      { print: { selectionWorkspace: { enabled: true } } },
      { print: { selectionWorkspace: { enabled: 'false' } } },
      new Proxy({}, { get() { throw new Error('Unreadable host config'); } }),
    ]) {
      const doc = filterToDocument(selectionEn, config);
      for (const title of [
        'Open the selection workspace', 'Remove pages from the selection', 'Add pages back to the selection',
        'Change the order', 'Preview a page in the workspace', 'Save the selection or leave the workspace',
        'How to tell that a selection is active', 'Print the selection', 'Remove the selection',
      ]) {
        expect(Array.from(doc.querySelectorAll('h2')).some((candidate) => (
          candidate.textContent.includes(title)
        )), title).toBe(true);
      }
    }
  });

  it('requires the real per-language selection aliases in the logical manifest', async () => {
    const { standardManualLogicalRules } = await import('../standardManualRules.js');
    const selectionRules = standardManualLogicalRules.filter((rule) => rule.state === 'selectionWorkspace');
    const ids = selectionRules.flatMap((rule) => (
      Object.values(rule.documents).flatMap((documents) => documents.map((document) => document.id))
    ));
    expect(ids).toEqual(expect.arrayContaining([
      'oppna', 'urval-oppna', 'open', 'urval-open',
      'tabort', 'urval-tabort', 'remove', 'urval-remove',
      'aterstall', 'urval-aterstall', 'reset', 'urval-reset',
    ]));
  });
});

describe('standard manual print action capability blocks', () => {
  const printEnabled = {
    print: {
      pdf: {
        enabled: true,
        allowDownload: true,
        orientation: { enabled: true, showOption: true },
      },
      actions: {
        printHtml: { enabled: true },
        printPdf: { enabled: true },
        downloadPdf: { enabled: true },
        reuseLastPrintSettings: { enabled: true },
      },
    },
  };

  it.each([
    ['Swedish', manualSv, 'utskrift', 'Skillnaden mellan de två knapparna:', 'Fortsätt jobba',
      'Återanvänd senaste utskriftsval', 'Automatisk sidorientering'],
    ['English', manualEn, 'printing', 'The difference between the two buttons:', 'Continue working',
      'Reuse latest print settings', 'Automatic page orientation'],
  ])('removes PDF-only %s blocks without removing ordinary printing help',
    (_label, html, printingId, differenceText, continueText, reuseText, orientationText) => {
      const doc = filterToDocument(html, {
        print: { pdf: { enabled: false }, actions: { printHtml: { enabled: true } } },
      });

      expect(doc.getElementById(printingId)).not.toBeNull();
      expect(doc.getElementById('lb-utskrift-aktiv-sida')).not.toBeNull();
      expect(doc.getElementById('lb-utskrift-forbereds')).toBeNull();
      expect(fragmentLinks(doc, 'lb-utskrift-forbereds')).toHaveLength(0);
      expect(doc.body.textContent).not.toContain(differenceText);
      expect(doc.body.textContent).not.toContain(continueText);
      expect(doc.body.textContent).not.toContain(reuseText);
      expect(doc.body.textContent).not.toContain(orientationText);
      expect(doc.body.textContent).toContain('HTML');
    });

  it.each([
    ['Swedish', 'utskrift', 'Fortsätt jobba', 'Skillnaden mellan de två knapparna:'],
    ['English', 'printing', 'Continue working', 'The difference between the two buttons:'],
  ])('scopes print-action removal to the declared %s print segment and its nested headings',
    (_label, printId, continueText, differenceText) => {
      const html = [
        '<div class="odv-manual">',
        `<h2 id="before">Before</h2><ul><li id="before-print">${continueText} before printing.</li></ul>`,
        `<h2 id="${printId}">1. Print</h2><p id="print-difference">${differenceText}</p>`,
        `<ul><li id="print-step">${continueText} while the PDF is prepared.</li></ul>`,
        `<h3 id="print-options">PDF options</h3><ul><li id="nested-print-step">${continueText} with nested options.</li></ul>`,
        `<h2 id="unrelated">2. Another feature</h2><ul><li id="unrelated-step">${continueText} with your selection.</li></ul>`,
        '<details class="embedded" id="guide-next"><summary>Next guide</summary>',
        `<h2 id="next-guide-heading">1. Next guide</h2><ul><li id="next-guide-step">${continueText} in the next guide.</li></ul>`,
        '</details></div>',
      ].join('');
      const doc = filterToDocument(html, { print: { pdf: { enabled: false } } });

      expect(doc.getElementById('print-difference')).toBeNull();
      expect(doc.getElementById('print-step')).toBeNull();
      expect(doc.getElementById('nested-print-step')).toBeNull();
      expect(doc.getElementById('before-print')).not.toBeNull();
      expect(doc.getElementById('unrelated-step')).not.toBeNull();
      expect(doc.getElementById('next-guide-step')).not.toBeNull();
      expect(doc.getElementById('guide-next')).not.toBeNull();
    });

  it('preserves same-prefix help when the document has no declared print heading', () => {
    const html = [
      '<div class="odv-manual"><h2 id="overview">Overview</h2>',
      '<p id="difference">The difference between the two buttons: unrelated explanation</p>',
      '<ul><li id="continue">Continue working with your selection.</li></ul></div>',
    ].join('');
    const doc = filterToDocument(html, { print: { pdf: { enabled: false } } });

    expect(doc.getElementById('difference')).not.toBeNull();
    expect(doc.getElementById('continue')).not.toBeNull();
  });

  it('keeps all print blocks when both actions and their PDF options are available', () => {
    const doc = filterToDocument(manualEn, printEnabled);
    expect(doc.body.textContent).toContain('The difference between the two buttons:');
    expect(doc.getElementById('lb-utskrift-forbereds')).not.toBeNull();
    expect(doc.body.textContent).toContain('Continue working');
    expect(doc.body.textContent).toContain('Reuse latest print settings');
    expect(doc.body.textContent).toContain('Automatic page orientation');
  });

  it('removes the mixed backend paragraph when HTML printing is disabled but retains PDF help', () => {
    const doc = filterToDocument(manualEn, {
      print: { pdf: { enabled: true }, actions: { printHtml: { enabled: false } } },
    });
    expect(doc.body.textContent).not.toContain('The difference between the two buttons:');
    expect(doc.getElementById('lb-utskrift-forbereds')).not.toBeNull();
  });

  it('gates the reuse and orientation items with the same predicates as the print dialog', () => {
    const reuseOff = filterToDocument(manualEn, {
      print: {
        pdf: { enabled: true, orientation: { enabled: true, showOption: true } },
        actions: { reuseLastPrintSettings: { enabled: false } },
      },
    });
    expect(reuseOff.body.textContent).not.toContain('Reuse latest print settings');
    expect(reuseOff.body.textContent).toContain('Continue working');
    expect(reuseOff.body.textContent).toContain('Automatic page orientation');

    const orientationOff = filterToDocument(manualEn, {
      print: { pdf: { enabled: true, orientation: { enabled: true, showOption: false } } },
    });
    expect(orientationOff.body.textContent).not.toContain('Automatic page orientation');
    expect(orientationOff.body.textContent).toContain('Continue working');
    expect(orientationOff.body.textContent).toContain('Reuse latest print settings');
  });

  it('fails open for unreadable print configuration', () => {
    const unreadable = new Proxy({}, { get() { throw new Error('Unreadable host config'); } });
    const doc = filterToDocument(manualEn, unreadable);
    expect(doc.body.textContent).toContain('The difference between the two buttons:');
    expect(doc.getElementById('lb-utskrift-forbereds')).not.toBeNull();
    expect(doc.body.textContent).toContain('Reuse latest print settings');
  });
});
