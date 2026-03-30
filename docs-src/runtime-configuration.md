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
- print-header settings
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

## Operational advice

- Do not long-cache `odv.config.js`.
- Locale JSON URLs now include an automatic per-build version token by default (`i18n.version: 'auto'`). That reduces stale-language-cache problems after deployments without requiring manual version bumps.
- Both `systemLog.enabled` and `userLog.enabled` are disabled by default in the shipped runtime config. Enable them explicitly in `odv.site.config.js` when the deployment is ready.
- The performance overlay heap section depends on Chromium's `performance.memory` API. In Firefox and other browsers that do not expose those values, the overlay will show `N/A` for heap metrics.
- If using a site override file, keep it deployment-local and avoid committing machine-specific values back into the main repo.
- Prefer stable, same-origin logging endpoints when possible.
- Re-check config precedence after any change to `bootConfig.js` or hosting rules.


## Large-document loading

The runtime config now also exposes a `documentLoading` section used by the new large-batch loading
pipeline.

```js
documentLoading: {
  warning: {
    sourceCountThreshold: 0,
    pageCountThreshold: 5000,
    probePageThresholdSources: 2,
    minStopRecommendationSources: 0,
    minStopRecommendationPages: 10000,
  },
  adaptiveMemory: {
    enabled: true,
    preferPerformanceWhenDeviceMemoryAtLeastGb: 8,
    preferPerformanceWhenJsHeapLimitAtLeastMiB: 2048,
    reuseFullImageThumbnailsBelowPageCount: 600,
  },
  fetch: {
    prefetchConcurrency: 2,
    prefetchRetryCount: 0,
    prefetchRetryBaseDelayMs: 750,
    prefetchRequestTimeoutMs: 8000,
  },
  sourceStore: {
    mode: 'adaptive', // 'memory' | 'indexeddb' | 'adaptive'
    switchToIndexedDbAboveSourceCount: 0,
    switchToIndexedDbAboveTotalMiB: 768,
    protection: 'aes-gcm-session', // 'none' | 'aes-gcm-session'
    staleSessionTtlMs: 24 * 60 * 60 * 1000,
    blobCacheEntries: 12,
  },
  assetStore: {
    enabled: true,
    mode: 'adaptive', // 'memory' | 'indexeddb' | 'adaptive'
    switchToIndexedDbAboveAssetCount: 0,
    switchToIndexedDbAboveTotalMiB: 1536,
    protection: 'aes-gcm-session',
    staleSessionTtlMs: 24 * 60 * 60 * 1000,
    blobCacheEntries: 16,
    persistThumbnails: true,
    releaseSinglePageRasterSourceAfterFullPersist: false,
  },
  render: {
    maxConcurrentAssetRenders: 4,
    fullPageScale: 1.5, // applies to PDF rendering in the lazy page-asset pipeline
    thumbnailMaxWidth: 220,
    thumbnailMaxHeight: 310,
    thumbnailLoadingStrategy: 'eager',
    thumbnailSourceStrategy: 'dedicated',
    thumbnailEagerPageThreshold: 5000,
    lookAheadPageCount: 8,
    lookBehindPageCount: 4,
    visibleThumbnailOverscan: 16,
    fullPageCacheLimit: 192,
    thumbnailCacheLimit: 8192,
    maxOpenPdfDocuments: 12,
    maxOpenTiffDocuments: 12,
  }
}
```

What these knobs control:

- `warning.*`
  - when to show a warning before continuing a very large load run; the shipped defaults disable source-count warnings and rely primarily on page volume
- `adaptiveMemory.*`
  - lets the viewer lean toward eager caching / full-image thumbnail reuse only on machines that actually have headroom
- `fetch.prefetchConcurrency`
  - how many source files are prefetched in parallel before page extraction starts
  - the customer-tuned profile in this bundle keeps concurrency at `2` but disables retries and adds an explicit fail-fast request timeout so slow upstream requests do not stall the UI for long
- `fetch.prefetchRetryCount` / `fetch.prefetchRetryBaseDelayMs` / `fetch.prefetchRequestTimeoutMs`
  - controls whether prefetch retries at all, how long it waits before another attempt, and when a single request is aborted as too slow
  - this customer bundle ships with no retries and an `8000` ms request timeout to keep the UI moving
- `sourceStore.*`
  - whether original source bytes stay in memory or move to browser disk-backed storage; the shipped defaults keep them in memory longer and switch by size, not source count
- `assetStore.*`
  - whether already-rendered page blobs are kept in memory or IndexedDB so they can be reused without re-rendering; the shipped defaults prefer stability/performance and avoid releasing original single-page rasters automatically
- `render.*`
  - lazy full-page rendering, thumbnail sizing, adaptive thumbnail strategy, and cache limits for object URLs / open documents

Operationally, the new pipeline works like this:

1. prefetch source files early so expiring one-time URLs are captured quickly
2. store the original bytes in memory or IndexedDB depending on configured thresholds
3. analyze page counts in stable order from the freshly fetched blob when possible, otherwise from temp storage
4. render thumbnails and full pages only when the UI actually needs them
5. persist rendered page blobs in a second cache layer (memory or IndexedDB) so a page is normally rasterized once per session
6. evict old object URLs via a small LRU cache while keeping the persisted blob recoverable for later navigation / print

### Thumbnail behavior

`documentLoading.render.thumbnailMaxWidth` and `thumbnailMaxHeight` define the actual maximum raster size of generated thumbnails.

`documentLoading.render.thumbnailLoadingStrategy` supports:

- `adaptive` — keep a fixed-height thumbnail pane; eager-build all thumbnails for smaller documents, then switch to current/visible-first requests for larger ones
- `eager` — keep a fixed-height thumbnail pane and build all thumbnails in the background
- `viewport` — keep a fixed-height thumbnail pane but request only the current/visible thumbnails and nearby neighbors

`documentLoading.render.thumbnailEagerPageThreshold` controls when `adaptive` changes from full background thumbnail warm-up to current/visible-first thumbnail requests. The scrollbar height remains deterministic in both modes because one row is rendered for every page.

In this customer-focused configuration, the prefetch stage still keeps concurrency moderate, but it fails fast instead of retrying. Thumbnails are warmed eagerly and use dedicated thumbnail rasters so the pane stays responsive even when documents contain large source images.


`documentLoading.render.thumbnailSourceStrategy` supports:

- `auto` — on high-memory machines, reuse full raster-image assets for thumbnails when the page count is low enough; otherwise build dedicated thumbnails
- `dedicated` — always build dedicated thumbnails
- `prefer-full-images` — always reuse full raster-image assets for image thumbnails

The thumbnail pane itself always keeps a deterministic scrollbar height. Asset reuse can change what gets stored in memory, but not the pane geometry.
