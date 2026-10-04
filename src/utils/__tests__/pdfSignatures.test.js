/**
 * Level-1 PDF signature parser tests.
 *
 * Fixtures are generated in-process by scripts/generate-signature-fixtures.mjs
 * (throwaway CA + certificates, synthetic PDFs) - nothing binary is committed.
 * One test per integrity status, one per contract field group, plus the
 * unsigned fast path. See docs-src/pdf-signatures.md.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createSignatureFixtures, createFixturePki, baseSignedPdf, signFile, buildSignedData, FIXTURE_SIGNING_TIME, FIXTURE_NOT_BEFORE, FIXTURE_NOT_AFTER } from '../../../scripts/generate-signature-fixtures.mjs';
import { collectPdfSignatures, SUPPORTED_SUBFILTERS } from '../pdfSignatures.js';

let fixtures;
const prefixLengths = [7, 1024, 4096, 65536];

beforeAll(async () => {
  fixtures = await createSignatureFixtures();
  const pki = await createFixturePki();
  const base = baseSignedPdf({ fieldName: 'Prefixed', visible: false,
    sigOptions: { subFilter: 'adbe.pkcs7.detached' } }).serialize();
  for (const length of prefixLengths) {
    const name = `signed-with-prefix-${length}.pdf`;
    fixtures[name] = await signFile(withJunkPrefix(base.bytes, length),
      base.offsets.get(8) + length, (signedOverBytes) => buildSignedData({ signer: pki.rsa, signedOverBytes }));
    fixtures[`tampered-with-prefix-${length}.pdf`] = fixtures[name].slice();
    fixtures[`tampered-with-prefix-${length}.pdf`][0] ^= 1;
  }
  const headerless = base.bytes.slice();
  headerless.fill(0x20, 0, 8);
  fixtures['signed-without-header.pdf'] = await signFile(headerless, base.offsets.get(8),
    (signedOverBytes) => buildSignedData({ signer: pki.rsa, signedOverBytes }));
}, 120000);

async function one(name) {
  const report = await collectPdfSignatures(fixtures[name]);
  expect(report.signatures).toHaveLength(1);
  return report.signatures[0];
}

function withJunkPrefix(bytes, length) {
  const prefixed = new Uint8Array(length + bytes.length);
  prefixed.fill(0x78, 0, length);
  prefixed.set(bytes, length);
  return prefixed;
}

describe('F10 PDF headers after leading junk', () => {
  it.each(prefixLengths)('verifies a %i-byte prefix included in signed bytes and detects tampering', async (length) => {
    const valid = await one(`signed-with-prefix-${length}.pdf`);
    expect(valid.integrity).toBe('intact');
    expect(valid.coversWholeFile).toBe(true);
    const tampered = await one(`tampered-with-prefix-${length}.pdf`);
    expect(tampered.integrity).toBe('digest-mismatch');
  }, 30000); // the 64 KiB prefix case takes ~4 s alone and exceeds 5 s under full-suite load
  it.each(['valid-rsa.pdf', 'digest-mismatch.pdf'])('%s remains visible with broken byte offsets', async (name) => {
    for (const length of [7, 1019, 1023, 1024, 4096, 65536]) {
      const report = await collectPdfSignatures(withJunkPrefix(fixtures[name], length));
      expect(report.signatures).toHaveLength(1);
      expect(report.signatures[0].fieldName).toBeTruthy();
      expect(report.signatures[0].integrity).toBe('unreadable');
      expect(report.signatures[0].integrityReason).toMatch(/ByteRange/i);
    }
  });

  it('discovers signatures without a header and verifies the actual bytes', async () => {
    expect((await one('signed-without-header.pdf')).integrity).toBe('intact');
    const tampered = fixtures['valid-rsa.pdf'].slice();
    tampered.fill(0x20, 0, 8);
    const report = await collectPdfSignatures(tampered);
    expect(report.signatures).toHaveLength(1);
    expect(report.signatures[0].integrity).toBe('digest-mismatch');
  });
});

describe('fast path: unsigned documents', () => {
  it('returns an empty signature list for an unsigned PDF', async () => {
    const report = await collectPdfSignatures(fixtures['unsigned.pdf']);
    expect(report).toEqual({ signatures: [] });
  });

  it('returns an empty list (never throws) for garbage input', async () => {
    const report = await collectPdfSignatures(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    expect(report).toEqual({ signatures: [] });
    const empty = await collectPdfSignatures(new Uint8Array(0));
    expect(empty).toEqual({ signatures: [] });
  });
});

describe('integrity statuses', () => {
  it('intact: valid detached RSA signature covering the whole file', async () => {
    const sig = await one('valid-rsa.pdf');
    expect(sig.integrity).toBe('intact');
    expect(sig.coversWholeFile).toBe(true);
    expect(sig.subFilter).toBe('adbe.pkcs7.detached');
    expect(sig.kind).toBe('approval');
  });

  it('intact: ETSI.CAdES.detached with ECDSA over an invisible widget', async () => {
    const sig = await one('cades-ecdsa-invisible.pdf');
    expect(sig.integrity).toBe('intact');
    expect(sig.subFilter).toBe('ETSI.CAdES.detached');
    expect(sig.fieldName).toBe('Sign2');
  });

  it('intact: RSA-PSS signature', async () => {
    const sig = await one('pss-rsa-no-signing-time-attr.pdf');
    expect(sig.integrity).toBe('intact');
    expect(sig.coversWholeFile).toBe(true);
  });

  it('intact: legacy adbe.pkcs7.sha1 with embedded document digest', async () => {
    const sig = await one('pkcs7-sha1.pdf');
    expect(sig.integrity).toBe('intact');
    expect(sig.subFilter).toBe('adbe.pkcs7.sha1');
  });

  it('digest-mismatch: a byte inside the signed range was changed', async () => {
    const sig = await one('digest-mismatch.pdf');
    expect(sig.integrity).toBe('digest-mismatch');
    expect(sig.integrityReason).toMatch(/digest/i);
  });

  it('modified-after-signing: incremental update appended after signing', async () => {
    const sig = await one('extended-after-signing.pdf');
    expect(sig.integrity).toBe('modified-after-signing');
    expect(sig.coversWholeFile).toBe(false);
    expect(sig.integrityReason).toMatch(/extended after signing/i);
  });

  it('signature-invalid: CMS signed with a foreign key still digests fine', async () => {
    const sig = await one('signature-invalid.pdf');
    expect(sig.integrity).toBe('signature-invalid');
    expect(sig.integrityReason).toMatch(/does not verify/i);
  });

  it('unsupported: signature present with unknown SubFilter is reported, not hidden', async () => {
    const sig = await one('unsupported-subfilter.pdf');
    expect(sig.integrity).toBe('unsupported');
    expect(sig.integrityReason).toMatch(/^signature present, format not supported/);
    expect(sig.integrityReason).toContain('ICVN.SADES');
    expect(sig.subFilter).toBe('ICVN.SADES');
    expect(sig.fieldName).toBe('GostSig');
  });

  it('unreadable: corrupt /Contents is reported as unreadable', async () => {
    const sig = await one('corrupt-contents.pdf');
    expect(sig.integrity).toBe('unreadable');
    expect(sig.integrityReason).toMatch(/CMS|parse/i);
  });

  it('kind timestamp: RFC 3161 document timestamp', async () => {
    const sig = await one('doc-timestamp-rfc3161.pdf');
    expect(sig.kind).toBe('timestamp');
    expect(sig.subFilter).toBe('ETSI.RFC3161');
    expect(sig.integrity).toBe('intact');
    expect(sig.signer).toContain('TSA');
  });

  it('kind certification: DocMDP /Reference marks a certification signature', async () => {
    const sig = await one('certified-docmdp.pdf');
    expect(sig.kind).toBe('certification');
    expect(sig.integrity).toBe('intact');
    expect(sig.coversWholeFile).toBe(true);
  });

  it('multiple signatures: first covered by later signature stays intact, last is intact', async () => {
    const report = await collectPdfSignatures(fixtures['two-signatures.pdf']);
    expect(report.signatures).toHaveLength(2);
    const [first, second] = report.signatures;
    expect(first.fieldName).toBe('Signature1');
    expect(first.integrity).toBe('intact');
    expect(first.coversWholeFile).toBe(false);
    expect(first.integrityReason).toMatch(/later signature/i);
    expect(second.fieldName).toBe('ApprovalTwo');
    expect(second.integrity).toBe('intact');
    expect(second.coversWholeFile).toBe(true);
    expect(second.signer).toContain('Approver');
  });
});

describe('data contract shape', () => {
  it('every entry has exactly the contract keys and enum-typed values', async () => {
    const report = await collectPdfSignatures(fixtures['two-signatures.pdf']);
    const keys = [
      'fieldName', 'signer', 'signerOrganization', 'issuer', 'serial',
      'notBefore', 'notAfter', 'signingTime', 'signingTimeSource',
      'reason', 'location', 'subFilter', 'kind', 'integrity',
      'integrityReason', 'coversWholeFile', 'trust'
    ];
    for (const sig of report.signatures) {
      expect(Object.keys(sig).sort()).toEqual([...keys].sort());
      expect(['approval', 'certification', 'timestamp']).toContain(sig.kind);
      expect([
        'intact', 'modified-after-signing', 'digest-mismatch',
        'signature-invalid', 'unsupported', 'unreadable'
      ]).toContain(sig.integrity);
      expect(['signed-attribute', 'pdf-M', 'none']).toContain(sig.signingTimeSource);
      expect(typeof sig.coversWholeFile === 'boolean' || sig.coversWholeFile === null).toBe(true);
    }
  });

  it('trust is always not-checked at level 1', async () => {
    for (const name of ['valid-rsa.pdf', 'digest-mismatch.pdf', 'unsupported-subfilter.pdf', 'corrupt-contents.pdf']) {
      const sig = await one(name);
      expect(sig.trust).toBe('not-checked');
    }
  });
});

describe('certificate identity field group', () => {
  it('reports subject CN, organisation, issuer CN, serial and validity from the certificate', async () => {
    const sig = await one('valid-rsa.pdf');
    expect(sig.signer).toBe('ODV Fixture Signer');
    expect(sig.signerOrganization).toBe('ODV Fixture Users');
    expect(sig.issuer).toBe('ODV Fixture Signing CA');
    expect(sig.serial).toBe('11');
    expect(sig.notBefore).toBe(new Date(FIXTURE_NOT_BEFORE).toISOString());
    expect(sig.notAfter).toBe(new Date(FIXTURE_NOT_AFTER).toISOString());
  });

  it('EC certificate identity is extracted the same way', async () => {
    const sig = await one('cades-ecdsa-invisible.pdf');
    expect(sig.signer).toBe('ODV Fixture Signer EC');
    expect(sig.serial).toBe('12');
  });

  it('falls back to the signature dictionary /Name when no certificate is readable', async () => {
    const sig = await one('unsupported-subfilter.pdf');
    expect(sig.signer).toBe('ODV Fixture Signer');
    expect(sig.signerOrganization).toBeNull();
    expect(sig.issuer).toBeNull();
    expect(sig.serial).toBeNull();
  });
});

describe('signing time field group', () => {
  it('prefers the CMS signingTime signed attribute', async () => {
    const sig = await one('valid-rsa.pdf');
    expect(sig.signingTimeSource).toBe('signed-attribute');
    expect(sig.signingTime).toBe(new Date(FIXTURE_SIGNING_TIME).toISOString());
  });

  it('falls back to the PDF /M date when the attribute is missing', async () => {
    const sig = await one('pss-rsa-no-signing-time-attr.pdf');
    expect(sig.signingTimeSource).toBe('pdf-M');
    expect(sig.signingTime).toBe(new Date(FIXTURE_SIGNING_TIME).toISOString());
  });

  it('reports none when neither source exists', async () => {
    const sig = await one('corrupt-contents.pdf');
    expect(sig.signingTimeSource).toBe('none');
    expect(sig.signingTime).toBeNull();
  });
});

describe('signature dictionary text field group', () => {
  it('exposes reason and location', async () => {
    const sig = await one('valid-rsa.pdf');
    expect(sig.reason).toBe('Approved fixture document');
    expect(sig.location).toBe('Local test environment');
  });

  it('leaves reason and location null when absent', async () => {
    const sig = await one('doc-timestamp-rfc3161.pdf');
    expect(sig.reason).toBeNull();
    expect(sig.location).toBeNull();
  });
});

describe('byte coverage field group', () => {
  it('coversWholeFile true when the range reaches EOF', async () => {
    const sig = await one('valid-rsa.pdf');
    expect(sig.coversWholeFile).toBe(true);
  });

  it('coversWholeFile false when the file grew after signing', async () => {
    const sig = await one('extended-after-signing.pdf');
    expect(sig.coversWholeFile).toBe(false);
  });
});

describe('supported formats registry', () => {
  it('lists the four handled SubFilter formats', () => {
    expect(SUPPORTED_SUBFILTERS).toEqual([
      'adbe.pkcs7.detached',
      'ETSI.CAdES.detached',
      'adbe.pkcs7.sha1',
      'ETSI.RFC3161'
    ]);
  });
});

describe('accepts both ArrayBuffer and Uint8Array input', () => {
  it('parses the same file given as ArrayBuffer', async () => {
    const bytes = fixtures['valid-rsa.pdf'];
    const buffer = bytes.slice().buffer;
    const report = await collectPdfSignatures(buffer);
    expect(report.signatures).toHaveLength(1);
    expect(report.signatures[0].integrity).toBe('intact');
  });
});

describe('fast path does not load the CMS stack', () => {
  it('unsigned PDF never imports pkijs', async () => {
    const marker = { loaded: false };
    vi.resetModules();
    vi.doMock('pkijs', async () => {
      marker.loaded = true;
      const actual = await vi.importActual('pkijs');
      return actual;
    });
    const mod = await import('../pdfSignatures.js');
    for (const length of [0, 7, 1023, 1024, 4096, 65536]) {
      const report = await mod.collectPdfSignatures(withJunkPrefix(fixtures['unsigned.pdf'], length));
      expect(report).toEqual({ signatures: [] });
    }
    expect(marker.loaded).toBe(false);
    vi.doUnmock('pkijs');
    vi.resetModules();
  });
});

function latin1Of(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 1) text += String.fromCharCode(bytes[i]);
  return text;
}

/** Split a classic-xref PDF into revisions at each %%EOF marker. */
function revisionsOf(bytes) {
  return latin1Of(bytes).split(/%%EOF\r?\n?/).filter((part) => part.trim());
}

/** Map object number -> generation from every in-use entry of a revision's xref table. */
function xrefGenerations(revision) {
  const table = revision.slice(revision.lastIndexOf('\nxref\n') + 6, revision.indexOf('trailer'));
  const lines = table.split('\n').filter((line) => line.trim());
  const generations = new Map();
  for (let i = 0; i < lines.length;) {
    const [first, count] = lines[i].trim().split(/\s+/).map(Number);
    for (let k = 0; k < count; k += 1) {
      const [, gen, type] = lines[i + 1 + k].trim().split(/\s+/);
      if (type === 'n') generations.set(first + k, Number(gen));
    }
    i += 1 + count;
  }
  return generations;
}

describe('incremental-update fixture shape (ISO 32000 7.5.6)', () => {
  it('two-signatures.pdf rewrites objects 3 and 5 with their original generation 0', () => {
    const revisions = revisionsOf(fixtures['two-signatures.pdf']);
    expect(revisions).toHaveLength(2);
    const second = revisions[1];
    expect(second).toMatch(/(^|\n)3 0 obj\n/);
    expect(second).toMatch(/(^|\n)5 0 obj\n/);
    expect(second).not.toMatch(/(^|\n)\d+ [1-9]\d* obj\n/);
    const generations = xrefGenerations(second);
    expect(generations.get(3)).toBe(0);
    expect(generations.get(5)).toBe(0);
    expect([...generations.values()].every((gen) => gen === 0)).toBe(true);
  });

  it('every incremental update in the spec-conforming fixtures keeps generation 0', () => {
    for (const name of ['two-signatures.pdf', 'extended-after-signing.pdf', 'certified-docmdp.pdf', 'doc-timestamp-rfc3161.pdf']) {
      for (const revision of revisionsOf(fixtures[name])) {
        expect(revision, name).not.toMatch(/(^|\n)\d+ [1-9]\d* obj\n/);
        expect([...xrefGenerations(revision).values()].every((gen) => gen === 0), name).toBe(true);
      }
    }
  });

  it('two-signatures-generation-bumped.pdf is the deliberate out-of-spec negative fixture', async () => {
    const revisions = revisionsOf(fixtures['two-signatures-generation-bumped.pdf']);
    expect(revisions[1]).toMatch(/(^|\n)3 1 obj\n/);
    expect(revisions[1]).toMatch(/(^|\n)5 1 obj\n/);
    expect(xrefGenerations(revisions[1]).get(3)).toBe(1);
    // The parser tolerates such writers: both signatures are still found and intact.
    const report = await collectPdfSignatures(fixtures['two-signatures-generation-bumped.pdf']);
    expect(report.signatures.map((sig) => [sig.fieldName, sig.integrity])).toEqual([
      ['Signature1', 'intact'], ['ApprovalTwo', 'intact']
    ]);
  });
});
