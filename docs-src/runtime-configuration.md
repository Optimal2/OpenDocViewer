# Runtime configuration notes

OpenDocViewer is designed so operational configuration can change without rebuilding the frontend bundle.

## Primary config files

- `public/odv.config.js`
  - required defaults
- `public/odv.site.config.sample.js`
  - sample site override file
- optional deployment-specific `odv.site.config.js`
  - loaded before the required default config

## Load order

`src/app/bootConfig.js` performs runtime config loading before React starts.

1. determine application base path
2. probe `odv.site.config.js` from the application base
3. probe `odv.config.js` from the application base
4. optionally fall back to site root for `odv.config.js` in development scenarios
5. import `src/index.jsx`

This keeps the viewer startup deterministic and avoids partial initialization with missing config.

## Why scripts are probed before injection

The boot loader uses a fetch probe before adding script tags so it can reject cases where the server returns:

- HTML instead of JavaScript
- a wrong MIME type
- an SPA fallback page for a missing config script

Without that probe, config failures are harder to diagnose in production.

## What belongs in runtime config

Good runtime-config candidates:

- logging endpoints and enable/disable flags
- i18n defaults and translation versioning / build-based cache busting
- print-dialog thresholds and print-header settings
- diagnostics toggles
- keyboard shortcut policy for browser-print interception
- deployment base path / base href

Poor runtime-config candidates:

- logic that should be compile-time code
- secrets that should not be visible to the browser
- values that need strong server-side enforcement

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

## Print preparation notice

OpenDocViewer can optionally show a temporary informational overlay after the user clicks
**Prepare printing** for a large job. This is useful when the browser takes noticeable time to build
its preview/print dialog for several hundred pages.

Configuration surface:

```js
print: {
  preparationNoticeThresholdPages: 200 // 0 disables the notice
}
```

Behavior:

- if the resolved print job contains at least this many pages, the notice is shown
- if the threshold is `0`, the notice is disabled entirely
- this does not alter the actual print payload; it only reduces accidental double-submission by users

## Operational advice

- Do not long-cache `odv.config.js`.
- Locale JSON URLs now include an automatic per-build version token by default (`i18n.version: 'auto'`). That reduces stale-language-cache problems after deployments without requiring manual version bumps.
- When `i18n.default` is set to a concrete language such as `sv`, OpenDocViewer now uses that site-level default before falling back to stored browser/OS language preferences.
- Both `systemLog.enabled` and `userLog.enabled` are disabled by default in the shipped runtime config. Enable them explicitly in `odv.site.config.js` when the deployment is ready.
- The performance overlay heap section depends on Chromium's `performance.memory` API. In Firefox and other browsers that do not expose those values, the overlay will show `N/A` for heap metrics.
- `public/odv.site.config.sample.js` is intended to mirror the full safe site-override surface. The
  only intentionally-commented entries are the environment-derived `basePath` and `baseHref`
  examples, because hard-overriding those two values unnecessarily can break deployment routing.
- When new runtime-config keys are introduced, update `public/odv.site.config.sample.js` in the same
  change so operators can see the full supported override surface without diffing source files.
- If using a site override file, keep it deployment-local and avoid committing machine-specific values back into the main repo.
- Prefer stable, same-origin logging endpoints when possible.
- Re-check config precedence after any change to `bootConfig.js` or hosting rules.


## Large-document loading

The runtime config now also exposes a `documentLoading` section used by the hybrid loading engine.
The most important top-level knob is now `documentLoading.mode`:

- `performance` — eager warm-up, worker-heavy raster/TIFF rendering, larger RAM caches
- `memory` — lazy viewport-first rendering, aggressive eviction, IndexedDB-friendly defaults
- `auto` — start on the fast eager path for ordinary runs, then degrade one-way only when page volume or memory pressure becomes genuinely large

Example:

```js
documentLoading: {
  mode: 'auto',
  warning: {
    sourceCountThreshold: 0,
    pageCountThreshold: 10000,
    probePageThresholdSources: 2,
    minStopRecommendationSources: 0,
    minStopRecommendationPages: 10000,
  },
  adaptiveMemory: {
    enabled: true,
    preferPerformanceWhenDeviceMemoryAtLeastGb: 8,
    preferPerformanceWhenJsHeapLimitAtLeastMiB: 2048,
    reuseFullImageThumbnailsBelowPageCount: 2000,
    performanceWindowPageCount: 2000,
  },
  fetch: {
    strategy: 'sequential',
    prefetchConcurrency: 4,
    prefetchRetryCount: 0,
    prefetchRetryBaseDelayMs: 750,
    prefetchRequestTimeoutMs: 10000,
  },
  sourceStore: {
    mode: 'adaptive',
    switchToIndexedDbAboveSourceCount: 0,
    switchToIndexedDbAboveTotalMiB: 1536,
    protection: 'aes-gcm-session',
    staleSessionTtlMs: 24 * 60 * 60 * 1000,
    blobCacheEntries: 16,
  },
  assetStore: {
    enabled: true,
    mode: 'adaptive',
    switchToIndexedDbAboveAssetCount: 0,
    switchToIndexedDbAboveTotalMiB: 4096,
    protection: 'aes-gcm-session',
    staleSessionTtlMs: 24 * 60 * 60 * 1000,
    blobCacheEntries: 24,
    persistThumbnails: false,
    releaseSinglePageRasterSourceAfterFullPersist: false,
  },
  render: {
    strategy: 'eager-nearby',
    backend: 'hybrid-by-format',
    workerCount: 0,
    useWorkersForRasterImages: true,
    useWorkersForTiff: true,
    maxConcurrentMainThreadRenders: 3,
    maxConcurrentAssetRenders: 3,
    warmupBatchSize: 48,
    loadingOverlayDelayMs: 90,
    fullPageScale: 1.5,
    thumbnailMaxWidth: 220,
    thumbnailMaxHeight: 310,
    thumbnailLoadingStrategy: 'adaptive',
    thumbnailSourceStrategy: 'prefer-full-images',
    thumbnailEagerPageThreshold: 10000,
    lookAheadPageCount: 12,
    lookBehindPageCount: 8,
    visibleThumbnailOverscan: 24,
    fullPageCacheLimit: 500,
    thumbnailCacheLimit: 8192,
    maxOpenPdfDocuments: 16,
    maxOpenTiffDocuments: 16,
  },
  memoryPressure: {
    enabled: true,
    sampleIntervalMs: 2000,
    softHeapUsageRatio: 0.82,
    hardHeapUsageRatio: 0.92,
    softResidentMiB: 1200,
    hardResidentMiB: 1800,
    forceMemoryModeAbovePageCount: 10000,
    forceMemoryModeAboveSourceCount: 0,
  },
}
```

What these knobs control:

- `mode`
  - picks the base operating profile before any runtime degradation happens
- `warning.*`
  - controls when the load-pressure dialog appears and when it recommends stopping
- `adaptiveMemory.*`
  - lets the viewer bias toward aggressive caching/full-image thumbnail reuse only on machines that actually have enough headroom
- `fetch.strategy`
  - `sequential` behaves like the older stable ticket-link flow: fetch -> store/analyze -> enqueue render -> next source
  - `parallel-limited` keeps multiple prefetches in flight when the upstream can tolerate it
- `fetch.prefetchConcurrency`
  - only matters when `fetch.strategy === 'parallel-limited'`
- `sourceStore.*` and `assetStore.*`
  - control where original source blobs and rendered page blobs live (RAM vs IndexedDB) and when promotion to disk-backed storage happens
- `render.strategy`
  - `eager-all`, `eager-nearby`, or `lazy-viewport`
- `render.backend`
  - `hybrid-by-format` uses workers for raster/TIFF when possible while keeping PDF on the main/pdf.js path
  - `main-only` disables OpenDocViewer worker rendering
- `render.workerCount`
  - `0` means “decide automatically from hardwareConcurrency/deviceMemory”
- `memoryPressure.*`
  - controls the one-way `auto` degradation thresholds; a session can step from `normal` to `soft` to `hard` but never back up again
- compare navigation modifiers
  - toolbar page buttons still target the left pane by default
  - when `Shift` is held, the same toolbar buttons target the right compare pane instead
  - if compare mode is not open yet, `Shift` + toolbar/keyboard navigation opens it and seeds the right pane from the requested page/document move
  - the button disabled state follows the right pane while `Shift` is held so compare navigation stays available even when the left pane sits on the first/last page
- performance overlay
  - the diagnostics HUD now reports fetch strategy, render strategy/backend, worker routing, load-run duration, source/asset store usage, cache counts, tracked object URLs, and pending/warm-up activity
  - the load-run timer stops when the current load finishes, but the other counters continue updating while the overlay stays visible
  - when the overlay is disabled, the viewer skips the overlay-specific polling and snapshot collection entirely
- print dialog during loading
  - printing stays unavailable until all pages are fully loaded so the dialog, totals, and browser print preview cannot be destabilized by pages still arriving in the background
- selection pane during loading
  - the selection tab also stays unavailable until all pages are fully loaded so document/page checkboxes only appear once the final visible page universe is known

Operationally, the hybrid pipeline works like this:

1. prefetch source files early so expiring one-time URLs are captured quickly
2. store the original bytes in memory or IndexedDB depending on the active profile
3. analyze page counts in stable order from the fetched blob
4. register placeholders immediately
5. render thumbnails and full pages either eagerly or lazily depending on the mode
6. persist rendered page blobs in a second cache layer so a page is normally rasterized once per session
7. keep the large viewer and thumbnail selection synchronized; if the requested page is not ready quickly enough, the large pane switches to a dedicated loading overlay instead of continuing to imply that the previous page is still active

### Thumbnail behavior

`documentLoading.render.thumbnailMaxWidth` and `thumbnailMaxHeight` define the actual maximum raster size of generated thumbnails.

`documentLoading.render.thumbnailLoadingStrategy` supports:

- `adaptive` — keep a fixed-height thumbnail pane; eager-build all thumbnails for smaller documents, then switch to current/visible-first requests for larger ones
- `eager` — keep a fixed-height thumbnail pane and build all thumbnails in the background
- `viewport` — keep a fixed-height thumbnail pane but request only the current/visible thumbnails and nearby neighbors

`documentLoading.render.thumbnailEagerPageThreshold` controls when `adaptive` changes from full background thumbnail warm-up to current/visible-first thumbnail requests. The scrollbar height remains deterministic in both modes because one row is rendered for every page.

In this customer-focused configuration, the prefetch stage still keeps concurrency moderate, but it fails fast instead of retrying. The default profile now prefers reusing the full rendered page for both the large viewer and the thumbnail pane so long as memory pressure remains acceptable. When the session degrades toward memory protection, the same runtime policy can switch back to dedicated thumbnail rasters.


`documentLoading.render.thumbnailSourceStrategy` supports:

- `auto` — let the active mode decide; on performance-friendly runs it prefers reuse, while memory-heavy runs can switch back to dedicated thumbnails
- `dedicated` — always build dedicated thumbnails
- `prefer-full-images` — reuse the same rendered page asset for both the large pane and the thumbnail pane until memory-pressure rules override that choice

The thumbnail pane itself always keeps a deterministic scrollbar height. Asset reuse changes what gets stored in memory and what gets persisted, but not the pane geometry.