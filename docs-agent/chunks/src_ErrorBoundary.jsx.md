# OpenDocViewer / src/ErrorBoundary.jsx

File count: 1. Line count: 297. JSDoc symbol count: 12.

## src/ErrorBoundary.jsx

Tiny helper to translate with safe fallback (NS: 'common').

Exports: ErrorBoundary

Local imports: src/logging/systemLogger.js

Symbols:

- `IS_DEV` (constant) - Determine whether we are in development mode.
- `tr` (function) - Tiny helper to translate with safe fallback (NS: 'common').
- `toBool` (function) - Coerce unknown values to boolean using common string/number forms.
- `readConfigFlag` (function) - Read a runtime configuration flag (SSR-safe).
- `ErrorBoundaryProps` (typedef) - Props for the ErrorBoundary component.
- `ErrorBoundaryState` (typedef) - Internal state for the ErrorBoundary.
- `module.exports` (class) - React Error Boundary implementation with: runtime-controlled stack visibility copy-to-clipboard helper for diagnostics reset handler to re-render child tree
- `getDerivedStateFromError` (function) - No description.
- `componentDidCatch` (function) - Log error details for diagnostics.
- `module.exports#reset` (member) - Reset the boundary and optionally call the external onReset handler.
- `module.exports#copyDetails` (member) - Copy a concise diagnostic bundle to the clipboard (best effort).
- `render` (function) - No description.
