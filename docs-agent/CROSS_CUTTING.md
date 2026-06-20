# Cross-Cutting Index

This index groups files by source-derived roles and risky source patterns. Treat it as a navigation aid, then inspect the source before editing.

## File Roles

### React Contexts

- `src/contexts/viewerContext.js` (207 lines) - Exports ViewerContext.
- `src/contexts/ViewerProvider.jsx` (2572 lines) - OpenDocViewer — Viewer state provider.
- `src/contexts/themeContext.js` (37 lines) - Create the Theme context with a safe default to avoid undefined access if a consumer is mounted outside the provider by mistake.
- `src/contexts/ThemeProvider.jsx` (202 lines) - src/contexts/ThemeProvider.jsx OpenDocViewer — Theme state context \(React\) Centralize theme handling with: \- explicit themes: normal / light / dark \- an implicit system\-following startup mode when the user has not chosen

### Hooks

- `src/components/DocumentToolbar/usePrintRangeDialog.js` (828 lines) - Hook \+ helpers for PrintRangeDialog.
- `src/components/DocumentViewer/useDocumentViewer.js` (1899 lines) - Primary viewer\-state hook.
- `src/hooks/useNavigationModifierState.js` (109 lines) - Shared modifier\-key state for navigation and compare\-aware viewer actions.
- `src/components/DocumentViewer/hooks/useViewerEffects.js` (557 lines) - File: src/components/DocumentViewer/hooks/useViewerEffects.js Cross\-cutting viewer effects: Sync zoomState.scale from numeric zoom Sticky Fit recomputation on relevant changes Res...
- `src/components/DocumentToolbar/usePdfPrebuildAllPages.js` (362 lines) - Background prebuild/cache for configured "all pages" generated\-PDF variants.
- `src/hooks/usePageTimer.js` (149 lines) - OpenDocViewer — Continuous Page Navigation Timer \(React hook\) Provide a tiny utility for press\-and\-hold page navigation: \- Invokes a caller\-supplied callback immediately \(leading edge\) and then repeatedly after an initia
- `src/components/DocumentViewer/hooks/useViewerPostZoom.js` (86 lines) - File: src/components/DocumentViewer/hooks/useViewerPostZoom.js Encapsulates per\-pane &amp;quot;post\-zoom&amp;quot; state &amp;amp; handlers used only in compare mode.
- `src/hooks/usePageNavigation.js` (182 lines) - OpenDocViewer — Page Navigation Hook \(React\) Provide memoized handlers for page navigation \(first/prev/next/last\) and continuous navigation timers suitable for press\-and\-hold UI \(e.g., mousedown\).
- `src/hooks/useAcceleratingHoldRepeat.js` (210 lines) - Reusable press\-and\-hold behavior for toolbar buttons.

### Workers

- `src/utils/pdfWorkerDispatcher.js` (451 lines) - OpenDocViewer \- generated PDF worker dispatcher.
- `src/utils/pageAssetWorkerPool.js` (320 lines) - OpenDocViewer — Page\-asset worker pool.
- `src/components/DocumentLoader/workerHandler.js` (301 lines) - OpenDocViewer — Worker orchestration &amp; message handling \- Create image workers for off\-main\-thread rasterization/conversion.
- `src/utils/pdfPageWorkerPool.js` (477 lines) - OpenDocViewer \- PDF page\-image worker pool.
- `src/workers/pdfWorker.js` (628 lines) - OpenDocViewer \- generated PDF worker.
- `src/workers/imageWorker.js` (500 lines) - OpenDocViewer — image / TIFF worker.
- `src/workers/pdfPageWorker.js` (433 lines) - OpenDocViewer \- PDF page image worker.

## Risky Source Patterns

### dangerouslySetInnerHTML

React raw HTML rendering.

- `src/components/DocumentToolbar/ManualOverlayDialog.jsx` lines 339 - Manual overlay that loads simple external HTML fragments from the public help folder.

### innerHTML

Direct DOM HTML assignment or access.

- `src/components/DocumentToolbar/ManualOverlayDialog.jsx` lines 100, 101, 102 - Manual overlay that loads simple external HTML fragments from the public help folder.
- `src/utils/printDom.js` lines 264 - OpenDocViewer — Print DOM Builder Safely construct the print iframe’s DOM using DOM APIs \(no doc.write\), wait until images reach a terminal state, then trigger window.print\(\).
