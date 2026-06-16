# OpenDocViewer / src/components/DocumentToolbar

File count: 14. Line count: 6326. JSDoc symbol count: 90.

## src/components/DocumentToolbar/AboutOverlayDialog.jsx

Exports AboutOverlayDialog.

Exports: AboutOverlayDialog

Local imports: src/utils/runtimeConfig.js, src/utils/supportDiagnostics.js

Symbols:

- `resolveAboutInfo` (function) - No description.
- `module.exports` (function) - No description.
- `<anonymous>~handleEscape` (function) - No description.

## src/components/DocumentToolbar/DocumentToolbar.jsx

Toolbar shell for page navigation, zoom, comparison, image adjustments, help, language, and print entry.

Exports: DocumentToolbar

Local imports: src/logging/userLogger.js, src/logging/systemLogger.js, src/components/DocumentToolbar/PageNavigationButtons.jsx, src/components/DocumentToolbar/ZoomButtons.jsx, src/components/DocumentToolbar/SplitToolbarButton.jsx, src/components/DocumentToolbar/LanguageMenuButton.jsx, src/components/DocumentToolbar/ThemeMenuButton.jsx, src/utils/printUtils.js, src/components/DocumentToolbar/PrintRangeDialog.jsx, src/components/DocumentToolbar/HelpMenuButton.jsx, src/components/DocumentToolbar/ManualOverlayDialog.jsx, src/components/DocumentToolbar/AboutOverlayDialog.jsx

Symbols:

- `isPdfAbortError` (function) - No description.
- `formatPdfProgressBody` (function) - No description.
- `getPdfProgressPercent` (function) - No description.
- `PrintSubmitDetail` (typedef) - Detail payload emitted by the print dialog.
- `AnyRef` (typedef) - Mutable ref-like object used by the toolbar.
- `ImageProperties` (typedef) - Editable image state shown by the toolbar.
- `PageNumberSetter` (typedef) - React-like numeric page setter used by the toolbar.
- `ZoomState` (typedef) - Zoom display state used by the newer toolbar UX paths.
- `DocumentToolbarProps` (typedef) - Props for {@link DocumentToolbar}.
- `SLIDER_CENTER_RANGE` (constant) - Range (±) around 100% where sliders snap back to the neutral value.
- `ONE_TO_ONE_EPS` (constant) - Epsilon for considering zoom ≈ 100% (0.5%).
- `normalizeToolbarPageNumber` (function) - Clamp a page number into the valid viewer range while preserving a safe fallback.

## src/components/DocumentToolbar/HelpMenuButton.jsx

Exports HelpMenuButton.

Exports: HelpMenuButton

Local imports: src/components/common/StatusLed.jsx

Symbols:

- `<anonymous>~handlePointerDown` (function) - No description.
- `<anonymous>~handleKeyDown` (function) - No description.

## src/components/DocumentToolbar/HelpOverlayDialog.jsx

Exports HelpOverlayDialog.

Exports: HelpOverlayDialog

Symbols:

- `module.exports` (function) - No description.
- `<anonymous>~handleEscape` (function) - No description.

## src/components/DocumentToolbar/LanguageMenuButton.jsx

Exports LanguageMenuButton.

Exports: LanguageMenuButton

Symbols:

- `resolveLanguageLabel` (function) - No description.
- `<anonymous>~handlePointerDown` (function) - No description.
- `<anonymous>~handleKeyDown` (function) - No description.
- `LanguageMenuButton~handleSelectLanguage` (function) - No description.

## src/components/DocumentToolbar/ManualOverlayDialog.jsx

Exports ManualOverlayDialog.

Exports: ManualOverlayDialog

Local imports: src/utils/runtimeConfig.js

Symbols:

- `toText` (function) - No description.
- `interpolateTemplate` (function) - No description.
- `isRewritableRelativeUrl` (function) - No description.
- `sanitizeManualHtml` (function) - No description.
- `rewriteManualHtml` (function) - No description.
- `appendManualRefreshToken` (function) - No description.
- `removeManualRefreshToken` (function) - No description.
- `buildManualCandidates` (function) - No description.
- `module.exports` (function) - No description.
- `<anonymous>~handleEscape` (function) - No description.

## src/components/DocumentToolbar/PageNavigationButtons.jsx

Exports PageNavigationButtons.

Exports: PageNavigationButtons

Local imports: src/hooks/useAcceleratingHoldRepeat.js

## src/components/DocumentToolbar/PrintRangeDialog.jsx

Structured payload returned to the caller on submit.

Exports: PrintRangeDialog

Local imports: src/components/DocumentToolbar/usePrintRangeDialog.js

Symbols:

- `PrintSubmitDetail` (typedef) - Structured payload returned to the caller on submit.

## src/components/DocumentToolbar/SplitToolbarButton.jsx

Exports SplitToolbarButton.

Exports: SplitToolbarButton

## src/components/DocumentToolbar/ThemeMenuButton.jsx

Exports ThemeMenuButton.

Exports: ThemeMenuButton

Local imports: src/contexts/themeContext.js

Symbols:

- `resolveThemeModeLabel` (function) - No description.
- `resolveThemeModeIcon` (function) - No description.
- `<anonymous>~handlePointerDown` (function) - No description.
- `<anonymous>~handleKeyDown` (function) - No description.
- `ThemeMenuButton~handleSelect` (function) - No description.

## src/components/DocumentToolbar/ThemeToggleButton.jsx

Exports ThemeToggleButton.

Exports: ThemeToggleButton

Local imports: src/contexts/themeContext.js

## src/components/DocumentToolbar/usePdfPrebuildAllPages.js

Run async work with bounded concurrency.

Exports: usePdfPrebuildAllPages

Local imports: src/logging/systemLogger.js, src/utils/runtimeConfig.js, src/utils/printPdf.js, src/utils/pdfPrebuildPlan.js, src/utils/pdfPrintCacheKey.js

Symbols:

- `throwIfAborted` (function) - No description.
- `isAbortError` (function) - No description.
- `normalizePdfOrientation` (function) - No description.
- `isCacheableAllPagesRequest` (function) - No description.
- `createVariantDetail` (function) - No description.
- `runLimited` (function) - Run async work with bounded concurrency.
- `createSessionPageNumbers` (function) - No description.
- `module.exports` (function) - No description.

## src/components/DocumentToolbar/usePrintRangeDialog.js

Read the runtime configuration (merged defaults + site overrides).

Exports: getCfg, safeRegex, ensureODVPrintCSS, usePrintRangeController

Local imports: src/utils/printUtils.js, src/utils/localizedValue.js, src/utils/runtimeConfig.js, src/utils/viewerPreferences.js

Symbols:

- `PrintSubmitDetail` (typedef) - Structured payload returned to the caller on submit.
- `getCfg` (function) - Read the runtime configuration (merged defaults + site overrides).
- `safeRegex` (function) - Build a safe RegExp from optional pattern/flags.
- `hasTextValue` (function) - No description.
- `resolveOptionPrintText` (function) - Resolve the string that should be used on physical print/log output for an option.
- `resolvePrintAction` (function) - Resolve a configurable print dialog action.
- `normalizePdfOrientationMode` (function) - No description.
- `buildSelectedOptionDetails` (function) - Build token-friendly details for the selected option without forcing templates to use list indexes.
- `ensureODVPrintCSS` (function) - Ensure base print CSS is injected once per document.
- `usePrintRangeController` (function) - Hook that encapsulates state, derived values, effects and handlers for PrintRangeDialog.
- `usePrintRangeController~onDialogKeyDown` (constant) - No description.
- `usePrintRangeController~makeDescendingSequence` (constant) - No description.

## src/components/DocumentToolbar/ZoomButtons.jsx

Parse a percent-like string safely.

Exports: ZoomButtons

Local imports: src/hooks/useAcceleratingHoldRepeat.js, src/components/DocumentToolbar/SplitToolbarButton.jsx

Symbols:

- `parsePercentInput` (function) - Parse a percent-like string safely.
