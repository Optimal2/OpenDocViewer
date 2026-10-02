/**
 * pdfSignatureWorker + pdfSignatureInspector tests.
 *
 * In Node the inspector cannot create browser workers, so it exercises the
 * documented main-thread fallback; the worker entry itself is tested against
 * a stubbed worker scope.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { createSignatureFixtures } from '../../../scripts/generate-signature-fixtures.mjs';

let fixtures;

beforeAll(async () => {
  fixtures = await createSignatureFixtures();
}, 120000);

describe('pdfSignatureInspector (node fallback path)', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('resolves the contract for a signed document without a Worker API', async () => {
    const { getDocumentSignatures } = await import('../pdfSignatureInspector.js');
    expect(typeof Worker).toBe('undefined');
    const report = await getDocumentSignatures(fixtures['valid-rsa.pdf']);
    expect(report.signatures).toHaveLength(1);
    expect(report.signatures[0].integrity).toBe('intact');
  });

  it('accepts ArrayBuffer and Blob sources', async () => {
    const { getDocumentSignatures } = await import('../pdfSignatureInspector.js');
    const buffer = fixtures['cades-ecdsa-invisible.pdf'].slice().buffer;
    const fromBuffer = await getDocumentSignatures(buffer);
    expect(fromBuffer.signatures[0].fieldName).toBe('Sign2');
    const blob = new Blob([new Uint8Array(buffer)], { type: 'application/pdf' });
    const fromBlob = await getDocumentSignatures(blob);
    expect(fromBlob.signatures[0].fieldName).toBe('Sign2');
  });

  it('never rejects: garbage and null sources resolve to an empty report', async () => {
    const { getDocumentSignatures } = await import('../pdfSignatureInspector.js');
    expect(await getDocumentSignatures(new Uint8Array([9, 9, 9]))).toEqual({ signatures: [] });
    expect(await getDocumentSignatures(null)).toEqual({ signatures: [] });
    expect(await getDocumentSignatures(undefined)).toEqual({ signatures: [] });
  });
});

describe('pdfSignatureWorker message protocol', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('answers collectPdfSignatures requests with a pdfSignaturesResult', async () => {
    const messages = [];
    vi.stubGlobal('self', {
      postMessage: (msg) => messages.push(msg)
    });
    await import('../../workers/pdfSignatureWorker.js');
    const selfScope = globalThis.self;
    await selfScope.onmessage({ data: { type: 'collectPdfSignatures', requestId: 7, bytes: fixtures['valid-rsa.pdf'] } });
    // wait for the async handler to post its answer
    for (let i = 0; i < 100 && messages.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('pdfSignaturesResult');
    expect(messages[0].requestId).toBe(7);
    expect(messages[0].ok).toBe(true);
    expect(messages[0].report.signatures).toHaveLength(1);
    expect(messages[0].report.signatures[0].integrity).toBe('intact');
  });

  it('ignores unrelated messages', async () => {
    const messages = [];
    vi.stubGlobal('self', { postMessage: (msg) => messages.push(msg) });
    await import('../../workers/pdfSignatureWorker.js');
    globalThis.self.onmessage({ data: { type: 'somethingElse' } });
    globalThis.self.onmessage({ data: null });
    expect(messages).toHaveLength(0);
  });
});
