# Page fine tuning and comparison

The ordinary viewer starts with fine tuning hidden. The localized **Fine tuning** toolbar button
toggles controls for the displayed page or both side-by-side pages. Its pressed/expanded state
reflects visibility, and the session choice survives entering/leaving compare and fullscreen views.
Hiding controls disables fine drag and Ctrl/Cmd-wheel editing without changing any geometry or
image adjustment. Per-page disclosure buttons can additionally collapse individual panels.

`fineTune.enabled` is the independent master capability (strict boolean, default `true`). When
false, controls, fine gestures, overlay, curtain and their print surfaces are unavailable. Ordinary
viewing, simple comparison and printing remain available. Overlay and curtain always open with
both reusable fine-tuning panels expanded, regardless of ordinary viewer visibility.

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
- The 90° toolbar buttons, the panel's 90° quick buttons and Ctrl+Arrow shortcuts dispatch
  `rotate` (±90). A fine residual is kept.
- Navigation saves calibration and image adjustments by original page number within each pane.
  An unvisited page starts neutral; returning restores its values. The pane banks are independent,
  including when both show the same page. Filtering uses original numbers, so it cannot reassign
  edits to another page. A new bundle clears the banks. Nothing is stored on the server or disk.
  Mode changes preserve alignment; they no longer dispatch `resetAlignment`.

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
- Single-page and compare modes apply the same transform. Both panes lay out at shared base zoom.
- The stage transform does not grow the scrollable area to the top or left. Use the offset to reach
  those parts of a scaled-up page.

## One adjustment model per page

Each compared page has exactly one adjustment state and one panel for it. The state is the page's
transform above plus its image adjustment, held per pane by `hooks/usePaneImageAdjustments.js`
and implemented in `src/utils/imageAdjustments.js`:

```js
imageProperties = {
  rotation: 0,      // derived from the transform's quarter turn, never stored on its own
  brightness: 100,  // percent, 100 = unchanged
  contrast: 100,    // percent, 100 = unchanged
  grayscale: 0,     // percent 0–100, 0 = in colour
  invert: false,    // boolean
}
```

`needsCanvas` decides whether a page is drawn on the canvas at all and `buildImageFilter` builds
the canvas filter (`brightness() contrast()`, then `grayscale()` and `invert()` only when set). With
all-neutral values the page keeps the plain `<img>` fast path, and the neutral filter string is the
one used before grayscale and invert existed, so neutral pages draw the same pixels as before
(`tests/ui/image-filter-neutrality.spec.mjs`).

### The panel

`CompareTransformControls.jsx` renders one panel above each displayed page when fine tuning is
visible. The toolbar toggle opens the panels expanded. Each disclosure can collapse to a summary
(`100,0 % · 0,0°`), followed by a one-character `◐` badge while the image is adjusted. Expanded,
it holds everything the page can be adjusted with:

- Zoom: numeric field in percent (0.1 %), −/+ buttons (0.1 %, Shift 1 %), Ctrl+wheel over the page
  (1 % per notch).
- Position: drag the page, arrow keys on the move control (1 px, Shift 10 px), numeric X/Y fields.
- Rotation: numeric field in degrees (0.1°, shown signed), −/+ buttons (0.1°, Shift 1°), and a 90°
  quick button on each side of the field. A quarter turn is added to the whole rotation and keeps
  the fine part, so 4,6° followed by the clockwise quick button reads 94,6° (and the
  counter-clockwise one −85,4°): the canvas draws the new quarter turn and the CSS keeps the 4,6°
  residual.
- Image: brightness and contrast in percent (0–200, 100 = unchanged), grayscale in percent
  (0–100, 0 = in colour), and an Invert checkbox. Steps 1 %, Shift 10 %.
- Three labelled resets:
  - **Reset all (layout and image)** / *Återställ allt (läge och bild)* — `resetPane`: identity
    transform (zoom 100 %, no offset, rotation 0 including the quarter turn) and neutral image.
  - **Reset layout (zoom, position, rotation)** / *Återställ läge (zoom, position, rotation)* —
    the transform only; brightness, contrast, grayscale and invert stay.
  - **Reset image (brightness, contrast, color)** / *Återställ bild (ljus, kontrast, färg)* —
    the image only; zoom, position and rotation stay.

  Each reset is disabled while there is nothing for it to clear.

### The main toolbar

The main toolbar's coarse image controls (90° buttons, brightness, contrast, reset) change the same
page state as the panel; they are not a second model. Which page they target follows the active
pane (and Shift), as before.

- In compare mode the toolbar reset is `resetPane`, the panel's full reset, and its label says so
  (`Reset all (layout and image)`). Both reach the same end state;
  `tests/ui/compare-transform.spec.mjs` measures both from the same starting state and asserts the
  two captures are equal.
- Outside compare mode the toolbar reset keeps its earlier, narrower scope: rotation 0 and neutral
  image, zoom and position kept.

`compare.adjust.toolbarMode` decides what the toolbar does with these controls in compare mode
(read by `getCompareAdjustToolbarMode`, see
[Runtime configuration](runtime-configuration.md#compare-views-and-printing)):

- `'mirror'` (default; also used for any missing or unknown value): the controls stay and show the
  target page's live values — a value chip on brightness and contrast when they are off 100 %, and
  the reset marked `is-active` while there is anything to reset, including grayscale and invert,
  which have no toolbar control of their own.
- `'hide'`: the controls are hidden while ANY shown page's panel is expanded and come back when
  every panel is collapsed. Outside compare mode the key has no effect, and the overlay and curtain
  views only ever have the panel.

### Where the adjustment travels

- The overlay and curtain views draw each page with the same image adjustment as side by side
  (`tests/ui/compare-overlay.spec.mjs` and `compare-curtain.spec.mjs` compare the canvas pixels).
- "Copy calibration" in the overlay view includes the image fields (see below).
- Active-page and ordinary two-page HTML/PDF printing read `getPrintableSurface()`: a raster of
  the current fine transform inside the original page frame (white outside content, clipped at page
  edges). Base zoom converts CSS offsets to raster pixels; quarter turns and filters are already
  drawn. Panel visibility does not affect output. Overlay/curtain composition continues to read
  raw `getActiveCanvas()` and applies transforms once in the shared stage frame. Range/all-page
  printing intentionally prints source assets without session edits, as before.

### Input behaviour

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
Close or Escape returns to the compare view (Escape also while the opacity slider has focus; text
fields keep Escape to undo their typed value); leaving compare mode closes it.

- Availability: `compare.overlay.enabled: false` hides the entry button, refuses the open action
  in `useCompareOverlay` and prevents rendering through `resolveShownCompareViews`, even with a
  stale open flag. It does not clear calibration or disable ordinary compare mode.
- **Print** opens the shared print dialog for one composed page of the visible stage, with the
  current top page, opacity and both pages' transforms. It uses the same options, direct/PDF
  choice and user print log (`pageCount: 1`) as the toolbar. Setting
  `compare.overlay.print.enabled: false` hides only this Print button.
- Each layer is a `DocumentRender` with the page's own transform (`buildCompareTransformCss`) and
  the shared base zoom. The layer viewports do not scroll; pan and zoom go through the transforms,
  so both pages stay in the same coordinate space. In fit modes page A fits the overlay surface.
- The overlay settings are a second piece of context state, `compareOverlay`
  (`src/utils/compareOverlay.js`): `{ opacity: 0–100 (default 50), top: 'compare' | 'primary' }`,
  changed through `dispatchCompareOverlay` (`setOpacity`, `stepOpacity`, `swap`, `markCalibrated`,
  `clearCalibrated`, `reset`). The
  slider sets the opacity of the page on top; swap changes which page that is.
- Calibration uses the same `CompareTransformControls` as the compare view, one per page. Dragging
  the stage moves the top page and Ctrl+wheel zooms it; nudge mode maps the arrow keys to the top
  page (1 px, Shift 10 px). Slider keys: Left/Right 1 %, Shift 10 %, Home/End to the bounds.
- Persistence: the transforms and the overlay settings live in the viewer context, so closing and
  reopening the view (or a later curtain view) keeps them. `hooks/useCompareOverlay.js` only holds
  the open flag and a snapshot taken when the view opens:
  `{ transforms, imageAdjustments: { primary, compare } }`. "Reset to compare" restores all of it
  for both pages — the transforms (`{ type: 'restore' }`) and the brightness, contrast, grayscale
  and invert of each page — not only the layout.
- "Copy calibration" writes `serializeCompareCalibration(transforms, imageAdjustments)` to the
  clipboard: `{ "version": 2, "A": {...transform, ...image}, "B": {...} }` with normalized values,
  for support cases. `COMPARE_CALIBRATION_VERSION` is 2; text without `version` is the older
  transform-only form (implicitly version 1). Nothing parses it back.
- While the view is open, the viewer's keyboard navigation is suspended (`interactionSuspended`)
  so arrow keys never change pages behind it.

Tests: `src/utils/__tests__/compareOverlay.test.js`, `src/components/__tests__/compareOverlayView.test.jsx`,
`src/components/__tests__/useCompareOverlay.test.jsx`, `tests/ui/compare-overlay.spec.mjs`.

## Curtain view

`CompareCurtainView.jsx` shows the calibration with a draggable border and per-image controls: the two pages
in the overlay's coordinate space (same `DocumentRender` layers and transforms), page A below and
page B above, page B clipped to one side of the border.

- Calibration presence: `compareOverlay.calibrated` is set (`markCalibrated`) when the overlay
  view opens and cleared (`clearCalibrated`) when compare mode ends or the second page goes away;
  `hasCompareCalibration()` reads it. Both reusable panels edit transforms and image adjustments
  through the same handlers as the other views, independently of normal panel visibility. Border
  pointer capture and slider keyboard handling remain separate from the calibration controls.
- Entry: `CompareCurtainButton.jsx`, in the overlay view's toolbar and in the compare toolbar next
  to the overlay button. Without a calibration the compare toolbar button is `aria-disabled` (still
  focusable, so its tooltip explains that the overlay view calibrates first). If the overlay is
  disabled by config, the curtain instead uses the compare view's own calibration and does not
  require opening the overlay first.
- Availability: `compare.curtain.enabled: false` hides the entry buttons in both toolbars,
  refuses the open action and prevents rendering even with a stale open flag.
- **Print** opens the shared print dialog for one composed page of the visible stage, with the
  current border orientation/position and both pages' transforms. It uses the same options,
  direct/PDF choice and user print log (`pageCount: 1`) as the toolbar. Setting
  `compare.curtain.print.enabled: false` hides only this Print button.
- Return: `hooks/useCompareOverlay.js` holds `curtainOpen` next to the overlay's open flag. Opened
  from the overlay view, the overlay stays open but hidden (`compareOverlayOpen` is false while the
  curtain shows), so Close returns to it with its "reset to compare" snapshot intact; opened from
  the compare view, Close returns there. Escape closes like Close (also from a slider).
- Geometry (`src/utils/compareCurtain.js`): `buildCurtainClipPath(mode, p)` is
  `inset(p% 0% 0% 0%)` in horizontal mode (horizontal line, page B below) and
  `inset(0% 0% 0% p%)` in vertical mode (vertical line, page B right); 0 % shows page B on the
  whole stage, 100 % hides it. The layers fill the non-scrolling stage, so percent of the layer is
  percent of the stage.
- Controls: one Horizontal/Vertical toggle and the border, a `role="slider"` grab bar focused on
  open. Arrow keys 1 %, Shift 10 % (`resolveCurtainKeyAction`); the reducer keeps one position per
  mode (`{ mode, positions: { horizontal, vertical } }`) in local state for as long as the view is
  open. A drag writes `clip-path` and the bar position straight to the DOM and commits on release;
  the page elements are memoized, so neither drag nor keys re-render the pages.
- Labels in the stage corners name the sides: `A · page n` (top left), `B · page m` (top right in
  vertical mode, bottom left in horizontal mode).

Tests: `src/utils/__tests__/compareCurtain.test.js`, `src/components/__tests__/compareCurtainView.test.jsx`,
`src/components/__tests__/useCompareOverlay.test.jsx`, `src/__tests__/compareHelp.test.js`,
`tests/ui/compare-curtain.spec.mjs`.

All four `compare` switches default to `true`; `odv.site.config.js` overrides them. Only a literal
`false` disables a key. See [Runtime configuration](runtime-configuration.md#compare-views-and-printing)
for an all-off example and [Printing design notes](printing.md#overlay-and-curtain-print) for the
shared output pipeline.

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
