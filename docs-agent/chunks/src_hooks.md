# OpenDocViewer / src/hooks

File count: 4. Line count: 650. JSDoc symbol count: 23.

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
