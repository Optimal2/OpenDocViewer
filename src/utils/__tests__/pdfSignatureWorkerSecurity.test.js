/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ workers: [], failConstruction: false, constructions: 0 }));
vi.mock('../../workers/pdfSignatureWorker.js?worker', () => ({ default: class {
  constructor() {
    state.constructions += 1;
    if (state.failConstruction) throw new Error('blocked worker');
    this.terminate = vi.fn();
    this.postMessage = vi.fn();
    state.workers.push(this);
  }
} }));
vi.mock('../pdfSignatures.js', async (load) => ({
  ...await load(), collectPdfSignatures: vi.fn(async () => ({ signatures: [] }))
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', class {});
  vi.stubGlobal('document', {});
  state.workers.length = 0;
  state.failConstruction = false;
  state.constructions = 0;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); vi.resetModules(); });
async function api() {
  return { ...await import('../pdfSignatureInspector.js'), ...await import('../pdfSignatures.js') };
}
it.each(['error', 'timeout', 'messageerror', 'postMessage'])('F12 recreates workers after %s, but stops after three recreations', async (failure) => {
  const { getDocumentSignatures, collectPdfSignatures, disposePdfSignatureWorker } = await api();
  for (let attempt = 0; attempt < 4; attempt++) {
    // A successful later document must work, but must not replenish the budget.
    const next = getDocumentSignatures(new Uint8Array(8));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.workers).toHaveLength(attempt + 1);
    const worker = state.workers[attempt];
    const message = worker.postMessage.mock.calls.at(-1)[0];
    const report = { signatures: [{ integrity: 'intact' }] };
    worker.onmessage({ data: { type: 'pdfSignaturesResult', requestId: message.requestId, ok: true, report } });
    expect(await next).toEqual(report);

    if (failure === 'postMessage') worker.postMessage.mockImplementation(() => { throw new Error('post failed'); });
    const failed = getDocumentSignatures(new Uint8Array(8), { timeoutMs: 30 });
    // A synchronous postMessage failure settles before another request can join.
    const concurrent = failure === 'postMessage' ? failed
      : getDocumentSignatures(new Uint8Array(8), { timeoutMs: 30 });
    await vi.advanceTimersByTimeAsync(0);
    if (failure === 'timeout') await vi.advanceTimersByTimeAsync(31);
    else if (failure === 'messageerror') worker.onmessageerror();
    else if (failure === 'error') worker.onerror({ preventDefault() {} });
    const expectedCode = failure === 'timeout' ? 'timeout' : 'viewer-error';
    for (const result of [await failed, await concurrent]) {
      expect(result.signatures[0].integrity).toBe('not-checked-in-viewer');
      expect(result.signatures[0].integrityCode).toBe(expectedCode);
    }
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  }
  for (let i = 0; i < 3; i++) {
    const blocked = await getDocumentSignatures(new Uint8Array(8));
    expect(blocked.signatures[0].integrity).toBe('not-checked-in-viewer');
    expect(blocked.signatures[0].integrityCode).toBe('viewer-error');
    expect(blocked.signatures[0].integrityReason).toMatch(/unavailable/);
  }
  expect(state.constructions).toBe(4);
  expect(collectPdfSignatures).not.toHaveBeenCalled();
  disposePdfSignatureWorker();
});

it('F12 bounds construction retries and disposal starts a fresh session', async () => {
  const { getDocumentSignatures, disposePdfSignatureWorker, collectPdfSignatures } = await api();
  state.failConstruction = true;
  for (let i = 0; i < 7; i++) {
    expect((await getDocumentSignatures(new Uint8Array(8))).signatures[0].integrity).toBe('not-checked-in-viewer');
  }
  expect(state.constructions).toBe(4);
  state.failConstruction = false;
  expect((await getDocumentSignatures(new Uint8Array(8))).signatures[0].integrity).toBe('not-checked-in-viewer');
  expect(state.constructions).toBe(4);
  disposePdfSignatureWorker();
  const next = getDocumentSignatures(new Uint8Array(8));
  await vi.advanceTimersByTimeAsync(0);
  expect(state.constructions).toBe(5);
  const worker = state.workers[0];
  const message = worker.postMessage.mock.calls[0][0];
  worker.onmessage({ data: { type: 'pdfSignaturesResult', requestId: message.requestId, ok: true, report: { signatures: [] } } });
  expect(await next).toEqual({ signatures: [] });
  expect(collectPdfSignatures).not.toHaveBeenCalled();
  disposePdfSignatureWorker();
});
it('F2 transfers disposable bytes and preserves buffers by default', async () => {
  const { getDocumentSignatures } = await api();
  for (const transfer of [true, false]) {
    const bytes = new Uint8Array([1, 2, 3]);
    const promise = getDocumentSignatures(bytes, { transfer });
    await vi.advanceTimersByTimeAsync(0);
    const worker = state.workers[0];
    const [message, transfers] = worker.postMessage.mock.calls.at(-1);
    expect(transfers).toEqual(transfer ? [bytes.buffer] : []);
    const received = structuredClone(message, { transfer: transfers });
    expect(bytes.byteLength).toBe(transfer ? 0 : 3);
    expect([...received.bytes]).toEqual([1, 2, 3]);
    worker.onmessage({ data: { type: 'pdfSignaturesResult', requestId: message.requestId, ok: true, report: { signatures: [] } } });
    await promise;
  }
});
it('F6 timeout terminates the worker, settles all requests, and never parses inline', async () => {
  const { getDocumentSignatures, collectPdfSignatures } = await api();
  const first = getDocumentSignatures(new Uint8Array(8), { timeoutMs: 30 });
  const second = getDocumentSignatures(new Uint8Array(8), { timeoutMs: 30000 });
  await vi.advanceTimersByTimeAsync(31);
  for (const result of [await first, await second]) {
    expect(result.signatures[0]?.integrity).toBe('not-checked-in-viewer');
    expect(result.signatures[0]?.integrityCode).toBe('timeout');
  }
  expect(state.workers[0].terminate).toHaveBeenCalledOnce();
  expect(collectPdfSignatures).not.toHaveBeenCalled();
});
it('heartbeats from the pdf.js comparison extend the timeout, bounded by its total cap', async () => {
  const { getDocumentSignatures } = await api();
  const { RENDER_CHECK_MAX_TOTAL_MS } = await import('../pdfSignatureRenderCheck.js');
  let settled = null;
  const promise = getDocumentSignatures(new Uint8Array(8), { timeoutMs: 10000 });
  promise.then((report) => { settled = report; });
  await vi.advanceTimersByTimeAsync(0);
  const worker = state.workers[0];
  const { requestId } = worker.postMessage.mock.calls[0][0];
  // A progressing comparison keeps the request alive far past timeoutMs ...
  for (let t = 0; t < RENDER_CHECK_MAX_TOTAL_MS; t += 9000) {
    worker.onmessage({ data: { type: 'pdfSignaturesProgress', requestId } });
    await vi.advanceTimersByTimeAsync(9000);
    if (t + 9000 < RENDER_CHECK_MAX_TOTAL_MS) expect(settled).toBeNull();
  }
  // ... but never past timeoutMs plus the comparison's total cap, heartbeats or not.
  for (let i = 0; i < 6 && settled === null; i++) {
    worker.onmessage({ data: { type: 'pdfSignaturesProgress', requestId } });
    await vi.advanceTimersByTimeAsync(1000);
  }
  expect(settled).not.toBeNull();
  expect((await promise).signatures[0]).toMatchObject({ integrity: 'not-checked-in-viewer', integrityCode: 'timeout' });
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it('without a heartbeat the worker still times out after timeoutMs', async () => {
  const { getDocumentSignatures } = await api();
  const promise = getDocumentSignatures(new Uint8Array(8), { timeoutMs: 10000 });
  await vi.advanceTimersByTimeAsync(0);
  const worker = state.workers[0];
  const { requestId } = worker.postMessage.mock.calls[0][0];
  worker.onmessage({ data: { type: 'pdfSignaturesProgress', requestId } });
  await vi.advanceTimersByTimeAsync(10001);
  expect((await promise).signatures[0]).toMatchObject({ integrity: 'not-checked-in-viewer', integrityCode: 'timeout' });
});
it('F6 worker construction failure never falls through to inline parsing', async () => {
  state.failConstruction = true;
  const { getDocumentSignatures, collectPdfSignatures } = await api();
  const report = await getDocumentSignatures(new Uint8Array(8));
  expect(report.signatures[0]?.integrity).toBe('not-checked-in-viewer');
  expect(collectPdfSignatures).not.toHaveBeenCalled();
});
it('F6 worker error terminates and produces a not-checked document', async () => {
  const { getDocumentSignatures, collectPdfSignatures } = await api();
  const promise = getDocumentSignatures(new Uint8Array(8));
  await vi.advanceTimersByTimeAsync(0);
  state.workers[0].onerror({ preventDefault() {} });
  expect((await promise).signatures[0]?.integrity).toBe('not-checked-in-viewer');
  expect(collectPdfSignatures).not.toHaveBeenCalled();
});
it('F6 Worker-free inline fallback is size bounded', async () => {
  vi.stubGlobal('Worker', undefined);
  const { getDocumentSignatures, collectPdfSignatures } = await api();
  const report = await getDocumentSignatures(new Uint8Array(1024 * 1024));
  expect(report.signatures[0]?.integrity).toBe('not-checked-in-viewer');
  expect(report.signatures[0]?.integrityCode).toBe('inspection-limit');
  expect(collectPdfSignatures).not.toHaveBeenCalled();
});
it('F8 dispose settles every pending promise immediately and permits a new worker', async () => {
  const { getDocumentSignatures, disposePdfSignatureWorker, collectPdfSignatures } = await api();
  const completed = [];
  const p1 = getDocumentSignatures(new Uint8Array(8)).then((r) => completed.push(r));
  const p2 = getDocumentSignatures(new Uint8Array(8)).then((r) => completed.push(r));
  await vi.advanceTimersByTimeAsync(0);
  disposePdfSignatureWorker();
  await vi.advanceTimersByTimeAsync(0);
  expect(completed).toHaveLength(2);
  await Promise.all([p1, p2]);
  expect(completed.every((r) => r.signatures[0]?.integrity === 'not-checked-in-viewer'
    && r.signatures[0]?.integrityCode === 'viewer-error')).toBe(true);
  expect(state.workers[0].terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  const next = getDocumentSignatures(new Uint8Array(8));
  await vi.advanceTimersByTimeAsync(0);
  expect(state.workers).toHaveLength(2);
  const message = state.workers[1].postMessage.mock.calls[0][0];
  state.workers[1].onmessage({ data: { type: 'pdfSignaturesResult', requestId: message.requestId, ok: true, report: { signatures: [] } } });
  expect(await next).toEqual({ signatures: [] });
  expect(collectPdfSignatures).not.toHaveBeenCalled();
});
it('I3 a worker answer without a report is not checked (viewer-error)', async () => {
  const { getDocumentSignatures } = await api();
  const promise = getDocumentSignatures(new Uint8Array(8));
  await vi.advanceTimersByTimeAsync(0);
  const message = state.workers[0].postMessage.mock.calls[0][0];
  state.workers[0].onmessage({ data: { type: 'pdfSignaturesResult', requestId: message.requestId, ok: true } });
  const report = await promise;
  expect(report.signatures[0]).toMatchObject({ integrity: 'not-checked-in-viewer', integrityCode: 'viewer-error' });
});
it('I4 a worker-side failure (ok:false) is not checked (viewer-error)', async () => {
  const { getDocumentSignatures } = await api();
  const promise = getDocumentSignatures(new Uint8Array(8));
  await vi.advanceTimersByTimeAsync(0);
  const message = state.workers[0].postMessage.mock.calls[0][0];
  state.workers[0].onmessage({ data: { type: 'pdfSignaturesResult', requestId: message.requestId, ok: false, error: 'boom' } });
  const report = await promise;
  expect(report.signatures[0]).toMatchObject({ integrity: 'not-checked-in-viewer', integrityCode: 'viewer-error', integrityReason: 'boom' });
});
it('I1 a source over 64 MiB is not checked (inspection-limit) without reading it', async () => {
  const { getDocumentSignatures } = await api();
  const report = await getDocumentSignatures({ size: 64 * 1024 * 1024 + 1 });
  expect(report.signatures[0]).toMatchObject({ integrity: 'not-checked-in-viewer', integrityCode: 'inspection-limit' });
  expect(state.workers).toHaveLength(0);
});
