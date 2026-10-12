# OpenDocViewer / src/components/DocumentViewer

File count: 17. Line count: 7445. JSDoc symbol count: 153.

## src/components/DocumentViewer/CompareCurtainButton.jsx

Entry to the curtain view \(CompareCurtainView.jsx\), shown in the compare toolbar and in the overlay view's toolbar.

Exports: `CompareCurtainButton`

Symbols:

- `CompareCurtainButton` (function) - No description.

## src/components/DocumentViewer/CompareCurtainView.jsx

Curtain view of the compare mode: the two calibrated pages in one coordinate space, page A \(left/primary\) below and page B \(right/compare\) above, page B clipped to one side of a draggable border.

Exports: `CompareCurtainView`

Local imports: `src/components/DocumentRender.jsx`, `src/utils/compareTransform.js`, `src/utils/imageAdjustments.js`, `src/utils/compareCurtain.js`, `src/components/DocumentViewer/compareViewKeys.js`, `src/utils/runtimeConfig.js`

Symbols:

- `CurtainMode` (typedef) - No description.
- `applyCurtainStyles` (function) - Write the clip and the grab bar position straight to the DOM \(drag path, no React render\).
- `measureStage` (function) - The stage's visible size in CSS px, so the printed page shows the same window as the screen.
- `CompareCurtainView` (function) - No description.
- `<anonymous>~onKeyDown` (function) - No description.

## src/components/DocumentViewer/CompareOverlayView.jsx

Overlay view of the compare mode: the two compared pages stacked in one coordinate space, page A \(left/primary\) below and page B \(right/compare\) above, so differences show through.

Exports: `CompareOverlayView`

Local imports: `src/components/DocumentRender.jsx`, `src/components/DocumentViewer/CompareTransformControls.jsx`, `src/utils/compareTransform.js`, `src/utils/imageAdjustments.js`, `src/utils/compareOverlay.js`, `src/components/DocumentViewer/CompareCurtainButton.jsx`, `src/components/DocumentViewer/compareViewKeys.js`, `src/utils/runtimeConfig.js`

Symbols:

- `OverlayTarget` (typedef) - No description.
- `measureStage` (function) - The stage's visible size in CSS px, so the printed page shows the same window as the screen.
- `CompareOverlayView` (function) - No description.
- `<anonymous>~onKeyDown` (function) - No description.
- `<anonymous>~onWheel` (function) - No description.

## src/components/DocumentViewer/CompareTransformControls.jsx

Compare toolbar for one compared page: a disclosure button with a short summary, which expands into one panel for everything the page can be adjusted with \- its free transform \(utils/compareTransform.js\) and its image ad

Exports: `CompareTransformControls`

Local imports: `src/utils/compareTransform.js`, `src/utils/imageAdjustments.js`

Symbols:

- `toSignedRotation` (function) - Rotation shown signed in \(\-180, 180\] so a small counter\-clockwise tilt reads as −0,1 and not 359,9.
- `TransformNumberField` (function) - Numeric text field with locale\-aware parsing; keeps a draft while focused.
- `CompareTransformControls` (function) - No description.
- `CompareTransformControls~setImage` (function) - No description.

## src/components/DocumentViewer/compareViewKeys.js

File: src/components/DocumentViewer/compareViewKeys.js Keyboard targets shared by the full\-surface compare views \(CompareOverlayView.jsx, CompareCurtainView.jsx\): which focused el...

Exports: `isOwnKeyTarget`, `shouldEscapeCloseView`, `hasActiveModalDialog`

Symbols:

- `module:compareViewKeys` (module) - File: src/components/DocumentViewer/compareViewKeys.js Keyboard targets shared by the full\-surface compare views \(CompareOverlayView.jsx, CompareCurtainView.jsx\): which focused el...
- `module:compareViewKeys.isOwnKeyTarget` (function) - Keys typed into fields \(and controls that handle their own arrows\) must not reach the view.
- `module:compareViewKeys.shouldEscapeCloseView` (function) - Escape closes the view unless a text field has focus \(Escape undoes its typed value there\).
- `module:compareViewKeys.hasActiveModalDialog` (function) - No description.

## src/components/DocumentViewer/CompareZoomOverlay.jsx

Per\-pane “post\-zoom” controls shown in comparison mode, tucked behind the pane marker ring at the top\-left of each pane.

Exports: `CompareZoomOverlay`

Local imports: `src/utils/compareTransform.js`

Symbols:

- `COLLAPSE_DELAY_MS` (constant) - Delay before the zone collapses after the pointer/focus has left, so it does not flicker.
- `isKeyboardFocus` (function) - No description.
- `CompareZoomOverlay` (function) - CompareZoomOverlay Parent owns the factor and clamping; this component only owns the expanded/collapsed state.

## src/components/DocumentViewer/DocumentViewer.jsx

OpenDocViewer — Document Viewer \(Container\) Tie together: • Toolbar \(actions, zoom, adjustments\) • Thumbnails \(navigation \+ selection reset\) • Main renderer \(canvas/img\) This component wires ViewerContext state into the

Exports: `DocumentViewer`

Local imports: `src/components/DocumentViewer/DocumentViewerToolbar.jsx`, `src/components/DocumentViewer/DocumentViewerThumbnails.jsx`, `src/components/DocumentViewer/DocumentViewerRender.jsx`, `src/components/DocumentViewer/CompareOverlayView.jsx`, `src/components/DocumentViewer/CompareCurtainView.jsx`, `src/components/PrintSelectionWorkspace.jsx`, `src/components/DocumentToolbar/PrintPipelineDialogs.jsx`, `src/components/DocumentToolbar/usePrintPipeline.js`, `src/components/Resizer.jsx`, `src/logging/systemLogger.js`, `src/contexts/viewerContext.js`, `src/components/DocumentViewer/useDocumentViewer.js`

Symbols:

- `DocumentViewer~openSignatureDialog` (constant) - Open the signature details dialog for the document that contains a file \(sourceKey\), with that file's tab preselected.
- `DocumentViewer~navigateToSignatureDocument` (constant) - Overview row activation: show the document's first page and keep the overview open.
- `<anonymous>~isEditableTarget` (function) - No description.
- `<anonymous>~hasActiveModalDialog` (function) - No description.
- `<anonymous>~onKeyDown` (function) - No description.
- `<anonymous>~allowNativeContextMenu` (function) - No description.

## src/components/DocumentViewer/DocumentViewerRender.jsx

OpenDocViewer — Main Viewer Rendering Wrapper Render the primary document pane \(and optional comparison pane\) by delegating all heavy lifting to &lt;DocumentRender /&gt;.

Exports: `DocumentViewerRender`

Local imports: `src/components/DocumentRender.jsx`, `src/components/DocumentViewer/CompareZoomOverlay.jsx`, `src/components/DocumentViewer/CompareTransformControls.jsx`, `src/contexts/viewerContext.js`, `src/utils/compareTransform.js`, `src/utils/imageAdjustments.js`, `src/utils/documentMetadata.js`

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
- `DocumentViewerRender~handleTransformWheel` (constant) - Ctrl/Cmd\+wheel over a pane whose fine\-tuning bar is expanded: ±1 % page scale per notch.

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

## src/components/DocumentViewer/hooks/useCompareOverlay.js

File: src/components/DocumentViewer/hooks/useCompareOverlay.js Open/close state of the compare overlay view \(CompareOverlayView.jsx\).

Exports: `resolveShownCompareViews`, `useCompareOverlay`

Local imports: `src/contexts/viewerContext.js`, `src/utils/compareTransform.js`, `src/utils/compareOverlay.js`, `src/utils/runtimeConfig.js`

Symbols:

- `module:useCompareOverlay` (module) - File: src/components/DocumentViewer/hooks/useCompareOverlay.js Open/close state of the compare overlay view \(CompareOverlayView.jsx\).
- `module:useCompareOverlay.resolveShownCompareViews` (function) - Render gate for the compare views: a view is shown only while it is open AND enabled in the runtime config, so a stale open flag can never surface a disabled view.
- `module:useCompareOverlay.useCompareOverlay` (function) - No description.

## src/components/DocumentViewer/hooks/useCompareTransforms.js

File: src/components/DocumentViewer/hooks/useCompareTransforms.js Viewer\-side access to the free per\-page compare transform kept in the viewer context \(utils/compareTransform.js,...

Exports: `useCompareTransforms`

Local imports: `src/contexts/viewerContext.js`, `src/utils/compareTransform.js`

Symbols:

- `module:useCompareTransforms` (module) - File: src/components/DocumentViewer/hooks/useCompareTransforms.js Viewer\-side access to the free per\-page compare transform kept in the viewer context \(utils/compareTransform.js,...
- `module:useCompareTransforms.useCompareTransforms` (function) - No description.
- `module:useCompareTransforms.useCompareTransforms~bumpPostZoomLeft` (constant) - No description.
- `module:useCompareTransforms.useCompareTransforms~bumpPostZoomRight` (constant) - No description.
- `module:useCompareTransforms.useCompareTransforms~resetPostZoom` (constant) - Scale 1 on both pages \(fit and actual\-size presets\).

## src/components/DocumentViewer/hooks/usePaneImageAdjustments.js

File: src/components/DocumentViewer/hooks/usePaneImageAdjustments.js Per\-pane image adjustments \(brightness, contrast, grayscale, invert\) and the resets that combine them with the...

Exports: `DEFAULT_IMAGE_ADJUSTMENTS`, `usePaneImageAdjustments`

Local imports: `src/utils/imageAdjustments.js`

Symbols:

- `module:usePaneImageAdjustments` (module) - File: src/components/DocumentViewer/hooks/usePaneImageAdjustments.js Per\-pane image adjustments \(brightness, contrast, grayscale, invert\) and the resets that combine them with the...
- `module:usePaneImageAdjustments.DEFAULT_IMAGE_ADJUSTMENTS` (constant) - Neutral per\-page image adjustment state.
- `module:usePaneImageAdjustments~normalizeTarget` (function) - No description.
- `module:usePaneImageAdjustments~readPercent200` (function) - No description.
- `module:usePaneImageAdjustments.usePaneImageAdjustments` (function) - No description.
- `module:usePaneImageAdjustments.usePaneImageAdjustments~patchPane` (constant) - No description.
- `module:usePaneImageAdjustments.usePaneImageAdjustments~handleBrightnessChange` (constant) - No description.
- `module:usePaneImageAdjustments.usePaneImageAdjustments~handleContrastChange` (constant) - No description.
- `module:usePaneImageAdjustments.usePaneImageAdjustments~handleGrayscaleChange` (constant) - No description.
- `module:usePaneImageAdjustments.usePaneImageAdjustments~handleInvertChange` (constant) - Accepts a checkbox event \( target.checked \), a \{ target: \{ value \} \} event or a plain value.
- `module:usePaneImageAdjustments.usePaneImageAdjustments~clearImageAdjustments` (constant) - Image only; the transform is kept.
- `module:usePaneImageAdjustments.usePaneImageAdjustments~resetPane` (constant) - Everything for one pane: identity transform \(no quarter turn either\) and neutral image.

## src/components/DocumentViewer/hooks/useViewerEffects.js

File: src/components/DocumentViewer/hooks/useViewerEffects.js Cross\-cutting viewer effects.

Exports: `isEditableTarget`, `hasActiveModalDialog`, `shouldIgnoreViewerShortcut`, `useViewerEffects`

Local imports: `src/components/DocumentViewer/hooks/useViewerKeyboardNavigation.js`, `src/components/DocumentViewer/hooks/useViewerZoomEffects.js`

Symbols:

- `module:useViewerEffects` (module) - File: src/components/DocumentViewer/hooks/useViewerEffects.js Cross\-cutting viewer effects.
- `module:useViewerEffects~ZoomMode` (typedef) - Sticky zoom modes used by the viewer.
- `module:useViewerEffects~KeyboardPrintShortcutBehavior` (typedef) - No description.
- `module:useViewerEffects~UseViewerEffectsArgs` (typedef) - Arguments for useViewerEffects.
- `module:useViewerEffects.isEditableTarget` (function) - Determine whether the event target is an editable or form control where viewer shortcuts must stay inactive.
- `module:useViewerEffects.hasActiveModalDialog` (function) - Determine whether a modal dialog is currently open.
- `module:useViewerEffects.shouldIgnoreViewerShortcut` (function) - Decide whether a keyboard shortcut should be ignored for the viewer.
- `module:useViewerEffects.useViewerEffects` (function) - No description.

## src/components/DocumentViewer/hooks/useViewerKeyboardNavigation.js

Global keyboard navigation, zoom, rotation, and selection shortcuts for DocumentViewer.

Exports: `useViewerKeyboardNavigation`

Local imports: `src/hooks/usePageTimer.js`

Symbols:

- `module:useViewerKeyboardNavigation` (module) - Global keyboard navigation, zoom, rotation, and selection shortcuts for DocumentViewer.
- `module:useViewerKeyboardNavigation.useViewerKeyboardNavigation` (function) - No description.
- `<anonymous>~getTarget` (function) - No description.
- `<anonymous>~getScope` (function) - No description.
- `<anonymous>~isNextRepeatKey` (function) - No description.
- `<anonymous>~isPreviousRepeatKey` (function) - No description.
- `<anonymous>~onKeyDown` (function) - No description.
- `<anonymous>~onKeyUp` (function) - No description.
- `<anonymous>~onWindowBlur` (function) - No description.
- `<anonymous>~onVisibilityChange` (function) - No description.

## src/components/DocumentViewer/hooks/useViewerZoomEffects.js

Zoom, resize, wheel, print\-shortcut, and initial\-fit effects for DocumentViewer.

Exports: `useViewerZoomEffects`

Local imports: `src/logging/systemLogger.js`

Symbols:

- `module:useViewerZoomEffects` (module) - Zoom, resize, wheel, print\-shortcut, and initial\-fit effects for DocumentViewer.
- `module:useViewerZoomEffects.useViewerZoomEffects` (function) - No description.
- `<anonymous>~onWheelGlobal` (function) - No description.
- `<anonymous>~onKeyDown` (function) - No description.

## src/components/DocumentViewer/useDocumentViewer.js

Primary viewer\-state hook.

Exports: `useDocumentViewer`

Local imports: `src/utils/pdfResolutionRuntime.js`, `src/logging/systemLogger.js`, `src/contexts/viewerContext.js`, `src/utils/runtimeConfig.js`, `src/utils/viewerPreferences.js`, `src/utils/compareTransform.js`, `src/components/DocumentViewer/hooks/useCompareTransforms.js`, `src/components/DocumentViewer/hooks/usePaneImageAdjustments.js`, `src/components/DocumentViewer/hooks/useCompareOverlay.js`, `src/components/DocumentViewer/hooks/useViewerEffects.js`

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
