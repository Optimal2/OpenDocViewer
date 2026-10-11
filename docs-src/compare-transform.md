# Compare view: free per-page transform

The compare view shows two pages side by side. To compare two pages exactly — for example as a
semi-transparent overlay or with a draggable "curtain" border — the two pages must first be aligned.
This note describes the transform model that makes that possible, and the overlay view built on it.

## Where the state lived before

| Concern | Before | Source |
| --- | --- | --- |
| Base zoom (shared) | `zoom` + `zoomState` | `useDocumentViewer.js` |
| Per-pane zoom | `postZoomLeft/Right`, ±0.1 steps, 0.1–4 | `hooks/useViewerPostZoom.js` (removed) |
| Rotation | `imageProperties.rotation`, 90° steps, drawn by the canvas | `useDocumentViewer.js`, `DocumentRender.jsx` |
| Pan | Scroll position of `.document-render-viewport` (drag scrolls) | `DocumentViewerRender.jsx` |

## State shape

One transform per compared page, held in the viewer context (`ViewerProvider.jsx`) and implemented
as pure functions in `src/utils/compareTransform.js`:

```js
compareTransforms = {
  primary: { scale: 1, dx: 0, dy: 0, rotation: 0 }, // left pane
  compare: { scale: 1, dx: 0, dy: 0, rotation: 0 }, // right pane
}
```

- `scale` multiplies the shared base zoom. `1` is 100 %. Resolution 0.001 (0.1 %). Range 0.1–8
  (10 %–800 %), so a CSS-scaled surface stays within what browsers composite without visible
  tiling. Values outside the range are clamped.
- `dx`, `dy` are CSS pixels at transform scale 1. The rendered offset is `dx × scale`, so the
  alignment stays put when the page scale changes. Resolution 0.01 px, range ±20 000 px.
- `rotation` is degrees clockwise in [0, 360) with 0.1° resolution.

The state is plain JSON. A later view reads and writes it through the context:

- `compareTransforms` — the state above.
- `getCompareTransform(target)` — selector for `'primary'` or `'compare'`.
- `setCompareTransform(target, partialOrUpdater)` — merge and normalize.
- `dispatchCompareTransform(action)` — reducer actions: `set`, `nudge`, `zoomStep`, `rotate`,
  `reset`, `resetAll`, `resetScale`, `resetAlignment`, `restore` (see the JSDoc in
  `compareTransform.js`).

## Presets write the same state

- The per-pane ±0.1 zoom buttons (`CompareZoomOverlay`) dispatch `zoomStep`, a plain ±0.1 step.
  A calibrated fraction is kept (100.5 % → 110.5 %), so + then − returns to the calibrated value.
  The buttons disable at the transform limits (`COMPARE_TRANSFORM_LIMITS`, 10 %–800 %). Fit and
  actual-size modes dispatch `resetScale`, as the old pane zoom reset did.
- The 90° toolbar buttons and Ctrl+Arrow shortcuts dispatch `rotate` (±90). A fine residual is kept.
- Changing the page resets its rotation, as before; scale and offset persist like the old pane zoom.
  Entering or leaving compare mode keeps only the nearest quarter turn (`resetAlignment`).

## How the renderer applies it

`splitTransformRotation` splits the rotation into a quarter turn (0/90/180/270) and a residual in
[-45°, 45°):

- The quarter turn is still drawn by the canvas (`DocumentRender.jsx`), so page layout, axis swap and
  fit modes behave as before. This is the only step that redraws, and it only happens when the angle
  crosses ±45° from a quarter turn.
- Scale, offset and residual become one CSS transform on the page stage
  (`.document-render-container`), with `transform-origin` at the page centre:
  `scale(s) translate(dx px, dy px) rotate(residual deg)`. The browser composites the existing
  full-resolution raster; nothing is re-rasterised per step, so fractional scales do not lose
  quality.
- Outside compare mode no transform is applied. Both panes lay out at the shared base zoom.
- The stage transform does not grow the scrollable area to the top or left. Use the offset to reach
  those parts of a scaled-up page.

## Controls (compare mode only)

Each pane gets a fine-tuning bar above it (`CompareTransformControls.jsx`). The main toolbar is not
changed, so nothing shifts for users who do not compare. The bar is collapsed by default and shows a
summary (`100,0 % · 0,0°`). Expanded, it offers:

- Zoom: numeric field in percent (0.1 %), −/+ buttons (0.1 %, Shift 1 %), Ctrl+wheel over the page
  (1 % per notch).
- Position: drag the page, arrow keys on the move control (1 px, Shift 10 px), numeric X/Y fields.
- Rotation: numeric field in degrees (0.1°, shown signed), −/+ buttons (0.1°, Shift 1°).
- Reset for the page.

Numeric fields accept a decimal comma or point (`parseLocaleNumber`), commit on Enter or blur,
revert on Escape, and step with ArrowUp/ArrowDown (Shift ×10). The move control carries
`data-odv-shortcuts="off"` so the viewer's arrow-key navigation does not also fire. While a bar is
expanded, drag and Ctrl+wheel over that page change the transform instead of scrolling or changing
the shared zoom. During a drag the stage style is updated directly and the offset is committed to the
context on release, so a drag does not re-render the viewer for every pointer move.

## Overlay view

`CompareOverlayView.jsx` stacks the two compared pages in one coordinate space: page A
(`primary`, left) below, page B (`compare`, right) above. It is opened from a toolbar button
(`toolbar.compareOverlay.open`) that only exists in compare mode with two pages shown, and it
replaces the main toolbar and the viewer surface while open, like the print selection workspace.
Close or Escape returns to the compare view; leaving compare mode closes it.

- Each layer is a `DocumentRender` with the page's own transform (`buildCompareTransformCss`) and
  the shared base zoom. The layer viewports do not scroll; pan and zoom go through the transforms,
  so both pages stay in the same coordinate space. In fit modes page A fits the overlay surface.
- The overlay settings are a second piece of context state, `compareOverlay`
  (`src/utils/compareOverlay.js`): `{ opacity: 0–100 (default 50), top: 'compare' | 'primary' }`,
  changed through `dispatchCompareOverlay` (`setOpacity`, `stepOpacity`, `swap`, `reset`). The
  slider sets the opacity of the page on top; swap changes which page that is.
- Calibration uses the same `CompareTransformControls` as the compare view, one per page. Dragging
  the stage moves the top page and Ctrl+wheel zooms it; nudge mode maps the arrow keys to the top
  page (1 px, Shift 10 px). Slider keys: Left/Right 1 %, Shift 10 %, Home/End to the bounds.
- Persistence: the transforms and the overlay settings live in the viewer context, so closing and
  reopening the view (or a later curtain view) keeps them. `hooks/useCompareOverlay.js` only holds
  the open flag and a snapshot of `compareTransforms` taken when the view opens; "reset to compare"
  dispatches `{ type: 'restore', state: snapshot }`.
- "Copy calibration" writes `serializeCompareCalibration(compareTransforms)` to the clipboard:
  `{ "A": transform, "B": transform }` with normalized values, for support cases.
- While the view is open, the viewer's keyboard navigation is suspended (`interactionSuspended`)
  so arrow keys never change pages behind it.

Tests: `src/utils/__tests__/compareOverlay.test.js`, `src/components/__tests__/compareOverlayView.test.jsx`,
`src/components/__tests__/useCompareOverlay.test.jsx`, `tests/ui/compare-overlay.spec.mjs`.

## Measurement

`tests/ui/compare-transform.spec.mjs` (last test) pans and rotates a 300 dpi A4 raster
(2480 × 3508 px canvas) inside the real compare-pane stage for 240 animation frames, using the same
CSS transform path. Three local runs (Playwright Chromium, headless, Windows 10, 2026-10-11; run 3
inside the full UI suite):

| Run | Median frame | p95 | Max | Median fps |
| --- | --- | --- | --- | --- |
| 1 | 16.7 ms | 33.3 ms | 116.7 ms | 60 |
| 2 | 16.7 ms | 33.4 ms | 250.1 ms | 60 |
| 3 | 16.7 ms | 49.9 ms | 83.4 ms | 60 |

Discrete changes (fields, buttons, arrow keys, Ctrl+wheel notches) go through the viewer context and
re-render its consumers once per change; that path is not part of this measurement.

The test fails if the median exceeds 34 ms (about 30 fps) and logs the numbers on every run.
