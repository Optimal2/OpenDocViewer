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
