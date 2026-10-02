// @vitest-environment jsdom
// File: src/hooks/__tests__/usePdfSignatureReports.test.jsx
/**
 * Wiring contract for the level-1 signature inspector hook:
 *  - the inspector runs once per PDF source, only after the first page is ready;
 *  - non-PDF documents are never inspected;
 *  - the hook never blocks rendering (reports start empty and fill in async);
 *  - results are cached per document (sourceKey).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import usePdfSignatureReports from '../usePdfSignatureReports.js';
import { getDocumentSignatures } from '../../utils/pdfSignatureInspector.js';
import SignatureStatusBadge from '../../components/SignatureStatusBadge.jsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key, options) => options?.defaultValue || key }) }));

vi.mock('../../utils/pdfSignatureInspector.js', () => ({
  getDocumentSignatures: vi.fn(),
  disposePdfSignatureWorker: vi.fn(),
}));

const SIGNED_REPORT = { signatures: [{ integrity: 'intact', signer: 'Test' }] };

function pdfPage(sourceKey) {
  return { sourceKey, fileExtension: 'pdf', status: 1, fullSizeUrl: 'blob:x' };
}

function tiffPage(sourceKey) {
  return { sourceKey, fileExtension: 'tif', status: 1, fullSizeUrl: 'blob:y' };
}

function flushMicrotasks() {
  return act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

async function renderProbe(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const probe = { reports: null };
  function Probe(next) {
    probe.reports = usePdfSignatureReports(next);
    return createElement(SignatureStatusBadge, { report: probe.reports['src-a'], onOpen: () => {} });
  }
  await act(() => root.render(createElement(Probe, props)));
  cleanups.push(() => { root.unmount(); container.remove(); });
  await flushMicrotasks();
  return {
    container,
    root,
    probe,
    rerender: async (next) => {
      await act(() => root.render(createElement(Probe, next)));
      await flushMicrotasks();
    },
  };
}

const cleanups = [];
afterEach(async () => { await act(() => { for (const cleanup of cleanups.splice(0)) cleanup(); }); });

describe('usePdfSignatureReports', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    getDocumentSignatures.mockReset();
    getDocumentSignatures.mockResolvedValue(SIGNED_REPORT);
  });

  it('does not inspect anything before the first page is ready', async () => {
    const readSourceArrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(8));
    const { root, container } = await renderProbe({
      allPages: [pdfPage('src-a')],
      inspectionReady: false,
      readSourceArrayBuffer,
    });
    expect(getDocumentSignatures).not.toHaveBeenCalled();
    await act(() => root.unmount());
    container.remove();
  });

  it('inspects each PDF source exactly once after the first page is ready', async () => {
    const readSourceArrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(8));
    const { root, container, probe, rerender } = await renderProbe({
      allPages: [pdfPage('src-a'), pdfPage('src-a')],
      inspectionReady: true,
      readSourceArrayBuffer,
    });
    expect(getDocumentSignatures).toHaveBeenCalledTimes(1);
    expect(probe.reports['src-a']).toEqual(SIGNED_REPORT);

    // Re-render with the same pages: still exactly one call (cached per sourceKey).
    await rerender({
      allPages: [pdfPage('src-a'), pdfPage('src-a')],
      inspectionReady: true,
      readSourceArrayBuffer,
    });
    expect(getDocumentSignatures).toHaveBeenCalledTimes(1);
    await act(() => root.unmount());
    container.remove();
  });

  it('never calls the inspector for non-PDF documents', async () => {
    const readSourceArrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(8));
    const { root, container, probe } = await renderProbe({
      allPages: [tiffPage('src-b'), pdfPage('src-a')],
      inspectionReady: true,
      readSourceArrayBuffer,
    });
    expect(getDocumentSignatures).toHaveBeenCalledTimes(1);
    expect(probe.reports['src-b']).toBeUndefined();
    expect(probe.reports['src-a']).toEqual(SIGNED_REPORT);
    await act(() => root.unmount());
    container.remove();
  });

  it('passes the bytes the viewer already holds and never blocks rendering', async () => {
    let resolveInspection;
    getDocumentSignatures.mockImplementation(() => new Promise((resolve) => { resolveInspection = resolve; }));
    const bytes = new ArrayBuffer(16);
    const readSourceArrayBuffer = vi.fn().mockResolvedValue(bytes);
    const { root, container, probe } = await renderProbe({
      allPages: [pdfPage('src-a')],
      inspectionReady: true,
      readSourceArrayBuffer,
    });
    // The hook returned synchronously with an empty report map while the
    // inspection is still pending: page rendering is never blocked.
    expect(getDocumentSignatures).toHaveBeenCalledTimes(1);
    const passed = getDocumentSignatures.mock.calls[0][0];
    expect(passed).toBeInstanceOf(Uint8Array);
    expect(passed.byteLength).toBe(16);
    await act(async () => {
      resolveInspection(SIGNED_REPORT);
      await Promise.resolve();
    });
    expect(probe.reports['src-a']).toEqual(SIGNED_REPORT);
    await act(() => root.unmount());
    container.remove();
  });

  it('stores an unreadable report when the source bytes are unavailable', async () => {
    const readSourceArrayBuffer = vi.fn().mockResolvedValue(null);
    const { root, container, probe } = await renderProbe({
      allPages: [pdfPage('src-a')],
      inspectionReady: true,
      readSourceArrayBuffer,
    });
    await flushMicrotasks();
    expect(getDocumentSignatures).not.toHaveBeenCalled();
    expect(probe.reports['src-a'].signatures[0].integrity).toBe('unreadable');
    await act(() => root.unmount());
    container.remove();
  });

  it('F1 retains a pending result and shows its badge across page list changes', async () => {
    let resolve;
    getDocumentSignatures.mockReturnValue(new Promise((done) => { resolve = done; }));
    const props = { allPages: [pdfPage('src-a')], inspectionReady: true,
      readSourceArrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)) };
    const { container, probe, rerender } = await renderProbe(props);
    await rerender({ ...props, allPages: [pdfPage('src-a'), pdfPage('src-a'), tiffPage('image')] });
    await act(async () => { resolve(SIGNED_REPORT); });
    expect(probe.reports['src-a']).toEqual(SIGNED_REPORT);
    expect(container.querySelector('.odv-signature-badge')).not.toBeNull();
    expect(getDocumentSignatures).toHaveBeenCalledTimes(1);
  });

  it('F2 bounds reads and inspections to one, prioritizing the current document', async () => {
    const pending = [];
    getDocumentSignatures.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const read = vi.fn().mockImplementation(async () => new ArrayBuffer(8));
    const props = { allPages: ['a', 'b', 'c', 'd'].map(pdfPage), inspectionReady: true,
      currentSourceKey: 'b', readSourceArrayBuffer: read };
    const { rerender } = await renderProbe(props);
    expect(read.mock.calls.map(([key]) => key)).toEqual(['b']);
    expect(getDocumentSignatures).toHaveBeenCalledTimes(1);
    expect(getDocumentSignatures.mock.calls[0][1]).toEqual({ transfer: true });
    await rerender({ ...props, currentSourceKey: 'd' });
    await act(async () => { pending.shift()(SIGNED_REPORT); });
    expect(read.mock.calls.map(([key]) => key)).toEqual(['b', 'd']);
    await act(async () => { pending.shift()(SIGNED_REPORT); });
    expect(read.mock.calls.map(([key]) => key)).toEqual(['b', 'd', 'a']);
    await act(async () => { pending.shift()(SIGNED_REPORT); });
    expect(read.mock.calls.map(([key]) => key)).toEqual(['b', 'd', 'a', 'c']);
    await act(async () => { pending.shift()(SIGNED_REPORT); });
  });

  it('drops removed documents and prevents recycled keys from inheriting pending results', async () => {
    const pending = [];
    getDocumentSignatures.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const props = { allPages: [pdfPage('src-a')], inspectionReady: true,
      readSourceArrayBuffer: vi.fn().mockImplementation(async () => new ArrayBuffer(8)) };
    const { probe, rerender } = await renderProbe(props);
    await rerender({ ...props, allPages: [] });
    await rerender(props);
    await act(async () => { pending.shift()(SIGNED_REPORT); });
    expect(probe.reports['src-a']).toBeUndefined();
    expect(getDocumentSignatures).toHaveBeenCalledTimes(2);
    await act(async () => { pending.shift()({ signatures: [] }); });
    expect(probe.reports['src-a']).toEqual({ signatures: [] });
  });

  it('does not inspect bytes that finish reading after unmount', async () => {
    let resolve;
    const read = vi.fn().mockReturnValue(new Promise((done) => { resolve = done; }));
    const { root } = await renderProbe({ allPages: [pdfPage('src-a')], inspectionReady: true, readSourceArrayBuffer: read });
    await act(() => root.unmount());
    await act(async () => { resolve(new ArrayBuffer(8)); });
    expect(getDocumentSignatures).not.toHaveBeenCalled();
  });
});
