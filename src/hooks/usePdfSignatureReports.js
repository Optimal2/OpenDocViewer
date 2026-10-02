// File: src/hooks/usePdfSignatureReports.js
/**
 * Level-1 PDF signature wiring.
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

const EMPTY_REPORT = { signatures: [] };

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
 * @returns {Object<string, *>} Map of sourceKey to PdfSignatureReport.
 */
export default function usePdfSignatureReports({ allPages, inspectionReady, readSourceArrayBuffer }) {
  const [reports, setReports] = useState(/** @type {Object<string, *>} */ ({}));
  /** sourceKeys already inspected or in flight: one inspector call per document, ever. */
  const requestedRef = useRef(/** @type {Set<string>} */ (new Set()));
  const generationRef = useRef(0);

  useEffect(() => {
    const pages = Array.isArray(allPages) ? allPages : [];
    if (pages.length <= 0) {
      // Session torn down or not started: drop cached reports so a new
      // session with recycled sourceKeys cannot inherit stale results.
      generationRef.current += 1;
      requestedRef.current = new Set();
      setReports((previous) => (Object.keys(previous).length > 0 ? {} : previous));
      return undefined;
    }
    if (!inspectionReady || typeof readSourceArrayBuffer !== 'function') return undefined;

    const generation = generationRef.current;
    let cancelled = false;

    const sourceKeys = [];
    for (const page of pages) {
      if (!isPdfPage(page)) continue;
      const sourceKey = String(page?.sourceKey || '');
      if (!sourceKey || requestedRef.current.has(sourceKey)) continue;
      requestedRef.current.add(sourceKey);
      sourceKeys.push(sourceKey);
    }

    for (const sourceKey of sourceKeys) {
      void (async () => {
        let report = EMPTY_REPORT;
        try {
          const bytes = await readSourceArrayBuffer(sourceKey);
          if (bytes) {
            report = await getDocumentSignatures(new Uint8Array(bytes));
          }
        } catch {
          report = EMPTY_REPORT;
        }
        if (cancelled || generationRef.current !== generation) return;
        const finalReport = report && Array.isArray(report.signatures) ? report : EMPTY_REPORT;
        setReports((previous) => (previous[sourceKey] ? previous : { ...previous, [sourceKey]: finalReport }));
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [allPages, inspectionReady, readSourceArrayBuffer]);

  return reports;
}
