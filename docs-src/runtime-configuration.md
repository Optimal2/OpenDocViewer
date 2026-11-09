# Runtime configuration notes

OpenDocViewer is designed so operational configuration can change without rebuilding the frontend bundle.

## Primary config files

- `public/odv.config.js`
  - required defaults
- `public/odv.site.config.sample.js`
  - sample site override file
- optional deployment-specific `odv.site.config.js`
  - fetched before the required default config and then merged on top of those defaults

To derive `odv.site.config.js` from the sample and re-verify it after an upgrade, use
`tools/site-config-generator/` (see its `README.md`). It applies a small JSON site profile to the
current sample, keeps the sample's comments, and `check` reports drift against a new sample. The
tool is not part of the build output or any release package.

## Load order

`src/app/bootConfig.js` performs runtime config loading before React starts.

1. determine application base path
2. probe `odv.site.config.js` from the application base
3. probe `odv.config.js` from the application base
4. optionally fall back to site root for `odv.config.js` in development scenarios
5. import `src/index.jsx`

This keeps the viewer startup deterministic and avoids partial initialization with missing config.
Although the optional site file is fetched first, `odv.config.js` owns the default object and applies
`odv.site.config.js` as overrides with `deepMerge(ACTIVE_CONFIG, siteOverrides)`.

## Why scripts are probed before injection

The outcome is published as `window.__ODV_SITE_CONFIG_STATUS__` with `attempted`, `url`, `loaded`
and `reason` (`not-found`, `wrong-content-type`, `script-error-or-integrity`, or `ok`). A present
but rejected file also emits a console warning with the reason. `not-found` includes failed probes
and HTTP failures; inspect the Network panel to distinguish a missing file from a blocked request.
`window.__ODV_SITE_CONFIG_KEYS__` lists the top-level override keys consumed by the default script.
Both are included in the support diagnostics export.

The boot loader uses a fetch probe before adding script tags so it can reject cases where the server returns:

- HTML instead of JavaScript
- a wrong MIME type
- an SPA fallback page for a missing config script

Without that probe, config failures are harder to diagnose in production.

## PDF display resolution

`documentLoading.render.pdfResolution` defaults to:

```js
{ mode: 'auto', targetDpi: 300, fixedScale: 2, minScale: 1.5, maxScale: 6,
  maxPixels: 40000000 }
```

Auto targets a physical resolution: the factor is `targetDpi / 72` (PDF user space is 72 points per
inch), so 300 dpi gives 4.1667 and an A4 page becomes 2480 × 3508 pixels, the same on a small
laptop screen, a large monitor and on paper. The page rasters are also what the viewer prints, so
the screen deliberately does not influence the factor; a user on a small screen gets the same print
quality as everyone else. The page size only matters downwards: for very large pages the pixel
budget and the browser render-surface limits lower the factor. `headroom` and `dprCap` from earlier
versions are accepted but no longer used; `viewerWidthCss` and `devicePixelRatio` are still shown in
the diagnostics for reference. Run `node scripts/measure-pdf-resolution.mjs` for the fixed/auto
A5/A4/A3 comparison table.

`fullPageScale` remains a legacy alias for `fixedScale`, and a floor in auto mode together with
`minScale`. A site containing only `fullPageScale: 4` therefore keeps a floor of 4. If a site sets
both aliases explicitly, auto honors the higher floor; in fixed mode `pdfResolution.fixedScale`
wins. To preserve the old fixed policy, set
`mode: 'fixed'`; ordinary safe pages keep the same scale and integer raster dimensions. The older
fallback renderer's separate hardcoded factor has been removed.

Normalization accepts finite numbers/numeric strings, clamps targetDpi to 72–1200, minScale to
0.5–6, fixedScale and maxScale to 0.5–12, headroom to 1–3, DPR cap to 1–4, and maxPixels to
1–268435456. Invalid values use defaults; maxScale is raised
to minScale when bounds are inverted. Pixel and browser surface limits take precedence over the
floor, including fixed mode. The low runtime memory tier halves the pixel budget to 20 MP by
default. The limit includes rounding to integer canvas dimensions. It is a per-page limit, not a
total session-memory budget; an RGBA raster alone uses roughly four bytes per pixel.

Effective scales are part of persisted page-asset keys. Reload restoration checks page geometry
against the current policy before accepting an asset. This can require opening the PDF to read
geometry even when the actual page raster is restored. Existing in-session pages retain their
effective scale on resize; resizing does **not** automatically rasterize again. The one-shot
resolution boost requests twice the current effective factor. The policy ceiling (maxScale) does
not limit the boost, because the auto policy already sits at that ceiling on wide or high-DPI
viewers; only the hard caps do (maxPixels, the browser render surface and the scale limit of 12).
The boost replaces the visible asset URL and marks the page boosted. When the hard caps already
bind, the page is marked "maxed" instead: the button is disabled with a distinct tooltip and
nothing is rendered again. Boosted rasters are session-local and do not overwrite the ordinary
persisted raster.

The diagnostics export includes the normalized policy, latest effective factor, DPR, viewer CSS
width, memory tier, reason and pixel count under `config.documentLoading.pdfResolution`.
Print rendering and dedicated thumbnail fit rules are separate. TIFF and raster sources are not
upscaled by these PDF settings. A thumbnail that reuses the full image naturally shares its raster.

## Trust boundary and integrity

OpenDocViewer runtime config is executable JavaScript, not passive JSON. `index.html`,
`odv.config.js`, and optional `odv.site.config.js` all execute in the viewer origin before React
starts. Anyone who can change any of those files can run arbitrary code in the same trust boundary
as the shipped application bundle.

Operational implications:

- treat runtime-config files with the same write-access controls as deployed JS/CSS assets
- keep runtime config same-origin with the viewer shell unless a host has intentionally designed and
  reviewed a different bootstrap boundary
- do not place secrets in runtime config; every value is readable by the browser
- keep `index.html`, `odv.config.js`, and `odv.site.config.js` on no-store caching so security or
  operational changes take effect immediately

The shell now carries a baseline Content Security Policy that blocks third-party script/object
injection while still allowing same-origin worker modules, blob-backed print frames, and the
deployment-specific document/log endpoints that existing integrations use.

When a deployment wants stronger pinning for runtime config, `src/app/bootConfig.js` can forward
Subresource Integrity attributes from the bootstrap script to the injected config scripts:

```html
<script
  type="module"
  data-odv-bootstrap
  data-odv-config-integrity="sha384-..."
  data-odv-site-config-integrity="sha384-..."
  src="./src/app/bootConfig.js"></script>
```

Use those attributes only when deployment automation can update the hashes every time the matching
config file changes. This is straightforward for immutable packaged defaults and only safe for
site-local overrides when the local deployment step owns both the file content and the bootstrap
markup that carries the hash.

When the OMP packaging scripts generate those hashes automatically, they inject the matching
`data-odv-config-integrity` and optional `data-odv-site-config-integrity` attributes into the built
`index.html`. Treat that as one deployment unit: do not edit `odv.site.config.js` directly on the
IIS server after packaging, because a content change without a matching hash update will cause the
browser to reject the file and OpenDocViewer will not start.

## What belongs in runtime config

Good runtime-config candidates:

- logging endpoints and enable/disable flags
- i18n defaults and translation versioning / build-based cache busting
- print-dialog thresholds and print-header settings
- diagnostics toggles
- user-facing document metadata visibility
- keyboard shortcut policy for browser-print interception
- deployment base path / base href
- optional integration-adapter mappings for host payload metadata

Poor runtime-config candidates:

- logic that should be compile-time code
- secrets that should not be visible to the browser
- values that need strong server-side enforcement

## Locale version token

Translation files are fetched from `i18n.loadPath` (default
`locales/{{lng}}/{{ns}}.json?v={{ver}}`). `{{ver}}` is resolved by `src/utils/i18nVersion.js`; the
first non-empty value wins:

1. `?i18nV=<token>` in the viewer URL - a one-page-load override for support diagnostics.
2. `i18n.version` in runtime config when the operator pins a value. `'auto'` (the shipped default)
   means "not pinned".
3. The build's locale token, `<ODV_BUILD_ID>.<locale hash>`. The build id is deterministic by
   default (`<package version>-stable`, overridable with `ODV_BUILD_ID` / `ODV_BUILD_STAMP` /
   `SOURCE_DATE_EPOCH`); the locale hash (`scripts/locale-resource-hash.mjs`, injected by
   `vite.config.js` as `ODV_I18N_RESOURCE_HASH`) is a SHA-256 over all `public/locales` files
   with normalized line endings. Any change to a locale file therefore gives a new URL, while
   rebuilding the same commit keeps the same URL.
4. localStorage `ODV_I18N_VERSION` (written only by the development diagnostics helper
   `window.__I18N_DIAG__.setVer()` / `bump()`), used only when the bundle carries no build token.
5. The application version, then the bundled resource revision.

Before 2026-10 the persisted localStorage value ranked above runtime config and the build id, and
the build id alone stayed `<version>-stable` between OMP module builds of the same package version.
After a module upgrade with new strings the locale URL could stay the same, and because `locales/`
inherited the one-year `immutable` cache policy the browser kept the old file (English fallbacks
such as "Signed documents" or "Details" in a Swedish UI). Both causes are fixed: the build token
outranks persisted values, and `public/web.config` makes `locales/` revalidate (see
`deploy-ops.md`, "Cache rules"). Only pin `i18n.version` when a site really needs a fixed token,
and change it whenever the locale files change.

## Document Metadata UI

Document metadata can be preserved in the normalized bundle even when the site does not want users
to inspect it directly inside OpenDocViewer. The user-facing metadata overlays and context-menu
metadata actions are controlled by:

```js
metadata: {
  enabled: true
}
```

Set `metadata.enabled` to `false` for deployments where metadata may still be used internally for
print templates, sorting, or diagnostics, but should not be exposed as a document metadata dialog or
overview table.

## PDF Signature Symbols

Signed PDF files show a signature symbol next to the document label ("DOK n") in the thumbnail
strip, a small symbol on every page thumbnail of a signed file, and one signature overview button
in the toolbar (see `docs-src/pdf-signatures.md`). The per-page thumbnail symbol can be turned off:

```js
pdfSignatures: {
  thumbnailPageBadge: true
}
```

Set `pdfSignatures.thumbnailPageBadge` to `false` to hide the per-page symbol. The document-level
symbol and the toolbar overview stay visible, so signed documents are still discoverable. Only an
explicit `false` disables the symbol; a missing or non-boolean value keeps the default (`true`).

### Inspection on/off and start time

Signature inspection never delays page loading: it waits for pages first and then runs inside the
signature worker, one PDF at a time, on bytes the viewer already holds. Two keys let a site that
puts total load time first keep it out of the way entirely:

```js
pdfSignatures: {
  enabled: true,            // false: no inspection, no symbols
  inspectAfter: 'firstPage' // 'allPages': start only when every page of the load is ready
}
```

- `pdfSignatures.enabled: false` turns signature reading off. No PDF bytes are handed to the
  signature worker, and the document symbol, page symbols and toolbar overview button do not
  appear. Only an explicit `false` disables it.
- `pdfSignatures.inspectAfter` chooses when inspection may start: `'firstPage'` (default) as soon
  as the first page is shown, `'allPages'` only after the whole loading run is complete. Unknown
  values fall back to `'firstPage'`.

### Symbol colour for unchecked signatures

The viewer checks integrity (whether the content is unchanged since signing) in the browser. It never
checks the certificate chain, revocation status or trust lists, and it makes no network request for
signatures. When the viewer could not check a signature itself (format, algorithm, size or time
budget, encryption, worker failure: status "Not checked in the viewer"), the symbol is green with
an information line by default. `pdfSignatures.uncheckedSeverity` chooses how such signatures are
shown:

```js
pdfSignatures: {
  uncheckedSeverity: 'ok' // 'warning': show "not checked in the viewer" as a warning
}
```

`'ok'` (default) keeps the OK symbol; exactly `'warning'` uses the warning symbol. Intact,
modified, damaged or invalid signatures keep their own severity, and unknown statuses stay
errors. Unknown values fall back to `'ok'`. See "Status model" in `docs-src/pdf-signatures.md`.

## OCR (in-browser, off by default)

Enable OCR with `ocr: { enabled: true, languages: ['swe', 'eng'] }` in the site configuration.
The shipped HTML meta and IIS policies already allow its WebAssembly engine; no application
file needs editing. A custom server or gateway policy must permit it too (see "CSP for OCR").

OpenDocViewer can recognize text on scanned pages (TIFF, JPG, PNG and PDF pages without a usable
text layer) inside the browser and show it as a selectable text layer on the page; a PDF page that
already has a usable text layer gets the same layer from its own text, without recognition. The
feature is opt-in and off by default:

```js
ocr: {
  enabled: false,              // only the literal true turns OCR on
  removeRulingLines: true,     // remove table/form lines from a copy of the page before recognition
  recognizeWholeDocument: false, // true: after the shown page's neighbours, the rest of the document
  workerCount: 1,              // pages recognised at the same time; 0: automatic from the client's cores
  languages: ['swe', 'eng'],   // Tesseract language codes, tried together on every text line
  search: {
    enabled: true,             // the toolbar's search in the text layers; false leaves a status-only indicator
    overridesCtrlF: false      // true: Ctrl+F opens this search instead of the browser's find
  },
  speech: {
    enabled: true,             // read-aloud (context menu entry, reading language in the language menu); false leaves it out
    autoDetectLanguage: true   // guess each page's language for read-aloud and the layer's lang
  },
  assetBaseUrl: null           // null: the viewer's own ocr/ folder; or a site-hosted base URL
}
```

- `ocr.enabled`: only the boolean literal `true` turns OCR on. A missing section, `false`,
  strings such as `"true"`, numbers and objects all keep it off. While off, the OCR module is never
  imported: no engine or language file is downloaded, no worker starts, no OCR element exists in
  the DOM, and layout, printing, performance and memory are unchanged. The engine, the page
  queue and tesseract.js are a separate lazy chunk that only the switch loads; the main bundle
  carries just the small layer component, its stylesheet and the context fields, which mount
  and compute nothing while the switch is off.
- `ocr.removeRulingLines`: whether the ruling lines of tables and forms are removed from a copy
  of the page image before recognition (see "Ruled tables" below). `true` by default; only the
  boolean literal `false` turns the step off, a missing key or any other value keeps it. The key
  means nothing while OCR is off.
- `ocr.recognizeWholeDocument`: whether the queue works through the whole document in the
  background. `false` by default: only the shown page and its neighbours are recognised (see
  "Which pages are recognised" below), and a page further away waits until the user reaches it,
  so the search covers only the pages that have been near the user. With the boolean literal
  `true`, the window keeps its priority and the remaining pages follow it (`ocr.workerCount` at
  a time) in reading order from the shown page to the end and then from the start of the document, while
  the viewer is open; a page the viewer has not rendered is rendered for the purpose and dropped
  again as soon as its bytes are read (so a long document does not pile up page renders; a page
  the user has reached meanwhile is left to the viewer), the outcome cache grows to the page
  count (an outcome is never dropped while its page is still planned), and the queue still
  pauses for printing and under memory pressure. On a long document this costs CPU in the
  background for as long as it takes (a few seconds per page), also while the tab is in the
  background, which is why it is off by default. The key means nothing while OCR is off.
- `ocr.workerCount`: how many pages are recognised at the same time, each in its own
  tesseract.js worker. `1` by default. Only an integer literal counts: `2` to `8` runs that many
  workers (a larger integer is lowered to 8), `0` chooses automatically from the client's logical
  cores (`navigator.hardwareConcurrency` minus one, which is left for the page itself, never
  fewer than one and never more than 4), and anything else (a string such as `"2"`, a fraction,
  a negative number, a boolean) gives one worker with a console warning. Every worker holds its
  own copy of the engine and of every language model, so each extra worker costs memory as well
  as a core; measure before raising it on a site, and keep it at one where clients are weak. The
  first worker starts alone (a failure is found once, the others then take the engine and models
  from the browser's cache) and the others follow once it runs. The pages in flight share the
  queue's order: with the window's pages first, the whole document (when asked for) then goes
  through that many pages at a time. The key means nothing while OCR is off.
- `ocr.languages`: an array of Tesseract language codes. Entries are trimmed and lower-cased;
  non-strings, malformed codes and duplicates are dropped, and an array without any valid entry
  (including `[]`) falls back to `['swe', 'eng']`. Only the form of a code is checked when the
  configuration is read; when OCR starts, codes that name no Tesseract model (a typo such as
  `sve`) are dropped as well, and every dropped or repeated entry, a value that is not an array
  and every fallback is reported once as a console warning, so a mistake is never silent. The `ocr/` folder that ships with the viewer
  contains the Swedish and English models; another language needs `ocr.assetBaseUrl` pointing at
  a folder that has its model (`<lang>.traineddata.gz`). Every listed model runs on every text
  line and the best match wins, so each extra language adds some recognition time per page. As
  with every array in the site file, an override replaces the default completely.
- `ocr.search.enabled`: whether the toolbar offers the search in the text layers (the button that
  also shows the page's recognition status, see "What the user sees" below). `true` by default;
  only the boolean literal `false` turns it off. With it off, the button's place keeps a
  status-only indicator (the same LED, the status as its name and tooltip, and the live region
  for screen readers), so the user still sees that text is being recognised, but no search field
  opens and no match is ever marked on a page. The text layers themselves, selecting and copying,
  read-aloud and the browser's own find (Ctrl+F) are unaffected. The key means nothing while OCR
  is off.
- `ocr.search.overridesCtrlF`: whether Ctrl+F (Cmd+F on a Mac) opens the toolbar's search
  instead of the browser's own find, as the portal's page search does with its user setting.
  `false` by default; only the boolean literal `true` hands the shortcut over. With it on, Ctrl+F
  opens the field (or puts the cursor back in it, with its text selected, when it is already
  open) and the browser's find does not appear; the search button's tooltip says so. Ctrl+F stays
  the browser's while a dialog is open, while the focus is in another text field or in one of
  the toolbar's menus (the language menu included), and with Shift or
  Alt held. The key means nothing while OCR or the search is off.
- `ocr.speech.enabled`: whether the viewer offers read-aloud of selected text: the entry "Read
  the selection aloud" in the page's context menu and the "Reading language" section in the
  toolbar's language menu (see "What the user sees" below). `true` by default; only the boolean
  literal `false` turns it off. With it off, neither exists, so the viewer neither follows the
  selection nor touches the browser's speech synthesis (no voice list is read). Reading, when
  on, uses only voices installed on the machine,
  never the browser's online voices. The key is independent of `ocr.search.enabled` and of
  `ocr.speech.autoDetectLanguage` below: with read-aloud off, the guess still gives the text
  flow its `lang`, which screen readers follow. The key means nothing while OCR is off.
- `ocr.speech.autoDetectLanguage`: whether the language of each page's text is guessed among the
  OCR languages, once per page when its text is ready (`src/ocr/detectLanguage.js`: the page's
  words are counted against a few dozen function words per language, with a little weight for
  letters such as å, ä, ö or æ, ø; the winner needs at least four function-word hits, clearly
  more than the runner-up, and at least as much as every language the viewer is not configured
  for, otherwise the page gets no language). The guess sets the reading language's "Auto"
  language and the text flow's `lang` attribute, which screen readers with automatic voice
  switching follow. Only languages in `ocr.languages` can be guessed: a German page in a viewer
  configured for Swedish and English gets no language (German fits its words better than
  Swedish, and it would be recognised poorly anyway); add `deu` and its model to guess German.
  The guess knows function words for Swedish, English, German, Danish, Norwegian, Finnish,
  French, Spanish and Dutch; a page in a language outside that set can still pass as the
  candidate it resembles most, and a configured language outside it is never guessed. A page
  that is mostly in another language than its headings (a Swedish reference list of English
  titles) is guessed by its majority. `true` by default; only the boolean literal
  `false` turns the guess off, and the read-aloud language then follows the UI language unless
  the user picks one. The key means nothing while OCR is off.
- `ocr.assetBaseUrl`: where the engine, worker and language files are served from. `null`
  (default) uses the viewer's own `ocr/` folder next to the application. A site can point this at
  a copy of that folder on its own host (same layout, see `docs-src/deploy-ops.md`) to keep the
  files out of the application package. Absolute `http(s)` values, protocol-relative values
  (`//host/odv-ocr/`) and relative values (`/shared/ocr/`, resolved against the page) are accepted
  and get a trailing slash when missing. A value with a query string or fragment is ignored,
  because file names are appended to it; so is any other scheme (`javascript:`, `data:`, `file:`
  and the like) and a value containing whitespace or control characters. An ignored value is
  reported once as a console warning and the viewer's own folder is used instead. A cross-origin base must also be allowed by the site's CSP: the worker
  and the engine core are loaded as scripts (`script-src`), and the language models are fetched
  (`connect-src`, and the host must send CORS headers).

While on, recognition runs in a Web Worker in the browser only. The input of each page is the page
image the viewer already rendered, at the site's configured resolution (`pdfResolution.targetDpi`
for PDF pages, the file's own resolution for raster images), so a lower configured resolution also
lowers OCR quality. Results stay in memory for the session, keyed by document and page, and are
dropped when the document changes or the tab closes: nothing is written to localStorage or
IndexedDB and nothing is sent to any server. The source files are never modified.

Which pages are recognised, and when:

- Raster pages (TIFF, JPEG, PNG and the other image formats the viewer shows) are always
  recognised. A PDF page is first checked for its own text layer through pdf.js, from the bytes
  the viewer already holds. A page with a usable layer is not recognised: its own text becomes the
  page's text layer (the outcome's source is `pdf-text`), so it is selectable, searchable and
  readable aloud the way a recognised page is, and the engine never runs for it. The word boxes
  come from pdf.js's text positions: an item (often a whole line) is placed by its transform and
  font height the way pdf.js's own text layer places it, and cut into words at its spaces with
  the item's width shared out by a rough per-character advance, so on a long line in a
  proportional font a box can drift by a few characters' worth. Where pdf.js cuts a line into
  several items (often right before a punctuation mark), an item that starts where the previous
  one ended on the same baseline, with no space at the seam, continues the previous word, so
  "sida," is one word (two items that touch without a space are joined even when they are, say,
  neighbouring table cells; pdf.js writes a space wherever a gap reads as one). A right-to-left
  item keeps its logical order with mirrored boxes; several right-to-left items on one line, and
  a left-to-right run inside one, stay in drawing order. The words are taken in the order the
  PDF draws them (column by column where there are columns), and the layer groups them into
  lines by their boxes, so a footer the PDF draws first is a line of its own. Text
  whose baseline is not upright on the page (a stamp along the margin) or set in a vertical font
  gets no box and is left out of the layer. A layer whose text cannot be placed at all keeps the
  viewer's text and is reported as "Not recognised: the page has its own text". The
  layer counts as unusable when it has fewer than 50 visible characters (a page number, or a short
  stamp on an otherwise scanned page), or when more than a fifth of them are private-use or
  replacement characters, or when fewer than half are letters or digits (a scanned page wrapped in
  a PDF, or a font without a usable ToUnicode map). The check counts characters only; a scanned
  page that carries more than 50 characters of real text in its layer is taken as a text page.
  The probe opens the PDF a second time in pdf.js from a copy of the bytes the viewer holds (the
  renderer keeps its own instance), at most two documents at a time, and closes them when the
  document leaves the viewer or the engine goes idle. Any other format is skipped.
- Only the displayed page (both pages in the compare view) and a fixed number of neighbours are
  queued by default, never the whole document: after each displayed page the next two pages,
  then the page before it, so at most four pages per displayed page however long the document
  is. A page joins the queue once the viewer has rendered it. Recognition starts after the first
  page is shown. With `ocr.recognizeWholeDocument: true` the rest of the document follows the
  window (forward from the displayed page, then from the start), rendered on demand.
- When the user moves to another page, the pages that have not started are dropped and the new
  window is queued; the page being recognised finishes (a Tesseract worker cannot be interrupted
  without discarding its loaded models) and its outcome is kept. Switching document drops that
  document's outcomes and aborts its pages in flight (with several workers, only the workers
  holding those pages are dropped).
- The queue pauses while a print flow holds page images or a print PDF is assembled, and under
  hard memory pressure; the pages in flight finish, nothing new starts until the pause ends.
- Outcomes (text, word boxes, a skip or a failure) are cached per page for the session, at most
  200 pages, least recently used first. A page that failed is not retried in the same session.
  Each step is bounded (30 s for the text-layer probe and the page image, 180 s for recognition),
  so a step that never answers fails that page instead of blocking the queue; a recognition that
  times out also drops the worker, and the next page starts a fresh one. After a minute without
  work the worker is terminated to free its WebAssembly memory; the next page starts it again,
  which costs the model load once more. An engine that cannot start at all (see CSP below) stops
  the queue for the session and releases the worker and the probed documents the same way.

Ruled tables. Tesseract reads the body of a ruled table badly: the cell borders are taken for
glyphs or column separators and the text between them comes out garbled or missing. Before a
page is recognised, the viewer therefore removes the ruling lines from a copy of the page image
(`ocr.removeRulingLines`, on by default): the copy is binarised, every horizontal or vertical
run of dark pixels at least 0.2 inch long (taking the page's longer side as an A4 height to
derive the resolution) and at least ten times as long as it is thick at its thinnest point is
painted white with a two-pixel margin, and the copy, re-encoded as PNG, is what the engine
receives. The thickness rule keeps the stems and bars of large headline glyphs, which can be
longer than 0.2 inch but are many pixels thick. The displayed page and printing never see the
copy; it is released stepwise while the step runs (the decoded bitmap right after it is drawn,
the canvas as soon as the cleaned image exists) and completely before recognition starts. The
copy costs about 13 bytes per pixel at its peak (bitmap, canvas, pixel data and a one-byte
mask), so around 110 MB for an A4 page at 300 dpi; a page above 20 million pixels (about A3 at
300 dpi, or a raster scan at 460 dpi and more) is not copied at all and is recognised as it is,
which bounds the peak whatever the source's resolution. A page without lines passes through
untouched, with nothing re-encoded. The step runs on the main thread in bands of rows that hand
control back to the event loop between them (through `scheduler.yield` or a message task, not a
timer, so a hidden tab's timer throttling does not stretch it; in a hidden tab it runs straight
through); it costs a few hundred milliseconds per page at 300 dpi. Limits, stated rather than
hidden: only solid dark lines are removed; light grey lines and dotted or dashed lines are left
as they are, and such a page is recognised as it is. The rule cannot tell a long thin stroke of
real ink from a line: the baseline of connected or cursive handwriting, the stems of a very
light-weight font at headline size, the bars of a barcode and the edges of a dark band with
white text in it are removed too, and such text may come out worse than without the step. A
glyph stroke that crosses a line (the stem of a letter through an underline) loses the
two-pixel band around the line. The layer of a page whose copy had lines removed carries
`data-ruling-lines-removed` for diagnostics; the word boxes are unaffected, since the copy has
the page image's size. No recognition quality figures are given here: the step has been
measured on synthetic pages only, not yet on a real document with grey or dotted table lines or
with handwriting. If the step is wrong for a site's documents, `removeRulingLines: false` turns
it off. A browser without an image decoder or a 2D canvas skips the step silently (a debug
line) and the page is recognised as it is; if the step fails midway (a canvas that refuses to
give its pixels back, an error in the removal or the encoding), the page is recognised as it is
after one console warning. Only a page image that cannot be decoded at all fails that page, as
it did before.

The text layer is ordinary DOM text, so the browser's own find (Ctrl+F) and copy work on it, but
only for pages that are currently in the DOM. Lazily rendered pages that are not mounted yet are
not searchable until they come into view. The layer is one text flow in reading order (the
words of a line joined with no-break spaces, the lines wrapped once each), so find matches
single words and phrases alike, typed with ordinary spaces, also when the phrase continues on the
next line. Copy gives the text as it reads on the page: spaces between words, a newline between
lines.

### Page layout analysis

The engine runs Tesseract in its fully automatic page segmentation mode (mode 3, the mode the
`tesseract` command line uses) rather than the API default, "a single uniform block of text"
(mode 6). The default reads the whole page as one block and returns fragments when a page has a
short text line beside a large graphic, columns, or text in several places; the automatic mode
finds the text regions first and recognises each. The mode is part of every worker's start-up
configuration (the `config` argument of tesseract.js's `createWorker`), so it is in force from
the first recognition; it is not configurable from the site file.

Orientation is not detected: mode 1, automatic analysis with orientation and script detection,
needs the `osd` model, which the viewer does not ship. The engine reads the page image as it is
stored (the same raster the viewer draws, before any rotation), so a page scanned sideways or
upside down is not recognised, and the viewer's rotate buttons do not change what the engine
sees or start a new recognition. Such a page has to be rotated at the source.

### CSP for OCR

The OCR engine is WebAssembly. Both the shipped `index.html` meta policy and the
`public/web.config` header (including its narrower deployment example) permit compilation with
`'wasm-unsafe-eval'` in `script-src`. OCR remains off by default; a site enables it through
`odv.site.config.js` alone. The token permits WebAssembly, not JavaScript `eval` or `new Function`.
The existing script origins and inline-script hash are unchanged.

If a site supplies a custom policy, include the token in its `script-src` directive:

```text
script-src 'self' 'wasm-unsafe-eval' 'sha256-...'
```

Browsers enforce all policies together: a response header cannot relax a stricter HTML meta
policy. The shipped policies therefore agree; do not edit `index.html` per installation.
Keep the token in any custom IIS/proxy header and in an explicit ODVGateway
`contentSecurityPolicy` override. ODVGateway's updated default (selected when this setting is
`null`) already includes it. An older gateway must be upgraded or given an explicit policy
with this token while retaining its other directives. A custom header without the token can
still deliberately prohibit WebAssembly. Without the token the engine cannot
start; OCR then turns itself off for the session and logs one console error naming the missing
token (the viewer probes WebAssembly compilation before starting the worker, so the refusal is
reported at once, not after a timeout). The same applies when the engine files cannot be loaded:
one console error names the paths, and no second start is attempted in that session. Pages
still load and render exactly as before. (Chromium reports the block as a
`CompileError` that names `'unsafe-eval'`; `'wasm-unsafe-eval'` alone is still the right token,
it allows WebAssembly without allowing `eval`.)

The same policy affects pdf.js: its optional JBIG2 and JPX (OpenJPEG) decoders are WebAssembly
modules in `pdfjs/wasm/`. The shipped policy also permits those faster decoders, independently
of the OCR switch. If a custom policy prohibits WebAssembly, pdf.js falls back to its JavaScript
decoders (`*_nowasm_fallback.js`, slower but correct) after one console warning per decoder.

Reference: [CSP Level 3, script source expressions](https://www.w3.org/TR/CSP3/#framework-directive-source-list).

What the user sees with OCR on: the page image is unchanged. Over a recognised page, and over a
PDF page with its own text, lies an invisible text layer (one transparent word per word, placed
on the ink, in one text flow with the lines of the page), so dragging over the words selects
text, Ctrl+C copies it as it reads on the page, and the browser's own find (Ctrl+F) matches
words and phrases in it; dragging on a blank part of the page still pans.

The toolbar gets an OCR group right after the image-adjustment group (the one that ends with
"Reset adjustments"), separated from it like the toolbar's other groups and spaced like its other
loose buttons. It holds the search (`ocr.search.enabled`); read-aloud (`ocr.speech.enabled`) is
not a toolbar button, see below:

- A search button that doubles as the page's OCR status: a small LED on the button and the
  status as its tooltip ("Recognising text…", "Text recognised", "The page has its own text",
  "No text found", "Not recognised: the page has its own text", "The text could not be
  recognised" or "Text recognition is unavailable", the last when the engine could not start; see
  CSP below). Behind a thin divider the button also counts the pages the search can cover over
  all pages ("4/300", spelt out in the tooltip); the count folds away while the field is open.
  The button is enabled once the displayed page has a text layer (recognised, or the
  PDF page's own). Clicking it grows a search field out of
  the button to the right (a short ease) into the room the toolbar has; when there is too little,
  the field hangs under the toolbar at the button's right edge instead. The search covers only the text layers (recognised text and PDF pages' own text), of every
  page that has an outcome, in page order; it is case-insensitive and finds a phrase also across
  a line break. Typing shows the position ("1/5", "Match 1 of 5" in the tooltip) and, while not every page has an outcome,
  how many pages the search covers ("2/300 pages searched", spelt out in the tooltip); the status
  is never cut short: the field grows to hold it with the input at its least width, and hangs
  under the toolbar when the toolbar has no room for that. The field also asks for a comfortable
  input (about 200 px) beyond what the status needs, as far as the toolbar's room or the viewport
  allows, so that a long status does not leave the input at its minimum. The matches are marked on the
  page over the words, the current match stronger and scrolled into view. Enter and the arrow
  buttons walk the matches (Shift+Enter backwards), moving to the match's page when it is another
  one; Escape closes the field. A toggle in the field ("Search only on this page") limits the
  search to the displayed page: the position counts that page's matches, the steps stay on it,
  the matches follow the page as it changes, and no other page's layer marks anything; on a page
  without searchable text the field shows the page's status instead of "No matches". Clicking
  the toggle leaves the keyboard focus in the field, so Enter still walks the matches. The toggle
  is remembered while the viewer is open, not across reloads. The search follows the primary
  page (in compare mode the compared page's layer still marks its matches, but the position and
  the status are the primary page's; limited to a page, only that page's layer marks), and a
  match on a page the print selection hides lands on the nearest shown page. The browser's own
  find (Ctrl+F) keeps working on the layer. With `ocr.search.enabled: false` the button is a
  status-only indicator: never enabled, no field, the status as its name and tooltip.
Read-aloud (`ocr.speech.enabled`) is not a toolbar button. It lives in two places:

- The page's context menu (right-click on a page, next to "Hide this page" and "Hide document")
  gets the entry "Read the selection aloud". It is always listed, greyed with the reason in its
  tooltip and accessible name while nothing can be read (no text selected in the page's text
  layer, no local voice for the reading language, a browser without speech synthesis), so the
  feature is found before anything is selected. The menu takes the keyboard focus when it
  opens (the arrow keys move between its entries, Escape closes it and gives the focus back),
  so Shift+F10 or the Menu key reach it too. Choosing it reads the selection as it reads on
  the page, line by line, with a voice installed in the operating system for the reading
  language. Only voices that run on the machine are used, never the browser's online voices:
  the text is document content and must not leave the computer; without a local voice nothing
  is spoken (an utterance without a voice would let the browser pick one, possibly online).
  While a reading runs the entry is "Stop reading aloud", and Escape stops it too.
- The toolbar's language menu gets a second, titled section, "Reading language", under the
  interface languages, so both are chosen in one place without being confused. It lists only
  what can actually be read: "Auto" first (always naming what it will do, "Auto (svenska)", with
  the language guessed for the selected page's text, see `ocr.speech.autoDetectLanguage`; when
  the guess is unsure, or names a language without a voice, it reads in the UI language if that
  has a local voice, else the first language that has one), then one entry per OCR language
  (`ocr.languages`) that has a voice installed on the machine. A language without a local voice
  is not offered. When exactly one language has a voice, the section shows that language alone
  and reads in it, with no "Auto"; when none has, it shows one greyed line saying so, and nothing
  can be read. With the guess turned off the section starts with the languages. A choice there
  sets the reading language without changing the UI language and is kept in the viewer
  preferences (`speechLanguage`, next to `language`) across reloads; a stored choice that is no
  longer offered counts as automatic.

Printing and PDF export never include the layer or the toolbar's OCR group. Texts are in
`public/locales/<lng>/common.json` under `ocr`.

## Toolbar Button Size

The theme menu has a "Larger toolbar buttons" checkbox (sv: "Större verktygsknappar"). Ticked keeps
the large toolbar (32px buttons, 62px toolbar); unticked gives the compact toolbar (26px buttons,
40px toolbar). In both, framed button groups keep 2px of space between the frame and its buttons. Deployments choose the default:

```js
toolbar: {
  largeButtons: true
}
```

The packaged default is `true`, so existing installations keep the large toolbar until a user
unticks the box. Set `toolbar.largeButtons` to `false` to make the compact toolbar the default;
only an explicit `false` does that. A user's own choice is stored with the other viewer
preferences (`ODV_USER_PREFERENCES` in `localStorage` and a same-origin cookie) and outranks the
configured default. The choice is viewer-local: unlike the theme mode it is not shared with OMP.

The viewer sets `data-toolbar-density="large|compact"` on the document root and
`src/styles/toolbar.css` maps it to CSS variables (toolbar height, button and icon size, gaps).
The 62px/40px minimum height belongs to the main toolbar; the print selection workspace toolbar has
no group frames and keeps its own lower minimum (48px/40px, content height 52px/50px). Every button
in a toolbar group is as wide as the icon buttons, including the "1:1" and "1:X" text buttons, whose
labels are slightly condensed to fit. Documented exceptions: the split-menu arrow and the signature
overview button (a status badge with a count, outside the groups).

### Touch-target policy

- Compact toolbar: every button is at least 26 x 26 px. Large toolbar: at least 32 x 32 px.
- Both are above the WCAG 2.2 AA minimum target size of 24 x 24 px (success criterion 2.5.8), which
  is the floor for any new toolbar control; do not add exceptions below it.
- Text on buttons keeps at least 4.5:1 contrast against the button colour in both densities.
- Compare-mode zoom controls (tucked behind each pane's marker ring) use 28 x 28 px buttons.
- `tests/ui/toolbar-density.spec.mjs` asserts the button minimums, equal widths within a group,
  contrast, the visible keyboard focus ring and both toolbar heights.

## Viewer Default Zoom Mode

Deployments can choose the initial zoom mode used when the first page opens:

```js
viewer: {
  // Supported values: "fit-page", "fit-width", "custom-fit-width", "actual-size".
  defaultZoomMode: 'fit-width',
  // Percentage caps used by the Custom Size toolbar button.
  // Width supports 1..100 and defaults to 70% of calculated fit-width zoom.
  // Height supports 1..500. Actual size supports 1..200. Use null for no cap.
  customFitWidthFactorPercent: 70,
  customFitHeightFactorPercent: null,
  customFitActualSizeFactorPercent: null
}
```

The default is `fit-width`, so users start with the page width filling the pane and can scroll
vertically through taller pages. Use `fit-page` when the full page should fit inside the viewer
pane. Use `custom-fit-width` when the viewer should start at a percentage of the fit-width zoom,
for example `70%` of the calculated width fit, optionally capped by viewport height or actual size.
Use `actual-size` for a 100% initial zoom.

Users can override the default zoom mode and custom-size caps from the toolbar. User choices are
stored in viewer preferences and take precedence over `odv.site.config.js` until the user chooses
the system default again.

## Compare Views and Printing

Deployments can control the overlay and curtain views independently of side-by-side compare mode.
The four keys in `public/odv.config.js` all default to `true`:

| Key | Default | Effect of `false` |
| --- | --- | --- |
| `compare.overlay.enabled` | `true` | Hides the overlay entry button and refuses opening/rendering the view. |
| `compare.overlay.print.enabled` | `true` | Hides the overlay view's Print button. |
| `compare.curtain.enabled` | `true` | Hides both curtain entry buttons and refuses opening/rendering the view. |
| `compare.curtain.print.enabled` | `true` | Hides the curtain view's Print button. |

`odv.site.config.js` overrides these defaults through the same deep merge as the `print` settings.
Only a literal boolean `false` disables a key; missing or non-boolean values (including the string
`'false'`) fall back to `true`. Disabling printing keeps the view available when its view key is
enabled. Disabling a view also makes its print action inaccessible, regardless of its print key.
These switches leave ordinary compare mode and its side-by-side print unchanged. With the overlay
disabled, the curtain can use the compare view's own calibration without opening the overlay first.

To turn all four switches off, paste this exact block from `public/odv.site.config.sample.js`
inside the existing `window.__ODV_SITE_CONFIG__` object in `odv.site.config.js` (replace any existing
`compare` block). Keep the trailing comma when another property follows:

```js
    compare: {
      overlay: {
        enabled: false,
        print: { enabled: false }
      },
      curtain: {
        enabled: false,
        print: { enabled: false }
      }
    },
```

For a standalone installation without a site file, copy `public/odv.site.config.sample.js` next to
the deployed `odv.config.js`, rename it to `odv.site.config.js`, and review its other overrides.
The sample already contains the all-off block above. Reload the viewer after changing the file.
See [Printing design notes](printing.md) for the composed-page output and shared print options.

### Fine-tuning capability and visibility

`fineTune.enabled` is the canonical master switch for fine tuning in both ordinary single-page and
side-by-side views, plus the calibration-dependent overlay and curtain views. It defaults to `true`.
Only a real boolean `false` disables it; missing, null, strings, numbers and objects use the default.
Set it in the existing site configuration object; normal deep-merge precedence applies:

```js
fineTune: { enabled: false },
```

With capability disabled, the toggle, panels and fine-edit gestures are unavailable. Overlay and
curtain are blocked at availability, open, render and print boundaries, even with individual child
flags enabled or stored calibration/open flags. Ordinary viewing, simple side-by-side comparison
and normal printing remain available. Child view/print flags continue to restrict each surface
independently when the master capability is enabled.

This switch is distinct from the session's **Fine tuning** toolbar selection. Ordinary panels start
hidden; the selection survives mode changes and hides only controls/gestures, preserving edits.
Overlay and curtain always open their own per-image controls expanded and never write their
visibility into the ordinary viewer selection. `compare.adjust.toolbarMode` only mirrors/hides
coarse image controls in compare mode; it is neither a capability nor a visibility preference.

Configuration loads before React mounts; installations apply changes by reloading the viewer.
There is no live configuration subscription. If a host replaces configuration and causes a render,
advanced views are blocked and their stale open flags discarded. Opens and print submits read the
current configuration again, including delayed print dispatches.

### Toolbar image controls in compare mode

In compare mode each compared page has one adjustment panel (zoom, position, rotation,
brightness, contrast, grayscale, invert and its resets). `compare.adjust.toolbarMode` decides what
the main toolbar's coarse image controls (the 90° buttons, brightness, contrast and reset) do
meanwhile:

| Key | Default | Values |
| --- | --- | --- |
| `compare.adjust.toolbarMode` | `'mirror'` | `'mirror'`: the toolbar controls stay, change the same page state as the panel and show the target page's current values (a value chip on brightness and contrast, the reset marked while there is anything to reset). `'hide'`: the toolbar controls are hidden while any shown page's panel is expanded and return when every panel is collapsed. |

`getCompareAdjustToolbarMode()` validates the value at runtime: it is trimmed and lower-cased, and
a missing or unknown value falls back to `'mirror'`. `odv.site.config.js` overrides the default
through the same deep merge as the switches above. The key has no effect outside compare mode, and
none in the overlay and curtain views, which only have the panel. For example:

```js
    compare: {
      adjust: { toolbarMode: 'hide' }
    },
```

See [Compare view: free per-page transform](compare-transform.md#the-main-toolbar) for the
adjustment model and the resets.

## Print Default Page Mode

Deployments can choose which page scope the print dialog should select by default:

```js
print: {
  // Supported values: "active", "all".
  defaultPageMode: 'active'
}
```

Only active-page and all-pages are persistent defaults. Range and custom sequences remain one-off
dialog choices. Users can override this default from the print toolbar split-button; the persisted
user choice takes precedence over runtime config until the user chooses the system default again.

## Print Selection Workspace

Deployments can enable or disable the full-page print selection workspace and control the document
header shown above grouped pages:

```js
print: {
  selectionWorkspace: {
    enabled: true,
    documentHeaderTemplate: {
      en: 'Document {documentNumber} of {totalDocuments} · {pageCount} pages',
      sv: 'Dokument {documentNumber} av {totalDocuments} · {pageCount} sidor'
    },
    previewInfoTemplate: {
      en: 'Page {sourcePage} of {totalPages} · {documentNumber}-{documentPageNumber}',
      sv: 'Sida {sourcePage} av {totalPages} · {documentNumber}-{documentPageNumber}'
    }
  }
}
```

The header template supports simple tokens from the grouped document and bundle metadata, including
`{documentNumber}`, `{totalDocuments}`, `{documentId}`, `{pageCount}`, `{firstPage}`, `{lastPage}`,
`{metadata.someField}`, `{metadataDetails.someField}`, and `{metaById.123.selectedValue}`.
The preview info template supports the same document metadata tokens plus page-oriented values such
as `{sourcePage}`, `{printPage}`, `{totalPages}`, `{documentPageNumber}`, and
`{documentPageCount}`. Both templates may be plain strings or localized objects such as
`{ en: "...", sv: "..." }`.

## Edge Scroll Page Turn

Deployments can configure or disable wheel-based page changes at the vertical scroll edges:

```js
viewer: {
  edgeScrollPageTurn: {
    enabled: true,
    thresholdPx: 720,
    quietMs: 140,
    decayMs: 650
  }
}
```

This gesture is enabled by default. Normal wheel scrolling works inside the current page. If the user
keeps scrolling down at the bottom edge, or up at the top edge, OpenDocViewer fills a small progress
indicator. Reaching the threshold changes to the next or previous page and resets the indicator. If
the user stops before the threshold, the indicator decays and disappears.

## Viewer Problem Notice

Deployments can configure a viewer-level support notice for serious load failures, for example when
host-provided document links expire and many pages fail at once.

Configuration surface:

```js
viewer: {
  problemNotice: {
    enabled: true,
    showForLoaderError: true,
    showForFailedPages: true,
    minFailedPages: 1,
    failedPageRatio: 0.5,
    requireLoadComplete: false,
    dismissible: true,
    showReloadButton: true,
    showResetSessionButton: true,
    resetSessionTarget: 'parent-or-current',
    resetSessionAllowedOrigin: 'https://host.example.test',
    showTechnicalDetails: false,
    title: {
      en: 'The documents could not be shown correctly',
      sv: 'Dokumenten kunde inte visas korrekt'
    },
    message: {
      en: 'The document session may have expired. Close this viewer and open the document again from the source system.',
      sv: 'Dokumentsessionen kan ha gått ut. Stäng visaren och öppna dokumentet på nytt från källsystemet.'
    }
  }
}
```

The notice is not tied to a single failed page. It is shown when the loader reports a fatal error, or
when the configured number and ratio of failed pages is reached. Site-specific text should explain
the local recovery path, such as reopening the document from the embedding application.

The loader can also stop early when an embedding host has issued unusable source tickets. Configure
the threshold under `documentLoading.fetch`:

```js
documentLoading: {
  fetch: {
    abortOnSourceUnavailableCount: 8
  }
}
```

When the first configured number of source URLs all fail as unavailable and no source has loaded
successfully, OpenDocViewer treats the whole source session as expired or invalid. This avoids
hundreds of identical failed requests and lets the viewer-level notice show the site-specific
recovery instruction.

`showResetSessionButton` adds a stronger recovery action than a plain viewer reload. The reset
button dispatches `odv:session-reset-requested`, posts the same message to the parent window, and
then follows `resetSessionTarget`:

- `parent-or-current` (default) reloads the same-origin embedding page when ODV is iframed, or falls
  back to a cache-busted viewer reload.
- `parent` only reloads the same-origin parent page.
- `current` reloads the viewer URL with an `odvSessionReset` cache-busting parameter.
- `none` only emits the event/message so the embedding host can handle recovery itself.

`resetSessionAllowedOrigin` optionally pins cross-origin `postMessage` delivery to a specific parent
origin. When unset, the viewer falls back to `document.referrer` and skips the cross-origin message
when no trustworthy origin can be derived.

Use the reset action for host integrations where reloading only the iframe can reuse the same stale
parent payload and therefore the same expired document tickets.

## PDF Page Rendering Worker Mode

PDF pages use an automatic PDF-to-image routing policy by default. The default policy now mirrors
the normal raster/TIFF worker recommendation: use the browser-reported logical core count with a
minimum/fallback of 4 workers, and cap the result by the number of PDF pages and any explicit site
limit.

```js
documentLoading: {
  render: {
    pdfToImageMode: 'auto',
    pdfWorkerMaxCount: 0,
    pdfWorkerPagePolicy: {
      enabled: true,
      mainThreadBelowPageCount: 0,
      mainThreadBelowHardwareConcurrency: 0,
      smallWorkerBelowPageCount: 0,
      smallWorkerCount: 1,
      fixedWorkerBelowPageCount: 0,
      fixedWorkerCount: 1,
      pagesPerWorker: 1,
      maxWorkerCount: 0
    }
  }
}
```

`pdfToImageMode` values are:

- `auto` - default. Uses the runtime-recommended worker count for the current client.
- `main-thread` - forces the behavior used by earlier OpenDocViewer versions.
- `worker` - forces PDF page images through dedicated workers when supported, with automatic fallback
  to the main-thread path if worker-side rendering is unavailable or fails.

The runtime-recommended worker count is `navigator.hardwareConcurrency` when available, but never
less than 4 in normal auto/performance mode. `memory` mode still caps background workers more
aggressively. `pdfWorkerMaxCount` and
`pdfWorkerPagePolicy.maxWorkerCount` default to `0`, meaning no static site cap; set either to a
positive value only when a deployment needs an explicit safety ceiling. Raster images and TIFF files
use the same worker recommendation through `documentLoading.render.workerCount`, while generated-PDF
printing uses its own worker policy.

Set `pdfWorkerPagePolicy.mainThreadBelowPageCount` above `0` only for deployments that explicitly
want very small PDFs to stay on the legacy main-thread route.
Set `pdfWorkerPagePolicy.mainThreadBelowHardwareConcurrency` above `0` when a deployment has measured
that low-core clients are faster or more stable on the main-thread route. For example, `8` means
clients with fewer than 8 logical cores use main-thread PDF rendering, while 8-core and stronger
clients still use the automatic PDF worker policy.

The render/decode benchmark can compare PDF page-image routing modes without changing the active
viewer setting:

```js
documentLoading: {
  renderBenchmark: {
    enabled: true,
    pdfToImageModes: ['main-thread', 'worker'],
    mainThreadConcurrencies: [1, 2, 3, 4, 5, 6, 8],
    mainThreadCoreMultipliers: [0.5, 0.75, 1],
    workerCounts: [0, 8, 16, 24],
    includeAutoWorkerCount: true,
    workerCoreMultipliers: [0.25, 0.5, 1],
    pdfWorkerPageTargets: [50, 100, 200],
    pdfWorkerBatchMode: 'queue',
    pdfWorkerRendersPerWorker: [1],
    taskTimeoutMs: 90000
  }
}
```

Use `['current']` to benchmark only the active `documentLoading.render.pdfToImageMode` value. When
the active mode is `auto`, `current` runs the automatic worker policy once. Explicit `main-thread` PDF
scenarios vary `mainThreadConcurrencies`, while explicit `worker` PDF scenarios vary `workerCounts`,
where `0` means the runtime-recommended worker count.

The benchmark also adds a small set of focused CPU-budget probes. `mainThreadCoreMultipliers`
derives extra main-thread render concurrency values from `navigator.hardwareConcurrency`.
`workerCoreMultipliers` derives extra worker counts from the runtime-recommended worker count.
`pdfWorkerPageTargets` derives worker counts from the sampled page count, for example `100` means
"roughly one PDF page worker per 100 sampled pages", capped by the runtime-recommended worker count.
`taskTimeoutMs` prevents one stuck page render from blocking the rest of the benchmark run.

`renderBenchmark.pdfWorkerBatchMode: 'partitioned'` is a benchmark stress mode for PDF worker
experiments. It splits the sampled PDF pages into contiguous partitions once, gives one partition to
each PDF page worker, and tests each value in `pdfWorkerRendersPerWorker` as the number of local
render lanes inside that worker.

The normal viewer runtime keeps `documentLoading.render.pdfWorkerWarmupBatchMode: 'off'` by default.
Support or high-throughput sites can opt in to the same partitioned batch concept for background
full-page PDF warm-up:

```js
documentLoading: {
  render: {
    pdfWorkerWarmupBatchMode: 'partitioned',
    pdfWorkerWarmupBatchSize: 1200,
    pdfWorkerWarmupRendersPerWorker: 1
  }
}
```

This runtime warm-up path is conservative about correctness:

- only full-size PDF page assets are selected
- pages already rendered or pending through another route are skipped
- selected pages are registered in the normal pending-asset map so foreground navigation does not
  render them again
- each worker result is checked against the current page state before commit
- missing, failed, stale, or uncommitted items fall back to the regular per-page render path

Keep this setting disabled until the target client hardware and upstream document source behavior
have been measured. It is most useful for very large PDF sessions where the PDF worker benchmark
shows that contiguous partitioning is materially faster than the per-page queue.

## Page Asset Persistence Diagnostics

Full-size page images are shown as soon as their rendered `Blob` is available. By default,
`documentLoading.assetStore.persistFullPagesInBackground` keeps first display from waiting for
memory or IndexedDB cache writes. Set it to `false` only when support needs to reproduce the older
synchronous path.

`documentLoading.assetStore.restoreBeforeRender` controls whether the viewer probes the rendered-page
cache before rendering a page. Keep it enabled for normal reload-cache behavior. Disable it during
first-load performance investigations to isolate render throughput from IndexedDB cache-miss reads.

## Document-Version Reload Cache

`documentLoading.sourceStore.reloadCacheTtlMs` and
`documentLoading.assetStore.reloadCacheTtlMs` enable an opt-in IndexedDB cache for original source
blobs and rendered page blobs. `0` disables this cache. A positive value keeps encrypted records for
that many milliseconds, up to 24 hours.

When a host provides stable document metadata, OpenDocViewer keys the cache by document identity
rather than by short-lived source URLs. For object-document payloads, the strongest built-in version
signal is:

- document id
- `modifiedTimestamp` metadata alias, or raw metadata field `502`
- optional page count metadata alias, or raw metadata field `504`
- file id / file order inside the document
- render settings for rendered page assets

This allows a document opened alone to be reused later when the same document is opened again or
included in a larger multi-document bundle. If no document version can be resolved, OpenDocViewer
falls back to URL-based cache keys to avoid serving stale content for a reused document id.

## Integration adapter mappings

Some embedding hosts send an object-document payload where document-level metadata records need to
be promoted into deployment-defined semantic aliases.

That mapping is runtime-configurable under:

```js
integrations: {
  portableBundle: {
    metadataAliases: {
      documentDate: ['primary-date', 'fallback-date'],
      patientId: 'patient-id',
      unitName: {
        fieldId: 'unit-name',
        prefer: 'lookupValue',
        label: 'Unit',
        type: 'string',
        contexts: ['screen', 'print']
      }
    }
  }
}
```

Notes:

- The shipped public repo keeps this object empty on purpose.
- A deployment that needs host-specific metadata mapping can define any number of semantic aliases.
- Each alias may point to one identifier, an ordered fallback list, or a richer selector object.
- If no metadata aliasing is needed, leave the object empty or omit it entirely.
- Raw metadata records are preserved regardless of alias configuration.
- Keep concrete deployment-specific identifiers out of the public repo and in deployment-local
  integration documentation/configuration instead.

### Alias selector object

Supported selector properties:

- `fieldId`
  - one metadata field id
- `fieldIds`
  - ordered fallback ids
- `prefer`
  - `value`
  - `lookupValue`
  - `valueThenLookup` (default)
  - `lookupThenValue`
- `label`
  - optional human-facing label for later UI/print use
- `type`
  - optional semantic hint such as `string`, `integer`, `date`, `datetime`
- `contexts`
  - optional list of intended usage targets such as `screen`, `print`, `sort`, `filter`, `debug`


## Help and About content

The runtime config now also exposes a lightweight help/about surface so deployments can replace the
manual content without rebuilding the React bundle.

Configuration surface:

```js
help: {
  manual: {
    enabled: true, // optional: only the boolean literal false disables the manual
    source: 'auto', // exact primitive string: "auto" (default) or "standard"
    sitePathTemplate: 'help/site/manual.{{lng}}.html',
    fallbackPathTemplate: 'help/default/manual.{{lng}}.html',
    fallbackLanguage: 'en'
  },
  about: {
    githubUrl: 'https://github.com/Optimal2/OpenDocViewer',
    contactEmail: 'dev@optimal2.se'
  }
}
```

Manual on/off switch:

- `help.manual.enabled` removes the manual from the UI. Only the boolean literal `false` disables
  it: a missing key, `true`, and any non-boolean value keep the default behaviour.
- when disabled, the help menu hides its Manual entry and the stand-alone manual page
  (`<ODV base>/manual/`) reports that the manual is not available (`help.manualDisabled`) instead
  of loading content. See `docs-src/help-manuals.md` for the stand-alone page.
- source modes, templates and the fallback language are unchanged by the switch: they apply
  whenever the manual is enabled.

Source selection:

- an omitted `source` and the exact string `auto` preserve the existing **site before default** order.
  The exact string `standard` always uses the bundled standard manual and never requests site HTML.
- every other value warns and behaves as `auto`. This includes `null`, an empty string, different case
  or padding, and non-string values: values are never trimmed, case-folded or coerced into a valid mode.
  A throwing warning sink does not prevent the manual from rendering.
- `auto` tries `help/site/manual.<lng>.html`, `help/default/manual.<lng>.html`, then the same two for
  `fallbackLanguage`. A site file therefore wins when it exists. Site-owned HTML is sanitized as
  before but is never feature-filtered or rewritten into the standard manual's section structure.
- `standard` lazy-loads a generated JavaScript module containing the unchanged bundled
  `manual.<lng>.html`. It sanitizes and filters that standard content against the same effective
  runtime config as the UI before contents, search and lightbox processing. Disabled feature sections
  and their contents/search entries are removed; removed prose links keep their text, and visible
  guide headings are renumbered. Unreadable feature state is treated as enabled. The installation
  switch sections `avstangt` and `jmf-avstangt` are never shown in standard mode.
- if a generated manual chunk fails to load, `standard` fetches `fallbackPathTemplate` instead and
  applies the same standard filtering to that HTML. It still never falls back to site-owned HTML.
- standard images and other relative assets resolve under `help/default/`; the complete bundled PDFs
  remain available and are not feature-filtered. The generated modules are build artifacts, not a
  second committed manual source (`docs-src/help-manuals.md`).
- `*.sample.html` files in `help/site/` are templates only and never count as a site manual; a fresh
  installation therefore shows the bundled default manual until the deployment adds its own
  `help/site/manual.<lng>.html`
- a fetched candidate only counts when the server returns the manual itself: a response that is the
  application shell (hosts with an SPA fallback answer a missing file with `index.html` and status 200)
  is skipped, and `public/web.config` keeps missing files under `help/` out of the SPA rewrite so they
  answer 404
- site-local manuals can therefore be upgraded independently of the app bundle as long as the deployment keeps `help/site/manual.<lng>.html` outside the tracked repo
- the manual dialog has a reload button that bypasses browser/server caches with a unique cache-busting URL when a site-local manual has been replaced during an active support session
- relative links inside fetched HTML are rewritten against the resolved file URL so images, PDFs, and other local help assets can live alongside the manual fragment
- the About dialog always exposes the support diagnostics JSON download; benchmark execution controls are separate opt-in runtime flags and default to disabled

Shipped public files:

- `public/help/default/` – the bundled user manual in English and Swedish: `manual.<lng>.html`
  (getting started; the three other guides are embedded at the bottom), `manual-urval.<lng>.html`
  (selection), `manual-jamforelse.<lng>.html` (comparing two pages), `manual-avancerat.<lng>.html`
  (more features), a PDF of each guide, and the screenshots in `img/`. The content is
  customer-neutral and uses a made-up test document. These files are generated copies of a
  source kept outside this repository and are never edited here: see `docs-src/help-manuals.md`.
- `public/help/site/manual.en.sample.html`
- `public/help/site/manual.sv.sample.html`

A site manual that links to other files (images, PDFs, further guides) should use relative links;
they resolve against the folder the manual was loaded from, so the same HTML works under both
`help/site/` and `help/default/`. The manual window runs the HTML through DOMPurify and keeps only
the body: put any `<style>` inside `<body>`, and do not use scripts.

## Print shortcut policy

The runtime config now supports a keyboard-only print policy surface under:

```js
shortcuts: {
  print: {
    ctrlOrCmdP: "browser" // "browser" | "disable" | "dialog"
  }
}
```

Behavior:

- `browser`: keep native browser handling for `Ctrl+P` / `Cmd+P`
- `disable`: cancel the keyboard shortcut without opening any print dialog
- `dialog`: cancel the keyboard shortcut and open OpenDocViewer's own print dialog instead

Important limitation:

- This applies to keyboard interception only.
- Browser menus, toolbar print buttons, and native context-menu print entries cannot be reliably overridden from normal page JavaScript.

## Shared theme preference and cross-origin bridge

OpenDocViewer joins the shared OMP light/dark choice through `OMP_THEME_PREFERENCE`
(cookie plus localStorage mirror, JSON `{"version":1,"mode":...,"revision":...}`).
The theme menu offers System, Normal, Light and Dark; ODV keeps its three palettes.
System/Light/Dark choices are written to the shared preference (new revision) so OMP
apps on the same host follow. Normal is stored locally together with the shared revision
it belongs to and shares mode `light` outwards; a later explicit shared choice wins over it.
An existing local ODV theme setting migrates into the shared preference only when no
shared preference exists. Printed pages always use the light path.

Default theme per installation: `theme.defaultMode` sets the mode used while the browser has
no stored theme choice at all (no shared `OMP_THEME_PREFERENCE` and no legacy local ODV
setting). Supported values are `"system"` (default, follows the OS light/dark setting),
`"light"`, `"dark"` and `"normal"`; unknown values fall back to `"system"`. A user's own
choice in the theme menu — including an explicit System — is remembered per browser
profile and always outranks this default, so the setting only decides the first impression
on a fresh browser.

Configuration surface:

```js
theme: {
  // Mode used while nothing is stored in the browser: "system" | "light" | "dark" | "normal".
  defaultMode: 'system',
  bridge: {
    // Opt-in postMessage bridge for cross-origin frames. Empty (default) disables it.
    // Entries must match event.origin exactly; use the exact targetOrigin, never '*'.
    allowedOrigins: [] // for example: ['https://portal.example']
  }
}
```

Behavior:

- Inbound messages are checked for an exact HTTP(S) origin, `event.source === window.parent`, the versioned
  shape `{ kind: 'omp:theme-preference', version: 1, mode, revision }` and a newer revision.
- Wildcards, opaque origins and URLs with paths are rejected in both directions.
- Revision ordering uses the base-36 creation timestamp, as in OMP; the cookie wins ties.
- Before comparing or applying an inbound bridge revision, its timestamp is capped at
  the viewer's current time plus five seconds. This tolerates small clock differences
  without letting a far-future parent timestamp permanently block subsequent changes.
- In a top-level window the bridge neither listens nor announces, even with allowed origins.
- If persistence is denied, the current page retains its choice through focus and visibility changes.
- Applying a remote change never announces it back, so changes cannot ping-pong.
- The embedding host must implement the same message protocol and send its current preference
  when the viewer loads. OMP's version 1 theme script does not implement this bridge itself.
- The initial palette is applied before React renders viewer content. A blank-page flash while
  bootstrap assets load is not covered by this guarantee and still needs browser acceptance.

## Print progress overlays

The older large-job HTML print notice has been removed from the runtime flow. HTML/browser printing
now goes directly to the browser print preview without an OpenDocViewer informational overlay.

OpenDocViewer shows progress only while generating a PDF for **Print via PDF** or **Save PDF**.
This progress dialog reports page generation progress and is the only print progress overlay.
The dialog can be cancelled with its cancel button or Escape; cancellation asks for confirmation
before aborting the current PDF generation run.

The legacy `print.preparationNoticeThresholdPages` key is ignored and remains only for backward
compatibility with existing site-local configuration files. Set it to `0` in new configuration files.

Configuration surface:

```js
print: {
  preparationNoticeThresholdPages: 0, // deprecated/no-op compatibility key
  actions: {
    downloadPdf: {
      enabled: true,
      label: { en: 'Save PDF', sv: 'Spara PDF' },
      tooltip: { en: 'Save the generated PDF.', sv: 'Spara den genererade PDF-filen.' }
    },
    printHtml: {
      enabled: true,
      label: { en: 'Print via HTML', sv: 'Skriv ut via HTML' },
      tooltip: {
        en: 'Use the browser print preview.',
        sv: 'Använd webbläsarens utskriftsförhandsgranskning.'
      }
    },
    printPdf: {
      enabled: true,
      label: { en: 'Print via PDF', sv: 'Skriv ut via PDF' },
      tooltip: {
        en: 'OpenDocViewer generates a PDF before printing.',
        sv: 'OpenDocViewer skapar en PDF innan utskrift.'
      }
    }
  },
  pdf: {
    enabled: true,
    defaultMode: 'direct',
    allowDownload: false,
    filename: 'opendocviewer-print.pdf',
    cacheLanguageMode: 'strict',
    marginPt: 8,
    headerReservePt: 18,
    footerReservePt: 14,
    textFontSize: 7,
    imageFallbackQuality: 0.9
  }
}
```

The older `print.prewarmIframe` optimization has been removed. HTML/browser print jobs now build
their print iframe on demand, while generated-PDF prebuild is handled by `print.pdf.prebuildAllPages`.

`print.pdf.enabled` controls whether the print dialog offers a separate **Print via PDF** action next to the normal **Print via HTML** action. `allowDownload: true` adds a separate **Save PDF** action to the print dialog. `print.actions.*.enabled` can hide individual footer buttons, while localized `label` and `tooltip` values override the button text without code changes.

The generated-PDF backend is intended for deployments where the browser is slow to build print preview from large HTML/IMG print documents. It reuses already rendered page image blobs for multi-page jobs. Active-page PDF output uses the current rendered surface to preserve transient image edits. `print.pdf.cacheLanguageMode` defaults to `strict`; set it to `ignore` only for deployments where generated PDF output is intentionally the same across UI languages for the same stable print option values.
