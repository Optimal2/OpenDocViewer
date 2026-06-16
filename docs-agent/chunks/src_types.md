# OpenDocViewer / src/types

File count: 1. Line count: 101. JSDoc symbol count: 13.

## src/types/jsdoc-types.js

Generic React-like state setter for numbers: accepts either a number or an updater function (number)-&gt;number.

Symbols:

- `SetNumberState` (typedef) - Generic React-like state setter for numbers: accepts either a number or an updater function (number)-&gt;number.
- `SetStringNullable` (typedef) - Setter for string-or-null values.
- `SetNumber` (typedef) - Simple number setter (no updater function).
- `SetString` (typedef) - Simple string setter.
- `SetBooleanState` (typedef) - React-like state setter for booleans: accepts a boolean or an updater (boolean)-&gt;boolean.
- `SetPageNumber` (typedef) - React-like state setter for page number: accepts a number or an updater (number)-&gt;number.
- `PageDirection` (typedef) - Direction token used by page timers / navigation.
- `FallbackRenderer` (typedef) - Render function signature for ErrorBoundary fallbacks.
- `DocumentRenderHandle` (typedef) - Minimal imperative handle exposed by the page renderer for printing.
- `RefLike` (typedef) - Generic &quot;ref-like&quot; object (for places where React.MutableRefObject is too specific).
- `ZoomMode` (typedef) - Sticky zoom modes used by the viewer.
- `BumpPostZoom` (typedef) - Step the per-pane post-zoom by ±0.1.
