# Customer performance profile

This build is tuned for an environment where RAM pressure is usually acceptable and the primary goal is that the application feels quick to use.

## Goals

- keep the thumbnail pane warm and usable
- reduce the time a single slow upstream source can block the overall loading sequence
- avoid heavy per-thumbnail full-image reuse for large raster-image runs
- respect manual thumbnail-pane scrolling while the document set is still growing

## Runtime choices in this profile

### Prefetch

- `documentLoading.fetch.prefetchConcurrency = 4`
- `documentLoading.fetch.prefetchRetryCount = 0`
- `documentLoading.fetch.prefetchRequestTimeoutMs = 10000`

Rationale: the observed customer environment showed repeated `GetStream` timeouts. Retrying the same request made the viewer feel stuck for longer. This profile therefore fails faster and moves on.

### Thumbnails

- `documentLoading.render.thumbnailLoadingStrategy = 'eager'`
- `documentLoading.render.thumbnailSourceStrategy = 'dedicated'`
- `documentLoading.render.thumbnailCacheLimit = 8192`
- `documentLoading.render.maxConcurrentAssetRenders = 6`

Rationale: the pane should behave like the older always-warm experience rather than a strictly lazy viewport. Dedicated thumbnail rasters are used because reusing full-size images for every tile can make image-heavy runs feel slower even on high-memory machines. In this profile the row DOM stays fully active during eager warm-up, so the browser is not asked to defer off-screen thumbnail subtrees with `content-visibility:auto`.

### Thumbnail pane scroll behaviour

The thumbnail pane now avoids re-centering on the active page simply because the total discovered page count increased. This fixes the case where the user drags the scrollbar while loading is still in progress and the pane jumps back to the active page as new thumbnails arrive.

## Trade-offs

This profile intentionally spends more memory and background work to improve responsiveness. It is not the best fit for memory-constrained devices or deployments where every failed prefetch should be retried aggressively before surfacing a placeholder.


## Focus-first thumbnail prioritization

The thumbnail pane now treats the user's current scroll target as the primary focus.

- Visible thumbnails are requested before distant background pages.
- If the active document page is elsewhere, the pane still prioritizes the visible thumbnail region the user is currently inspecting.
- Background eager warm-up restarts around the visible center whenever the user scrolls, instead of continuing from page 1 upward.
- Warm-up batches are intentionally small so user-driven requests can overtake background work quickly.