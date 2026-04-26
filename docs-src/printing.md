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

## Large print preparation notice

Large print jobs can take noticeable time before the browser preview actually appears. To reduce the
chance that users click the print action multiple times, the toolbar can show a temporary “print
request has been sent” overlay once the job size passes the configured threshold.

The threshold is controlled by runtime config:

```js
print: {
  preparationNoticeThresholdPages: 200,
  format: {
    enabled: true,
    useValueForOutput: true,
    default: '',
    options: [
      { value: '', label: { en: 'Normal print', sv: 'Normal utskrift' } },
      { value: 'KOPIA', label: { en: 'Copy', sv: 'Kopia' } }
    ]
  }
}
```

This notice is informational only. It does not modify the generated print DOM or the actual pages
selected for printing.

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

## Print format marker and watermark

OpenDocViewer can expose a **Print format** selector in the print dialog. When the selected option resolves to a non-empty output text, that text is available as the {{isCopy}}/ {{printFormat}} template value and, by default, as a semi-transparent watermark centered on every printed page. A separate automatic header marker can be enabled with print.format.headerMarker.enabled.

The format options use the same stable-value/localized-label pattern as print reasons:

- `value` is the stable configured value and is used on the physical print when `useValueForOutput: true`
- `label` is localized UI text
- when `useValueForOutput: false`, the localized `label` is also used as the physical print text

This allows one installation to print exactly `KOPIA`, while another can print a different configured word or allow the print text to follow the active UI language.

## Print header/footer metadata templates

Print header and footer are configured independently through `printHeader` and `printFooter`.
Both use the same template engine and both are evaluated per printed page.

Supported token forms:

```text
{{date}}
{{time}}
{{page}}
{{totalPages}}
{{reason}}
{{forWhom}}
{{printFormat}}
{{isCopy}}
{{UserId}}
{{session.userId}}
{{doc.documentId}}
{{doc.title}}
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

`{{isCopy}}` is an alias for the resolved print-format output text, for example `KOPIA`.
It is intentionally available for configurable header/footer placement while the watermark remains
controlled by `print.format.watermark.enabled`.

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
