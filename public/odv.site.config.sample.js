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
 * PRINT TEMPLATE TOKENS
 *   Header/footer templates support:
 *     - {{date}}, {{time}}, {{page}}, {{totalPages}}
 *     - {{UserId}}, {{session.userId}}, {{SessionId}}, {{session.sessionId}}
 *     - {{reason}}, {{reasonSelection.output}}, {{reasonSelection.label.sv}}, {{reasonSelection.printValue.sv}}
 *     - {{forWhom}}
 *     - {{isCopy}}, {{printFormat}}, {{printFormatSelection.output}}, {{printFormatSelection.printValue.sv}}
 *     - {{doc.documentId}}, {{doc.documentPageNumber}}, {{doc.documentPageCount}}
 *     - {{metadata.<alias>}}, {{metadataAlias.<alias>.value}}, {{metadata.<fieldId>}}
 *
 *   Conditional block syntax:
 *     [[{{UserId}}, "Utskriven av: {{UserId}}"]]
 *   The whole block is omitted when the condition value is null, undefined, empty or null-like.
 *   Newlines in template strings are rendered as print line breaks.
 *
 * STABLE IDENTIFIERS
 *   Values used for logging or integration identifiers should stay stable and non-localized.
 *   Use localized `label` for UI text and localized `printValue` for physical print output.
 *
 * THRESHOLD CONVENTION
 *   For the numeric count/threshold settings below:
 *     - use a positive number to enable the threshold
 *     - use 0 to disable that specific threshold
 *
 * INTENTIONALLY COMMENTED KEYS
 *   `basePath` and `baseHref` are shown as commented examples rather than active values
 *   because they are normally derived automatically from the deployed script URL.
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
      default: 'sv',
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
    // Print UI behavior
    // =========================================================================
    print: {
      // Deprecated/no-op since PDF progress became the only print progress overlay.
      // Kept as a harmless compatibility key for older site-local configs.
      preparationNoticeThresholdPages: 0,

      // Warm print iframe preloads original page image blobs in a hidden iframe after all pages
      // are ready. It is only used for order-preserving multi-page jobs; active-page and reordered
      // custom jobs continue to use the regular print path.
      prewarmIframe: {
        // "auto" follows the existing documentLoading/memory profile; true forces eligibility
        // unless hard memory pressure is detected; false disables the optimization.
        enabled: 'auto',
        // 0 means reuse the existing documentLoading adaptive thresholds instead of adding a
        // separate print-specific page limit.
        maxPages: 0
      },


      // Optional generated-PDF backend for print output. Direct print remains the default.
      // Safe print generates a PDF inside OpenDocViewer and lets the browser print that PDF.
      pdf: {
        enabled: true,
        // "direct" -> browser HTML print is selected by default.
        // "safe"   -> generated-PDF print is selected by default.
        defaultMode: 'direct',
        // When true, the print dialog also shows a separate "Save PDF" action.
        allowDownload: false,
        filename: 'opendocviewer-print.pdf',
        // PDF layout tuning in points. Keep these small so document content keeps maximum space.
        marginPt: 8,
        headerReservePt: 18,
        footerReservePt: 14,
        textFontSize: 7,
        imageFallbackQuality: 0.9
      },

      // Optional copy marker. The print dialog uses a checkbox, not a format dropdown.
      // When inactive, {{isCopy}}/{{printFormat}} are empty and no watermark/header marker is emitted.
      format: {
        enabled: true,

        // true  -> use option.value on physical print output when option.printValue is missing
        // false -> use the localized option.label on physical print output when option.printValue is missing
        useValueForOutput: true,

        // Usually keep this disabled and place {{copyMarkerText}} or {{isCopy}} explicitly in printHeader/printFooter.
        // Enable only if you want OpenDocViewer to inject a separate automatic header marker.
        headerMarker: { enabled: false },

        watermark: {
          enabled: true,
          // true  -> show a user-controlled checkbox in the print dialog
          // false -> hide the checkbox; combine with defaultChecked=true for forced copy watermark
          showOption: true,
          // false -> normal print by default; user must explicitly choose copy watermark
          defaultChecked: false,
          // Optional extra CSS appended inside the isolated print iframe for the watermark element.
          // Use this only for trusted, site-local visual tweaks.
          css: ''
        },

        // Only one non-empty option is used by the checkbox UI. Keep value stable for logging;
        // use localized printValue for the actual physical print text.
        options: [
          {
            value: 'copy',
            label: { en: 'Copy', sv: 'Kopia' },
            checkboxLabel: { en: 'Add copy watermark', sv: 'Lägg till KOPIA-vattenstämpel' },
            printValue: { en: 'COPY', sv: 'KOPIA' }
          }
        ]
      }
    },

    // =========================================================================
    // Integration adapters
    // =========================================================================
    integrations: {
      portableBundle: {
        // Optional mapping from semantic metadata aliases to metadata-record identifiers used by
        // an embedding host's object-document payload. Supported values per alias:
        //   - string:  one field id
        //   - array:   ordered fallback field ids
        //   - object:  { fieldId|fieldIds, prefer, label, type, contexts }
        //
        // Raw metadata records remain available even when this object is empty.
        // Use aliases when a deployment wants stable semantic names for UI/print logic.
        // Field ids below are illustrative examples and should be adjusted per installation.
        metadataAliases: {
          patientId: {
            fieldId: '1001',
            prefer: 'value',
            label: { en: 'Patient ID', sv: 'Personnummer' },
            type: 'string',
            contexts: ['screen', 'print', 'sort', 'filter', 'selection']
          },
          patientName: {
            fieldId: '1002',
            prefer: 'value',
            label: { en: 'Name', sv: 'Namn' },
            type: 'string',
            contexts: ['screen', 'print', 'sort', 'filter', 'selection']
          },
          unitCode: {
            fieldId: '1011',
            prefer: 'value',
            label: { en: 'Unit code', sv: 'Avd/Mott kod' },
            type: 'string',
            contexts: ['screen', 'print', 'filter', 'debug']
          },
          unitName: {
            fieldId: '1011',
            prefer: 'lookupValue',
            label: { en: 'Unit name', sv: 'Avd/Mott namn' },
            type: 'string',
            contexts: ['screen', 'print', 'filter']
          },
          careContact: {
            fieldId: '1003',
            prefer: 'value',
            label: { en: 'Care contact', sv: 'Vårdkontakt' },
            type: 'string',
            contexts: ['screen', 'print', 'filter']
          },
          documentDate: {
            fieldId: '1007',
            prefer: 'value',
            label: { en: 'Document date', sv: 'Dokumentdatum' },
            type: 'datetime',
            contexts: ['screen', 'print', 'sort', 'filter', 'selection']
          },
          createdTimestamp: {
            fieldId: '500',
            prefer: 'value',
            label: { en: 'Created timestamp', sv: 'Skapad' },
            type: 'datetime',
            contexts: ['debug', 'support', 'sort']
          },
          modifiedTimestamp: {
            fieldId: '502',
            prefer: 'value',
            label: { en: 'Modified timestamp', sv: 'Ändrad' },
            type: 'datetime',
            contexts: ['debug', 'support', 'sort']
          },
          numberOfPages: {
            fieldId: '504',
            prefer: 'value',
            label: { en: 'Number of pages', sv: 'Antal sidor' },
            type: 'integer',
            contexts: ['screen', 'print', 'validation']
          },
          documentGuidPart: {
            fieldId: '15',
            prefer: 'value',
            label: { en: 'Document ID', sv: 'Dokument-id' },
            type: 'string',
            contexts: ['screen', 'print', 'debug', 'validation']
          }
        }
      }
    },

    // =========================================================================
    // Help / About
    // =========================================================================
    help: {
      manual: {
        // Site-local HTML fragments can be added without rebuilding the React app.
        // Create `help/site/manual.sv.html` / `help/site/manual.en.html` locally to override.
        sitePathTemplate: 'help/site/manual.{{lng}}.html',
        fallbackPathTemplate: 'help/default/manual.{{lng}}.html',
        fallbackLanguage: 'en'
      },
      about: {
        githubUrl: 'https://github.com/Optimal2/OpenDocViewer',
        contactEmail: 'dev@optimal2.se'
      }
    },

    // =========================================================================
    // User log (proxied via /ODVProxy/)
    // =========================================================================
    userLog: {
      // Enable this in a local site config only when the host endpoint is available.
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
            // true keeps stable option.value on print/logs when option.printValue is missing.
            // Prefer option.printValue for localized print output that differs from the UI label.
            useValueForOutput: true,
            maxLen: 255,
            regex: null,
            regexFlags: '',
            placeholder: { en: 'Select reason…', sv: 'Välj orsak…' },

            source: {
              // IMPORTANT: if you override this array, include the complete final list.
              options: [
                {
                  value: 'patient-copy',
                  label: {
                    en: 'Patient copy (verify recipient identity before printing)',
                    sv: 'Patientkopia (kontrollera mottagarens identitet före utskrift)'
                  },
                  printValue: { en: 'Patient copy', sv: 'Patientkopia' }
                },
                {
                  value: 'internal-review',
                  label: { en: 'Internal review', sv: 'Intern granskning' },
                  printValue: { en: 'Internal review', sv: 'Intern granskning' }
                },
                {
                  value: 'legal-request',
                  label: { en: 'Legal request', sv: 'Juridisk begäran' },
                  printValue: { en: 'Legal request', sv: 'Juridisk begäran' }
                },
                {
                  value: 'other',
                  label: { en: 'Other', sv: 'Annat' },
                  printValue: { en: 'Other', sv: 'Annat' },
                  allowFreeText: true,
                  input: {
                    required: true,
                    maxLen: 140,
                    regex: null,
                    regexFlags: '',
                    placeholder: { en: 'Type other reason…', sv: 'Ange annan orsak…' },
                    prefix: { en: 'Other: ', sv: 'Annan: ' },
                    suffix: { en: ' (specified)', sv: ' (angiven)' }
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
      // Default layout is "flow": the header reserves page space and does not cover the
      // source page image. Use layout: 'overlay' only when a deployment explicitly accepts
      // that the header/footer may be drawn on top of the printed page.
      layout: 'flow',
      heightPx: 22,
      applyTo: 'all',
      // Keep the default header compact: at most two short rows. The rendered page image is
      // scaled into the remaining page area, so large headers reduce image size instead of
      // covering source content.
      template: {
        en: '[[{{isCopy}}, "<strong>{{isCopy}}</strong> | "]]{{date}} {{time}} | Page {{page}}/{{totalPages}}[[{{metadata.patientId}}, " | Patient ID: {{metadata.patientId}}"]][[{{metadata.patientName}}, " | Name: {{metadata.patientName}}"]]\n[[{{metadata.unitName}}, "Unit: {{metadata.unitName}} | "]][[{{reasonSelection.output}}, "Reason: {{reasonSelection.output}} | "]][[{{forWhom}}, "For: {{forWhom}} | "]][[{{UserId}}, "Printed by: {{UserId}}"]]',
        sv: '[[{{isCopy}}, "<strong>{{isCopy}}</strong> | "]]{{date}} {{time}} | Sida {{page}}/{{totalPages}}[[{{metadata.patientId}}, " | Patient-ID: {{metadata.patientId}}"]][[{{metadata.patientName}}, " | Namn: {{metadata.patientName}}"]]\n[[{{metadata.unitName}}, "Avd/Mott: {{metadata.unitName}} | "]][[{{reasonSelection.output}}, "Orsak: {{reasonSelection.output}} | "]][[{{forWhom}}, "För: {{forWhom}} | "]][[{{UserId}}, "Utskriven av: {{UserId}}"]]'
      },
      css: `
.odv-print-header{ font:8.5px/1.15 Arial,Helvetica,sans-serif; color:#222;
  background:rgba(255,255,255,.35); padding:1.2mm 3mm; overflow:hidden; }
.odv-print-header strong{ color:#000; font-size:10px; letter-spacing:.06em; }
`.trim()
    },

    // =========================================================================
    // Print footer
    // =========================================================================
    printFooter: {
      enabled: true,
      position: 'bottom',
      layout: 'flow',
      heightPx: 14,
      applyTo: 'all',
      // Shows the source/original document id and the page number inside that original document.
      // This is different from {{page}}/{{totalPages}}, which refers to the whole print job.
      template: {
        en: '[[{{doc.documentId}}, "Document: {{doc.documentId}}"]][[{{doc.documentPageNumber}}, " (page: {{doc.documentPageNumber}}"]][[{{doc.documentPageCount}}, "/{{doc.documentPageCount}}"]][[{{doc.documentPageNumber}}, ")"]]',
        sv: '[[{{doc.documentId}}, "Dokument: {{doc.documentId}}"]][[{{doc.documentPageNumber}}, " (sida: {{doc.documentPageNumber}}"]][[{{doc.documentPageCount}}, "/{{doc.documentPageCount}}"]][[{{doc.documentPageNumber}}, ")"]]'
      },
      css: `
.odv-print-footer{ font:8px/1.1 Arial,Helvetica,sans-serif; color:#444;
  background:rgba(255,255,255,.25); padding:.9mm 3mm; overflow:hidden; }
`.trim()
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
        pageCountThreshold: 10000,

        // Start estimating total page volume after this many sources have been analyzed.
        probePageThresholdSources: 2,

        // Recommendation-only thresholds shown inside the warning dialog.
        minStopRecommendationSources: 0,
        minStopRecommendationPages: 10000
      },

      adaptiveMemory: {
        // Runtime heuristics remain enabled by default, but this SAMPLE intentionally
        // shows a more conservative profile than the built-in defaults in public/odv.config.js.
        // Copy whichever profile best matches the deployment's typical client hardware.
        enabled: true,
        preferPerformanceWhenDeviceMemoryAtLeastGb: 4,
        preferPerformanceWhenJsHeapLimitAtLeastMiB: 1024,

        // When every page is a single raster image and the run is not too large,
        // the viewer may reuse full images for thumbnails instead of generating a
        // separate thumbnail asset for each page.
        reuseFullImageThumbnailsBelowPageCount: 3000,
        // Auto mode stays on the fast eager path up to roughly this many pages unless the browser
        // enters a clearly catastrophic memory condition.
        performanceWindowPageCount: 3000
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
        switchToIndexedDbAboveTotalMiB: 2048,

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
        switchToIndexedDbAboveTotalMiB: 4096,

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
        // Rendering strategy:
        //   "eager-all"     -> render every page as soon as the source is known
        //   "eager-nearby"  -> render a warm window around the active page
        //   "lazy-viewport" -> render only what the viewport currently needs
        strategy: 'eager-all',

        // Rendering backend:
        //   "hybrid-by-format" -> prefer worker-backed raster/TIFF paths when possible
        //   "main-only"        -> keep rendering on the main thread only
        backend: 'hybrid-by-format',

        // 0 means “decide automatically from the current browser/runtime”.
        workerCount: 0,
        useWorkersForRasterImages: true,
        useWorkersForTiff: true,

        // Maximum number of main-thread renders allowed when the worker path is unavailable.
        maxConcurrentMainThreadRenders: 3,

        // Maximum number of concurrent page-asset renders allowed in the lazy renderer.
        // This pipeline renders page assets in the main thread, so keep this value moderate.
        // Keep this aligned with the normalized runtime defaults from
        // `src/utils/documentLoadingConfig.js`. There is no hidden ViewerProvider-only default of 6
        // for this setting in the current code path.
        maxConcurrentAssetRenders: 3,

        // How many page assets to queue per warm-up batch, and how long to wait before the
        // large-pane loading overlay appears for an individual page.
        warmupBatchSize: 48,
        loadingOverlayDelayMs: 90,

        // Full-page scale applies to PDF rendering in the current lazy page-asset pipeline.
        // Raster images and TIFF pages are not upscaled by this setting.
        fullPageScale: 1.0,

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
        fullPageCacheLimit: 2048,
        thumbnailCacheLimit: 4096,

        // Limits for open decoded multi-page source objects kept by the lazy renderer.
        maxOpenPdfDocuments: 16,
        maxOpenTiffDocuments: 16
      },

      memoryPressure: {
        enabled: true,
        sampleIntervalMs: 2000,
        softHeapUsageRatio: 0.82,
        hardHeapUsageRatio: 0.92,
        softResidentMiB: 1200,
        hardResidentMiB: 1800,
        forceMemoryModeAbovePageCount: 10000,
        forceMemoryModeAboveSourceCount: 0
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
