# Customer performance profile

This build now supports three explicit document-loading modes instead of one fixed behavior:

- `performance`
- `memory`
- `auto`

## Recommended default

Use `documentLoading.mode = 'auto'` unless a specific customer explicitly wants one extreme.

`auto` starts close to the old fast-feeling eager pipeline:

- true sequential fetch by default for ticket/proxy safety
- worker-backed raster/TIFF rendering on a per-file basis whenever that source can use workers
- eager-all warm-up for ordinary runs (the default performance window now covers roughly the first 2000 pages)
- reuse the same rendered full page for both the large pane and the thumbnail pane by default
- larger in-memory caches

Then it degrades one-way when pressure rises:

- stop global eager-all warm-up
- reduce concurrency
- prefer dedicated thumbnails again
- promote more blobs to IndexedDB
- shrink cache limits

## When to use `performance`

Choose `performance` when:

- the client machines are known to have enough RAM
- the customer prioritizes fast thumbnail/full-page warm-up over memory usage
- the upstream document service behaves well with sequential fetch and aggressive local rendering

Expected characteristics:

- eager-all source warm-up
- worker-preferred raster/TIFF rendering, evaluated per source file rather than globally
- large in-memory caches
- full-image thumbnail reuse as the default

## When to use `memory`

Choose `memory` when:

- the environment has a hard browser-memory ceiling
- thousands of pages are common
- the customer accepts later page loads in exchange for lower resident memory

Expected characteristics:

- lazy viewport-first rendering
- low render concurrency
- dedicated thumbnail rasters
- aggressive eviction / IndexedDB usage

## Ticket-link guidance

For tokenized or iframe-launched ticket links, prefer:

```js
documentLoading: {
  mode: 'auto',
  fetch: {
    strategy: 'sequential'
  }
}
```

That keeps the older fetch ordering semantics while still allowing the new hybrid renderer to warm pages in the background after each source has been secured locally.

## Page-consistency guarantee

The viewer now treats “selected page” and “actually displayed page” as separate states.

- If the next page is ready immediately, the switch feels instant.
- If the next page is slower, the thumbnail highlight stays on the actually displayed page until the viewer changes to a real loading overlay.
- Once the loading overlay is visible, the requested page may be highlighted because the large pane is no longer pretending to show the previous page.

This avoids the earlier class of bugs where page X was highlighted but page Y was still visible in the large pane.

## Print dialog during loading

While the total page count is still changing, the print dialog now stays in a very small active-page-only mode. This avoids the earlier confusion where selecting "all pages" or switching modes could appear to reset itself mid-load simply because more pages had just been discovered.

## Runtime status hint

OpenDocViewer now shows a thin status bar above the toolbar so operators can immediately see which profile is active:

- green = fast eager/performance path
- yellow = memory-efficient path
- red = viewer error state
