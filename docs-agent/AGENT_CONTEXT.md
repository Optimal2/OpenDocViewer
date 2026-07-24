# OpenDocViewer Agent Context

Generated: committed\-docs
Source commit: not embedded

## Project

- Package: opendocviewer
- Version: 2.7.0
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

- Source files: 114
- Source lines: 49419
- JSDoc symbols: 1316
- Files with JSDoc: 114
- Low-confidence summaries: 0
- Parse errors: 0

## High-Signal Files

- `src/utils/documentLoadingConfig.js` - OpenDocViewer — runtime helpers for fetch/render/memory policies.
- `src/utils/runtimeConfig.js` - Runtime configuration helpers.
- `src/logging/systemLogger.js` - src/logging/systemLogger.js OpenDocViewer — Frontend Logging Controller \(ESM\) \- Provide a small, dependency\-light logging facade for the browser app.
- `src/utils/printPdf.js` - OpenDocViewer — Generated PDF print backend.
- `src/utils/viewerPreferences.js` - Lightweight persisted viewer preferences.
- `src/contexts/viewerContext.js` - Exports ViewerContext.
- `src/utils/localizedValue.js` - Localized string resolver for admin\-supplied config values.
- `src/index.jsx` - OpenDocViewer — Application Entry \- Load global styles \(CSS variables \+ layout\).
- `src/utils/pdfPrintCacheKey.js` - Generated\-PDF cache key helpers.
- `src/utils/printTemplate.js` - OpenDocViewer — Print Templating &amp; Tokens Provide token context generation and safe token substitution where values are HTML\-escaped before insertion into admin\-authored print header/footer templates.
- `src/components/DocumentLoader/documentLoaderUtils.js` - OpenDocViewer — Loader Utilities Helper utilities used by the DocumentLoader pipeline: • Build document URL lists \(pattern mode and demo mode\) • Fetch as ArrayBuffer \(with optional AbortSignal\) • Page counting \(PDF / TIF
- `src/utils/supportDiagnostics.js` - Support diagnostics helpers for opt\-in troubleshooting tools.

## Agent Notes

- Use AGENT\_CONTEXT.md first, then SYMBOL\_INDEX.md by file path to avoid loading the whole symbol JSON.
