# OpenDocViewer Agent Context

Generated: committed-docs
Source commit: not embedded

## Project

- Package: opendocviewer
- Version: 2.6.3
- Description: Fast, lightweight document viewer (PDF, TIFF, images) built with React + Vite, with a token-gated log server and runtime configuration.

## Read Order

1. Read this file.
2. Open `MODULES.md` for top-level structure.
3. Open `FILE_MAP.md` only for the area you need.
4. Open `ENTRYPOINTS.md` when you need startup, package scripts, or import hubs.
5. Open `DEPENDENCIES.md` when external package behavior matters.
6. Use `SYMBOL_INDEX.md` for JSDoc-backed APIs.
7. Use `agent-map.json` for tool-driven navigation.

## Stats

- Source files: 109
- JSDoc symbols: 1266
- Files with JSDoc: 105
- Parse errors: 0

## High-Signal Files

- `src/utils/documentLoadingConfig.js` - Count PDF pages in a page descriptor list.
- `src/utils/runtimeConfig.js` - Read the merged runtime configuration from the browser environment.
- `src/utils/viewerPreferences.js` - Persist the user's theme mode preference.
- `src/utils/printPdf.js` - Build a PDF blob from page image URLs and print metadata.
- `src/logging/systemLogger.js` - Export a singleton instance (sufficient for app usage).
- `src/contexts/viewerContext.js` - Exports ViewerContext.
- `src/index.jsx` - Determine environment and set a sensible client-side log level.
- `src/utils/pdfPrintCacheKey.js` - Compare the content-affecting print settings that determine whether an existing generated PDF can be reused.
- `src/utils/printTemplate.js` - Resolve the configured copy/print-format marker text consistently across print backends.
- `src/utils/supportDiagnostics.js` - Download a JSON diagnostics payload in browser environments.
- `src/components/DocumentLoader/documentLoaderUtils.js` - Generate a list of document URLs using a simple pattern: 001..NNN + extension.
- `src/utils/documentMetadata.js` - Build a UI-friendly projection of one document's metadata.

## Agent Notes

- 4 files have no JSDoc doclets; AgentDocMap uses source-derived summaries for them.
- Use AGENT_CONTEXT.md first, then SYMBOL_INDEX.md by file path to avoid loading the whole symbol JSON.
