# OpenDocViewer / src/hooks

File count: 7. Line count: 971. JSDoc symbol count: 29.

## src/hooks/useAcceleratingHoldRepeat.js

Reusable press\-and\-hold behavior for toolbar buttons.

Exports: `useAcceleratingHoldRepeat`

Local imports: `src/logging/systemLogger.js`

Symbols:

- `module.exports` (function) - No description.

## src/hooks/useNavigationModifierState.js

Shared modifier\-key state for navigation and compare\-aware viewer actions.

Exports: `useNavigationModifierState`, `useNavigationModifierState`

Symbols:

- `NavigationModifierState` (typedef) - No description.
- `hasActiveModalDialog` (function) - No description.
- `resolveModifierState` (function) - No description.
- `useNavigationModifierState` (function) - No description.
- `<anonymous>~applyState` (function) - No description.
- `<anonymous>~clearState` (function) - No description.
- `<anonymous>~syncModifierState` (function) - No description.
- `<anonymous>~handleVisibilityChange` (function) - No description.

## src/hooks/useOcrModule.js

Loads the OCR module once the runtime switch \(\`ocr.enabled\`\) is the literal true.

Exports: `useOcrModule`

Local imports: `src/logging/systemLogger.js`, `src/utils/ocrLoader.js`, `src/utils/runtimeConfig.js`

Symbols:

- `module.exports` (function) - No description.

## src/hooks/useOcrTextLayers.js

Runs OCR for the pages near the viewer's focus and exposes the outcomes per page.

Exports: `OCR_IDLE_SHUTDOWN_MS`, `useOcrTextLayers`

Local imports: `src/logging/systemLogger.js`, `src/utils/ocrPageKey.js`

Symbols:

- `OCR_IDLE_SHUTDOWN_MS` (constant) - Idle time after which the OCR worker is terminated to free its memory.
- `module.exports` (function) - No description.

## src/hooks/usePageNavigation.js

OpenDocViewer — Page Navigation Hook \(React\) Provide memoized handlers for page navigation \(first/prev/next/last\) and continuous navigation timers suitable for press\-and\-hold UI \(e.g., mousedown\).

Exports: `usePageNavigation`

Local imports: `src/logging/systemLogger.js`, `src/hooks/usePageTimer.js`, `src/utils/navigationUtils.js`

Symbols:

- `PageNavigationAPI` (typedef) - API returned by usePageNavigation.
- `usePageNavigation` (function) - Custom hook to handle document page navigation with keyboard/mouse.
- `usePageNavigation~handlePrevPageWrapper` (constant) - Wrapper: go to previous page \(logs once per user action\).
- `usePageNavigation~handleNextPageWrapper` (constant) - Wrapper: go to next page \(logs once per user action\).
- `usePageNavigation~handleFirstPageWrapper` (constant) - Wrapper: go to first page.
- `usePageNavigation~handleLastPageWrapper` (constant) - Wrapper: go to last page.
- `usePageNavigation~fastPrev` (constant) - Fast step: previous \(used by timers\).
- `usePageNavigation~fastNext` (constant) - Fast step: next \(used by timers\).

## src/hooks/usePageTimer.js

OpenDocViewer — Continuous Page Navigation Timer \(React hook\) Provide a tiny utility for press\-and\-hold page navigation: \- Invokes a caller\-supplied callback immediately \(leading edge\) and then repeatedly after an initia

Exports: `usePageTimer`

Local imports: `src/logging/systemLogger.js`

Symbols:

- `PageDirection` (typedef) - No description.
- `DEFAULT_REPEAT_INTERVAL_MS` (constant) - Default repeat cadence \(ms\).
- `PageTimerAPI` (typedef) - API returned by usePageTimer.
- `usePageTimer` (function) - Custom hook to handle page change with a timer for continuous navigation.
- `usePageTimer~startPageTimer` (constant) - Start the timer for continuous page navigation.
- `usePageTimer~stopPageTimer` (constant) - Stop any active delay or interval timer \(idempotent\).

## src/hooks/usePdfSignatureReports.js

Browser PDF signature inspection.

Exports: `usePdfSignatureReports`

Local imports: `src/utils/pdfSignatureInspector.js`, `src/utils/pdfSignatures.js`

Symbols:

- `module:hooks/usePdfSignatureReports` (module) - Browser PDF signature inspection.
- `module:hooks/usePdfSignatureReports~isPdfPage` (function) - No description.
- `module:hooks/usePdfSignatureReports` (function) - No description.
