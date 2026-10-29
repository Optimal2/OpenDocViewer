# OpenDocViewer / src/ocr

File count: 5. Line count: 386. JSDoc symbol count: 17.

## src/ocr/assetUrls.js

Resolves where the OCR worker, engine core and language models are loaded from.

Exports: `readOcrAssetManifest`, `resolveOcrAssetUrls`

Symbols:

- `OcrAssetManifest` (typedef) - No description.
- `OcrAssetUrls` (typedef) - No description.
- `readOcrAssetManifest` (function) - The manifest the build generated, or null when it is unusable.
- `resolveOcrAssetUrls` (function) - Turn the dist\-relative manifest paths into absolute URLs.

## src/ocr/engine.js

Thin wrapper around a tesseract.js worker.

Exports: `OCR_STARTUP_FAILURE`, `classifyOcrStartupError`, `flattenOcrWords`, `createOcrEngine`

Local imports: `src/logging/systemLogger.js`

Symbols:

- `OCR_STARTUP_FAILURE` (constant) - Why the engine could not start \(see classifyOcrStartupError\).
- `CSP` (member) - WebAssembly compilation refused: the site CSP lacks 'wasm\-unsafe\-eval' in script\-src.
- `ASSETS` (member) - The worker script, engine core or a language model could not be loaded.
- `UNKNOWN` (member) - Anything else.
- `classifyOcrStartupError` (function) - Classify a start\-up error by its message.
- `flattenOcrWords` (function) - Flatten tesseract.js' block tree into one word list with page\-pixel boxes.
- `OcrEngine` (typedef) - No description.
- `createOcrEngine` (function) - Create an engine for the given languages and asset URLs.

## src/ocr/index.js

Entry point of the OCR module: the one file the viewer imports, and only through \`src/utils/ocrLoader.js\` with \`import\(\)\` after \`isOcrEnabled\(\)\` returned true.

Exports: `createOcrEngine`, `classifyOcrStartupError`, `flattenOcrWords`, `OCR_STARTUP_FAILURE`, `readOcrAssetManifest`, `resolveOcrAssetUrls`, `KNOWN_OCR_LANGUAGES`, `partitionOcrLanguages`, `createConfiguredOcrEngine`, `describeOcrSetup`

## src/ocr/languages.js

Membership check for OCR language codes against the models tesseract.js knows.

Exports: `KNOWN_OCR_LANGUAGES`, `partitionOcrLanguages`

Symbols:

- `KNOWN_OCR_LANGUAGES` (constant) - Every language code tesseract.js lists a model for \(lower\-case, e.g.
- `partitionOcrLanguages` (function) - Split codes into those tesseract.js knows a model for and the rest.

## src/ocr/setup.js

Builds an OCR engine from the runtime configuration and reports configuration problems once.

Exports: `describeOcrSetup`, `createConfiguredOcrEngine`

Local imports: `src/utils/runtimeConfig.js`, `src/logging/systemLogger.js`, `src/ocr/assetUrls.js`, `src/ocr/engine.js`, `src/ocr/languages.js`

Symbols:

- `OcrSetup` (typedef) - No description.
- `describeOcrSetup` (function) - Resolve languages and asset URLs from the configuration, logging each problem once.
- `createConfiguredOcrEngine` (function) - Create an engine for the configured languages and asset location.
