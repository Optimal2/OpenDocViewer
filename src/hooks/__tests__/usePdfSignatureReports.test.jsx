// @vitest-environment jsdom
// File: src/hooks/__tests__/usePdfSignatureReports.test.jsx
/**
 * Wiring contract for the level-1 signature inspector hook:
 *  - the inspector runs once per PDF source, only after the first page is ready;
 *  - non-PDF documents are never inspected;
 *  - the hook never blocks rendering (reports start empty and fill in async);
 *  - results are cached per document (sourceKey).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import usePdfSignatureReports from '../usePdfSignatureReports.js';
import { getDocumentSignatures } from '../../utils/pdfSignatureInspector.js';

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
  function Probe() {
    probe.reports = usePdfSignatureReports(props);
    return null;
  }
  await act(() => root.render(createElement(Probe)));
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

  it('stores an empty report when the source bytes are unavailable', async () => {
    const readSourceArrayBuffer = vi.fn().mockResolvedValue(null);
    const { root, container, probe } = await renderProbe({
      allPages: [pdfPage('src-a')],
      inspectionReady: true,
      readSourceArrayBuffer,
    });
    await flushMicrotasks();
    expect(getDocumentSignatures).not.toHaveBeenCalled();
    expect(probe.reports['src-a']).toEqual({ signatures: [] });
    await act(() => root.unmount());
    container.remove();
  });
});
