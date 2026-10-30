# OpenDocViewer / src/workers

File count: 4. Line count: 1637. JSDoc symbol count: 5.

## src/workers/imageWorker.js

OpenDocViewer — image / TIFF worker.

Symbols:

- `createFallbackMainThreadError` (function) - Creates an error that tells the caller this worker path is unsupported and should be retried on the main thread.

## src/workers/pdfPageWorker.js

OpenDocViewer \- PDF page image worker.

Local imports: `src/utils/pdfjsDocumentOptions.js`, `src/utils/pdfResolution.js`

Symbols:

- `PdfCacheEntry` (typedef) - No description.

## src/workers/pdfSignatureWorker.js

Web worker entry for PDF signature inspection.

Local imports: `src/utils/pdfSignatures.js`, `src/utils/pdfjsDocumentOptions.js`

Symbols:

- `module:workers/pdfSignatureWorker` (module) - Web worker entry for PDF signature inspection.
- `module:workers/pdfSignatureWorker~loadPdfjs` (function) - The viewer's pdf.js build, loaded only when an appended revision needs the differential confirmation.

## src/workers/pdfWorker.js

OpenDocViewer \- generated PDF worker.

Symbols:

- `workerScope` (constant) - OpenDocViewer \- generated PDF worker.
