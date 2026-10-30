/** @vitest-environment node */
// Appended-revision classifier (docs-src/pdf-signatures.md "Appended revisions").
// Synthetic fixtures only: scripts/signature-revision-fixtures.mjs.
import { beforeAll, describe, expect, it } from 'vitest';
import * as pdfLib from 'pdf-lib';
import { collectPdfSignatures } from '../pdfSignatures.js';
import { getSignatureSeverity } from '../pdfSignatureStatus.js';
import {
  classifyAppendedRevisions, createRevisionLog, decodeXrefStream, installRevisionLogHooks
} from '../pdfSignatureRevisions.js';
import { createSecurityFixtures, byteRange } from '../../../scripts/signature-security-fixtures.mjs';

let f;
let r;
beforeAll(async () => { f = await createSecurityFixtures(); r = f.revisions; }, 120000);

async function signatures(bytes) {
  const report = await collectPdfSignatures(bytes);
  expect(report.signatures.length).toBeGreaterThan(0);
  return report.signatures;
}
/** The approval signature (fixtures with an unverifiable timestamp may order it second). */
async function approval(bytes) {
  return (await signatures(bytes)).find((sig) => sig.kind === 'approval');
}
function expectStatus(sig, integrity, code, severity) {
  expect([sig.integrity, sig.integrityCode]).toEqual([integrity, code]);
  expect(getSignatureSeverity(sig)).toBe(severity);
  expect(getSignatureSeverity(sig, { uncheckedSeverity: 'warning' })).toBe(severity);
}

describe('appended revisions with validation data or metadata only -> ok with information', () => {
  it.each([
    ['DSS/VRI', 'okDss'],
    ['/Info only', 'okInfo'],
    ['XMP /Metadata only', 'okMetadata'],
    ['xref/trailer rewrite with a byte-identical object', 'okXrefOnly'],
    ['DSS/VRI, xref stream tail', 'okDssXrefStream'],
    ['DSS/VRI, Flate + PNG predictor xref stream tail', 'okDssXrefStreamCompressed'],
    ['DSS/VRI inside an object stream (type-2 entries)', 'okDssObjectStream'],
    ['/Info only, xref stream tail', 'okInfoXrefStream'],
    ['XMP /Metadata only, xref stream tail', 'okMetadataXrefStream'],
    ['byte-identical rewrite, xref stream tail', 'okXrefOnlyXrefStream'],
    ['a change reverted byte for byte by a later revision (net comparison)', 'okRevertedChange']
  ])('%s', async (_label, name) => {
    const [sig] = await signatures(r[name]);
    expectStatus(sig, 'intact', 'extended-with-validation-data', 'ok');
    expect(sig.coversWholeFile).toBe(false);
    expect(sig.integrityReason).toMatch(/validation data\/metadata only/);
  });

  it('a document timestamp covering the tail keeps the later-signature branch unchanged', async () => {
    const [approval, timestamp] = await signatures(r.okDocTimestamp);
    expectStatus(approval, 'intact', 'extended-by-later-signature', 'ok');
    expectStatus(timestamp, 'intact', null, 'ok');
    expect(timestamp.kind).toBe('timestamp');
  });

  it('document timestamp then DSS: both signatures stay green with the information line', async () => {
    const [approval, timestamp] = await signatures(r.okDocTimestampThenDss);
    expectStatus(approval, 'intact', 'extended-with-validation-data', 'ok');
    expectStatus(timestamp, 'intact', 'extended-with-validation-data', 'ok');
  });

  it('an invisible document timestamp field is validation data even when the timestamp itself fails', async () => {
    const sigs = await signatures(r.okUnverifiedDocTimestamp);
    expectStatus(sigs.find((sig) => sig.kind === 'approval'), 'intact', 'extended-with-validation-data', 'ok');
    expect(sigs.find((sig) => sig.kind === 'timestamp').integrity).toBe('unreadable');
  });
});

describe('appended revisions that change content -> warning', () => {
  it.each([
    ['adds an annotation', 'annotation'],
    ['adds an annotation (xref stream tail)', 'annotationXrefStream'],
    ['replaces the page content stream', 'pageContent'],
    ['replaces the page content stream (compressed xref stream tail)', 'pageContentXrefStream'],
    ['changes a page entry (/MediaBox)', 'pageKey'],
    ['changes a form field value', 'fieldValue'],
    ['adds catalog /OpenAction', 'openAction'],
    ['sets AcroForm /NeedAppearances', 'needAppearances'],
    ['adds a visible timestamp widget', 'visibleTimestampWidget'],
    ['adds a timestamp widget with an appearance stream', 'timestampWidgetWithAppearance'],
    ['changes an object shared by /DSS and the page content', 'dssSharedWithContent'],
    ['a second unsigned revision adds an annotation after a DSS revision', 'laterRevisionAddsAnnotation'],
    ['fills in a reference that dangled at signing time', 'danglingReferenceFilled'],
    ['deletes a live object with an f entry', 'freeLiveObject'],
    ['deletes a live object with a type-0 xref stream entry', 'freeLiveObjectXrefStream']
  ])('%s', async (_label, name) => {
    expectStatus(await approval(r[name]), 'modified-after-signing', 'content-changed-after-signing', 'warning');
  });

  it('existing negatives stay non-green: maliciousLater and fakeLater', async () => {
    for (const bytes of [f.maliciousLater, f.fakeLater]) {
      const [sig] = await signatures(bytes);
      expectStatus(sig, 'modified-after-signing', 'content-changed-after-signing', 'warning');
    }
  });
});

describe('appended revisions that cannot be classified with certainty -> warning', () => {
  it.each([
    ['an unlinked decoy xref table re-points an object without appending a definition', 'unlinkedDecoyXrefTable', /outside the active \/Prev chain/],
    ['an unlinked decoy xref stream re-points an object without appending a definition', 'unlinkedDecoyXrefStream', /outside the active \/Prev chain/],
    ['any pre-E xref section outside the active chain fails closed', 'unlinkedPreSection', /outside the active \/Prev chain/],
    ['shadow object: the xref points at a changed definition, pdf-lib keeps a later identical one', 'shadowObject', /not listed|does not point/],
    ['an orphan signed definition cannot become the baseline for an unsigned content change', 'orphanShadowObject', /signed cross-reference|does not point/],
    ['/Prev does not chain to the signed revision', 'prevOverride', /Prev chain/],
    ['/XRefStm in an appended trailer', 'xrefStmInTail', /XRefStm/],
    ['an xref offset patched off its definition', 'patchedXrefOffset', /does not point at its definition/],
    ['an appended object stream reuses a signed object number', 'reusedStreamNumber', /reuses an object number/],
    ['objects appended without a cross-reference section', 'tailWithoutXref', /no cross-reference section/]
  ])('%s', async (_label, name, reason) => {
    const [sig] = await signatures(r[name]);
    expectStatus(sig, 'modified-after-signing', 'unclassified-change-after-signing', 'warning');
    expect(sig.integrityReason).toMatch(reason);
  });

  it('orphan object: extended-after-signing.pdf stays a warning', async () => {
    const [sig] = await signatures(f.normal['extended-after-signing.pdf']);
    expectStatus(sig, 'modified-after-signing', 'unclassified-change-after-signing', 'warning');
    expect(sig.integrityReason).toMatch(/not reachable/);
  });

  it('an invalid object in the tail is never green', async () => {
    const [sig] = await signatures(r.invalidObjectInTail);
    expect(sig.integrity).not.toBe('intact');
    expect(getSignatureSeverity(sig)).toBe('warning');
  });

  it.each(['two-signatures.pdf', 'two-signatures-generation-bumped.pdf'])('%s stays intact', async (name) => {
    const [first, second] = await signatures(f.normal[name]);
    expectStatus(first, 'intact', 'extended-by-later-signature', 'ok');
    expectStatus(second, 'intact', null, 'ok');
  });
});

describe('status model with an xref stream on the signed revision', () => {
  it('intact signed bytes -> ok', async () => {
    expectStatus(await approval(f.signedXrefStream.intact), 'intact', null, 'ok');
  });

  it.each([
    ['DSS-only append', 'dssOnly'],
    ['DSS-only append with a signed object stream', 'dssObjectStream']
  ])('%s -> ok with information', async (_label, name) => {
    const sig = await approval(f.signedXrefStream[name]);
    expectStatus(sig, 'intact', 'extended-with-validation-data', 'ok');
    expect(sig.integrityReason).toMatch(/validation data\/metadata only/);
  });

  it('content change -> warning', async () => {
    expectStatus(await approval(f.signedXrefStream.contentChanged),
      'modified-after-signing', 'content-changed-after-signing', 'warning');
  });

  it('shadow object and re-pointing append keep the structural warning', async () => {
    const sig = await approval(f.signedXrefStream.shadowObject);
    expectStatus(sig, 'modified-after-signing', 'unclassified-change-after-signing', 'warning');
    expect(sig.integrityReason).toMatch(/not listed|does not point/);
  });

  it.each([
    ['digest mismatch', 'digestMismatch', 'digest-mismatch', 'content-digest-mismatch'],
    ['invalid CMS signature', 'invalidSignature', 'signature-invalid', 'signature-invalid']
  ])('%s -> error', async (_label, name, integrity, code) => {
    expectStatus(await approval(f.signedXrefStream[name]), integrity, code, 'error');
  });
});

describe('parser hook shape guard (design flag F-f)', () => {
  async function hookedLog(bytes) {
    const parser = pdfLib.PDFParser.forBytesWithOptions(bytes, 100, true);
    const log = createRevisionLog();
    installRevisionLogHooks(parser, log);
    await parser.parseDocument();
    return log;
  }
  it('a parser without the expected methods is never hooked and never green', () => {
    const log = createRevisionLog();
    installRevisionLogHooks({ parseIndirectObject() {}, bytes: { offset: () => 0 }, context: { assign() {} } }, log);
    expect(log.hooked).toBe(false);
    expect(classifyAppendedRevisions(log, 10, pdfLib).code).toBe('unclassified-change-after-signing');
    expect(classifyAppendedRevisions(null, 10, pdfLib).code).toBe('unclassified-change-after-signing');
  });
  it('a complete log is only trusted while hooked and free of shape errors', async () => {
    const br = byteRange(r.okDss);
    const end = br[2] + br[3];
    const log = await hookedLog(r.okDss);
    expect(classifyAppendedRevisions(log, end, pdfLib).code).toBe('extended-with-validation-data');
    expect(classifyAppendedRevisions({ ...log, hooked: false }, end, pdfLib).code).toBe('unclassified-change-after-signing');
    expect(classifyAppendedRevisions({ ...log, shapeError: 'test' }, end, pdfLib).code).toBe('unclassified-change-after-signing');
    expect(classifyAppendedRevisions({ ...log, unattributed: true }, end, pdfLib).code).toBe('unclassified-change-after-signing');
  });
  it('an appended definition missing from the cross-reference data is unclassified, not green', async () => {
    const br = byteRange(r.okDss);
    const log = await hookedLog(r.okDss);
    const broken = { ...log, records: [...log.records, { num: 1, start: br[2] + br[3] + 1, object: null, container: null }] };
    expect(classifyAppendedRevisions(broken, br[2] + br[3], pdfLib).code).toBe('unclassified-change-after-signing');
  });
});

describe('cross-reference stream decoding', () => {
  const { PDFContext } = pdfLib;
  const dict = (entries) => PDFContext.create().obj(entries);
  it('decodes /W, /Index and type 0/1/2 entries', () => {
    const data = new Uint8Array([0, 0, 0, 0, 1, 2, 0, 0, 2, 0, 3, 7]);
    expect(decodeXrefStream(dict({ W: [1, 2, 1], Size: 9, Index: [5, 3] }), data, pdfLib)).toEqual([
      { num: 5, type: 0 }, { num: 6, type: 1, offset: 512 }, { num: 7, type: 2, stream: 3, index: 7 }
    ]);
  });
  it.each([
    ['an unknown entry type', { W: [1, 1, 1], Size: 1 }, [3, 0, 0]],
    ['truncated entries', { W: [1, 2, 1], Size: 2 }, [1, 0, 0, 0]],
    ['a TIFF predictor', { W: [1, 1, 1], Size: 1, DecodeParms: { Predictor: 2 } }, [1, 0, 0]],
    ['an unknown PNG row filter', { W: [1, 1, 1], Size: 1, DecodeParms: { Predictor: 12, Columns: 3 } }, [9, 1, 0, 0]],
    ['a missing /W', { Size: 1 }, [1, 0, 0]]
  ])('rejects %s', (_label, entries, bytes) => {
    expect(() => decodeXrefStream(dict(entries), new Uint8Array(bytes), pdfLib)).toThrow();
  });
  it('undoes the PNG Up predictor', () => {
    const data = new Uint8Array([2, 1, 0, 9, 2, 0, 1, 1]);
    expect(decodeXrefStream(dict({ W: [1, 1, 1], Size: 2, DecodeParms: { Predictor: 12, Columns: 3 } }), data, pdfLib))
      .toEqual([{ num: 0, type: 1, offset: 0 }, { num: 1, type: 1, offset: 1 }]);
  });
});
