# OpenDocViewer / src/components/DocumentToolbar

File count: 21. Line count: 8077. JSDoc symbol count: 115.

## src/components/DocumentToolbar/AboutOverlayDialog.jsx

Small About dialog for version/build/support information.

Exports: `AboutOverlayDialog`

Local imports: `src/utils/runtimeConfig.js`, `src/utils/supportDiagnostics.js`

Symbols:

- `resolveAboutInfo` (function) - No description.
- `module.exports` (function) - No description.
- `<anonymous>~handleEscape` (function) - No description.

## src/components/DocumentToolbar/DocumentToolbar.jsx

Main toolbar UI for page navigation, zoom, comparison, image adjustments, help, language, and print entry.

Exports: `DocumentToolbar`

Local imports: `src/logging/userLogger.js`, `src/logging/systemLogger.js`, `src/components/DocumentToolbar/PageNavigationButtons.jsx`, `src/components/DocumentToolbar/ZoomButtons.jsx`, `src/components/DocumentToolbar/SplitToolbarButton.jsx`, `src/components/DocumentToolbar/LanguageMenuButton.jsx`, `src/components/DocumentToolbar/ThemeMenuButton.jsx`, `src/components/DocumentToolbar/PrintPipelineDialogs.jsx`, `src/components/DocumentToolbar/usePrintPipeline.js`, `src/components/DocumentToolbar/HelpMenuButton.jsx`, `src/components/DocumentToolbar/OcrToolbarActions.jsx`, `src/components/DocumentToolbar/ManualOverlayDialog.jsx`

Symbols:

- `AnyRef` (typedef) - Mutable ref\-like object used by the toolbar.
- `ImageProperties` (typedef) - Editable image state shown by the toolbar.
- `PageNumberSetter` (typedef) - React\-like numeric page setter used by the toolbar.
- `ZoomState` (typedef) - Zoom display state used by the newer toolbar UX paths.
- `DocumentToolbarProps` (typedef) - Props for \{@link DocumentToolbar\}.
- `SLIDER_CENTER_RANGE` (constant) - Range \(±\) around 100% where sliders snap back to the neutral value.
- `OCR_BENCHMARK_KEEP_AROUND_SHOWN_PAGE` (constant) - Pages on either side of the shown page whose renders the OCR benchmark leaves to the viewer.
- `ONE_TO_ONE_EPS` (constant) - Epsilon for considering zoom ≈ 100% \(0.5%\).
- `makePdfResolutionPageKey` (function) - No description.
- `isPdfPage` (function) - No description.
- `DocumentToolbar` (function) - Toolbar shell for page navigation, zoom, comparison, image adjustments, help, language, and print entry.
- `<anonymous>~handlePointerDown` (function) - No description.

## src/components/DocumentToolbar/HelpMenuButton.jsx

Toolbar help menu with entries for the manual and About dialog.

Exports: `HelpMenuButton`

Local imports: `src/utils/runtimeConfig.js`, `src/utils/manualEnabled.js`, `src/components/common/StatusLed.jsx`

Symbols:

- `<anonymous>~handlePointerDown` (function) - No description.
- `<anonymous>~handleKeyDown` (function) - No description.

## src/components/DocumentToolbar/HelpOverlayDialog.jsx

Full\-screen help overlay for OpenDocViewer.

Exports: `HelpOverlayDialog`

Symbols:

- `module.exports` (function) - No description.
- `<anonymous>~handleEscape` (function) - No description.

## src/components/DocumentToolbar/hooks/usePrintRangeConfig.js

Runtime\-configuration derivation for PrintRangeDialog.

Exports: `usePrintRangeConfig`

Local imports: `src/utils/localizedValue.js`, `src/utils/runtimeConfig.js`, `src/integrations/integrationSettings.js`, `src/utils/viewerPreferences.js`, `src/components/DocumentToolbar/printRangeDialogHelpers.js`

Symbols:

- `module:usePrintRangeConfig` (module) - Runtime\-configuration derivation for PrintRangeDialog.
- `module:usePrintRangeConfig.usePrintRangeConfig` (function) - No description.

## src/components/DocumentToolbar/LanguageMenuButton.jsx

Compact language selector for the toolbar.

Exports: `LanguageMenuButton`

Local imports: `src/contexts/readAloudContext.js`

Symbols:

- `resolveLanguageLabel` (function) - No description.
- `<anonymous>~handlePointerDown` (function) - No description.
- `<anonymous>~handleKeyDown` (function) - No description.
- `LanguageMenuButton~handleSelectLanguage` (function) - No description.
- `LanguageMenuButton~closeMenu` (function) - Close the menu and give the focus back to the button \(a choice unmounts the focused item\).

## src/components/DocumentToolbar/ManualOverlayDialog.jsx

Manual overlay: modal dialog chrome \(title bar, reload, open\-in\-new\-tab and close buttons, focus trap, Escape and backdrop handling\) around the shared \{@link ManualView\}, which loads, filters, searches and navigates the

Exports: `ManualOverlayDialog`

Local imports: `src/components/Manual/ManualView.jsx`, `src/components/Manual/manualDocument.js`, `src/utils/runtimeConfig.js`

Symbols:

- `MANUAL_TITLE_ID` (constant) - Id of the dialog title.
- `MANUAL_DIALOG_IDS` (constant) - Ids the dialog renders around the manual view.
- `module.exports` (function) - No description.
- `ManualOverlayDialog~handleManualTabTrap` (function) - Keep forward and reverse Tab navigation inside the open modal dialog.

## src/components/DocumentToolbar/OcrSearchBar.jsx

Search in the recognised text, from the toolbar: a search button right after the image\-adjustment group that doubles as the page's OCR status \(an LED on the button, the status in its tooltip and in a visually hidden live

Exports: `OcrSearchBar`

Local imports: `src/contexts/viewerContext.js`, `src/components/common/StatusLed.jsx`, `src/utils/ocrPageKey.js`, `src/utils/ocrStatus.js`, `src/utils/ocrSearch.js`, `src/utils/ocrSearchPlacement.js`, `src/components/DocumentViewer/hooks/useViewerEffects.js`, `src/utils/ocrBoostStatus.js`, `src/utils/ocrProgress.js`, `src/utils/runtimeConfig.js`

Symbols:

- `OCR_PENDING_STATUSES` (constant) - Statuses \(src/ocr/queue.js OCR\_PAGE\_STATUS\) of a page still waiting for OCR.
- `OCR_ACTIVE_STATUSES` (constant) - Statuses of a page being worked on right now: one for each of the queue's pages in flight.
- `matchIdOf` (function) - No description.
- `module.exports` (function) - No description.
- `OcrSearchBar~goToMatch` (constant) - No description.
- `OcrSearchBar~step` (constant) - Enter / the arrows: a current match on another page is shown first \(the position does not move\), unless its page was already asked for \(a hidden page lands on the nearest shown on...
- `OcrSearchBar~handleInputKeyDown` (function) - No description.
- `OcrSearchBar~handlePanelKeyDown` (function) - Escape closes the field from any of its controls.

## src/components/DocumentToolbar/OcrToolbarActions.jsx

The toolbar's OCR group, right after the image\-adjustment group: a separator and the search in the text layers \(OcrSearchBar.jsx\), behind its runtime switches: \- \`ocr.search.enabled\` \(default true; only the literal false

Exports: `OcrToolbarActions`

Local imports: `src/components/DocumentToolbar/OcrSearchBar.jsx`, `src/utils/runtimeConfig.js`

Symbols:

- `module.exports` (function) - No description.

## src/components/DocumentToolbar/PageNavigationButtons.jsx

Page navigation controls with support for single\-step clicks and continuous stepping on press\-and\-hold.

Exports: `PageNavigationButtons`

Local imports: `src/hooks/useAcceleratingHoldRepeat.js`

Symbols:

- `clampPage` (function) - Page navigation button group.

## src/components/DocumentToolbar/printFieldLabels.js

Visible label for an optional/required print\-dialog field.

Exports: `resolvePrintFieldLabel`

Symbols:

- `resolvePrintFieldLabel` (function) - No description.

## src/components/DocumentToolbar/PrintPipelineDialogs.jsx

The dialogs of the ONE print pipeline \(usePrintPipeline.js\): the print dialog and the generated\-PDF progress \(modal, or a dock while working in the background\).

Exports: `PrintPipelineDialogs`

Local imports: `src/components/DocumentToolbar/PrintRangeDialog.jsx`

Symbols:

- `formatPdfProgressBody` (function) - No description.
- `getPdfProgressPercent` (function) - No description.
- `module.exports` (function) - No description.

## src/components/DocumentToolbar/PrintRangeDialog.jsx

Unified print dialog with a single print\-method selector and shared print\-details section.

Exports: `PrintRangeDialog`

Local imports: `src/components/DocumentToolbar/usePrintRangeDialog.js`, `src/components/DocumentToolbar/printFieldLabels.js`

Symbols:

- `PrintSubmitDetail` (typedef) - Structured payload returned to the caller on submit.

## src/components/DocumentToolbar/printRangeDialogHelpers.js

Pure helpers and shared constants for the print\-range dialog.

Exports: `getCfg`, `safeRegex`, `hasTextValue`, `resolveOptionPrintText`, `resolvePrintAction`, `normalizePdfOrientationMode`, `buildSelectedOptionDetails`, `ensureODVPrintCSS`

Local imports: `src/utils/localizedValue.js`

Symbols:

- `module:printRangeDialogHelpers` (module) - Pure helpers and shared constants for the print\-range dialog.
- `module:printRangeDialogHelpers.getCfg` (function) - Read the runtime configuration \(merged defaults \+ site overrides\).
- `module:printRangeDialogHelpers.safeRegex` (function) - Build a safe RegExp from optional pattern/flags.
- `module:printRangeDialogHelpers.hasTextValue` (function) - No description.
- `module:printRangeDialogHelpers.resolveOptionPrintText` (function) - Resolve the string that should be used on physical print/log output for an option.
- `module:printRangeDialogHelpers.resolvePrintAction` (function) - Resolve a configurable print dialog action.
- `module:printRangeDialogHelpers.normalizePdfOrientationMode` (function) - No description.
- `module:printRangeDialogHelpers.buildSelectedOptionDetails` (function) - Build token\-friendly details for the selected option without forcing templates to use list indexes.
- `module:printRangeDialogHelpers.ensureODVPrintCSS` (function) - Ensure base print CSS is injected once per document.

## src/components/DocumentToolbar/SplitToolbarButton.jsx

Reusable toolbar split\-button.

Exports: `SplitToolbarButton`

Symbols:

- `module.exports` (member) - Exported SplitToolbarButton component.

## src/components/DocumentToolbar/ThemeMenuButton.jsx

Compact theme selector for the toolbar.

Exports: `ThemeMenuButton`

Local imports: `src/contexts/themeContext.js`

Symbols:

- `resolveThemeModeLabel` (function) - No description.
- `resolveThemeModeIcon` (function) - No description.
- `resolveSelectedMode` (function) - No description.
- `<anonymous>~handlePointerDown` (function) - No description.
- `<anonymous>~handleKeyDown` (function) - No description.
- `ThemeMenuButton~handleSelect` (function) - No description.

## src/components/DocumentToolbar/ThemeToggleButton.jsx

Small button that toggles between light/dark themes using the ThemeContext.

Exports: `ThemeToggleButton`

Local imports: `src/contexts/themeContext.js`

Symbols:

- `module.exports` (member) - Exported ThemeToggleButton component.

## src/components/DocumentToolbar/usePdfPrebuildAllPages.js

Background prebuild/cache for configured "all pages" generated\-PDF variants.

Exports: `usePdfPrebuildAllPages`

Local imports: `src/logging/systemLogger.js`, `src/utils/runtimeConfig.js`, `src/utils/printPdf.js`, `src/utils/pdfPrebuildPlan.js`, `src/utils/pdfPrintCacheKey.js`

Symbols:

- `throwIfAborted` (function) - No description.
- `isAbortError` (function) - No description.
- `normalizePdfOrientation` (function) - No description.
- `isCacheableAllPagesRequest` (function) - No description.
- `createVariantDetail` (function) - No description.
- `runLimited` (function) - Run async work with bounded concurrency.
- `createSessionPageNumbers` (function) - No description.
- `module.exports` (function) - No description.

## src/components/DocumentToolbar/usePrintPipeline.js

File: src/components/DocumentToolbar/usePrintPipeline.js The ONE print pipeline of the viewer: print dialog target, print options, user print log, the direct\-versus\-generated\-PDF...

Exports: `EMPTY_PDF_PROGRESS`, `isComposedCompareDetail`, `normalizeToolbarPageNumber`, `usePrintPipeline`

Local imports: `src/logging/userLogger.js`, `src/logging/systemLogger.js`, `src/utils/printUtils.js`, `src/components/DocumentToolbar/usePdfPrebuildAllPages.js`, `src/utils/runtimeConfig.js`, `src/utils/pdfPrintCacheKey.js`

Symbols:

- `module:usePrintPipeline` (module) - File: src/components/DocumentToolbar/usePrintPipeline.js The ONE print pipeline of the viewer: print dialog target, print options, user print log, the direct\-versus\-generated\-PDF...
- `module:usePrintPipeline~COMPOSED_VIEW_PRINTERS` (constant) - Compare views that print as one composed page, with their print helpers.
- `module:usePrintPipeline~canPrintComposedView` (function) - Read capability at use time, including delayed submits from a stale dialog.
- `module:usePrintPipeline~isPdfAbortError` (function) - No description.
- `module:usePrintPipeline.isComposedCompareDetail` (function) - True for the dialog detail of a compare\-view print \( activeScope compare\-overlay / compare\-curtain \): both compared pages composed onto one page.
- `module:usePrintPipeline.normalizeToolbarPageNumber` (function) - Clamp a page number to the visible page range.
- `module:usePrintPipeline~PrintSubmitDetail` (typedef) - Detail payload emitted by the print dialog.
- `module:usePrintPipeline~ComposedPrintTarget` (typedef) - A compare view asking the shared dialog to print it as one page.
- `module:usePrintPipeline~PrintPipelineParams` (typedef) - No description.
- `module:usePrintPipeline` (function) - The single print pipeline shared by the toolbar and the compare views.
- `module:usePrintPipeline~usePrintPipeline~toPagesString` (constant) - Build a compact &quot;pages&quot; descriptor for logging.
- `module:usePrintPipeline~usePrintPipeline~resolvePrintPageCount` (constant) - Estimate the number of pages the user is about to print.

## src/components/DocumentToolbar/usePrintRangeDialog.js

Hook \+ helpers for PrintRangeDialog.

Exports: `ensureODVPrintCSS`, `getCfg`, `safeRegex`, `usePrintRangeController`

Local imports: `src/utils/printUtils.js`, `src/utils/localizedValue.js`, `src/components/DocumentToolbar/printRangeDialogHelpers.js`, `src/components/DocumentToolbar/hooks/usePrintRangeConfig.js`

Symbols:

- `PrintSubmitDetail` (typedef) - Structured payload returned to the caller on submit.
- `usePrintRangeController` (function) - Hook that encapsulates state, derived values, effects and handlers for PrintRangeDialog.
- `usePrintRangeController~onDialogKeyDown` (constant) - No description.
- `usePrintRangeController~makeDescendingSequence` (constant) - No description.
- `usePrintRangeController~validateRange` (constant) - No description.
- `usePrintRangeController~validateUserFields` (constant) - No description.
- `usePrintRangeController~composePrintFormat` (constant) - No description.
- `usePrintRangeController~composeReason` (constant) - No description.
- `usePrintRangeController~extras` (constant) - No description.
- `usePrintRangeController~composeSubmitDetail` (constant) - Compose and validate the print payload for the current dialog state.
- `usePrintRangeController~submitWithBackend` (constant) - No description.
- `usePrintRangeController~submitPrintDirect` (constant) - No description.

## src/components/DocumentToolbar/ZoomButtons.jsx

Zoom control cluster: \[ \- \] \[ % editable \] \[ \+ \] \| \[ 1:1 \] \[ Fit Page \] \[ Fit Width \] \[ Custom Fit \] \- When the field is NOT focused, it renders like “100%”.

Exports: `ZoomButtons`

Local imports: `src/hooks/useAcceleratingHoldRepeat.js`, `src/components/DocumentToolbar/SplitToolbarButton.jsx`

Symbols:

- `BASIC_CUSTOM_SIZE_FIELDS` (constant) - Fields shown by default \(window width\) vs.
- `AdvancedCustomSizeDisclosure` (function) - &quot;Advanced&quot; disclosure for the secondary custom\-size fields \(window height, actual size\).
- `parsePercentInput` (function) - Parse a percent\-like string safely.
