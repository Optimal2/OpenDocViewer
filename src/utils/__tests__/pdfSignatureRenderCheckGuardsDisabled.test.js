/** @vitest-environment node */
// Proof that the pdf.js differential carries the safety on its own: every
// pdf-lib revision rule is DISABLED here (the classifier always answers
// "validation data only"), and every known attack must still be a warning,
// while every honest validation-data append stays green.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { collectPdfSignatures } from '../pdfSignatures.js';
import { getSignatureSeverity } from '../pdfSignatureStatus.js';
import { createSecurityFixtures } from '../../../scripts/signature-security-fixtures.mjs';
import { createMultiPageFixtures } from '../../../scripts/signature-revision-fixtures.mjs';
import { createFixturePki } from '../../../scripts/generate-signature-fixtures.mjs';
import { attackFiles, contentChangeFiles, honestFiles, invisibleChangeFiles } from './pdfSignatureRenderCheck.cases.js';

vi.mock('../pdfSignatureRevisions.js', async (importOriginal) => ({
  ...(await importOriginal()),
  classifyAppendedRevisions: () => ({
    integrity: 'intact', code: 'extended-with-validation-data', reason: 'pdf-lib revision guards disabled for this test'
  })
}));

const fixture = (name) => new Uint8Array(readFileSync(new URL(`../../../scripts/fixtures/${name}`, import.meta.url)));
let f;
let multi;
beforeAll(async () => {
  f = await createSecurityFixtures();
  multi = await createMultiPageFixtures(await createFixturePki(), 6);
}, 180000);

async function approval(bytes) {
  return (await collectPdfSignatures(bytes)).signatures.find((sig) => sig.kind === 'approval');
}

describe('pdf-lib guards disabled: the pdf.js differential alone', () => {
  it('the guards really are disabled', async () => {
    const { classifyAppendedRevisions } = await import('../pdfSignatureRevisions.js');
    expect(classifyAppendedRevisions(null, 0, null).reason).toMatch(/guards disabled/);
  });

  it.each([
    ...attackFiles.map((c) => [c.label, c.bytes]),
    ...contentChangeFiles
  ])('%s -> warning', async (_label, bytes) => {
    const sig = await approval(bytes(f, fixture, multi));
    expect([sig.integrity, sig.integrityCode]).toEqual(['modified-after-signing', 'content-changed-after-signing']);
    expect(sig.integrityReason).toMatch(/pdf\.js shows different content in the final file/);
    expect(getSignatureSeverity(sig)).toBe('warning');
  });

  // Documented limit: what pdf.js draws identically is green without the
  // pdf-lib rules; with them (production) these stay warnings.
  it.each(invisibleChangeFiles)('%s -> ok, nothing pdf.js draws changed', async (_label, bytes) => {
    const sig = await approval(bytes(f));
    expect([sig.integrity, sig.integrityCode]).toEqual(['intact', 'extended-with-validation-data']);
  });

  it.each(honestFiles.map((c) => [c.label, c.bytes]))('honest append %s -> ok', async (_label, bytes) => {
    const sig = await approval(bytes(f, fixture, multi));
    expect([sig.integrity, sig.integrityCode]).toEqual(['intact', 'extended-with-validation-data']);
    expect(getSignatureSeverity(sig)).toBe('ok');
  });
});
