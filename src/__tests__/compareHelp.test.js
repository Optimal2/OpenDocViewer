/**
 * User help for the three compare views (fine-tune, overlay, curtain): the in-app help dialog
 * (HelpOverlayDialog.jsx) has an entry per view in English and Swedish, and the bundled
 * "More features" guide carries a section per view in its HTML (standalone and embedded in
 * manual.<lng>.html) and in its PDF.
 *
 * @vitest-environment node
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFileSync(path.join(ROOT, relative));
const readText = (relative) => read(relative).toString('utf8');

const SECTIONS = {
  sv: [
    { id: 'jamforelse-finjustera', heading: 'Finjustera zoom, läge och rotation' },
    { id: 'jamforelse-overlagring', heading: 'Lägg sidorna på varandra (överlagring)' },
    { id: 'jamforelse-gardin', heading: 'Dra en gräns mellan sidorna (gardin)' },
  ],
  en: [
    { id: 'compare-finetune', heading: 'Fine-tune zoom, position and rotation' },
    { id: 'compare-overlay', heading: 'Lay the pages on top of each other (overlay)' },
    { id: 'compare-curtain', heading: 'Drag a border between the pages (curtain)' },
  ],
};

/** Collapse whitespace so headings broken over PDF text items still match. */
const normalize = (text) => text.replace(/\s+/g, ' ').trim();

describe('help dialog entries for the compare views', () => {
  const source = readText('src/components/DocumentToolbar/HelpOverlayDialog.jsx');
  const locales = {
    en: JSON.parse(readText('public/locales/en/common.json')),
    sv: JSON.parse(readText('public/locales/sv/common.json')),
  };

  it.each(['fineTune', 'overlay', 'curtain'])('help.sections.compare.%s is used and translated', (key) => {
    expect(source).toContain(`t('help.sections.compare.${key}'`);
    const en = locales.en.help.sections.compare[key];
    const sv = locales.sv.help.sections.compare[key];
    expect(typeof en).toBe('string');
    expect(typeof sv).toBe('string');
    expect(sv).not.toBe(en);
  });

  it('the Swedish curtain entry names the toggle as shown in the UI', () => {
    expect(locales.sv.help.sections.compare.curtain).toContain('Horisontell');
    expect(locales.sv.help.sections.compare.curtain).toContain('Vertikal');
  });
});

describe('bundled "More features" guide', () => {
  for (const [lng, sections] of Object.entries(SECTIONS)) {
    it(`${lng}: HTML has a section per compare view, also in the guide embedded in manual.${lng}.html`, () => {
      const guide = readText(`public/help/default/manual-avancerat.${lng}.html`);
      const main = readText(`public/help/default/manual.${lng}.html`);
      for (const { id, heading } of sections) {
        expect(guide).toContain(`<h3 id="${id}">${heading}</h3>`);
        expect(main).toContain(`<h3 id="fler-${id}">${heading}</h3>`);
      }
    });
  }

  describe('PDF', () => {
    let pdfjs;
    beforeAll(async () => {
      pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    }, 120000);

    /** @param {string} relative @returns {Promise<string>} */
    async function pdfText(relative) {
      const task = pdfjs.getDocument({ data: new Uint8Array(read(relative)), isEvalSupported: false });
      try {
        const doc = await task.promise;
        const parts = [];
        for (let number = 1; number <= doc.numPages; number += 1) {
          const page = await doc.getPage(number);
          const content = await page.getTextContent();
          parts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
        }
        return normalize(parts.join(' '));
      } finally {
        await task.destroy();
      }
    }

    for (const [lng, sections] of Object.entries(SECTIONS)) {
      it(`${lng}: manual-avancerat.${lng}.pdf carries every compare section`, async () => {
        const text = await pdfText(`public/help/default/manual-avancerat.${lng}.pdf`);
        for (const { heading } of sections) {
          expect(text, heading).toContain(normalize(heading));
        }
      }, 120000);
    }
  });
});
