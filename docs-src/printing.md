# Printing design notes

The print flow is deliberately separated from the main viewer UI because printing crosses several browser constraints: DOM capture, image safety, hidden document rendering, and timing around `window.print()`.

## Responsibilities by module

- `PrintRangeDialog.jsx`
  - modal UI for print mode and metadata
- `usePrintRangeDialog.js`
  - validation and submit orchestration for the dialog
- `printUtils.js`
  - thin convenience exports that bridge the toolbar into `printCore.js`
- `printCore.js`
  - chooses the active printable source(s)
  - resolves print options
  - creates the hidden iframe
  - calls the DOM rendering helpers
- `printDom.js`
  - writes the iframe document contents
- `printParse.js`
  - parses user-provided page ranges and sequences
- `printTemplate.js`
  - expands optional header tokens
- `printSanitize.js`
  - validates image sources before they are embedded into the print iframe

## Current high-level flow

The current viewer uses one unified print dialog. The user first chooses a print method from a
single dropdown:

- Active page
- All pages
- Simple range
- Custom pages

The dialog then shows only the extra fields relevant to the chosen method, while the shared print
details section (reason / for-whom / optional header metadata) stays consistent across modes.

To keep the dialog compact, the **Pages and scope** card is hidden entirely when the chosen method
does not need any extra scope input (for example **Active page** outside compare mode, or **All
pages** when no saved selection/filter is active).

When compare mode is active and the user prints the active page, the dialog can also prepare either:

- the left / primary page only
- both compare panes as a two-page print job

When the user chooses both compare panes, the summary text now names both page numbers explicitly so
the dialog reflects the actual pair that will be prepared.

Printing is intentionally unavailable until every page has reached a terminal loaded/failed state.
That keeps the dialog stable while totals are still changing and prevents accidental duplicate
submissions while the browser is still discovering new pages.

### Single-page print

1. resolve the active canvas or image
2. derive a printable URL or data URL
3. resolve page orientation
4. create a hidden iframe
5. render printable DOM into the iframe
6. wait for the document/image to settle
7. call `print()`
8. clean up the iframe

### Multi-page print

1. resolve all page URLs from the renderer handle or DOM fallbacks
2. optionally filter those URLs by range or explicit sequence
3. compute a cleanup delay that scales with the page count
4. render a multi-page document into the hidden iframe
5. call `print()` and remove the iframe afterwards

## Print progress overlays

OpenDocViewer no longer shows the older informational overlay for HTML/browser printing. In
practice, that notice appeared too briefly to be useful and could visually compete with the PDF
progress dialog.

Progress is now shown only when OpenDocViewer actively generates a PDF, either for **Print via
PDF** or **Save PDF**. The progress dialog reports how many pages have been processed before the
browser PDF print preview or download is started.

The legacy `print.preparationNoticeThresholdPages` runtime key is ignored and remains only as a
harmless compatibility key for older site-local configuration files.

## Why hidden iframes are used

The frontend uses hidden iframes rather than popup windows so printing can happen without popup blockers and without moving state into a second top-level browsing context.

## Important constraints

- printing from a tainted canvas is not always possible
- DOM-based page collection must tolerate virtualization or missing non-visible pages
- header token substitution must not become an injection path
- cleanup timing must leave enough time for the print dialog and image decode to start

## Future refactor boundaries

If print code grows further, the most natural split points are:

- hidden-iframe lifecycle management
- active-page source resolution
- all-page / range / sequence resolution
- print-header token preparation

## Copy marker and watermark

OpenDocViewer can expose a **copy watermark** checkbox in the print dialog. By default it is not checked, so normal prints do not get a watermark and `{{copyMarkerText}}` / `{{printFormat}}` (`{{isCopy}}` remains as a backward-compatible alias) are empty.

Relevant config:

```js
print: {
  format: {
    enabled: true,
    useValueForOutput: true,
    headerMarker: { enabled: false },
    watermark: {
      enabled: true,
      showOption: true,
      defaultChecked: false,
      mode: 'auto', // 'auto', 'copy', 'kopia', or 'custom'
      assets: {
        copy: 'assets/watermarks/copy.png',
        kopia: 'assets/watermarks/kopia.png'
      },
      // Optional trusted CSS appended to the isolated print iframe watermark rule.
      css: ''
    },
    options: [
      {
        value: 'KOPIA',
        label: { en: 'Copy', sv: 'Kopia' },
        checkboxLabel: { en: 'Add copy watermark', sv: 'Lägg till KOPIA-vattenstämpel' },
        printValue: { en: 'COPY', sv: 'KOPIA' }
      }
    ]
  }
}
```

Behavior:

- `watermark.showOption: true` shows the checkbox to the user.
- `watermark.defaultChecked: false` makes normal print the default.
- `watermark.mode: 'auto'` uses the bundled transparent PNG watermark matching the current UI language: COPY for English and KOPIA for Swedish.
- `watermark.mode: 'copy'` or `'kopia'` forces one bundled PNG regardless of language.
- `watermark.mode: 'custom'` keeps the generated text overlay based on the resolved configured marker text.
- `watermark.assets` can point to deployment-local transparent PNGs when the built-in COPY/KOPIA files should be replaced.
- `watermark.css` can append trusted site-local CSS for the watermark element inside the isolated print iframe.
- `watermark.showOption: false` and `watermark.defaultChecked: true` forces the configured marker without allowing the user to disable it.
- `printValue` is the preferred output text for print/header/footer tokens and may be localized.
- If `printValue` is missing, legacy `useValueForOutput` decides whether `value` or localized `label` is used.

## Print header/footer metadata templates

Print header and footer are configured independently through `printHeader` and `printFooter`.
Both use the same template engine and both are evaluated per printed page. By default, `layout: 'flow'` reserves space for header/footer so the source page image is scaled into the remaining page area instead of being covered. Use `layout: 'overlay'` only when a deployment explicitly accepts drawing the header/footer on top of the page.

Supported token forms:

```text
{{date}}
{{time}}
{{page}}
{{totalPages}}
{{reason}}
{{reasonSelection.output}}
{{reasonSelection.label.sv}}
{{reasonSelection.printValue.sv}}
{{forWhom}}
{{printFormat}}
{{printFormatSelection.output}}
{{printFormatSelection.label.sv}}
{{printFormatSelection.printValue.sv}}
{{copyMarkerText}}
{{printFormatOutput}}
{{isCopy}}
{{UserId}}
{{session.userId}}
{{doc.documentId}}
{{doc.documentPageNumber}}
{{doc.documentPageCount}}
{{metadata.1001}}
{{metadata.patientId}}
{{metadataAlias.patientId.value}}
{{metadataAlias.patientId.lookupValue}}
```

`doc.title` is a derived convenience value. It comes from the normalized bundle document `title`,
then `name`, then `documentId` as fallback. It is not expected to exist as a literal `doc.title`
field in the host session payload.

For metadata aliases configured through `integrations.portableBundle.metadataAliases`, use:

- `{{metadata.<alias>}}` for the selected alias value, respecting the alias `prefer` rule.
- `{{metadataAlias.<alias>.value}}` to force the raw metadata `Value`.
- `{{metadataAlias.<alias>.lookupValue}}` to force the raw metadata `LookupValue`.

Example: if `patientId` maps to field id `1001` with `prefer: 'value'`, use
`{{metadata.patientId}}` or `{{metadataAlias.patientId.value}}`.

`{{copyMarkerText}}` and `{{printFormatOutput}}` contain the resolved print-format output text, for example `KOPIA`. `{{isCopy}}` is kept as a backward-compatible alias even though it contains text rather than a boolean value.
It is intentionally available for configurable header/footer placement while the watermark remains
controlled by `print.format.watermark.enabled` and by the checkbox/forced default configuration.

Conditional blocks prevent empty labels from being printed:

```text
[[{{UserId}}, "Utskriven av: {{UserId}} | "]]
[[{{reason}}, "Orsak: {{reason}} | "]]
```

If the condition token is `null`, `undefined`, an empty string, or a null-like string, the entire
block is omitted. This avoids output such as `Utskriven av: | Orsak: |` when the host session lacks
those values.

Newlines in configured templates are rendered as print line breaks. Token values are HTML-escaped
before insertion. Admin-authored template markup, such as `<strong>`, is preserved.

## Warm print iframe

OpenDocViewer can prewarm a hidden print iframe after all pages are loaded. The warm frame reuses the existing original page image blob URLs, loads them in natural session order, and keeps the iframe ready for compatible print jobs. At print time OpenDocViewer updates dynamic header/footer text, toggles included pages, and invokes `print()` without rebuilding and reloading the whole print DOM.

The warm frame is deliberately limited to order-preserving original-page jobs. It is used for:

- all pages in the session
- all pages in the active selection, when the selected pages are already in natural order and unique
- simple ascending ranges
- custom page lists that are strictly increasing and contain no duplicates

It is not used for active-page printing, compare active-page printing, descending ranges, reordered custom lists, or repeated pages. Those jobs continue to use the regular robust print path because active-page printing may include transient image edits and reordered jobs cannot be represented by hiding pages in a natural-order iframe.

Configuration is intentionally small and reuses the existing document-loading memory/performance profile:

```js
print: {
  prewarmIframe: {
    enabled: false,  // false by default; can be 'auto' or true
    maxPages: 0     // 0 = use existing documentLoading thresholds
  }
}
```

A small LED-style status indicator on the toolbar print button shows whether the warm print cache is inactive, being prepared, ready, or using fallback.

## Generated PDF print backend

The print dialog can optionally offer two separate print actions:

- **Print via HTML** uses the normal browser HTML/iframe print pipeline.
- **Print via PDF** generates a PDF inside OpenDocViewer from the selected page images, applies configured header/footer text and copy watermark text, then sends that PDF to the browser's PDF print flow.

This is intended as an alternative for browsers that are slow to create print previews from large HTML documents with many image pages. It is configurable and direct print remains the default primary action. PDF generation shows an OpenDocViewer progress indicator before the browser PDF print preview opens.

Configuration surface:

```js
print: {
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
    defaultMode: 'direct', // 'direct' or 'safe'
    allowDownload: false,
    filename: 'opendocviewer-print.pdf',
    marginPt: 8,
    headerReservePt: 18,
    footerReservePt: 14,
    textFontSize: 7,
    imageFallbackQuality: 0.9
  }
}
```

If `allowDownload` is `true`, the dialog also shows a **Save PDF** action unless `print.actions.downloadPdf.enabled` is `false`. The HTML and PDF print buttons can likewise be hidden with `print.actions.printHtml.enabled` and `print.actions.printPdf.enabled`, and each action can use localized `label` and `tooltip` values. Active-page PDF output uses the currently rendered active surface so transient image edits are preserved. Multi-page PDF output uses the original page image blobs in the requested print order.
