/**
 * User help for the three compare views (fine-tune, overlay, curtain): the in-app help dialog
 * (HelpOverlayDialog.jsx) has an entry per view in English and Swedish, and the bundled
 * comparison guide (manual-jamforelse.<lng>.html) carries a section per view in its HTML
 * (standalone and embedded in manual.<lng>.html with the "jmf-" id prefix) and in its PDF.
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

const GUIDE = 'manual-jamforelse';
/** Id prefix embed.py gives the guide's ids when it is embedded in manual.<lng>.html. */
const EMBED_PREFIX = 'jmf-';

const SECTIONS = {
  sv: [
    { id: 'finjustera', heading: '3. Finjustera varje sida' },
    { id: 'overlagring', heading: '4. Lägg sidorna på varandra (överlagring)' },
    { id: 'gardin', heading: '5. Dra en gräns mellan sidorna (gardin)' },
  ],
  en: [
    { id: 'finetune', heading: '3. Fine-tune each page' },
    { id: 'overlay', heading: '4. Lay the pages on top of each other (overlay)' },
    { id: 'curtain', heading: '5. Drag a border between the pages (curtain)' },
  ],
};

/** Collapse whitespace so headings broken over PDF text items still match. */
const normalize = (text) => text.replace(/\s+/g, ' ').trim();

const PRINT_HELP = {
  en: ['Print the overlay view:', 'Print the curtain view:', 'one composed page', 'Print via PDF', 'Save PDF'],
  sv: ['Skriv ut överlagringsvyn:', 'Skriv ut gardinvyn:', 'en sammansatt sida', 'Skriv ut via PDF', 'Spara PDF'],
};
const COMPARE_KEYS = [
  'compare.overlay.enabled', 'compare.overlay.print.enabled',
  'compare.curtain.enabled', 'compare.curtain.print.enabled',
  'compare.adjust.toolbarMode', 'fineTune.enabled',
];

describe('help dialog entries for the compare views', () => {
  const source = readText('src/components/DocumentToolbar/HelpOverlayDialog.jsx');
  const locales = {
    en: JSON.parse(readText('public/locales/en/common.json')),
    sv: JSON.parse(readText('public/locales/sv/common.json')),
  };

  it.each(['fineTune', 'overlay', 'curtain', 'overlayPrint', 'curtainPrint'])('help.sections.compare.%s is used and translated', (key) => {
    expect(source).toContain(`t('help.sections.compare.${key}'`);
    const en = locales.en.help.sections.compare[key];
    const sv = locales.sv.help.sections.compare[key];
    expect(typeof en).toBe('string');
    expect(typeof sv).toBe('string');
    expect(sv).not.toBe(en);
  });

  it.each(['en', 'sv'])('%s: the fine-tune entry describes one panel with the three resets as labelled in the UI', (lng) => {
    const fineTune = locales[lng].help.sections.compare.fineTune;
    const panel = locales[lng].compareTransform;
    for (const label of [panel.resetAll, panel.resetLayout, panel.resetImage, panel.toggle]) {
      expect(fineTune).toContain(label);
    }
    expect(fineTune).toContain(lng === 'sv' ? '4,6° → 94,6°' : '4.6° → 94.6°');
    // The old wording described a bar for zoom, position and rotation only.
    expect(fineTune).not.toMatch(/Fine-tune bar|en rad Finjustera/);
  });

  it.each(['en', 'sv'])('%s: the adjustments entry qualifies the toolbar controls for compare.adjust.toolbarMode hide', (lng) => {
    const body = locales[lng].help.sections.adjustments.body;
    const toggle = locales[lng].compareTransform.toggle;
    expect(body).toContain("compare.adjust.toolbarMode: 'hide'");
    expect(body).toContain(toggle);
    expect(body).toContain(lng === 'sv' ? 'Utanför jämförelsevyn finns' : 'Outside compare mode,');
    // The old wording claimed the controls were always in the toolbar, also in compare mode.
    expect(body).not.toMatch(/are always available in the toolbar|finns alltid tillgängliga i verktygsfältet/);
    // The JSX fallback must match the English locale text.
    if (lng === 'en') expect(source).toContain(`defaultValue: ${JSON.stringify(body)}`);
  });

  it('the Swedish curtain entry names the toggle as shown in the UI', () => {
    expect(locales.sv.help.sections.compare.curtain).toContain('Horisontell');
    expect(locales.sv.help.sections.compare.curtain).toContain('Vertikal');
  });
});

describe('bundled comparison guide', () => {
  for (const [lng, sections] of Object.entries(SECTIONS)) {
    it(`${lng}: HTML has a section per compare view, also in the guide embedded in manual.${lng}.html`, () => {
      const guide = readText(`public/help/default/${GUIDE}.${lng}.html`);
      const main = readText(`public/help/default/manual.${lng}.html`);
      for (const { id, heading } of sections) {
        expect(guide).toContain(`<h2 id="${id}">${heading}</h2>`);
        expect(main).toContain(`<h2 id="${EMBED_PREFIX}${id}">${heading}</h2>`);
      }
    });

    it(`${lng}: both HTML guides explain composed printing and every site switch`, () => {
      for (const name of [GUIDE, 'manual']) {
        const html = readText(`public/help/default/${name}.${lng}.html`);
        for (const phrase of [...PRINT_HELP[lng], ...COMPARE_KEYS, 'odv.site.config.js']) {
          expect(html).toContain(phrase);
        }
      }
    });

    it(`${lng}: the "More features" guide no longer carries the compare sections`, () => {
      const more = readText(`public/help/default/manual-avancerat.${lng}.html`);
      for (const { heading } of sections) {
        expect(more).not.toContain(heading);
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
      it(`${lng}: ${GUIDE}.${lng}.pdf carries every compare section`, async () => {
        const text = await pdfText(`public/help/default/${GUIDE}.${lng}.pdf`);
        for (const { heading } of sections) {
          expect(text, heading).toContain(normalize(heading));
        }
        for (const phrase of [...PRINT_HELP[lng], ...COMPARE_KEYS, 'odv.site.config.js']) {
          expect(text).toContain(phrase);
        }
      }, 120000);
    }
  });
});
