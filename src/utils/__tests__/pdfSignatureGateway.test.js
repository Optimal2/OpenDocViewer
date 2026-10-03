import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGatewaySignatureContext, mergeGatewaySignatureReport } from '../pdfSignatureGateway.js';
import { getSignatureSeverity } from '../pdfSignatureStatus.js';

const time = '2026-10-01T12:00:00Z';
const local = { fieldName: 'Approval', integrity: 'intact', trust: 'not-checked',
  signer: 'Browser signer', integrityReason: 'Browser reason', signingTime: '2026-09-01T12:00:00Z', signingTimeSource: 'pdf-M' };
const remote = { ...local, trust: 'valid', trustReason: 'Certificate chain verified', validationTime: time };
const merge = (signatures, server = [remote]) => mergeGatewaySignatureReport({ signatures }, { signatures: server, validatedAt: time });

beforeEach(() => vi.stubGlobal('location', { href: 'https://example.test/gateway/viewer/' }));
afterEach(() => vi.unstubAllGlobals());

it('G22 resolves source-pack transport identity and never guesses missing or malformed indexes', () => {
  const base = 'https://example.test/gateway/viewer/';
  const pack = { url: '../source-pack/session-pack', fileIndex: 2 };
  expect(getGatewaySignatureContext('/files/document.pdf', base, pack)?.endpoint)
    .toBe('https://example.test/gateway/signatures/session-pack/2');
  for (const fileIndex of [undefined, null, '', '0', -1, 1.5, NaN, 2147483648]) {
    expect(getGatewaySignatureContext('/source/other/0', base, { ...pack, fileIndex })).toBeNull();
  }
  for (const url of ['', '/source-pack/a%2Fb', '/source-pack/%', '/source-pack/session/extra',
    'https://foreign.test/source-pack/session', 'http://example.test/source-pack/session',
    'https://example.test:444/source-pack/session', 'https://user:pass@example.test/source-pack/session']) {
    expect(getGatewaySignatureContext('/source/other/0', base, { ...pack, url })).toBeNull();
  }
  expect(getGatewaySignatureContext('/source-pack/session-pack', base)).toBeNull();
});

it('G11 detects only a gateway source route, including relative URLs and virtual directories', () => {
  expect(getGatewaySignatureContext('../source/session-one/42', 'https://example.test/gateway/viewer/')).toEqual({
    endpoint: 'https://example.test/gateway/signatures/session-one/42', session: 'https://example.test/gateway/signatures/session-one',
  });
  expect(getGatewaySignatureContext('https://example.test/source/session-one/0?download=1#x')?.endpoint)
    .toBe('https://example.test/signatures/session-one/0');
  for (const url of ['', '/document.pdf', '/source/session/1/extra', '/source/session/-1', '/source/session/2147483648',
    '/source/session/1.5', '/source/session/01', '/source/a%2Fb/1', '/source/%/1', 'file:///source/session/0',
    'https://user:password@example.test/source/session/1']) {
    expect(getGatewaySignatureContext(url, 'https://example.test')).toBeNull();
  }
});

it('G12 merges by fieldName instead of position and preserves browser identity', () => {
  const result = merge([local, { ...local, fieldName: 'Second' }], [
    { ...remote, fieldName: 'Second', trust: 'invalid' }, { ...remote, signer: 'Server signer' },
  ]);
  expect(result.signatures.map((signature) => signature.trust)).toEqual(['valid', 'invalid']);
  expect(result.signatures[0]).toMatchObject({ signer: 'Browser signer', trustReason: remote.trustReason,
    validationTime: time, integrityReason: local.integrityReason });
  expect(result.validatedAt).toBe(time);
  expect(local.trust).toBe('not-checked');
});

it('G11 rejects non-HTTP sources even when the viewer shares their origin', () => {
  vi.stubGlobal('location', { href: 'file:///viewer/index.html' });
  expect(getGatewaySignatureContext('file:///source/session/0')).toBeNull();
});

it('G18 never uses the HTML base or an absent viewer location as a trust anchor', () => {
  expect(getGatewaySignatureContext('/source/session/0', 'https://foreign.test/')).toBeNull();
  vi.stubGlobal('location', undefined);
  expect(getGatewaySignatureContext('https://example.test/source/session/0')).toBeNull();
});

describe('G13 never improves browser integrity and accepts worse server integrity', () => {
  const worstFirst = ['unreadable', 'signature-invalid', 'digest-mismatch', 'modified-after-signing', 'unsupported', 'intact'];
  for (const [browserIndex, browserIntegrity] of worstFirst.entries()) {
    for (const [serverIndex, serverIntegrity] of worstFirst.entries()) {
      it(`${browserIntegrity} / ${serverIntegrity}`, () => {
        const signature = merge([{ ...local, integrity: browserIntegrity }], [{ ...remote, integrity: serverIntegrity, integrityReason: 'Server reason' }]).signatures[0];
        expect(signature.integrity).toBe(worstFirst[Math.min(browserIndex, serverIndex)]);
        expect(signature.integrityReason).toBe(serverIndex < browserIndex ? 'Server reason' : 'Browser reason');
      });
    }
  }
});

it('G14 uses only server timestamp signing times', () => {
  const changed = { ...remote, signingTime: time };
  for (const signingTimeSource of ['pdf-M', 'signed-attribute', 'none']) {
    expect(merge([local], [{ ...changed, signingTimeSource }]).signatures[0])
      .toMatchObject({ signingTime: local.signingTime, signingTimeSource: 'pdf-M' });
  }
  expect(merge([local], [{ ...changed, signingTimeSource: 'timestamp' }]).signatures[0])
    .toMatchObject({ signingTime: time, signingTimeSource: 'timestamp' });
});

it('G15 missing or ambiguous fields stay unchecked', () => {
  for (const server of [[], [{ ...remote, fieldName: 'Other' }], [remote, remote], [{ ...remote, fieldName: null }]]) {
    expect(merge([local], server).signatures[0]).toMatchObject({ trust: 'not-checked', trustReason: 'server validation unavailable' });
  }
  expect(merge([local, local]).signatures.every((signature) => signature.trust === 'not-checked')).toBe(true);
  expect(merge([{ ...local, fieldName: null }], [{ ...remote, fieldName: null }]).signatures[0].trust).toBe('not-checked');
});

it.each([null, {}, { signatures: null }, { signatures: [null] }, { signatures: Array(257).fill(remote) },
  { signatures: [remote], validatedAt: 'yesterday' },
  ...[{ trust: 'VALID' }, { integrity: 'invented' }, { trustReason: {} }, { validationTime: null }, { validationTime: 'yesterday' },
    { fieldName: 1 }, { fieldName: undefined }, { signingTimeSource: 'timestamp', signingTime: null }]
    .map((patch) => ({ signatures: [{ ...remote, ...patch }] })),
])('G16 malformed server response stays unchecked: %j', (server) => {
  const signature = mergeGatewaySignatureReport({ signatures: [local] }, server).signatures[0];
  expect(signature).toMatchObject({ trust: 'not-checked', trustReason: 'server validation unavailable', integrity: 'intact' });
});

it('G17 severity combines trust with integrity without hiding integrity failures', () => {
  expect(getSignatureSeverity('intact', 'invalid')).toBe('error');
  expect(getSignatureSeverity('intact', 'unknown')).toBe('warning');
  expect(getSignatureSeverity('intact', 'valid')).toBe('ok');
  expect(getSignatureSeverity('modified-after-signing', 'valid')).toBe('warning');
  expect(getSignatureSeverity('unreadable', 'valid')).toBe('error');
});
