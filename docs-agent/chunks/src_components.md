# OpenDocViewer / src/components

File count: 13. Line count: 6612. JSDoc symbol count: 82.

## src/components/CanvasRenderer.jsx

OpenDocViewer — Absolute\-positioned Canvas Renderer Render a &lt;canvas&gt; element for a single page at a specified zoom factor.

Exports: `CanvasRenderer`

Symbols:

- `CanvasRenderer` (constant) - CanvasRenderer component.

## src/components/DocumentConsumerWrapper.jsx

OpenDocViewer — Consumer Wrapper for Loader \+ Viewer Orchestrates the document loading pipeline and the main viewer UI: • Pattern mode: \{ folder, extension, endNumber \} • Explicit\-list: \{ sourceList: \[\{ url, ext?, fileIn

Exports: `DocumentConsumerWrapper`

Local imports: `src/contexts/viewerContext.js`, `src/logging/systemLogger.js`

Symbols:

- `SourceItem` (typedef) - An item for explicit\-list mode.
- `DocumentConsumerWrapper` (function) - DocumentConsumerWrapper Wraps DocumentLoader \+ DocumentViewer and switches between full viewer and a thumbnail\-only presentation on small/mobile layouts.

## src/components/DocumentMetadataMatrixOverlayDialog.jsx

Session\-wide document metadata matrix overlay.

Exports: `DocumentMetadataMatrixOverlayDialog`

Symbols:

- `module.exports` (function) - No description.
- `<anonymous>~handleEscape` (function) - No description.

## src/components/DocumentMetadataOverlayDialog.jsx

Document metadata overlay shown from viewer\-owned context menus.

Exports: `DocumentMetadataOverlayDialog`

Symbols:

- `module.exports` (function) - No description.
- `<anonymous>~handleEscape` (function) - No description.

## src/components/DocumentRender.jsx

OpenDocViewer — Active page renderer.

Exports: `DocumentRender`

Local imports: `src/contexts/viewerContext.js`, `src/logging/systemLogger.js`, `src/components/ImageRenderer.jsx`, `src/components/CanvasRenderer.jsx`, `src/components/LoadingMessage.jsx`, `src/utils/zoomUtils.js`, `src/utils/documentLoadingConfig.js`, `src/utils/renderSurfaceBounds.js`

Symbols:

- `getCurrentPage` (function) - No description.
- `normalizeSize` (function) - No description.
- `hasUsableSize` (function) - No description.
- `isBlobAssetUrl` (function) - No description.
- `DisplayedAsset` (typedef) - No description.
- `DocumentRender` (constant) - No description.
- `<anonymous>~resetAssetRetry` (constant) - Reset the per\-page blob\-URL retry tracker after a successful load or when the target page changes.
- `<anonymous>~clearLoadingOverlayTimer` (constant) - No description.
- `<anonymous>~claimAssetRetry` (constant) - No description.
- `<anonymous>~resolveCustomFitOptions` (constant) - No description.
- `<anonymous>~drawImageOnCanvas` (constant) - No description.
- `<anonymous>~getActiveRenderSurface` (constant) - Returns the surface whose intrinsic size should drive fit calculations.

## src/components/DocumentSelectionPanel.jsx

Hierarchical page\-selection editor shown inside the thumbnail pane.

Exports: `DocumentSelectionPanel`

Symbols:

- `SelectionCheckboxRow` (function) - No description.
- `module.exports` (function) - No description.

## src/components/DocumentThumbnailList.jsx

OpenDocViewer — Deterministic thumbnail strip.

Exports: `DocumentThumbnailList`

Local imports: `src/contexts/viewerContext.js`, `src/logging/systemLogger.js`, `src/components/LoadingSpinner.jsx`, `src/utils/documentLoadingConfig.js`, `src/utils/publicAssetUrl.js`, `src/utils/documentMetadata.js`

Symbols:

- `ThumbnailRowProps` (typedef) - No description.
- `clamp` (function) - No description.
- `shouldWarmAllThumbnails` (function) - No description.
- `getThumbnailLayout` (function) - No description.
- `formatMetricFraction` (function) - No description.
- `formatMetricValue` (function) - No description.
- `getSessionPageIndex` (function) - No description.
- `isIndexInRange` (function) - No description.
- `buildCenterOutQueue` (function) - Build a center\-out thumbnail warm\-up order so the pane feels responsive around the user's current scroll target instead of always starting from page 1.
- `getPageDocumentKey` (function) - No description.
- `getPageDocumentContext` (function) - No description.
- `getMetricTitles` (function) - No description.

## src/components/ImageRenderer.jsx

OpenDocViewer — Absolute\-positioned Image Renderer Render a single page image at a specified zoom factor.

Exports: `ImageRenderer`

Symbols:

- `ImgEventHandler` (typedef) - Image load/error handler.
- `ImageRenderer` (constant) - ImageRenderer component.

## src/components/LoadingMessage.jsx

OpenDocViewer — Loading / Error Message Simple, accessible message block that reflects the current page load status.

Exports: `LoadingMessage`

Local imports: `src/utils/publicAssetUrl.js`

Symbols:

- `LoadingMessage` (function) - LoadingMessage component.

## src/components/LoadingSpinner.jsx

OpenDocViewer — Loading Spinner Minimal, accessible loading indicator.

Exports: `LoadingSpinner`

Symbols:

- `srOnlyStyle` (constant) - Inline “visually hidden” style for screen\-reader\-only text \(no CSS dependency\).
- `LoadingSpinner` (function) - LoadingSpinner component.
- `LoadingSpinner.propTypes.size` (member) - Optional width/height; if omitted, CSS controls dimensions.
- `LoadingSpinner.propTypes.label` (member) - Accessible label announced by assistive technologies.
- `LoadingSpinner.propTypes.className` (member) - Extra classes to append to the root element.

## src/components/PrintSelectionWorkspace.jsx

Full\-window print\-selection workspace.

Exports: `PrintSelectionWorkspace`

Local imports: `src/utils/publicAssetUrl.js`, `src/utils/localizedValue.js`, `src/utils/printSanitize.js`

Symbols:

- `<anonymous>~handleKeyDown` (function) - No description.
- `<anonymous>~handleKeyDown` (function) - No description.
- `<anonymous>~handleMove` (function) - No description.
- `<anonymous>~handleDone` (function) - No description.

## src/components/Resizer.jsx

OpenDocViewer — Resizer Small, focusable separator used to let users resize adjacent panels \(e.g., sidebar/content\) via mouse drag or keyboard interaction.

Exports: `Resizer`

Symbols:

- `ResizeStartHandler` (typedef) - Handler invoked when a resize interaction is initiated.
- `ResizerProps` (typedef) - Props for .
- `Resizer` (constant) - Resizer component.
- `<anonymous>~handleKeyDown` (constant) - Keyboard handler \(Enter/Space\) to initiate the same flow as mouse down.
- `Resizer.propTypes.onMouseDown` (member) - Initiates resize in the parent \(mouse or keyboard\-initiated\).
- `Resizer.propTypes.orientation` (member) - Visual/semantic orientation of the separator.
- `Resizer.propTypes.ariaLabel` (member) - Accessible name for assistive technologies.
- `Resizer.propTypes.className` (member) - Extra class names to append to the root element.

## src/components/ViewerProblemNotice.jsx

OpenDocViewer — configurable viewer\-level problem notice.

Exports: `ViewerProblemNotice`

Local imports: `src/utils/runtimeConfig.js`, `src/utils/localizedValue.js`

Symbols:

- `toCount` (function) - No description.
- `ProblemNoticeTrigger` (typedef) - No description.
- `resolveProblemTrigger` (function) - No description.
- `module.exports` (function) - No description.
