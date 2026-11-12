# Cross-Cutting Index

This index groups files by source-derived roles and risky source patterns. Treat it as a navigation aid, then inspect the source before editing.

## File Roles

### React Contexts

- `src/contexts/viewerContext.js` (265 lines) - Per\-page compare transform \(utils/compareTransform.js\): scale multiplies the base zoom \(1 \= 100 %\), dx / dy are CSS px at transform scale 1, rotation is degrees in \[0, 360\).
- `src/contexts/ViewerProvider.jsx` (2939 lines) - OpenDocViewer — Viewer state provider.
- `src/contexts/ThemeProvider.jsx` (343 lines) - src/contexts/ThemeProvider.jsx OpenDocViewer — Theme state context \(React\) Centralize theme handling with: \- explicit themes: normal / light / dark \- an implicit system\-following startup mode when the user has not chosen
- `src/contexts/readAloudContext.js` (41 lines) - The read\-aloud state shared by the page's context menu \("Read the selection aloud" / "Stop reading aloud", components/ReadAloudMenuItem.jsx\) and the toolbar's language menu \(the "Reading language" section, DocumentToolba
- `src/contexts/themeContext.js` (41 lines) - Create the Theme context with a safe default to avoid undefined access if a consumer is mounted outside the provider by mistake.

### Hooks

- `src/components/DocumentViewer/hooks/useViewerEffects.js` (123 lines) - File: src/components/DocumentViewer/hooks/useViewerEffects.js Cross\-cutting viewer effects.
- `src/components/DocumentToolbar/usePrintPipeline.js` (800 lines) - File: src/components/DocumentToolbar/usePrintPipeline.js The ONE print pipeline of the viewer: print dialog target, print options, user print log, the direct\-versus\-generated\-PDF...
- `src/components/DocumentToolbar/usePrintRangeDialog.js` (671 lines) - Hook \+ helpers for PrintRangeDialog.
- `src/components/DocumentViewer/useDocumentViewer.js` (1918 lines) - Primary viewer\-state hook.
- `src/hooks/useOcrTextLayers.js` (459 lines) - Runs OCR for the pages near the viewer's focus and exposes the outcomes per page.
- `src/components/DocumentViewer/hooks/usePaneImageAdjustments.js` (181 lines) - File: src/components/DocumentViewer/hooks/usePaneImageAdjustments.js Per\-pane image adjustments \(brightness, contrast, grayscale, invert\) and the resets that combine them with the...
- `src/hooks/useNavigationModifierState.js` (109 lines) - Shared modifier\-key state for navigation and compare\-aware viewer actions.
- `src/components/DocumentToolbar/usePdfPrebuildAllPages.js` (367 lines) - Background prebuild/cache for configured "all pages" generated\-PDF variants.
- `src/hooks/usePageTimer.js` (149 lines) - OpenDocViewer — Continuous Page Navigation Timer \(React hook\) Provide a tiny utility for press\-and\-hold page navigation: \- Invokes a caller\-supplied callback immediately \(leading edge\) and then repeatedly after an initia
- `src/hooks/useReadAloud.js` (242 lines) - Read the selected recognised text aloud: the state behind the page's context menu entry and the toolbar's "Reading language" section \(contexts/readAloudContext.js\).
- `src/components/DocumentViewer/hooks/useViewerKeyboardNavigation.js` (311 lines) - Global keyboard navigation, zoom, rotation, and selection shortcuts for DocumentViewer.
- `src/components/DocumentViewer/hooks/useCompareOverlay.js` (186 lines) - File: src/components/DocumentViewer/hooks/useCompareOverlay.js Open/close state of the compare overlay view \(CompareOverlayView.jsx\).
- `src/hooks/useKeyTipsHeld.js` (67 lines) - Whether the key tips key \(\`?\`\) is held: the one piece of the key tips \(components/KeyTips.jsx\) that lives while the viewer runs.
- `src/hooks/usePageNavigation.js` (182 lines) - OpenDocViewer — Page Navigation Hook \(React\) Provide memoized handlers for page navigation \(first/prev/next/last\) and continuous navigation timers suitable for press\-and\-hold UI \(e.g., mousedown\).
- `src/components/DocumentViewer/hooks/useCompareTransforms.js` (101 lines) - File: src/components/DocumentViewer/hooks/useCompareTransforms.js Viewer\-side access to the free per\-page compare transform kept in the viewer context \(utils/compareTransform.js,...

### Workers

- `src/utils/pdfWorkerDispatcher.js` (451 lines) - OpenDocViewer \- generated PDF worker dispatcher.
- `src/utils/pageAssetWorkerPool.js` (320 lines) - OpenDocViewer — Page\-asset worker pool.
- `src/components/DocumentLoader/workerHandler.js` (301 lines) - OpenDocViewer — Worker orchestration & message handling \- Create image workers for off\-main\-thread rasterization/conversion.
- `src/utils/pdfPageWorkerPool.js` (479 lines) - OpenDocViewer \- PDF page\-image worker pool.
- `src/ocr/prepareWorker.js` (85 lines) - OpenDocViewer — OCR image preparation worker.
- `src/workers/pdfWorker.js` (628 lines) - OpenDocViewer \- generated PDF worker.
- `src/workers/imageWorker.js` (500 lines) - OpenDocViewer — image / TIFF worker.
- `src/workers/pdfPageWorker.js` (441 lines) - OpenDocViewer \- PDF page image worker.
- `src/workers/pdfSignatureWorker.js` (80 lines) - Web worker entry for PDF signature inspection.

## Risky Source Patterns

### dangerouslySetInnerHTML

React raw HTML rendering.

- `src/components/Manual/ManualView.jsx` lines 854 - Shared manual body: loads the configured manual source for the current UI language, filters the standard manual by enabled features, renders a contents tree built from the h2/h3 headings, an in\-manual search with highlig

### innerHTML

Direct DOM HTML assignment or access.

- `src/components/Manual/manualDocument.js` lines 332, 333, 334 - Manual source loading and HTML preparation shared by every manual host \(the overlay dialog and a full\-page view\).
- `src/utils/printDom.js` lines 264 - OpenDocViewer — Print DOM Builder Safely construct the print iframe’s DOM using DOM APIs \(no doc.write\), wait until images reach a terminal state, then trigger window.print\(\).
- `src/utils/standardManual.js` lines 566 - Filter and sanitize the bundled standard manual for a supplied runtime config.
