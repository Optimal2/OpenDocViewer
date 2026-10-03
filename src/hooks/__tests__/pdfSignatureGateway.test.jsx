// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import usePdfSignatureReports from '../usePdfSignatureReports.js';
import { getDocumentSignatures } from '../../utils/pdfSignatureInspector.js';

vi.mock('../../utils/pdfSignatureInspector.js', () => ({ getDocumentSignatures: vi.fn() }));
const signature = { fieldName: 'Approval', integrity: 'intact', trust: 'not-checked' };
const browserReport = { signatures: [signature] };
const serverReport = { validatedAt: '2026-10-01T12:00:00Z', signatures: [{ ...signature,
  trust: 'valid', trustReason: 'Certificate chain verified', validationTime: '2026-10-01T12:00:00Z' }] };
let root, container, reports;
const page = (sourceKey) => ({ sourceKey, fileExtension: 'pdf' });
const sourceUrl = (key) => `https://example.test/gateway/source/session-one/${key === 'a' ? 17 : 42}`;
const response = (body = serverReport, status = 200) => ({ ok: status === 200, status, json: async () => body });
const read = vi.fn();
function Probe(props) { reports = usePdfSignatureReports(props); return null; }
async function render(extra = {}) {
  const props = { allPages: [page('a')], inspectionReady: true, readSourceArrayBuffer: read,
    getSourceUrl: sourceUrl, ...extra };
  await act(async () => { root.render(createElement(Probe, props)); });
  return props;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
  getDocumentSignatures.mockReset().mockResolvedValue(browserReport);
  read.mockReset().mockImplementation(async () => new ArrayBuffer(8));
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(async () => { await act(() => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('G1 derives gateway index from the source URL and caches once per document', async () => {
  const props = await render({ allPages: [page('a'), page('a'), page('b')] });
  await render({ ...props, allPages: [...props.allPages] });
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    'https://example.test/gateway/signatures/session-one/17',
    'https://example.test/gateway/signatures/session-one/42',
  ]);
  expect(read).toHaveBeenCalledTimes(2);
  expect(reports.a.signatures[0].trust).toBe('valid');
});

it('G2 leaves non-gateway and unsigned documents at level one without fetch', async () => {
  await render({ getSourceUrl: () => 'https://example.test/files/document.pdf' });
  expect(fetch).not.toHaveBeenCalled();
  expect(reports.a).toEqual(browserReport);
  getDocumentSignatures.mockResolvedValue({ signatures: [] });
  await render({ allPages: [page('b')] });
  expect(fetch).not.toHaveBeenCalled();
  expect(reports.b.signatures).toEqual([]);
});

it('G3 publishes level one while the server is pending and serializes the existing queue', async () => {
  let resolve;
  fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const props = await render({ allPages: [page('a'), page('b')] });
  expect(reports.a).toEqual(browserReport);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledTimes(1);
  await render({ ...props, allPages: [...props.allPages] });
  await act(async () => { resolve(response()); });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(reports.a.signatures[0].trust).toBe('valid');
});

it('G4 disabled 404 suppresses the session but not a different session', async () => {
  fetch.mockResolvedValueOnce(response({ error: 'Signature validation is not enabled on this gateway.' }, 404));
  await render({ allPages: [page('a'), page('b')] });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(reports.a).toEqual(browserReport);
  expect(reports.b).toEqual(browserReport);
  await render({ allPages: [page('c')], getSourceUrl: () => 'https://example.test/gateway/source/session-two/0' });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(reports.c.signatures[0].trust).toBe('valid');
});

it.each([404, 413, 415, 422, 500])('G5 HTTP %s keeps trust unchecked and does not disable the session', async (status) => {
  fetch.mockResolvedValueOnce(response({ error: 'Unavailable' }, status));
  await render({ allPages: [page('a'), page('b')] });
  expect(reports.a.signatures[0]).toMatchObject({ trust: 'not-checked', trustReason: 'server validation unavailable' });
  expect(reports.b.signatures[0].trust).toBe('valid');
});

it('G5 network errors and malformed JSON keep trust unchecked', async () => {
  fetch.mockRejectedValueOnce(new Error('network'));
  fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error('JSON'); } });
  await render({ allPages: [page('a'), page('b')] });
  for (const key of ['a', 'b']) expect(reports[key].signatures[0]).toMatchObject({
    trust: 'not-checked', trustReason: 'server validation unavailable',
  });
});

it('G5 malformed successful response never grants trust', async () => {
  fetch.mockResolvedValueOnce(response({ signatures: [{ ...signature, trust: 'valid' }] }));
  await render();
  expect(reports.a.signatures[0]).toMatchObject({ trust: 'not-checked', trustReason: 'server validation unavailable' });
});

it('G6 stalled fetch is bounded to twenty seconds', async () => {
  vi.useFakeTimers();
  fetch.mockImplementationOnce(() => new Promise(() => {}));
  await render();
  await act(async () => { await vi.advanceTimersByTimeAsync(20001); });
  expect(reports.a.signatures[0]).toMatchObject({ trust: 'not-checked', trustReason: 'server validation unavailable' });
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
});

it('G6 timeout includes response body reading, aborts, and releases the queue', async () => {
  vi.useFakeTimers();
  fetch.mockResolvedValueOnce({ ok: true, status: 200, json: () => new Promise(() => {}) });
  await render({ allPages: [page('a'), page('b')] });
  await act(async () => { await vi.advanceTimersByTimeAsync(20001); });
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(reports.a.signatures[0]).toMatchObject({ trust: 'not-checked', trustReason: 'server validation unavailable' });
  expect(reports.b.signatures[0].trust).toBe('valid');
});

it('G7 does not publish a server result for a removed document', async () => {
  let resolve;
  fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await render();
  await render({ allPages: [] });
  await act(async () => { resolve(response()); });
  expect(reports.a).toBeUndefined();
});
