# OpenDocViewer / src/ocr

File count: 17. Line count: 3886. JSDoc symbol count: 157.

## src/ocr/assetUrls.js

Resolves where the OCR worker, engine core and language models are loaded from.

Exports: `readOcrAssetManifest`, `resolveOcrAssetUrls`

Symbols:

- `OcrAssetManifest` (typedef) - No description.
- `OcrAssetUrls` (typedef) - No description.
- `readOcrAssetManifest` (function) - The manifest the build generated, or null when it is unusable.
- `resolveOcrAssetUrls` (function) - Turn the dist\-relative manifest paths into absolute URLs.

## src/ocr/benchmark.js

Opt\-in OCR benchmark \(\`ocr.benchmark.enabled\`\): recognises a sample of the loaded document's pages once per scenario and reports what each scenario cost, so a site can measure how many workers \(\`ocr.workerCount\`\), which

Exports: `OCR_BENCHMARK_SCHEMA`, `OCR_BENCHMARK_DEFAULTS`, `normalizeOcrBenchmarkConfig`, `expandOcrBenchmarkWorkerCounts`, `resolveOcrBenchmarkLanguages`, `planOcrBenchmarkScenarios`, `selectOcrBenchmarkPages`, `summarizeDurations`, `startMainThreadLagSampler`, `downscaleOcrImage`, `runOcrBenchmark`

Local imports: `src/logging/systemLogger.js`, `src/utils/runtimeConfig.js`, `src/utils/supportDiagnostics.js`, `src/ocr/classify.js`, `src/ocr/languages.js`, `src/ocr/prepareImage.js`, `src/ocr/setup.js`

Symbols:

- `OCR_BENCHMARK_DEFAULTS` (constant) - Defaults of ocr.benchmark beyond the switch.
- `LAG_SAMPLE_MS` (constant) - Period of the main\-thread lag sampler \(ms\): short enough to see a stalled frame, cheap enough to leave the result alone.
- `LAG_STALL_MS` (constant) - A lag sample above this counts as a stall the user would notice.
- `OcrBenchmarkConfig` (typedef) - No description.
- `integerIn` (function) - No description.
- `normalizeOcrBenchmarkConfig` (function) - Read ocr.benchmark with every value bounded; an unusable list falls back to its default.
- `expandOcrBenchmarkWorkerCounts` (function) - The worker counts a configured list stands for on this client: explicit counts as they are, 0 as every count from one up to the cores minus one \(bounded by MAX\_OCR\_WORKER\_COUNT, a...
- `resolveOcrBenchmarkLanguages` (function) - The languages the engine will load for a configuration: the configured codes \(form checked by getOcrLanguages\) less the ones with no model, as setup.js resolves them, and the defa...
- `OcrBenchmarkScenario` (typedef) - No description.
- `planOcrBenchmarkScenarios` (function) - The scenarios a configuration stands for: the worker counts with the languages the engine loads and the full image, then \(with one worker\) the single\-language variant when more th...
- `selectOcrBenchmarkPages` (function) - The pages to recognise: loaded pages the OCR queue would recognise \(not skipped by classifyPageSource\), sampled evenly over the document \(or the first ones\), at most pageLimit .
- `summarizeDurations` (function) - Summary statistics of a list of durations.

## src/ocr/boostBenchmark.js

Opt\-in OCR \*boost\* benchmark \(\`ocr.boostBenchmark.enabled\`\): the same measurement as benchmark.js, but above the worker counts the viewer itself will ever run.

Exports: `loadOcrBoostDependencies`, `OCR_BOOST_BENCHMARK_SCHEMA`, `BOOST_MAX_WORKER_COUNT`, `OCR_BOOST_BENCHMARK_DEFAULTS`, `BOOST_SKIP_REASON`, `BOOST_ABORT_REASON`, `normalizeOcrBoostBenchmarkConfig`, `describeOcrBoostCapacity`, `judgeOcrBoostScenario`, `readJsHeap`, `createBoostEnginePool`, `runOcrBoostBenchmark`

Local imports: `src/logging/systemLogger.js`, `src/utils/runtimeConfig.js`, `src/utils/supportDiagnostics.js`, `src/ocr/index.js`

Symbols:

- `borrowedModules` (member) - Memoised result of loadOcrBoostDependencies\(\).
- `loadOcrBoostDependencies` (function) - The measuring helpers of benchmark.js \(reused rather than reimplemented, so both benchmarks report the same statistics the same way\) and the engine pieces a scenario is built from...
- `BOOST_MAX_WORKER_COUNT` (constant) - Most workers a boost scenario may ask for.
- `OCR_BOOST_BENCHMARK_DEFAULTS` (constant) - Defaults of ocr.boostBenchmark beyond the switch.
- `ASSUMED_DEVICE_MEMORY_GIB` (constant) - Device memory assumed for a browser that does not report it \(Firefox, Safari\), in GiB.
- `HEAP_ABORT_FRACTION` (constant) - A used JS heap above this share of jsHeapSizeLimit ends the scenario before the page heap does.
- `BOOST_SKIP_REASON` (constant) - Reasons a scenario did not run; kept in the result so the gap in the curve is explained.
- `BOOST_ABORT_REASON` (constant) - Reasons a scenario stopped part\-way.
- `OcrBoostBenchmarkConfig` (typedef) - No description.
- `integerIn` (function) - No description.
- `fractionIn` (function) - No description.
- `normalizeOcrBoostBenchmarkConfig` (function) - Read ocr.boostBenchmark with every value bounded, as normalizeOcrBenchmarkConfig does for ocr.benchmark : a non\-numeric or out\-of\-range entry is dropped, and a list left with noth...

## src/ocr/classify.js

Decides, per page, whether OCR is worth running.

Exports: `OCR_PAGE_DECISION`, `OCR_SKIP_REASON`, `PDF_TEXT_LAYER_THRESHOLDS`, `classifyPageSource`, `assessPdfTextLayer`

Symbols:

- `OCR_PAGE_DECISION` (constant) - Decides, per page, whether OCR is worth running.
- `RECOGNIZE` (member) - Pixels only: recognise.
- `PROBE_TEXT` (member) - PDF: read the text layer first, recognise only when it is not usable.
- `SKIP` (member) - Not a page OCR can work on.
- `TEXT_LAYER` (member) - The PDF page has a usable text layer that could not be placed as words \(none of its text is upright, or the page has no size\); the viewer's own text wins.
- `UNSUPPORTED` (member) - A format the viewer does not rasterise into a page image.
- `FAILED_PAGE` (member) - The page failed to load; there is no image to recognise.
- `RASTER_EXTENSIONS` (constant) - The image formats the viewer rasterises \(utils/documentLoadingConfig.js isRasterImageExtension\).
- `PDF_TEXT_LAYER_THRESHOLDS` (constant) - Thresholds of assessPdfTextLayer; exported so the documentation and tests state the same numbers.
- `minCharacters` (member) - Fewer visible characters than this counts as an empty layer: page numbers, a stray header, or a short stamp on an otherwise scanned page.
- `minLetterShare` (member) - Below this share of letters and digits among visible characters the layer is garbled.
- `maxPrivateUseShare` (member) - Above this share of private\-use or replacement characters the layer is garbled.

## src/ocr/detectLanguage.js

Guess the language of a page's text among a few candidate languages, from its words alone.

Exports: `MIN_HITS`, `RUNNER_UP_RATIO`, `DETECTABLE_LANGUAGES`, `detectTextLanguage`

Symbols:

- `MIN_HITS` (constant) - Fewest function\-word hits the winning language needs.
- `RUNNER_UP_RATIO` (constant) - The winner must have at least this many times the runner\-up's score.
- `LETTER_SCORE` (constant) - Score a distinctive letter adds, and the most such letters that count.
- `FUNCTION_WORDS` (constant) - Common function words per language \(ISO 639\-1\), lower case.
- `DISTINCTIVE_LETTERS` (constant) - Letters that point at a language more than at its neighbours.
- `DETECTABLE_LANGUAGES` (constant) - The languages the guess knows function words for \(ISO 639\-1\).
- `TextLanguageGuess` (typedef) - No description.
- `detectTextLanguage` (function) - No description.

## src/ocr/engine.js

Thin wrapper around a tesseract.js worker.

Exports: `OCR_STARTUP_FAILURE`, `DEFAULT_OCR_START_TIMEOUT_MS`, `OCR_PAGE_SEGMENTATION_MODE`, `probeWebAssemblyCompilation`, `classifyOcrStartupError`, `flattenOcrWords`, `createOcrEngine`

Local imports: `src/logging/systemLogger.js`

Symbols:

- `OCR_STARTUP_FAILURE` (constant) - Why the engine could not start \(see classifyOcrStartupError\).
- `CSP` (member) - WebAssembly compilation refused: the site CSP lacks 'wasm\-unsafe\-eval' in script\-src.
- `ASSETS` (member) - The worker script, engine core or a language model could not be loaded.
- `TIMEOUT` (member) - The worker gave no answer within the start timeout.
- `UNKNOWN` (member) - Anything else.
- `DEFAULT_OCR_START_TIMEOUT_MS` (constant) - Default bound on worker start\-up \(core and models are a few MB; a stalled start stays silent otherwise\).
- `OCR_PAGE_SEGMENTATION_MODE` (constant) - Tesseract page segmentation mode every worker starts with: 3 \= fully automatic page segmentation without orientation and script detection \(the mode the tesseract command line uses...
- `EMPTY_WASM_MODULE` (constant) - The smallest valid WebAssembly module: magic number and version, nothing else.
- `probeWebAssemblyCompilation` (function) - Throw the browser's own error when WebAssembly modules cannot be compiled on this page, which under a Content\-Security\-Policy without 'wasm\-unsafe\-eval' is a CompileError that nam...
- `classifyOcrStartupError` (function) - Classify a start\-up error by its message.
- `flattenOcrWords` (function) - Flatten tesseract.js' block tree into one word list with page\-pixel boxes.
- `toError` (function) - No description.

## src/ocr/enginePool.js

A pool of OCR engines \(engine.js\) behind the one\-engine interface the queue \(queue.js\) uses, so that several pages \(the worker count, see setup.js\) can be recognised at the same time.

Exports: `createOcrEnginePool`

Symbols:

- `TERMINATED_MESSAGE` (constant) - Rejection for callers waiting on a free engine when the pool is terminated.
- `OcrEnginePool` (typedef) - No description.
- `createOcrEnginePool` (function) - No description.
- `createOcrEnginePool~takeIdle` (function) - A free entry now, a new one while under the limit, else null.
- `createOcrEnginePool~drop` (function) - Terminate one engine and forget it; the next acquisition creates a fresh one in its place.

## src/ocr/index.js

Entry point of the OCR module: the one file the viewer imports, and only through \`src/utils/ocrLoader.js\` with \`import\(\)\` after \`isOcrEnabled\(\)\` returned true.

Exports: `createOcrEngine`, `classifyOcrStartupError`, `flattenOcrWords`, `OCR_STARTUP_FAILURE`, `createOcrEnginePool`, `OCR_BENCHMARK_DEFAULTS`, `OCR_BENCHMARK_SCHEMA`, `downscaleOcrImage`, `expandOcrBenchmarkWorkerCounts`, `normalizeOcrBenchmarkConfig`, `planOcrBenchmarkScenarios`, `resolveOcrBenchmarkLanguages`, `runOcrBenchmark`, `selectOcrBenchmarkPages`, `startMainThreadLagSampler`, `summarizeDurations`, `loadOcrBoostBenchmark`, `readOcrAssetManifest`, `resolveOcrAssetUrls`, `KNOWN_OCR_LANGUAGES`, `partitionOcrLanguages`, `createConfiguredOcrEngine`, `describeOcrSetup`, `resolveOcrConcurrency`, `OCR_PAGE_DECISION`, `OCR_SKIP_REASON`, `PDF_TEXT_LAYER_THRESHOLDS`, `assessPdfTextLayer`, `classifyPageSource`, `DEFAULT_OPEN_PDF_DOCUMENTS`, `createPdfTextProber`, `PDF_TEXT_DEFAULT_ASCENT`, `PDF_TEXT_DEFAULT_DESCENT`, `pdfTextLayerWords`, `DEFAULT_OCR_CACHE_LIMIT`, `createOcrResultCache`, `OCR_WINDOW_AHEAD`, `OCR_WINDOW_BEHIND`, `maxOcrWindowSize`, `planOcrWindow`, `OCR_OUTCOME_SOURCE`, `OCR_PAGE_STATUS`, `createOcrQueue`, `DETECTABLE_LANGUAGES`, `MIN_HITS`, `RUNNER_UP_RATIO`, `detectTextLanguage`, `RULING_LINE_DILATE_PX`, `createEventLoopYield`, `removeRulingLines`, `removeRulingLinesAsync`, `rulingLineMinRunPx`, `OCR_LINE_REMOVAL_MAX_PIXELS`, `prepareOcrImage`

Local imports: `src/ocr/boostBenchmark.js`

## src/ocr/languages.js

Membership check for OCR language codes against the models tesseract.js knows.

Exports: `KNOWN_OCR_LANGUAGES`, `partitionOcrLanguages`

Symbols:

- `KNOWN_OCR_LANGUAGES` (constant) - Every language code tesseract.js lists a model for \(lower\-case, e.g.
- `partitionOcrLanguages` (function) - Split codes into those tesseract.js knows a model for and the rest.

## src/ocr/lineRemoval.js

Ruling\-line removal before recognition: the pre\-processing step for ruled tables and forms.

Exports: `RULING_LINE_DARK_LUMA`, `RULING_LINE_MIN_RUN_SHARE`, `RULING_LINE_MIN_RUN_FLOOR_PX`, `RULING_LINE_MIN_ASPECT`, `RULING_LINE_DILATE_PX`, `RULING_LINE_BAND_ROWS`, `rulingLineMinRunPx`, `rulingLineRemovalSteps`, `removeRulingLines`, `createEventLoopYield`, `yieldToEventLoop`, `removeRulingLinesAsync`

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

Reads a PDF page's own text layer through pdf.js so classify.js can decide whether OCR is needed at all, and, when the layer is usable, hands it over as words with boxes \(pdfTextWords.js\) so the page gets the same text l

Exports: `DEFAULT_OPEN_PDF_DOCUMENTS`, `createPdfTextProber`

Local imports: `src/utils/pdfjsDocumentOptions.js`, `src/ocr/classify.js`, `src/ocr/pdfTextWords.js`

Symbols:

- `DEFAULT_OPEN_PDF_DOCUMENTS` (constant) - Open pdf.js documents kept for neighbouring pages before the least recently used is closed.
- `defaultGetDocument` (function) - pdf.js loading task for a copy of the bytes \(pdf.js takes ownership of the buffer it is given\).
- `PdfTextProber` (typedef) - No description.
- `createPdfTextProber` (function) - No description.

## src/ocr/pdfTextWords.js

Word boxes from a PDF page's own text layer, in the shape the recognised words have, so that a page with real text gets the same text layer, search and read\-aloud as a recognised page \(components/OcrTextLayer.jsx, utils/

Exports: `PDF_TEXT_DEFAULT_ASCENT`, `PDF_TEXT_DEFAULT_DESCENT`, `pdfTextAdvanceWeight`, `multiplyTransforms`, `pdfTextLayerWords`

Symbols:

- `PDF_TEXT_DEFAULT_ASCENT` (constant) - pdf.js's own fallbacks for a font without metrics \(TextLayer: ascent 0.8, descent \-0.2\).
- `UPRIGHT_TOLERANCE` (constant) - Baselines turned by more than this \(radians\) from the viewport's x axis get no boxes.
- `SEAM_GAP_EM` (constant) - An item continues the previous one's word when it starts within this share of the font height after the previous item's end \(pdf.js writes a space into the string, or a separate s...
- `pdfTextAdvanceWeight` (function) - Rough advance of a character relative to a typical lowercase letter, used to share an item's width among its characters.
- `multiplyTransforms` (function) - pdf.js Util.transform : the product of two affine matrices \[a, b, c, d, e, f\].
- `placeItem` (function) - Where an upright item lies in the viewport, or null when it gets no box.
- `pdfTextLayerWords` (function) - No description.
- `pdfTextLayerWords~previous` (member) - The last placed item's end, for the seam test.
- `pdfTextLayerWords~pending` (member) - The word under construction, which the next item may continue.

## src/ocr/prepareImage.js

Turns the viewer's rendered page image into the image the OCR engine receives: measures it and, when \`ocr.removeRulingLines\` is on \(the default\), removes the ruling lines of tables and forms on a private copy \(lineRemova

Exports: `OCR_LINE_REMOVAL_MAX_PIXELS`, `prepareOcrImage`

Local imports: `src/logging/systemLogger.js`, `src/utils/runtimeConfig.js`, `src/ocr/lineRemoval.js`

Symbols:

- `CLEANED_IMAGE_TYPE` (constant) - The cleaned copy is encoded losslessly: a JPEG round trip would add its own artefacts.
- `OCR_LINE_REMOVAL_MAX_PIXELS` (constant) - Pages with more pixels than this are recognised as they are \(no copy\): bounds the peak memory.
- `defaultDecode` (function) - No description.
- `defaultCreateCanvas` (function) - No description.
- `releaseCanvas` (function) - Free the canvas backing store.
- `encodeCanvas` (function) - No description.
- `PreparedOcrImage` (typedef) - No description.
- `prepareOcrImage` (function) - No description.

## src/ocr/queue.js

The OCR page queue: \`concurrency\` pages at a time \(one by default\), bounded by the window \(window.js\), results in the in\-memory cache \(resultCache.js\).

Exports: `OCR_STEP_TIMEOUTS_MS`, `OCR_PAGE_STATUS`, `OCR_OUTCOME_SOURCE`, `createOcrQueue`

Local imports: `src/ocr/classify.js`

Symbols:

- `OCR_STEP_TIMEOUTS_MS` (constant) - Upper bounds per step, so a promise that never settles \(a pdf.js document that hangs, a page image that never arrives, a worker that stops answering\) fails the page instead of blo...
- `TIMEOUT_STEP` (constant) - Marker on the error of a step that exceeded its bound.
- `withTimeout` (function) - No description.
- `OCR_OUTCOME_SOURCE` (constant) - Where a done outcome's words come from \( source \).
- `RECOGNITION` (member) - The engine recognised the page image.
- `PDF_TEXT` (member) - The PDF page's own text layer, read through pdf.js; the engine never ran.
- `OcrQueueCandidate` (typedef) - No description.
- `OcrQueueSnapshot` (typedef) - No description.
- `OcrQueue` (typedef) - No description.
- `createOcrQueue` (function) - No description.
- `createOcrQueue~retained` (member) - null until retainSources is called: every source is retained.
- `createOcrQueue~abortJob` (function) - Abort one job's recognition: its worker on a pool, the engine as a whole otherwise.

## src/ocr/resultCache.js

In\-memory cache of OCR outcomes, one entry per document page.

Exports: `DEFAULT_OCR_CACHE_LIMIT`, `createOcrResultCache`

Symbols:

- `DEFAULT_OCR_CACHE_LIMIT` (constant) - Pages kept per session before the least recently used outcome is dropped.
- `OcrResultCache` (typedef) - No description.
- `createOcrResultCache` (function) - No description.

## src/ocr/setup.js

Builds an OCR engine from the runtime configuration and reports configuration problems once.

Exports: `describeOcrSetup`, `resolveOcrConcurrency`, `createConfiguredOcrEngine`

Local imports: `src/utils/runtimeConfig.js`, `src/logging/systemLogger.js`, `src/ocr/assetUrls.js`, `src/ocr/engine.js`, `src/ocr/enginePool.js`, `src/ocr/languages.js`

Symbols:

- `OcrSetup` (typedef) - No description.
- `reportedCores` (function) - No description.
- `reportedDeviceMemoryGiB` (function) - No description.
- `describeOcrSetup` (function) - Resolve languages, asset URLs and the worker count from the configuration, logging each problem once.
- `resolveOcrConcurrency` (function) - How many pages the queue should keep in flight for pageCount pending pages: the automatic plan for that many pages \(one worker per ocr.workerPolicy.pagesPerWorker \), never above t...
- `createConfiguredOcrEngine` (function) - Create an engine for the configured languages and asset location: one engine \(engine.js\) for a worker count of one, otherwise a pool of that many \(enginePool.js\) behind the same i...

## src/ocr/window.js

Which pages are queued for OCR: the visible page\(s\) and a fixed number of neighbours, and, when the site asks for the whole document, the rest after them.

Exports: `OCR_WINDOW_AHEAD`, `OCR_WINDOW_BEHIND`, `maxOcrWindowSize`, `planOcrWindow`

Symbols:

- `OCR_WINDOW_AHEAD` (constant) - Pages queued after each focus page.
- `OCR_WINDOW_BEHIND` (constant) - Pages queued before each focus page.
- `maxOcrWindowSize` (function) - No description.
- `planOcrWindow` (function) - Ordered page indexes to process: focus pages first, then the pages after them \(nearest first\), then the pages before them; with wholeDocument , then every remaining page, from the...
