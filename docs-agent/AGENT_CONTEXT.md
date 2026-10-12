# OpenDocViewer Agent Context

Generated: committed\-docs
Source commit: not embedded

## Project

- Package: opendocviewer
- Version: 2.10.0
- Description: Fast, lightweight document viewer \(PDF, TIFF, images\) built with React \+ Vite, with a token\-gated log server and runtime configuration.

## Read Order

1. Read this file.
2. Open `MODULES.md` for top-level structure.
3. Open `FILE_MAP.md` only for the area you need.
4. Open `ENTRYPOINTS.md` when you need startup, package scripts, or import hubs.
5. Open `CROSS_CUTTING.md` for hooks, contexts, workers, and risky source patterns.
6. Open `DEPENDENCIES.md` when external package behavior matters.
7. Open `BUDGET.md` when you need output size and token estimates.
8. Use `SYMBOL_INDEX.md` for JSDoc-backed APIs.
9. Use `agent-map.json` for tool-driven navigation.

## Stats

- Source files: 148
- Source lines: 60063
- JSDoc symbols: 1640
- Files with JSDoc: 148
- Low-confidence summaries: 0
- Parse errors: 0

## High-Signal Files

- `src/utils/documentLoadingConfig.js` - OpenDocViewer — runtime helpers for fetch/render/memory policies.
- `src/utils/runtimeConfig.js` - Runtime configuration helpers.
- `src/utils/compareTransform.js` - File: src/utils/compareTransform.js Free per\-page transform for the compare view: stepless scale, free pan and 0.1 degree rotation, one transform per compared page \( primary \= lef...
- `src/utils/imageAdjustments.js` - File: src/utils/imageAdjustments.js Per\-pane pixel adjustments \(brightness, contrast, grayscale, invert\) and the quarter turn the canvas draws.
- `src/utils/viewerPreferences.js` - Lightweight persisted viewer preferences.
- `src/utils/pdfSignatureStatus.js` - Signature UI status helpers for browser integrity and gateway trust.
- `src/logging/systemLogger.js` - src/logging/systemLogger.js OpenDocViewer — Frontend Logging Controller \(ESM\) \- Provide a small, dependency\-light logging facade for the browser app.
- `src/utils/printPdf.js` - OpenDocViewer — Generated PDF print backend.
- `src/utils/pdfResolution.js` - Pure, per\-page PDF display resolution policy shared by browser and worker renderers.
- `src/utils/pdfSignatureDocuments.js` - Per\-document aggregation of PDF signature reports.
- `src/contexts/viewerContext.js` - Per\-page compare transform \(utils/compareTransform.js\): scale multiplies the base zoom \(1 \= 100 %\), dx / dy are CSS px at transform scale 1, rotation is degrees in \[0, 360\).
- `src/utils/localizedValue.js` - Localized string resolver for admin\-supplied config values.

## Agent Notes

- Use AGENT\_CONTEXT.md first, then SYMBOL\_INDEX.md by file path to avoid loading the whole symbol JSON.
