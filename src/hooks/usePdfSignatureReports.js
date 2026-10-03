// File: src/hooks/usePdfSignatureReports.js
/**
 * Browser PDF signature inspection and optional gateway trust enrichment.
 *
 * Watches the viewer's pages and, once the first page is ready (so page
 * rendering is never blocked or delayed), inspects every loaded PDF document
 * exactly once with the bytes the viewer already holds in its source temp
 * store — the file is never fetched again. Reports are cached per document
 * (sourceKey) for the lifetime of the session. Non-PDF documents are never
 * inspected. The inspection itself runs off the main thread inside the
 * signature worker (see utils/pdfSignatureInspector.js).
 *
 * @module hooks/usePdfSignatureReports
 */

import { useEffect, useRef, useState } from 'react';
import { getDocumentSignatures } from '../utils/pdfSignatureInspector.js';
import { unreadableSignatureReport } from '../utils/pdfSignatures.js';
import { createGatewaySignatureClient } from '../utils/pdfSignatureGateway.js';

const INSPECTION_CONCURRENCY = 1;

/**
 * @param {*} page
 * @returns {boolean}
 */
function isPdfPage(page) {
  return String(page?.fileExtension || '').toLowerCase() === 'pdf';
}

/**
 * @param {Object} options
 * @param {Array<*>} options.allPages Viewer pages (each carries sourceKey/fileExtension).
 * @param {boolean} options.inspectionReady True once the first page is shown;
 * inspection never starts before that so rendering keeps priority.
 * @param {function(string): Promise<(ArrayBuffer|null)>} options.readSourceArrayBuffer
 * Reads the already-loaded source bytes for a sourceKey.
 * @param {string} [options.currentSourceKey] Visible document, prioritized before queued documents.
 * @param {function(string): string} [options.getSourceUrl] Registered document source URL.
 * @returns {Object<string, *>} Map of sourceKey to PdfSignatureReport.
 */
export default function usePdfSignatureReports({ allPages, inspectionReady, readSourceArrayBuffer, currentSourceKey, getSourceUrl }) {
  const [reports, setReports] = useState(/** @type {Object<string, *>} */ ({}));
  // Entry identity separates removed/reloaded documents even when sourceKeys are reused.
  const entriesRef = useRef(new Map());
  const mountedRef = useRef(false);
  const activeRef = useRef(0);
  const pumpRef = useRef(() => {});
  const gatewayRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    gatewayRef.current = createGatewaySignatureClient();
    const entries = entriesRef.current;
    return () => {
      mountedRef.current = false;
      entries.clear();
      pumpRef.current = () => {};
    };
  }, []);

  useEffect(() => {
    const pages = Array.isArray(allPages) ? allPages : [];
    const sourceKeys = new Set();
    for (const page of pages) {
      if (!isPdfPage(page)) continue;
      const sourceKey = String(page?.sourceKey || '');
      if (sourceKey) sourceKeys.add(sourceKey);
    }
    const entries = entriesRef.current;
    for (const key of entries.keys()) {
      if (!sourceKeys.has(key)) entries.delete(key);
    }
    setReports((previous) => {
      const retained = Object.entries(previous).filter(([key]) => sourceKeys.has(key));
      return retained.length === Object.keys(previous).length ? previous : Object.fromEntries(retained);
    });
    for (const key of sourceKeys) {
      if (!entries.has(key)) entries.set(key, { state: 'requested' });
    }
    const orderedKeys = [...sourceKeys];
    if (sourceKeys.has(currentSourceKey)) {
      orderedKeys.splice(orderedKeys.indexOf(currentSourceKey), 1);
      orderedKeys.unshift(currentSourceKey);
    }
    pumpRef.current = () => {
      if (!mountedRef.current || !inspectionReady || typeof readSourceArrayBuffer !== 'function') return;
      for (const sourceKey of orderedKeys) {
        if (activeRef.current >= INSPECTION_CONCURRENCY) break;
        const entry = entries.get(sourceKey);
        if (entry?.state !== 'requested') continue;
        entry.state = 'pending';
        activeRef.current += 1;
        void (async () => {
          const isCurrent = () => mountedRef.current && entries.get(sourceKey) === entry;
          let report;
          try {
            const bytes = await readSourceArrayBuffer(sourceKey);
            if (!isCurrent()) return;
            if (!bytes) throw new Error('PDF source bytes are unavailable');
            report = await getDocumentSignatures(new Uint8Array(bytes), { transfer: true });
            if (!Array.isArray(report?.signatures)) throw new Error('Signature inspection returned no report');
            if (!isCurrent()) return;
            // Publish browser integrity before waiting for optional server trust.
            setReports((previous) => ({ ...previous, [sourceKey]: report }));
            report = await gatewayRef.current.enrich(report, getSourceUrl?.(sourceKey));
            entry.state = 'done';
          } catch (error) {
            entry.state = 'failed';
            report = unreadableSignatureReport(String(error?.message || error));
          } finally {
            if (isCurrent() && report) {
              setReports((previous) => ({ ...previous, [sourceKey]: report }));
            }
            activeRef.current -= 1;
            pumpRef.current();
          }
        })();
      }
    };
    pumpRef.current();
  }, [allPages, inspectionReady, readSourceArrayBuffer, currentSourceKey, getSourceUrl]);

  return reports;
}
