# OpenDocViewer / src/components

File count: 13. Line count: 6527. JSDoc symbol count: 82.

## src/components/CanvasRenderer.jsx

CanvasRenderer component.

Exports: CanvasRenderer

Symbols:

- `CanvasRenderer` (constant) - CanvasRenderer component.

## src/components/DocumentConsumerWrapper.jsx

DocumentConsumerWrapper Wraps DocumentLoader + DocumentViewer and switches between full viewer and a thumbnail-only presentation on small/mobile layouts.

Exports: DocumentConsumerWrapper

Local imports: src/contexts/viewerContext.js, src/logging/systemLogger.js

Symbols:

- `SourceItem` (typedef) - An item for explicit-list mode.
- `DocumentConsumerWrapper` (function) - DocumentConsumerWrapper Wraps DocumentLoader + DocumentViewer and switches between full viewer and a thumbnail-only presentation on small/mobile layouts.

## src/components/DocumentMetadataMatrixOverlayDialog.jsx

Exports DocumentMetadataMatrixOverlayDialog.

Exports: DocumentMetadataMatrixOverlayDialog

Symbols:

- `module.exports` (function) - No description.
- `<anonymous>~handleEscape` (function) - No description.

## src/components/DocumentMetadataOverlayDialog.jsx

Exports DocumentMetadataOverlayDialog.

Exports: DocumentMetadataOverlayDialog

Symbols:

- `module.exports` (function) - No description.
- `<anonymous>~handleEscape` (function) - No description.

## src/components/DocumentRender.jsx

Reset the per-page blob-URL retry tracker after a successful load or when the target page changes.

Exports: DocumentRender

Local imports: src/contexts/viewerContext.js, src/logging/systemLogger.js, src/components/ImageRenderer.jsx, src/components/CanvasRenderer.jsx, src/components/LoadingMessage.jsx, src/utils/zoomUtils.js, src/utils/documentLoadingConfig.js

Symbols:

- `getCurrentPage` (function) - No description.
- `normalizeSize` (function) - No description.
- `hasUsableSize` (function) - No description.
- `isBlobAssetUrl` (function) - No description.
- `DisplayedAsset` (typedef) - No description.
- `DocumentRender` (constant) - No description.
- `<anonymous>~resetAssetRetry` (constant) - Reset the per-page blob-URL retry tracker after a successful load or when the target page changes.
- `<anonymous>~clearLoadingOverlayTimer` (constant) - No description.
- `<anonymous>~claimAssetRetry` (constant) - No description.
- `<anonymous>~resolveCustomFitOptions` (constant) - No description.
- `<anonymous>~drawImageOnCanvas` (constant) - No description.
- `<anonymous>~getActiveRenderSurface` (constant) - Returns the surface whose intrinsic size should drive fit calculations.

## src/components/DocumentSelectionPanel.jsx

Exports DocumentSelectionPanel.

Exports: DocumentSelectionPanel

Symbols:

- `SelectionCheckboxRow` (function) - No description.
- `module.exports` (function) - No description.

## src/components/DocumentThumbnailList.jsx

Build a center-out thumbnail warm-up order so the pane feels responsive around the user's current scroll target instead of always starting from page 1.

Exports: DocumentThumbnailList

Local imports: src/contexts/viewerContext.js, src/logging/systemLogger.js, src/components/LoadingSpinner.jsx, src/utils/documentLoadingConfig.js, src/utils/publicAssetUrl.js, src/utils/documentMetadata.js

Symbols:

- `ThumbnailRowProps` (typedef) - No description.
- `clamp` (function) - No description.
- `shouldWarmAllThumbnails` (function) - No description.
- `getThumbnailLayout` (function) - No description.
- `formatMetricFraction` (function) - No description.
- `formatMetricValue` (function) - No description.
- `getSessionPageIndex` (function) - No description.
- `isIndexInRange` (function) - No description.
- `buildCenterOutQueue` (function) - Build a center-out thumbnail warm-up order so the pane feels responsive around the user's current scroll target instead of always starting from page 1.
- `getPageDocumentKey` (function) - No description.
- `getPageDocumentContext` (function) - No description.
- `getMetricTitles` (function) - No description.

## src/components/ImageRenderer.jsx

ImageRenderer component.

Exports: ImageRenderer

Symbols:

- `ImgEventHandler` (typedef) - Image load/error handler.
- `ImageRenderer` (constant) - ImageRenderer component.

## src/components/LoadingMessage.jsx

LoadingMessage component.

Exports: LoadingMessage

Local imports: src/utils/publicAssetUrl.js

Symbols:

- `LoadingMessage` (function) - LoadingMessage component.

## src/components/LoadingSpinner.jsx

LoadingSpinner component.

Exports: LoadingSpinner

Symbols:

- `srOnlyStyle` (constant) - Inline “visually hidden” style for screen-reader-only text (no CSS dependency).
- `LoadingSpinner` (function) - LoadingSpinner component.
- `LoadingSpinner.propTypes.size` (member) - Optional width/height; if omitted, CSS controls dimensions.
- `LoadingSpinner.propTypes.label` (member) - Accessible label announced by assistive technologies.
- `LoadingSpinner.propTypes.className` (member) - Extra classes to append to the root element.

## src/components/PrintSelectionWorkspace.jsx

Exports PrintSelectionWorkspace.

Exports: PrintSelectionWorkspace

Local imports: src/utils/publicAssetUrl.js, src/utils/localizedValue.js

Symbols:

- `<anonymous>~handleKeyDown` (function) - No description.
- `<anonymous>~handleKeyDown` (function) - No description.
- `<anonymous>~handleMove` (function) - No description.
- `<anonymous>~handleDone` (function) - No description.

## src/components/Resizer.jsx

Resizer component.

Exports: Resizer

Symbols:

- `ResizeStartHandler` (typedef) - Handler invoked when a resize interaction is initiated.
- `ResizerProps` (typedef) - Props for .
- `Resizer` (constant) - Resizer component.
- `<anonymous>~handleKeyDown` (constant) - Keyboard handler (Enter/Space) to initiate the same flow as mouse down.
- `Resizer.propTypes.onMouseDown` (member) - Initiates resize in the parent (mouse or keyboard-initiated).
- `Resizer.propTypes.orientation` (member) - Visual/semantic orientation of the separator.
- `Resizer.propTypes.ariaLabel` (member) - Accessible name for assistive technologies.
- `Resizer.propTypes.className` (member) - Extra class names to append to the root element.

## src/components/ViewerProblemNotice.jsx

Exports ViewerProblemNotice.

Exports: ViewerProblemNotice

Local imports: src/utils/runtimeConfig.js, src/utils/localizedValue.js

Symbols:

- `toCount` (function) - No description.
- `ProblemNoticeTrigger` (typedef) - No description.
- `resolveProblemTrigger` (function) - No description.
- `module.exports` (function) - No description.
