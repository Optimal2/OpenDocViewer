// File: public/odv.site.config.sample.js
/**
 * OpenDocViewer — Site-specific Overrides (SAMPLE)
 *
 * PURPOSE
 *   This file is the full site-local override surface for OpenDocViewer.
 *   Keep `public/odv.config.js` under application control. Copy this file, rename it to
 *   `odv.site.config.js`, and edit only the values that should differ for a specific site.
 *
 * UPGRADE STRATEGY
 *   - Keep `odv.config.js` unchanged when upgrading the application.
 *   - Keep `odv.site.config.js` under site/customer control.
 *   - During upgrades, replace the application files and keep the site-local config file.
 *   - When a new OpenDocViewer version adds settings, compare the local file with this sample.
 *
 * HOW TO USE
 *   1) Copy this file to the same folder as `odv.config.js` (usually `/public`).
 *   2) Rename the copy to: `odv.site.config.js`
 *   3) Edit only the values that should differ for this site.
 *
 * IMPORTANT MERGE RULES
 *   - This file is deep-merged on top of the built-in defaults from `odv.config.js`.
 *   - Plain values replace the defaults.
 *   - Nested objects merge by key.
 *   - Arrays replace the defaults completely. If you override an array, include the full final array.
 *
 * LOCALIZED VALUES
 *   Any user-facing string may be either:
 *     - a plain string
 *     - or a localized object map: { en: "Text", sv: "Text" }
 *
 * STABLE IDENTIFIERS
 *   Values used for logging or integration identifiers should stay stable and non-localized.
 *   Example: reason option `value` should remain a stable plain string, while `label` may be localized.
 *
 * THRESHOLD CONVENTION
 *   For the numeric count/threshold settings below:
 *     - use a positive number to enable the threshold
 *     - use 0 to disable that specific threshold
 */
(function (w) {
  w.__ODV_SITE_CONFIG__ = {
    // =========================================================================
    // UI & diagnostics
    // =========================================================================
    exposeStackTraces: false,
    showPerfOverlay: false,

    // =========================================================================
    // Base paths and runtime i18n
    // =========================================================================
    // These values are normally derived automatically. Override them only if the
    // hosting environment requires explicit control.

    // Example:
    // basePath: "/OpenDocViewer",
    // baseHref: "/OpenDocViewer/",

    i18n: {
      default: 'en',
      supported: ['en', 'sv'],
      loadPath: 'locales/{{lng}}/{{ns}}.json?v={{ver}}',
      version: 'auto'
    },

    // =========================================================================
    // Keyboard shortcuts
    // =========================================================================
    shortcuts: {
      print: {
        // Ctrl/Cmd+P behavior:
        //   "browser" -> keep native browser print behavior
        //   "disable" -> intercept and cancel Ctrl/Cmd+P
        //   "dialog"  -> intercept and open the OpenDocViewer print dialog
        ctrlOrCmdP: 'dialog'
      }
    },

    // =========================================================================
    // User log (proxied via /ODVProxy/)
    // =========================================================================
    userLog: {
      enabled: false,
      endpoint: '/ODVProxy/userlog/record',
      transport: 'form',

      ui: {
        // Field visibility rules:
        //   "auto"   -> show when (userLog.enabled || printHeader.enabled)
        //   "always" -> always show the field
        //   "never"  -> never show the field
        showReasonWhen: 'auto',
        showForWhomWhen: 'auto',

        fields: {
          reason: {
            required: true,
            maxLen: 255,
            regex: null,
            regexFlags: '',
            placeholder: { en: 'Select reason…', sv: 'Välj orsak…' },

            source: {
              // IMPORTANT: if you override this array, include the complete final list.
              options: [
                { value: 'Patient copy',    label: { en: 'Patient copy',    sv: 'Patientkopia' } },
                { value: 'Internal review', label: { en: 'Internal review', sv: 'Intern granskning' } },
                { value: 'Legal request',   label: { en: 'Legal request',   sv: 'Juridisk begäran' } },
                {
                  value: 'Other',
                  label: { en: 'Other', sv: 'Annat' },
                  allowFreeText: true,
                  input: {
                    required: true,
                    maxLen: 140,
                    regex: null,
                    regexFlags: '',
                    placeholder: { en: 'Type other reason…', sv: 'Ange annan orsak…' },
                    prefix: { en: 'Other: ', sv: 'Annan: ' },
                    suffix: { en: ' (specify)', sv: ' (ange)' }
                  }
                }
              ]

              // Alternative remote-source shape for reasons:
              // url: '/OpenDocViewer/userlog/reasons.json',
              // cacheTtlSec: 300
            },

            default: null
          },

          forWhom: {
            required: false,
            maxLen: 120,
            regex: null,
            regexFlags: '',
            placeholder: { en: 'Who requested this?', sv: 'Vem begärde detta?' }
          }
        }
      }
    },

    // =========================================================================
    // Print header
    // =========================================================================
    printHeader: {
      enabled: true,
      position: 'top',
      heightPx: 32,
      applyTo: 'all',
      template: {
        en: "${date} ${time} | ${doc.title||''} | Reason: ${reason||''} | For: ${forWhom||''} | Page ${page}/${totalPages}",
        sv: "${date} ${time} | ${doc.title||''} | Orsak: ${reason||''} | För: ${forWhom||''} | Sida ${page}/${totalPages}"
      },
      css: [
        '.odv-print-header{ font:12px/1.2 Arial,Helvetica,sans-serif; color:#444;',
        '  background:rgba(255,255,255,.85); padding:4mm 6mm; }',
        '.odv-print-header strong{ color:#000; }'
      ].join('\n')
    },

    // =========================================================================
    // Large-document loading, caching, and memory behavior
    // =========================================================================
    documentLoading: {
      // Choose one of: 'performance', 'memory', 'auto'.
      // 'auto' starts aggressively, then degrades one-way when page count or memory pressure grows.
      mode: 'auto',

      warning: {
        // Count-based warnings are disabled by default because many OpenDocViewer runs
        // consist of large numbers of single-page raster files.
        sourceCountThreshold: 0,

        // Warn only for clearly large page volumes by default.
        pageCountThreshold: 5000,

        // Start estimating total page volume after this many sources have been analyzed.
        probePageThresholdSources: 2,

        // Recommendation-only thresholds shown inside the warning dialog.
        minStopRecommendationSources: 0,
        minStopRecommendationPages: 10000
      },

      adaptiveMemory: {
        // Runtime heuristics remain enabled by default, but the defaults now favor
        // stability/performance and only become conservative when the browser signals
        // a lower-memory environment.
        enabled: true,
        preferPerformanceWhenDeviceMemoryAtLeastGb: 8,
        preferPerformanceWhenJsHeapLimitAtLeastMiB: 2048,

        // When every page is a single raster image and the run is not too large,
        // the viewer may reuse full images for thumbnails instead of generating a
        // separate thumbnail asset for each page.
        reuseFullImageThumbnailsBelowPageCount: 600
      },

      fetch: {
        // 'sequential' is safest for ticket links and proxy-backed document endpoints.
        // 'parallel-limited' is faster when the upstream can tolerate multiple in-flight fetches.
        strategy: 'sequential',

        // Number of concurrent network fetches used during the prefetch step.
        // Conservative by default so tokenized/proxied backends are less likely to stall.
        prefetchConcurrency: 4,

        // Retry a small number of transient failures such as browser/network timeouts or
        // gateway-style upstream errors. Permanent failures are not retried.
        prefetchRetryCount: 0,

        // Base backoff before retry attempts. Later retries scale linearly from this value.
        prefetchRetryBaseDelayMs: 750,
        // Abort a single prefetch attempt after this many milliseconds so one slow source does not
        // keep the viewer waiting on that spot in the sequence for too long.
        prefetchRequestTimeoutMs: 10000
      },

      sourceStore: {
        // Original source-file bytes.
        //   "memory"    -> keep in memory only
        //   "indexeddb" -> keep in IndexedDB/browser disk cache
        //   "adaptive"  -> start in memory and switch to IndexedDB when thresholds are hit
        mode: 'adaptive',

        // Count-based switching is disabled by default. Size-based switching remains enabled.
        switchToIndexedDbAboveSourceCount: 0,

        // Switch to IndexedDB once the prefetched original source bytes grow beyond this size.
        switchToIndexedDbAboveTotalMiB: 768,

        //   "none"            -> plain temporary storage
        //   "aes-gcm-session" -> encrypted with an in-memory per-session key
        protection: 'aes-gcm-session',

        staleSessionTtlMs: 24 * 60 * 60 * 1000,

        // Small in-memory read cache for recently reused source blobs.
        blobCacheEntries: 12
      },

      assetStore: {
        // Persist already-rendered page blobs so a page normally needs to be rasterized only once.
        enabled: true,
        mode: 'adaptive',

        // Count-based switching is disabled by default. Size-based switching remains enabled.
        switchToIndexedDbAboveAssetCount: 0,

        // Switch to IndexedDB once the rendered asset store grows beyond this size.
        switchToIndexedDbAboveTotalMiB: 1536,

        protection: 'aes-gcm-session',
        staleSessionTtlMs: 24 * 60 * 60 * 1000,
        blobCacheEntries: 16,

        // Dedicated thumbnails are off by default because the preferred runtime profile reuses the
        // full rendered page for both the main view and the thumbnail pane until memory pressure
        // forces a downgrade.
        persistThumbnails: false,

        // Keep original single-page raster sources by default for stability. Change this
        // to true only if you explicitly want the original source released after the full
        // page blob has been persisted.
        releaseSinglePageRasterSourceAfterFullPersist: false
      },

      render: {
        // Maximum number of concurrent page-asset renders allowed in the lazy renderer.
        // This pipeline renders page assets in the main thread, so keep this value moderate.
        maxConcurrentAssetRenders: 6,

        // Full-page scale applies to PDF rendering in the current lazy page-asset pipeline.
        // Raster images and TIFF pages are not upscaled by this setting.
        fullPageScale: 1.5,

        // Real thumbnail raster size. The thumbnail pane may still scale the image to fit
        // the currently available width.
        thumbnailMaxWidth: 220,
        thumbnailMaxHeight: 310,

        // Thumbnail asset scheduling strategy:
        //   "adaptive" -> eager for smaller runs, current/visible-first for larger runs
        //   "eager"    -> build all thumbnails in the background
        //   "viewport" -> only build current/visible thumbnails and nearby neighbors
        thumbnailLoadingStrategy: 'eager',

        // Thumbnail source strategy:
        //   "auto"               -> reuse full raster-image assets when appropriate,
        //                           otherwise generate dedicated thumbnail rasters
        //   "dedicated"          -> always generate dedicated thumbnail rasters
        //   "prefer-full-images" -> always reuse the rendered full page for thumbnails
        thumbnailSourceStrategy: 'prefer-full-images',

        // In "adaptive" mode, runs at or below this page count will queue the entire
        // thumbnail set in the background while still keeping a deterministic thumbnail pane.
        thumbnailEagerPageThreshold: 10000,

        // Neighbor prefetch around the active page.
        lookAheadPageCount: 12,
        lookBehindPageCount: 8,

        // How many rows beyond the visible thumbnail range should be considered for work.
        visibleThumbnailOverscan: 24,

        // In-memory object-URL cache limits.
        // The underlying rendered blobs may still remain in the asset store even if an older
        // browser object URL is revoked from RAM.
        fullPageCacheLimit: 500,
        thumbnailCacheLimit: 8192,

        // Limits for open decoded multi-page source objects kept by the lazy renderer.
        maxOpenPdfDocuments: 16,
        maxOpenTiffDocuments: 16
      }
    },

    // =========================================================================
    // System log (proxied via /ODVProxy/)
    // =========================================================================
    systemLog: {
      enabled: false,
      endpoint: '/ODVProxy/log',
      token: 'REPLACE_WITH_SYSTEM_LOG_TOKEN'
    }
  };
})(window);