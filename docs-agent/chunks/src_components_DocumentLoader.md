# OpenDocViewer / src/components/DocumentLoader

File count: 8. Line count: 3984. JSDoc symbol count: 107.

## src/components/DocumentLoader/batchHandler.js

Batch scheduler entry point.

Exports: batchHandler

Local imports: src/logging/systemLogger.js

Symbols:

- `WorkerJob` (typedef) - A single decoding/rendering unit handed to a worker.
- `Batch` (typedef) - A batch groups one or more jobs of the same file type.
- `InsertPageAtIndex` (typedef) - Signature for the function that inserts a page record at a specific index.
- `WorkerMessageHandler` (typedef) - Handle a worker's message and insert results.
- `PUMP_DELAY_MS` (constant) - Small delay so the event loop can breathe between pumps (ms).
- `pump` (function) - Schedule a short, fair distribution pass: Assigns at most one batch per idle worker.
- `batchHandler` (constant) - Batch scheduler entry point.

## src/components/DocumentLoader/DemoControls.jsx

DemoControls — wraps DocumentLoader with demo-mode props and a small control UI.

Exports: DemoControls

Local imports: src/components/DocumentLoader/DocumentLoader.js

Symbols:

- `module.exports` (function) - DemoControls — wraps DocumentLoader with demo-mode props and a small control UI.

## src/components/DocumentLoader/DocumentLoader.js

Resolve source type information with a cheap signature-first path.

Exports: DocumentLoader

Local imports: src/contexts/viewerContext.js, src/logging/systemLogger.js, src/components/DocumentLoader/documentLoaderUtils.js, src/utils/documentLoadingConfig.js, src/components/DocumentLoader/LoadPressureDialog.jsx, src/utils/publicAssetUrl.js, src/utils/reloadCacheIdentity.js

Symbols:

- `DocumentSourceItem` (typedef) - No description.
- `DocumentLoaderProps` (typedef) - No description.
- `PagePlaceholderInput` (typedef) - No description.
- `FailedPlaceholderInput` (typedef) - No description.
- `ResolvedEntry` (typedef) - No description.
- `LoadPressureSummary` (typedef) - No description.
- `PageEstimateStats` (typedef) - No description.
- `PrefetchResult` (typedef) - No description.
- `createLimiter` (function) - No description.
- `inferUrlExtension` (function) - No description.
- `normalizeExtension` (function) - No description.
- `isSupportedSourceExtension` (function) - No description.

## src/components/DocumentLoader/documentLoaderUtils.js

Generate a list of document URLs using a simple pattern: 001..NNN + extension.

Exports: generateDocumentList, generateDemoList, fetchAndArrayBuffer, getTotalPages, getTiffMetadata, generateThumbnail

Local imports: src/logging/systemLogger.js, src/utils/pdfjsDocumentOptions.js

Symbols:

- `TRANSPARENT_1x1` (constant) - Tiny transparent PNG as a safe fallback when thumbnails cannot be produced.
- `generateDocumentList` (constant) - Generate a list of document URLs using a simple pattern: 001..NNN + extension.
- `generateDemoList` (constant) - Generate a list of demo document URLs by repeating or mixing sample files.
- `FetchOptions` (typedef) - Options for fetchAndArrayBuffer.
- `fetchAndArrayBuffer` (constant) - Fetch a resource and return its ArrayBuffer.
- `getTotalPages` (constant) - Determine total pages for a given document by inspecting its buffer and type.
- `getTiffMetadata` (constant) - Extract light-weight metadata from a TIFF buffer (best-effort).
- `generateThumbnail` (constant) - Create a small thumbnail data URL for a given image URL.

## src/components/DocumentLoader/LoadPressureDialog.jsx

Large-load warning dialog shown before / during very heavy loading runs.

Exports: LoadPressureDialog

Local imports: src/utils/documentLoadingConfig.js

Symbols:

- `LoadPressureDialogSummary` (typedef) - No description.
- `LoadPressureDialogProps` (typedef) - No description.
- `module.exports` (function) - Large-load warning dialog shown before / during very heavy loading runs.
- `LoadPressureDialog~tr` (function) - No description.

## src/components/DocumentLoader/mainThreadRenderer.js

Render PDF pages on the main thread and INSERT THEM DIRECTLY.

Exports: renderPDFInMainThread, renderTIFFInMainThread

Local imports: src/logging/systemLogger.js, src/components/DocumentLoader/documentLoaderUtils.js, src/utils/publicAssetUrl.js, src/utils/pdfjsDocumentOptions.js

Symbols:

- `RenderJob` (typedef) - Render job passed to the main-thread renderer.
- `InsertPageAtIndex` (typedef) - Signature for inserting a page structure into the page list at an index.
- `addToUrlRegistry` (function) - Track a created object URL so it can be revoked later.
- `__pdfWorkerInitialized` (member) - One-time init of pdf.js classic worker script URL (dev == build).
- `ensurePdfWorker` (function) - Ensure a pdf.js worker is ready for this runtime.
- `renderPDFInMainThread` (constant) - Render PDF pages on the main thread and INSERT THEM DIRECTLY.
- `getTagArray` (function) - Safely read a TIFF tag array from a utif2 IFD object.
- `buildOjpegJpeg` (function) - Build a standard JPEG Blob from an OJPEG (old-style JPEG-in-TIFF) IFD by concatenating the tables ( JPEGInterchangeFormat / Length : t513/t514) with the entropy-coded scan strips...
- `renderTIFFInMainThread` (constant) - Render TIFF pages on the main thread with an ultra-light OJPEG fast path: If Compression=6 (old-style JPEG-in-TIFF), reconstruct a standard JPEG stream by concatenating the JFIF/t...

## src/components/DocumentLoader/sources/explicitListSource.js

Convert a PortableDocumentBundle into a flat, ordered list of file URLs.

Exports: makeExplicitSource

Symbols:

- `ExplicitSourceList` (typedef) - OpenDocViewer — Explicit Source List Normalizer PURPOSE Convert a PortableDocumentBundle into a flat, ordered list of file entries that the loader can process deterministically.
- `PortableFile` (typedef) - A single file reference in a portable document.
- `PortableDoc` (typedef) - Portable document containing a list of files.
- `PortableDocumentBundle` (typedef) - Bundle containing multiple portable documents.
- `inferExtFromUrl` (function) - Infer a lowercase extension from a URL if present.
- `optionalText` (function) - No description.
- `firstDocumentField` (function) - No description.
- `metadataAliasValue` (function) - No description.
- `metadataFieldValue` (function) - No description.
- `resolveDocumentVersion` (function) - No description.
- `makeExplicitSource` (function) - Convert a PortableDocumentBundle into a flat, ordered list of file URLs.

## src/components/DocumentLoader/workerHandler.js

Create a new image worker instance.

Exports: createWorker, getNumberOfWorkers, handleWorkerMessage

Local imports: src/logging/systemLogger.js, src/components/DocumentLoader/mainThreadRenderer.js, src/components/DocumentLoader/documentLoaderUtils.js, src/utils/publicAssetUrl.js, ../../workers/imageWorker.js?worker

Symbols:

- `WorkerJob` (typedef) - A single job/result entry communicated between worker and main thread.
- `WorkerMessage` (typedef) - Worker → main message envelope.
- `InsertPageAtIndex` (typedef) - Signature for inserting a page structure into the viewer at a specific index.
- `HandleOpts` (typedef) - Options passed to the handler to coordinate main-thread rendering.
- `createWorker` (function) - Create a new image worker instance.
- `getNumberOfWorkers` (function) - Decide how many workers to spawn, leaving one logical core for the UI when possible.
- `addToUrlRegistry` (function) - Create / get a global URL registry and install unload cleanup once.
- `scheduleMainThread` (function) - Decide how to schedule/execute a main-thread render job based on options: If a queue ref is provided → push the job to the queue (deferred execution).
- `handleWorkerMessage` (constant) - Handle a message payload from an image worker and insert resulting page(s).
