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
- optional integration-adapter mappings for host payload metadata

Poor runtime-config candidates:

- logic that should be compile-time code
- secrets that should not be visible to the browser
- values that need strong server-side enforcement

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

Behavior:

- the manual dialog first tries the site-local HTML fragment under `help/site/`
- if no site-local file exists for the current language, it falls back to the bundled default under `help/default/`
- site-local manuals can therefore be upgraded independently of the app bundle as long as the deployment keeps `help/site/manual.<lng>.html` outside the tracked repo
- relative links inside the loaded HTML are rewritten against the resolved file URL so images, PDFs, and other local help assets can live alongside the manual fragment

Shipped public files:

- `public/help/default/manual.en.html`
- `public/help/default/manual.sv.html`
- `public/help/site/manual.en.sample.html`
- `public/help/site/manual.sv.sample.html`

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
  preparationNoticeThresholdPages: 200, // 0 disables the notice
  prewarmIframe: {
    enabled: 'auto', // 'auto', true, or false
    maxPages: 0     // 0 = reuse existing documentLoading thresholds
  },
  pdf: {
    enabled: true,
    defaultMode: 'direct',
    allowDownload: false,
    filename: 'opendocviewer-print.pdf',
    marginPt: 8,
    headerReservePt: 18,
    footerReservePt: 14,
    textFontSize: 7,
    imageFallbackQuality: 0.9
  },
  format: {
    enabled: true,
    useValueForOutput: true, // true=value on print, false=localized label on print
    default: '',
    headerMarker: { enabled: false },
    watermark: {
      enabled: true,
      showOption: true,
      defaultChecked: false,
      css: ''
    },
    options: [
      { value: '', label: { en: 'Normal print', sv: 'Normal utskrift' } },
      { value: 'KOPIA', label: { en: 'Copy', sv: 'Kopia' } }
    ]
  }
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
    // Keep this aligned with the normalized runtime defaults from
    // src/utils/documentLoadingConfig.js. The current ViewerProvider path does not apply
    // a separate hidden default of 6 for maxConcurrentAssetRenders.
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

## Print header/footer templates

`printHeader` and `printFooter` are independent runtime-config sections. Both support localized
`template` values, `position`, `layout`, `heightPx`, `applyTo`, and trusted print-only `css`.
Default `layout: 'flow'` reserves page space so source content is not covered; `layout: 'overlay'`
preserves the legacy absolute overlay behavior.

Example:

```js
printHeader: {
  enabled: true,
  position: 'top',
  layout: 'flow',
  applyTo: 'all',
  template: {
    sv: '[[{{isCopy}}, "<strong>{{isCopy}}</strong> | "]]{{date}} {{time}}[[{{metadata.patientId}}, " | Patient-ID: {{metadata.patientId}}"]][[{{UserId}}, " | Utskriven av: {{UserId}}"]] | Sida {{page}}/{{totalPages}}'
  }
},
printFooter: {
  enabled: true,
  position: 'bottom',
  layout: 'flow',
  template: {
    sv: '[[{{doc.documentId}}, "Dokument: {{doc.documentId}}"]][[{{doc.documentPageNumber}}, " (sida: {{doc.documentPageNumber}})"]]'
  }
}
```

Useful token scopes:

- session-level: `{{UserId}}`, `{{SessionId}}`, `{{session.userId}}`, `{{session.id}}`
- print-dialog: `{{reason}}`, `{{reasonSelection.output}}`, `{{reasonSelection.label.sv}}`, `{{reasonSelection.printValue.sv}}`, `{{forWhom}}`
- print format: `{{printFormat}}`, `{{printFormatSelection.output}}`, `{{printFormatSelection.label.sv}}`, `{{printFormatSelection.printValue.sv}}`, `{{copyMarkerText}}`, `{{printFormatOutput}}`, `{{isCopy}}`
- document-level: `{{doc.documentId}}`, `{{doc.documentPageNumber}}`, `{{doc.documentPageCount}}`
- metadata-level by field id: `{{metadata.<fieldId>}}`, for example `{{metadata.1001}}`
- metadata aliases: `{{metadata.<alias>}}`, for example `{{metadata.patientId}}`
- raw alias details: `{{metadataAlias.<alias>.value}}` and `{{metadataAlias.<alias>.lookupValue}}`

`doc.title` is derived by OpenDocViewer from normalized document metadata (`title`, `name`, then `documentId`). It is not a literal host-session field. For metadata aliases from `integrations.portableBundle.metadataAliases`, prefer `{{metadata.<alias>}}` for the selected value or `{{metadataAlias.<alias>.value}}` when the raw `Value` field must be used explicitly.

Conditional syntax:

```text
[[{{UserId}}, "Utskriven av: {{UserId}} | "]]
```

The configured block is rendered only when the first token resolves to a non-empty value.

### Warm print iframe

`print.prewarmIframe.enabled` controls the optional hidden print iframe used to speed up compatible multi-page print jobs. `auto` follows the existing `documentLoading` and memory-pressure profile, `true` forces eligibility unless hard memory pressure is detected, and `false` disables the optimization. `maxPages: 0` means that OpenDocViewer reuses existing document-loading thresholds instead of adding a separate print-specific page limit.

`print.pdf.enabled` controls whether the print button's split-menu offers generated-PDF output as **Safe print**. The primary **Prepare printing** button still uses direct browser printing by default so the dialog stays compact. `allowDownload: true` adds a separate **Save PDF** action to the print dialog.

The generated-PDF backend is intended for deployments where the browser is slow to build print preview from large HTML/IMG print documents. It reuses already rendered page image blobs for multi-page jobs. Active-page PDF output uses the current rendered surface to preserve transient image edits.
