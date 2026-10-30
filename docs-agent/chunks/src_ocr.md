# OpenDocViewer / src/ocr

File count: 12. Line count: 1575. JSDoc symbol count: 78.

## src/ocr/assetUrls.js

Resolves where the OCR worker, engine core and language models are loaded from.

Exports: `readOcrAssetManifest`, `resolveOcrAssetUrls`

Symbols:

- `OcrAssetManifest` (typedef) - No description.
- `OcrAssetUrls` (typedef) - No description.
- `readOcrAssetManifest` (function) - The manifest the build generated, or null when it is unusable.
- `resolveOcrAssetUrls` (function) - Turn the dist\-relative manifest paths into absolute URLs.

## src/ocr/classify.js

Decides, per page, whether OCR is worth running.

Exports: `OCR_PAGE_DECISION`, `OCR_SKIP_REASON`, `PDF_TEXT_LAYER_THRESHOLDS`, `classifyPageSource`, `assessPdfTextLayer`

Symbols:

- `OCR_PAGE_DECISION` (constant) - Decides, per page, whether OCR is worth running.
- `RECOGNIZE` (member) - Pixels only: recognise.
- `PROBE_TEXT` (member) - PDF: read the text layer first, recognise only when it is not usable.
- `SKIP` (member) - Not a page OCR can work on.
- `TEXT_LAYER` (member) - The PDF page has a usable text layer; the viewer's own text wins.
- `UNSUPPORTED` (member) - A format the viewer does not rasterise into a page image.
- `FAILED_PAGE` (member) - The page failed to load; there is no image to recognise.
- `RASTER_EXTENSIONS` (constant) - The image formats the viewer rasterises \(utils/documentLoadingConfig.js isRasterImageExtension\).
- `PDF_TEXT_LAYER_THRESHOLDS` (constant) - Thresholds of assessPdfTextLayer; exported so the documentation and tests state the same numbers.
- `minCharacters` (member) - Fewer visible characters than this counts as an empty layer: page numbers, a stray header, or a short stamp on an otherwise scanned page.
- `minLetterShare` (member) - Below this share of letters and digits among visible characters the layer is garbled.
- `maxPrivateUseShare` (member) - Above this share of private\-use or replacement characters the layer is garbled.

## src/ocr/engine.js

Thin wrapper around a tesseract.js worker.

Exports: `OCR_STARTUP_FAILURE`, `DEFAULT_OCR_START_TIMEOUT_MS`, `probeWebAssemblyCompilation`, `classifyOcrStartupError`, `flattenOcrWords`, `createOcrEngine`

Local imports: `src/logging/systemLogger.js`

Symbols:

- `OCR_STARTUP_FAILURE` (constant) - Why the engine could not start \(see classifyOcrStartupError\).
- `CSP` (member) - WebAssembly compilation refused: the site CSP lacks 'wasm\-unsafe\-eval' in script\-src.
- `ASSETS` (member) - The worker script, engine core or a language model could not be loaded.
- `TIMEOUT` (member) - The worker gave no answer within the start timeout.
- `UNKNOWN` (member) - Anything else.
- `DEFAULT_OCR_START_TIMEOUT_MS` (constant) - Default bound on worker start\-up \(core and models are a few MB; a stalled start stays silent otherwise\).
- `EMPTY_WASM_MODULE` (constant) - The smallest valid WebAssembly module: magic number and version, nothing else.
- `probeWebAssemblyCompilation` (function) - Throw the browser's own error when WebAssembly modules cannot be compiled on this page, which under a Content\-Security\-Policy without 'wasm\-unsafe\-eval' is a CompileError that nam...
- `classifyOcrStartupError` (function) - Classify a start\-up error by its message.
- `flattenOcrWords` (function) - Flatten tesseract.js' block tree into one word list with page\-pixel boxes.
- `toError` (function) - No description.
- `OcrEngine` (typedef) - No description.

## src/ocr/index.js

Entry point of the OCR module: the one file the viewer imports, and only through \`src/utils/ocrLoader.js\` with \`import\(\)\` after \`isOcrEnabled\(\)\` returned true.

Exports: `createOcrEngine`, `classifyOcrStartupError`, `flattenOcrWords`, `OCR_STARTUP_FAILURE`, `readOcrAssetManifest`, `resolveOcrAssetUrls`, `KNOWN_OCR_LANGUAGES`, `partitionOcrLanguages`, `createConfiguredOcrEngine`, `describeOcrSetup`, `OCR_PAGE_DECISION`, `OCR_SKIP_REASON`, `PDF_TEXT_LAYER_THRESHOLDS`, `assessPdfTextLayer`, `classifyPageSource`, `DEFAULT_OPEN_PDF_DOCUMENTS`, `createPdfTextProber`, `DEFAULT_OCR_CACHE_LIMIT`, `createOcrResultCache`, `OCR_WINDOW_AHEAD`, `OCR_WINDOW_BEHIND`, `maxOcrWindowSize`, `planOcrWindow`, `OCR_PAGE_STATUS`, `createOcrQueue`, `RULING_LINE_DILATE_PX`, `removeRulingLines`, `removeRulingLinesAsync`, `rulingLineMinRunPx`, `prepareOcrImage`

## src/ocr/languages.js

Membership check for OCR language codes against the models tesseract.js knows.

Exports: `KNOWN_OCR_LANGUAGES`, `partitionOcrLanguages`

Symbols:

- `KNOWN_OCR_LANGUAGES` (constant) - Every language code tesseract.js lists a model for \(lower\-case, e.g.
- `partitionOcrLanguages` (function) - Split codes into those tesseract.js knows a model for and the rest.

## src/ocr/lineRemoval.js

Ruling\-line removal before recognition: the pre\-processing step for ruled tables and forms.

Exports: `RULING_LINE_DARK_LUMA`, `RULING_LINE_MIN_RUN_SHARE`, `RULING_LINE_MIN_RUN_FLOOR_PX`, `RULING_LINE_MIN_ASPECT`, `RULING_LINE_DILATE_PX`, `RULING_LINE_BAND_ROWS`, `rulingLineMinRunPx`, `rulingLineRemovalSteps`, `removeRulingLines`, `removeRulingLinesAsync`

Symbols:

- `RULING_LINE_DARK_LUMA` (constant) - Dark pixels below this luma \(0..255\) count as ink.
- `RULING_LINE_MIN_RUN_SHARE` (constant) - Minimum run length as a share of the page's longer side: 0.2 inch on an 11.7 inch \(A4\) side.
- `RULING_LINE_MIN_RUN_FLOOR_PX` (constant) - Floor for the minimum run length, so a tiny image never takes glyph strokes for lines.
- `RULING_LINE_MIN_ASPECT` (constant) - A run is a line only when its length is at least this many times its thinnest thickness.
- `RULING_LINE_DILATE_PX` (constant) - Pixels painted white around every line pixel.
- `RULING_LINE_BAND_ROWS` (constant) - Rows between two yields of the generator.
- `THICKNESS_SAMPLES` (constant) - Positions along a run at which its thickness is sampled.
- `rulingLineMinRunPx` (function) - The minimum run length \(px\) for a page of the given size.
- `RulingLineRemovalOptions` (typedef) - No description.
- `thinnestHorizontal` (function) - Thinnest thickness of a horizontal run \(dark rows through it\) sampled along its length.
- `thinnestVertical` (function) - Thinnest thickness of a vertical run \(dark columns through it\) sampled along its length.
- `rulingLineRemovalSteps` (function) - Remove the ruling lines of an RGBA image in place, as a generator: each next\(\) processes one band of rows and the final value is the number of pixels painted white \(0 when the pag...

## src/ocr/pdfTextProbe.js

Reads a PDF page's own text layer through pdf.js so classify.js can decide whether OCR is needed at all.

Exports: `DEFAULT_OPEN_PDF_DOCUMENTS`, `createPdfTextProber`

Local imports: `src/utils/pdfjsDocumentOptions.js`, `src/ocr/classify.js`

Symbols:

- `DEFAULT_OPEN_PDF_DOCUMENTS` (constant) - Open pdf.js documents kept for neighbouring pages before the least recently used is closed.
- `defaultGetDocument` (function) - pdf.js loading task for a copy of the bytes \(pdf.js takes ownership of the buffer it is given\).
- `PdfTextProber` (typedef) - No description.
- `createPdfTextProber` (function) - No description.

## src/ocr/prepareImage.js

Turns the viewer's rendered page image into the image the OCR engine receives: measures it and, when \`ocr.removeRulingLines\` is on \(the default\), removes the ruling lines of tables and forms on a private copy \(lineRemova

Exports: `prepareOcrImage`

Local imports: `src/logging/systemLogger.js`, `src/utils/runtimeConfig.js`, `src/ocr/lineRemoval.js`

Symbols:

- `CLEANED_IMAGE_TYPE` (constant) - The cleaned copy is encoded losslessly: a JPEG round trip would add its own artefacts.
- `defaultDecode` (function) - No description.
- `defaultCreateCanvas` (function) - No description.
- `releaseCanvas` (function) - Free the canvas backing store.
- `encodeCanvas` (function) - No description.
- `PreparedOcrImage` (typedef) - No description.
- `prepareOcrImage` (function) - No description.

## src/ocr/queue.js

The OCR page queue: one page at a time, bounded by the window \(window.js\), results in the in\-memory cache \(resultCache.js\).

Exports: `OCR_STEP_TIMEOUTS_MS`, `OCR_PAGE_STATUS`, `createOcrQueue`

Local imports: `src/ocr/classify.js`

Symbols:

- `OCR_STEP_TIMEOUTS_MS` (constant) - Upper bounds per step, so a promise that never settles \(a pdf.js document that hangs, a page image that never arrives, a worker that stops answering\) fails the page instead of blo...
- `TIMEOUT_STEP` (constant) - Marker on the error of a step that exceeded its bound.
- `withTimeout` (function) - No description.
- `OcrQueueCandidate` (typedef) - No description.
- `OcrQueueSnapshot` (typedef) - No description.
- `OcrQueue` (typedef) - No description.
- `createOcrQueue` (function) - No description.
- `createOcrQueue~retained` (member) - null until retainSources is called: every source is retained.

## src/ocr/resultCache.js

In\-memory cache of OCR outcomes, one entry per document page.

Exports: `DEFAULT_OCR_CACHE_LIMIT`, `createOcrResultCache`

Symbols:

- `DEFAULT_OCR_CACHE_LIMIT` (constant) - Pages kept per session before the least recently used outcome is dropped.
- `OcrResultCache` (typedef) - No description.
- `createOcrResultCache` (function) - No description.

## src/ocr/setup.js

Builds an OCR engine from the runtime configuration and reports configuration problems once.

Exports: `describeOcrSetup`, `createConfiguredOcrEngine`

Local imports: `src/utils/runtimeConfig.js`, `src/logging/systemLogger.js`, `src/ocr/assetUrls.js`, `src/ocr/engine.js`, `src/ocr/languages.js`

Symbols:

- `OcrSetup` (typedef) - No description.
- `describeOcrSetup` (function) - Resolve languages and asset URLs from the configuration, logging each problem once.
- `createConfiguredOcrEngine` (function) - Create an engine for the configured languages and asset location.

## src/ocr/window.js

Which pages are queued for OCR: the visible page\(s\) and a fixed number of neighbours.

Exports: `OCR_WINDOW_AHEAD`, `OCR_WINDOW_BEHIND`, `maxOcrWindowSize`, `planOcrWindow`

Symbols:

- `OCR_WINDOW_AHEAD` (constant) - Pages queued after each focus page.
- `OCR_WINDOW_BEHIND` (constant) - Pages queued before each focus page.
- `maxOcrWindowSize` (function) - No description.
- `planOcrWindow` (function) - Ordered page indexes to process: focus pages first, then the pages after them \(nearest first\), then the pages before them.
