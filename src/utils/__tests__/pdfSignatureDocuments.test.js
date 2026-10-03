// File: src/utils/__tests__/pdfSignatureDocuments.test.js
/**
 * Per-document signature aggregation: signature reports are keyed per file
 * (sourceKey) while the thumbnail strip, the document symbol and the toolbar
 * overview work per document, and one document can consist of several files.
 */

import { describe, it, expect } from 'vitest';
import {
  buildSignatureDocuments,
  findSignatureDocumentBySourceKey,
  getPageSignatureDocumentKey,
  getSignatureFileHeading,
  getSignatureFilePages,
  getSourceFileNameFromUrl,
  summarizeSignatureDocuments,
} from '../pdfSignatureDocuments.js';

function page(sourceKey, allPagesIndex, documentNumber = 0, totalDocuments = 0, documentId = undefined) {
  return { sourceKey, allPagesIndex, documentNumber, totalDocuments, documentId };
}

function report(...signatures) {
  return { signatures };
}

/** Two documents: doc A = files a1 (2 pages) + a2 (1 page); doc B = file b1. */
const PAGES = [
  page('a1', 0, 1, 2, 'A'),
  page('a1', 1, 1, 2, 'A'),
  page('a2', 2, 1, 2, 'A'),
  page('b1', 3, 2, 2, 'B'),
];

describe('buildSignatureDocuments', () => {
  it('returns no documents (no symbol, no toolbar button) when nothing is signed', () => {
    expect(buildSignatureDocuments(PAGES, {})).toEqual([]);
    expect(buildSignatureDocuments(PAGES, { a1: report(), b1: { status: 'pending' } })).toEqual([]);
    expect(buildSignatureDocuments([], { a1: report({ integrity: 'intact' }) })).toEqual([]);
    expect(summarizeSignatureDocuments([])).toBe(null);
  });

  it('groups several signed files of one document and counts every signature', () => {
    const documents = buildSignatureDocuments(PAGES, {
      a1: report({ integrity: 'intact' }),
      a2: report({ integrity: 'intact' }, { integrity: 'intact' }),
    });
    expect(documents).toHaveLength(1);
    const [doc] = documents;
    expect(doc.key).toBe('A');
    expect(doc.documentNumber).toBe(1);
    expect(doc.totalDocuments).toBe(2);
    expect(doc.firstPageNumber).toBe(1);
    expect(doc.signatureCount).toBe(3);
    expect(doc.signedFiles.map((file) => [file.sourceKey, file.fileNumber, file.fileCount, file.signatureCount]))
      .toEqual([['a1', 1, 2, 1], ['a2', 2, 2, 2]]);
  });

  it('uses the worst severity across all files of the document', () => {
    const [doc] = buildSignatureDocuments(PAGES, {
      a1: report({ integrity: 'intact' }),
      a2: report({ integrity: 'modified-after-signing' }),
    });
    expect(doc.severity).toBe('warning');
    expect(doc.worstIntegrity).toBe('modified-after-signing');

    const [failed] = buildSignatureDocuments(PAGES, {
      a1: report({ integrity: 'digest-mismatch' }),
      a2: report({ integrity: 'intact', trust: 'valid' }),
    });
    expect(failed.severity).toBe('error');

    const [untrusted] = buildSignatureDocuments(PAGES, {
      a1: report({ integrity: 'intact', trust: 'valid' }),
      a2: report({ integrity: 'intact', trust: 'invalid' }),
    });
    expect(untrusted.severity).toBe('error');
    expect(untrusted.worstTrust).toBe('invalid');
  });

  it('keeps one entry per signed document in page order and reports the newest signature', () => {
    const documents = buildSignatureDocuments(PAGES, {
      b1: report(
        { integrity: 'intact', signer: 'Older Signer', signingTime: '2026-03-01T10:00:00Z' },
        { integrity: 'intact', signer: 'Newer Signer', signingTime: '2026-03-05T12:30:00Z' },
        { integrity: 'intact', signer: 'No Time' }
      ),
      a2: report({ integrity: 'intact', signer: 'Only Signer' }),
    });
    expect(documents.map((doc) => doc.key)).toEqual(['A', 'B']);
    expect(documents[1].firstPageNumber).toBe(4);
    expect(documents[1].newestSignature.signer).toBe('Newer Signer');
    expect(documents[0].newestSignature.signer).toBe('Only Signer');
  });

  it('treats each file as its own document when the pages carry no document context', () => {
    const documents = buildSignatureDocuments(
      [page('x', 0), page('y', 1), page('y', 2)],
      { x: report({ integrity: 'intact' }), y: report({ integrity: 'unsupported' }) }
    );
    expect(documents.map((doc) => [doc.documentNumber, doc.signatureCount, doc.severity]))
      .toEqual([[1, 1, 'ok'], [2, 1, 'warning']]);
    expect(documents[1].firstPageNumber).toBe(2);
  });

  it('adds file names from the optional resolver', () => {
    const [doc] = buildSignatureDocuments(PAGES, { a2: report({ integrity: 'intact' }) }, {
      getFileName: (sourceKey) => (sourceKey === 'a2' ? 'appendix.pdf' : ''),
    });
    expect(doc.signedFiles[0].fileName).toBe('appendix.pdf');
    expect(doc.files.map((file) => file.fileName)).toEqual(['', 'appendix.pdf']);
  });
});

describe('summarizeSignatureDocuments', () => {
  it('counts signed documents and takes the worst severity over all loaded files', () => {
    const documents = buildSignatureDocuments(PAGES, {
      a1: report({ integrity: 'intact' }),
      b1: report({ integrity: 'unsupported' }),
    });
    expect(summarizeSignatureDocuments(documents)).toEqual({
      documentCount: 2,
      signatureCount: 2,
      severity: 'warning',
    });
  });
});

describe('lookup helpers', () => {
  it('finds the document of a file and the document key of a page', () => {
    const documents = buildSignatureDocuments(PAGES, { a2: report({ integrity: 'intact' }) });
    expect(findSignatureDocumentBySourceKey(documents, 'a1')?.key).toBe('A');
    expect(findSignatureDocumentBySourceKey(documents, 'b1')).toBe(null);
    expect(getPageSignatureDocumentKey(PAGES[2])).toBe('A');
    expect(getPageSignatureDocumentKey(page('solo', 0))).toBe('file:solo');
  });

  it('derives a display file name only from a plain path segment', () => {
    expect(getSourceFileNameFromUrl('https://host.example/files/Report%201.pdf?x=1')).toBe('Report 1.pdf');
    expect(getSourceFileNameFromUrl('/ui/a.pdf')).toBe('a.pdf');
    expect(getSourceFileNameFromUrl('blob:https://host.example/123')).toBe('');
    expect(getSourceFileNameFromUrl('https://host.example/api/document/42')).toBe('');
    expect(getSourceFileNameFromUrl('')).toBe('');
  });

  it('records the page range of each file inside its document for the dialog', () => {
    const [doc] = buildSignatureDocuments(PAGES, { a1: report({ integrity: 'intact' }), a2: report({ integrity: 'intact' }) });
    expect(doc.files.map((file) => [file.firstPage, file.lastPage])).toEqual([[1, 2], [3, 3]]);
    // The thumbnail "S" number (documentPageNumber) wins when pages carry it.
    const numbered = [
      { ...page('x1', 0, 1, 2, 'X'), documentPageNumber: 18 },
      { ...page('x2', 1, 1, 2, 'X'), documentPageNumber: 19 },
      { ...page('x2', 2, 1, 2, 'X'), documentPageNumber: 24 },
    ];
    const [numberedDoc] = buildSignatureDocuments(numbered, { x2: report({ integrity: 'intact' }) });
    expect([numberedDoc.files[1].firstPage, numberedDoc.files[1].lastPage]).toEqual([19, 24]);
    const t = (key, options) => String(options.defaultValue);
    expect(getSignatureFilePages(t, numberedDoc.files[1])).toBe('Pages 19–24');
    expect(getSignatureFilePages(t, { firstPage: 3, lastPage: 3 })).toBe('Page 3');
    expect(getSignatureFilePages(t, {})).toBe('');
  });

  it('names the active file as "File k of m: name", or "File k of m" without a name', () => {
    const t = (key, options) => String(options.defaultValue);
    expect(getSignatureFileHeading(t, { fileNumber: 2, fileCount: 2, fileName: 'appendix.pdf' })).toBe('File 2 of 2: appendix.pdf');
    expect(getSignatureFileHeading(t, { fileNumber: 2, fileCount: 2, fileName: '' })).toBe('File 2 of 2');
  });
});
