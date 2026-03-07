# Architecture notes

This document is a maintainer-oriented overview of the main runtime flow.

## Startup flow

1. `src/app/bootConfig.js`
   - resolves application base path
   - probes and loads runtime configuration scripts
   - imports `src/index.jsx` only after configuration is available
2. `src/index.jsx`
   - mounts the React root
3. `src/app/AppBootstrap.jsx`
   - detects the active bootstrap mode
   - prepares props for the main viewer shell
4. `src/app/OpenDocViewer.jsx`
   - wires providers and global UI toggles
5. `src/components/DocumentConsumerWrapper.jsx`
   - bridges loader state into viewer state

## Bootstrap responsibilities

`src/integrations/` holds the startup adapters:

- `bootstrapRuntime.js` chooses the input source
- `parentBridge.js` reads same-origin parent-window data
- `sessionToken.js` reads token-based startup data
- `urlParams.js` supports legacy pattern mode
- `normalizePortableBundle.js` turns multiple host payload shapes into one neutral bundle shape

The rest of the application should not need to know which bootstrap source was used.

## Loading and rendering pipeline

`src/components/DocumentLoader/DocumentLoader.js` orchestrates loading.

High-level flow:

1. generate a list of source entries
2. fetch bytes
3. infer file type
4. choose processing path
   - PDF -> main-thread renderer
   - TIFF -> main-thread renderer
   - raster image -> worker pipeline
5. insert normalized page entries into `ViewerContext`

Rendering responsibilities are split further:

- `DocumentRender.jsx` chooses image vs. canvas presentation for the active page
- `ImageRenderer.jsx` handles plain image rendering
- `CanvasRenderer.jsx` handles canvas drawing and visual adjustments
- `DocumentViewer/*` manages stateful viewer composition
- `DocumentToolbar/*` manages toolbar UI and print dialog UI

## State ownership

The broad state split is:

- `ViewerContext`
  - shared page collection and viewer-wide data
- `useDocumentViewer()`
  - local viewer interaction state such as current page, zoom, compare mode, and image adjustments
- `ThemeContext`
  - theme selection and theme toggle actions

## Print flow

The print pipeline is deliberately separated from the viewer UI.

- `PrintRangeDialog.jsx` and `usePrintRangeDialog.js`
  - collect and validate user print options
- `printCore.js`
  - coordinates iframe-based printing
- `printDom.js`
  - builds printable DOM structures
- `printTemplate.js`
  - resolves print-header tokens
- `printParse.js`
  - parses ranges and custom page sequences

## Logging boundaries

The frontend can operate without the log servers.

- `src/logging/systemLogger.js`
  - structured operational logging from the client
- `src/logging/userLogger.js`
  - print-related user logging
- `server/*.js`
  - optional ingestion services

## Areas still suited for future splitting

The codebase works as-is, but these files still carry multiple responsibilities and are the most natural future split candidates:

- `src/components/DocumentLoader/DocumentLoader.js`
- `src/components/DocumentToolbar/DocumentToolbar.jsx`
- `src/components/DocumentRender.jsx`
- `src/utils/printCore.js`
