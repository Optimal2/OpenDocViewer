/** @vitest-environment node */
// pdf.js differential confirmation (docs-src/pdf-signatures.md "pdf.js
// differential confirmation"). Synthetic fixtures only:
// scripts/signature-security-fixtures.mjs, scripts/signature-revision-fixtures.mjs
// and the committed regression files in scripts/fixtures/.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { collectPdfSignatures } from '../pdfSignatures.js';
import { getSignatureSeverity } from '../pdfSignatureStatus.js';
import { createRenderComparator, renderCheckVerdict } from '../pdfSignatureRenderCheck.js';
import { hasEscapedSecurityKey } from '../pdfSignatureRevisions.js';
import { createSecurityFixtures, byteRange } from '../../../scripts/signature-security-fixtures.mjs';
import { createMultiPageFixtures } from '../../../scripts/signature-revision-fixtures.mjs';
import { createFixturePki } from '../../../scripts/generate-signature-fixtures.mjs';
import { attackFiles, honestFiles, invisibleChangeFiles } from './pdfSignatureRenderCheck.cases.js';

const fixture = (name) => new Uint8Array(readFileSync(new URL(`../../../scripts/fixtures/${name}`, import.meta.url)));
const signedEnd = (bytes) => { const br = byteRange(bytes); return br[2] + br[3]; };

let f;
let multi;
beforeAll(async () => {
  f = await createSecurityFixtures();
  multi = await createMultiPageFixtures(await createFixturePki(), 6);
}, 180000);

async function approval(bytes, options) {
  const report = await collectPdfSignatures(bytes, options);
  return report.signatures.find((sig) => sig.kind === 'approval');
}
async function compare(bytes) {
  const comparator = createRenderComparator(bytes);
  try { return await comparator.compare(signedEnd(bytes)); } finally { await comparator.destroy(); }
}

let pdfjs;
beforeAll(async () => { pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); });
/** All text pdf.js extracts, the way the viewer resolves the file. */
async function pdfjsText(bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false });
  try {
    const doc = await task.promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      text += (await (await doc.getPage(i)).getTextContent()).items.map((item) => item.str).join('');
    }
    return text;
  } finally { await task.destroy(); }
}

describe('known attacks: classifier warning AND pdf.js shows the changed text', () => {
  it.each(attackFiles.map((c) => [c.label, c]))('%s', async (_label, c) => {
    const bytes = c.bytes(f, fixture, multi);
    // Measurement 1: the full pipeline (pdf-lib rules + differential) is never green.
    const sig = await approval(bytes);
    expect(sig.integrity).toBe('modified-after-signing');
    expect(getSignatureSeverity(sig)).toBe('warning');
    // Measurement 2: pdf.js draws the change in the final file, not in the signed revision.
    expect(await pdfjsText(bytes)).toMatch(c.marker);
    expect(await pdfjsText(bytes.slice(0, signedEnd(bytes)))).not.toMatch(c.marker);
    // The differential on its own sees the change too.
    const check = await compare(bytes);
    expect(check.outcome).toBe('different');
    expect(renderCheckVerdict(check)).toMatchObject({ integrity: 'modified-after-signing', code: 'content-changed-after-signing' });
  });
});

it('replaced image data behind unchanged drawing operators: the classifier warns and pdf.js sees other pixels', async () => {
  expect((await approval(multi.imageChanged)).integrity).toBe('modified-after-signing');
  expect(await compare(multi.imageChanged)).toMatchObject({ outcome: 'different', detail: 'page 1 operator list' });
});

describe('honest validation-data appends stay green after the pdf.js comparison', () => {
  it.each(honestFiles.map((c) => [c.label, c]))('%s', async (_label, c) => {
    const bytes = c.bytes(f, fixture, multi);
    expect((await compare(bytes)).outcome).toBe('same');
    const sig = await approval(bytes);
    expect([sig.integrity, sig.integrityCode]).toEqual(['intact', 'extended-with-validation-data']);
    expect(sig.integrityReason).toMatch(/pdf\.js shows the same document as the signed revision/);
    expect(getSignatureSeverity(sig, { uncheckedSeverity: 'warning' })).toBe('ok');
  });

  it.each(invisibleChangeFiles)('%s: pdf.js draws the same document, the classifier still warns', async (_label, get) => {
    const bytes = get(f);
    expect((await compare(bytes)).outcome).toBe('same');
    expect(await pdfjsText(bytes)).toBe(await pdfjsText(bytes.slice(0, signedEnd(bytes))));
    const sig = await approval(bytes);
    expect([sig.integrity, sig.integrityCode]).toEqual(['modified-after-signing', 'content-changed-after-signing']);
  });
});

describe('fail closed: no complete pdf.js comparison -> not green, neutral information', () => {
  const expectNotChecked = (sig, code) => {
    expect([sig.integrity, sig.integrityCode]).toEqual(['indeterminate', code]);
    expect(getSignatureSeverity(sig)).toBe('warning');
    expect(getSignatureSeverity(sig, { uncheckedSeverity: 'ok' })).toBe('warning');
    expect(sig.integrityReason).toMatch(/pdf\.js comparison with the signed revision could not be completed/);
  };

  it('pdf.js cannot be loaded -> viewer-error', async () => {
    const loadPdfjs = () => Promise.reject(new Error('chunk failed'));
    expectNotChecked(await approval(f.revisions.okDss, { renderCheck: { loadPdfjs } }), 'viewer-error');
  });

  it('pdf.js cannot load a revision -> viewer-error', async () => {
    const loadPdfjs = async () => ({
      getDocument: () => ({ promise: Promise.reject(new Error('Invalid PDF structure')), destroy: async () => {} })
    });
    expectNotChecked(await approval(f.revisions.okDss, { renderCheck: { loadPdfjs } }), 'viewer-error');
  });

  it('pdf.js throws while comparing -> viewer-error', async () => {
    const real = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadPdfjs = async () => ({
      ...real,
      getDocument: (params) => {
        const task = real.getDocument(params);
        return { destroy: () => task.destroy(),
          promise: task.promise.then((doc) => new Proxy(doc, {
            get: (target, key) => (key === 'getPage' ? () => Promise.reject(new Error('page failed')) : Reflect.get(target, key))
          })) };
      }
    });
    expectNotChecked(await approval(f.revisions.okDss, { renderCheck: { loadPdfjs } }), 'viewer-error');
  });

  it('the time budget is exceeded -> timeout', async () => {
    const loadPdfjs = () => new Promise(() => {});
    expectNotChecked(await approval(f.revisions.okDss, { renderCheck: { loadPdfjs, budget: { startupMs: 50 } } }), 'timeout');
  });

  it('the page budget is exceeded -> inspection-limit', async () => {
    expectNotChecked(await approval(multi.dss, { renderCheck: { maxPages: 5 } }), 'inspection-limit');
  });

  it('a signed range that does not end inside the file is never "same"', async () => {
    const comparator = createRenderComparator(f.revisions.okDss);
    expect((await comparator.compare(f.revisions.okDss.length)).outcome).toBe('unavailable');
    await comparator.destroy();
  });

  it('renderCheckVerdict: only "same" keeps the green verdict; unknown results fail closed', () => {
    expect(renderCheckVerdict({ outcome: 'same', detail: '' })).toBeNull();
    expect(renderCheckVerdict(undefined)).toMatchObject({ integrity: 'indeterminate', code: 'viewer-error' });
    expect(renderCheckVerdict({ outcome: 'unavailable', code: 'bogus' })).toMatchObject({ code: 'viewer-error' });
  });
});

describe('escaped security keys (keys only, every dictionary)', () => {
  const raw = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
  it.each([
    ['an escaped /Root key in a trailer', '<< /Size 42 /Root 1 0 R /R#6fot 30 0 R /Prev 17450 >>', true],
    ['a lowercase-escaped /L key', '<< /Linearized 1 /L 100 /#4c 9999 >>', true],
    ['an uppercase-escaped /Prev key after a reference value', '<< /Root 1 0 R /#50rev 10 >>', true],
    ['an escaped key in a nested dictionary', '<< /A << /B 1 /Lengt#68 5 >> >>', true],
    ['an escaped key after a number value', '<< /Foo 1 /#4c 5 >>', true],
    ['an unrelated escaped key next to a Line annotation /L key', '<< /Subtype /Line /L [0 0 100 100] /My#20Key 1 >>', false],
    ['/L as a value in a nested dictionary next to an escaped key', '<< /Inner << /S /L >> /My#20Key 1 >>', false],
    ['an escaped security name used as a value', '<< /S /#4c /T [/R#6fot] >>', false],
    ['escapes inside strings, comments and stream data', '<< /T (/#4c 1) /U <2F4C> % /#4c 1\n /V 1 >>\nstream\n<< /#4c 9 >>', false]
  ])('%s', (_label, source, expected) => {
    expect(hasEscapedSecurityKey(raw(source))).toBe(expected);
  });

  it.each([
    ['an escaped name next to a Line-annotation /L key', 'dss-escaped-name-with-line-key.pdf'],
    ['an escaped name next to /L as a nested value', 'dss-escaped-name-with-nested-l-value.pdf']
  ])('round-7 false warning fixed: %s -> ok with information', async (_label, name) => {
    const sig = await approval(fixture(name));
    expect([sig.integrity, sig.integrityCode]).toEqual(['intact', 'extended-with-validation-data']);
  });

  it('the escaped /Root trailer key fails closed in the classifier', async () => {
    expect((await approval(fixture('attack-escaped-root-key.pdf'))).integrityReason).toMatch(/spelled with #-escapes/);
  });

  it('a startxref inside appended stream data fails closed in the classifier', async () => {
    expect((await approval(fixture('attack-startxref-in-stream-data.pdf'))).integrityReason).toMatch(/startxref keyword after the signed range/);
  });
});
