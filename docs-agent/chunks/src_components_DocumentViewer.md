# OpenDocViewer / src/components/DocumentViewer

File count: 8. Line count: 4717. JSDoc symbol count: 106.

## src/components/DocumentViewer/CompareZoomOverlay.jsx

CompareZoomOverlay Presentational-only (no state).

Exports: CompareZoomOverlay

Symbols:

- `CompareZoomOverlay` (function) - CompareZoomOverlay Presentational-only (no state).

## src/components/DocumentViewer/DocumentViewer.jsx

Exports DocumentViewer.

Exports: DocumentViewer

Local imports: src/components/DocumentViewer/DocumentViewerToolbar.jsx, src/components/DocumentViewer/DocumentViewerThumbnails.jsx, src/components/DocumentViewer/DocumentViewerRender.jsx, src/components/PrintSelectionWorkspace.jsx, src/components/Resizer.jsx, src/logging/systemLogger.js, src/contexts/viewerContext.js, src/components/DocumentViewer/useDocumentViewer.js, src/hooks/useNavigationModifierState.js, src/components/DocumentMetadataOverlayDialog.jsx, src/components/DocumentMetadataMatrixOverlayDialog.jsx, src/components/ViewerProblemNotice.jsx

Symbols:

- `<anonymous>~isEditableTarget` (function) - No description.
- `<anonymous>~hasActiveModalDialog` (function) - No description.
- `<anonymous>~onKeyDown` (function) - No description.
- `<anonymous>~allowNativeContextMenu` (function) - No description.

## src/components/DocumentViewer/DocumentViewerRender.jsx

DocumentViewerRender Renders the main document pane and, if enabled, a comparison pane.

Exports: DocumentViewerRender

Local imports: src/components/DocumentRender.jsx, src/components/DocumentViewer/CompareZoomOverlay.jsx, src/contexts/viewerContext.js, src/utils/documentMetadata.js

Symbols:

- `ViewerPaneKey` (typedef) - No description.
- `ViewerContextMenuState` (typedef) - No description.
- `getPageSelectionContext` (function) - No description.
- `isPaneInteractiveTarget` (function) - No description.
- `isPannableViewport` (function) - No description.
- `isPointerOnViewportScrollbar` (function) - No description.
- `getWheelDeltaYPx` (function) - No description.
- `isAtScrollTop` (function) - No description.
- `isAtScrollBottom` (function) - No description.
- `preventDefaultIfCancelable` (function) - No description.
- `DocumentViewerRender` (function) - DocumentViewerRender Renders the main document pane and, if enabled, a comparison pane.
- `DocumentViewerRender~handlePaneWheelCapture` (constant) - No description.

## src/components/DocumentViewer/DocumentViewerThumbnails.jsx

Exports DocumentViewerThumbnails.

Exports: DocumentViewerThumbnails

Local imports: src/components/DocumentThumbnailList.jsx

Symbols:

- `DocumentViewerThumbnails` (function) - No description.

## src/components/DocumentViewer/DocumentViewerToolbar.jsx

Renders the toolbar for the document viewer by delegating to .

Exports: DocumentViewerToolbar

Local imports: src/components/DocumentToolbar/DocumentToolbar.jsx

Symbols:

- `RefLike` (typedef) - Ref-like shape used for imperative handles.
- `SetBooleanState` (typedef) - State setter that accepts a boolean or an updater callback.
- `PageNumberSetter` (typedef) - React-like numeric/original page setter used by the toolbar adapter.
- `DocumentViewerToolbarProps` (typedef) - Props consumed by DocumentViewerToolbar.
- `DocumentViewerToolbar` (function) - Renders the toolbar for the document viewer by delegating to .

## src/components/DocumentViewer/hooks/useViewerEffects.js

File: src/components/DocumentViewer/hooks/useViewerEffects.js Cross-cutting viewer effects: Sync zoomState.scale from numeric zoom Sticky Fit recomputation on relevant changes Res...

Exports: useViewerEffects

Local imports: src/logging/systemLogger.js, src/hooks/usePageTimer.js

Symbols:

- `module:useViewerEffects` (module) - File: src/components/DocumentViewer/hooks/useViewerEffects.js Cross-cutting viewer effects: Sync zoomState.scale from numeric zoom Sticky Fit recomputation on relevant changes Res...
- `module:useViewerEffects~ZoomMode` (typedef) - Sticky zoom modes used by the viewer.
- `module:useViewerEffects~KeyboardPrintShortcutBehavior` (typedef) - No description.
- `module:useViewerEffects~UseViewerEffectsArgs` (typedef) - Arguments for useViewerEffects.
- `module:useViewerEffects~isEditableTarget` (function) - Determine whether the event target is an editable or form control where viewer shortcuts must stay inactive.
- `module:useViewerEffects~hasActiveModalDialog` (function) - Determine whether a modal dialog is currently open.
- `module:useViewerEffects~shouldIgnoreViewerShortcut` (function) - Decide whether a keyboard shortcut should be ignored for the viewer.
- `module:useViewerEffects.useViewerEffects` (function) - No description.
- `<anonymous>~onWheelGlobal` (function) - No description.
- `<anonymous>~onKeyDown` (function) - No description.
- `<anonymous>~getTarget` (function) - No description.
- `<anonymous>~getScope` (function) - No description.

## src/components/DocumentViewer/hooks/useViewerPostZoom.js

File: src/components/DocumentViewer/hooks/useViewerPostZoom.js Encapsulates per-pane &quot;post-zoom&quot; state &amp; handlers used only in compare mode.

Exports: useViewerPostZoom

Symbols:

- `module:useViewerPostZoom` (module) - File: src/components/DocumentViewer/hooks/useViewerPostZoom.js Encapsulates per-pane &quot;post-zoom&quot; state &amp; handlers used only in compare mode.
- `module:useViewerPostZoom~clamp` (function) - Clamp a numeric value to [min, max].
- `module:useViewerPostZoom~round1` (function) - Round to one decimal place (avoids float drift when stepping by 0.1).
- `module:useViewerPostZoom.useViewerPostZoom` (function) - Hook managing per-pane post-zoom factors for compare mode.
- `module:useViewerPostZoom.useViewerPostZoom~resetPostZoom` (constant) - Reset both per-pane factors to 1.0.
- `module:useViewerPostZoom.useViewerPostZoom~bumpPostZoomLeft` (constant) - Adjust left pane post-zoom by ±0.1 steps.
- `module:useViewerPostZoom.useViewerPostZoom~bumpPostZoomRight` (constant) - Adjust right pane post-zoom by ±0.1 steps.

## src/components/DocumentViewer/useDocumentViewer.js

Hook that centralizes viewer UI state and event handlers.

Exports: useDocumentViewer

Local imports: src/logging/systemLogger.js, src/contexts/viewerContext.js, src/utils/runtimeConfig.js, src/utils/viewerPreferences.js, src/components/DocumentViewer/hooks/useViewerPostZoom.js, src/components/DocumentViewer/hooks/useViewerEffects.js

Symbols:

- `clampPage` (function) - Clamp a 1-based page number into [1, total].
- `normalizeRotationDegrees` (function) - Normalize a rotation angle into the canonical 0..359 range used by the canvas renderer.
- `DEFAULT_IMAGE_PROPERTIES` (constant) - Neutral per-page image adjustment state.
- `buildImageRotationDependencyKey` (function) - No description.
- `normalizeSelectionMask` (function) - No description.
- `hasExcludedPages` (function) - No description.
- `masksEqual` (function) - No description.
- `normalizePrintPageSequence` (function) - No description.
- `isNaturalPrintPageSequence` (function) - No description.
- `findNearestVisiblePageNumber` (function) - Resolve the nearest visible page number for a requested original page index.
- `buildDocumentSelectionModel` (function) - No description.
- `getPageDocumentNavigationMeta` (function) - No description.
