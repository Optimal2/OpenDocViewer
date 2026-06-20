# OpenDocViewer / src/components/DocumentViewer

File count: 8. Line count: 4926. JSDoc symbol count: 113.

## src/components/DocumentViewer/CompareZoomOverlay.jsx

Per\-pane “post\-zoom” controls shown in comparison mode.

Exports: `CompareZoomOverlay`

Symbols:

- `CompareZoomOverlay` (function) - CompareZoomOverlay Presentational\-only \(no state\).

## src/components/DocumentViewer/DocumentViewer.jsx

OpenDocViewer — Document Viewer \(Container\) Tie together: • Toolbar \(actions, zoom, adjustments\) • Thumbnails \(navigation \+ selection reset\) • Main renderer \(canvas/img\) This component wires ViewerContext state into the

Exports: `DocumentViewer`

Local imports: `src/components/DocumentViewer/DocumentViewerToolbar.jsx`, `src/components/DocumentViewer/DocumentViewerThumbnails.jsx`, `src/components/DocumentViewer/DocumentViewerRender.jsx`, `src/components/PrintSelectionWorkspace.jsx`, `src/components/Resizer.jsx`, `src/logging/systemLogger.js`, `src/contexts/viewerContext.js`, `src/components/DocumentViewer/useDocumentViewer.js`, `src/hooks/useNavigationModifierState.js`, `src/components/DocumentMetadataOverlayDialog.jsx`, `src/components/DocumentMetadataMatrixOverlayDialog.jsx`, `src/components/ViewerProblemNotice.jsx`

Symbols:

- `<anonymous>~isEditableTarget` (function) - No description.
- `<anonymous>~hasActiveModalDialog` (function) - No description.
- `<anonymous>~onKeyDown` (function) - No description.
- `<anonymous>~allowNativeContextMenu` (function) - No description.

## src/components/DocumentViewer/DocumentViewerRender.jsx

OpenDocViewer — Main Viewer Rendering Wrapper Render the primary document pane \(and optional comparison pane\) by delegating all heavy lifting to &lt;DocumentRender /&gt;.

Exports: `DocumentViewerRender`

Local imports: `src/components/DocumentRender.jsx`, `src/components/DocumentViewer/CompareZoomOverlay.jsx`, `src/contexts/viewerContext.js`, `src/utils/documentMetadata.js`

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

OpenDocViewer — Document Viewer Thumbnails \(Wrapper\) Provides the deterministic thumbnail list and local width controls for the viewer shell.

Exports: `DocumentViewerThumbnails`

Local imports: `src/components/DocumentThumbnailList.jsx`

Symbols:

- `DocumentViewerThumbnails` (function) - No description.

## src/components/DocumentViewer/DocumentViewerToolbar.jsx

Toolbar adapter for the document viewer.

Exports: `DocumentViewerToolbar`

Local imports: `src/components/DocumentToolbar/DocumentToolbar.jsx`

Symbols:

- `RefLike` (typedef) - Ref\-like shape used for imperative handles.
- `SetBooleanState` (typedef) - State setter that accepts a boolean or an updater callback.
- `PageNumberSetter` (typedef) - React\-like numeric/original page setter used by the toolbar adapter.
- `DocumentViewerToolbarProps` (typedef) - Props consumed by DocumentViewerToolbar.
- `DocumentViewerToolbar` (function) - Renders the toolbar for the document viewer by delegating to .

## src/components/DocumentViewer/hooks/useViewerEffects.js

File: src/components/DocumentViewer/hooks/useViewerEffects.js Cross\-cutting viewer effects: Sync zoomState.scale from numeric zoom Sticky Fit recomputation on relevant changes Res...

Exports: `useViewerEffects`

Local imports: `src/logging/systemLogger.js`, `src/hooks/usePageTimer.js`

Symbols:

- `module:useViewerEffects` (module) - File: src/components/DocumentViewer/hooks/useViewerEffects.js Cross\-cutting viewer effects: Sync zoomState.scale from numeric zoom Sticky Fit recomputation on relevant changes Res...
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

File: src/components/DocumentViewer/hooks/useViewerPostZoom.js Encapsulates per\-pane &amp;quot;post\-zoom&amp;quot; state &amp;amp; handlers used only in compare mode.

Exports: `useViewerPostZoom`

Symbols:

- `module:useViewerPostZoom` (module) - File: src/components/DocumentViewer/hooks/useViewerPostZoom.js Encapsulates per\-pane &amp;quot;post\-zoom&amp;quot; state &amp;amp; handlers used only in compare mode.
- `module:useViewerPostZoom~clamp` (function) - Clamp a numeric value to \[min, max\].
- `module:useViewerPostZoom~round1` (function) - Round to one decimal place \(avoids float drift when stepping by 0.1\).
- `module:useViewerPostZoom.useViewerPostZoom` (function) - Hook managing per\-pane post\-zoom factors for compare mode.
- `module:useViewerPostZoom.useViewerPostZoom~resetPostZoom` (constant) - Reset both per\-pane factors to 1.0.
- `module:useViewerPostZoom.useViewerPostZoom~bumpPostZoomLeft` (constant) - Adjust left pane post\-zoom by ±0.1 steps.
- `module:useViewerPostZoom.useViewerPostZoom~bumpPostZoomRight` (constant) - Adjust right pane post\-zoom by ±0.1 steps.

## src/components/DocumentViewer/useDocumentViewer.js

Primary viewer\-state hook.

Exports: `useDocumentViewer`

Local imports: `src/logging/systemLogger.js`, `src/contexts/viewerContext.js`, `src/utils/runtimeConfig.js`, `src/utils/viewerPreferences.js`, `src/components/DocumentViewer/hooks/useViewerPostZoom.js`, `src/components/DocumentViewer/hooks/useViewerEffects.js`

Symbols:

- `clampPage` (function) - Clamp a 1\-based page number into \[1, total\].
- `normalizeRotationDegrees` (function) - Normalize a rotation angle into the canonical 0..359 range used by the canvas renderer.
- `CustomFitSizeLimits` (typedef) - Optional maximum percentage limits for the custom fit\-to\-size zoom mode.
- `SelectionMask` (typedef) - No description.
- `PrintPageSequence` (typedef) - No description.
- `ViewerPageTarget` (typedef) - No description.
- `ImageProperties` (typedef) - Image adjustment properties for canvas edit mode.
- `resolveEffectiveCustomFitSizeLimits` (function) - Resolve effective custom\-fit limits from a preferred value set and runtime config.
- `buildImageRotationDependencyKey` (function) - No description.
- `normalizeSelectionMask` (function) - Normalize a persisted/host\-provided page\-selection mask to the current page count.
- `hasExcludedPages` (function) - Return true when the normalized mask excludes at least one page from the current session.
- `masksEqual` (function) - Compare two selection masks over the active page count.
