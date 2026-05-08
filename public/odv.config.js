// File: public/odv.config.js
/**
 * OpenDocViewer — Runtime Configuration (public/odv.config.js)
 *
 * INTERNATIONALIZED CONFIG VALUES:
 *   Any user-facing string may be either a plain string (back-compat)
 *   OR a map { [languageCode]: string } — a "LocalizedString".
 *   Example: "Select reason…"  OR  { en: "Select reason…", sv: "Välj orsak…" }
 *
 * Keep stable identifiers (like reason `value`) as plain strings for logging.
 */

/**
 * @typedef {string | Object.<string,string>} LocalizedString
 *
 * @typedef {Object} ReasonFreeText
 * @property {boolean} [required]
 * @property {number}  [maxLen]
 * @property {string|null} [regex]
 * @property {string} [regexFlags]
 * @property {LocalizedString} [placeholder]
 * @property {LocalizedString} [prefix]
 * @property {LocalizedString} [suffix]
 *
 * @typedef {Object} ReasonOption
 * @property {string} value             // stable id sent to logs (keep as plain string)
 * @property {LocalizedString} [label]       // optional localized display label (falls back to value)
 * @property {LocalizedString} [printValue]  // optional localized text used on physical print/log output
 * @property {boolean} [allowFreeText]
 * @property {ReasonFreeText} [input]
 *
 * @typedef {Object} PrintFormatOption
 * @property {string} value                  // stable id for the marker option
 * @property {LocalizedString} [label]       // localized display label
 * @property {LocalizedString} [checkboxLabel] // optional localized checkbox label
 * @property {LocalizedString} [printValue]  // optional localized text used on physical print output
 */

(function (w, d) {
  /**
   * Coerce a value to boolean with a default.
   * @param {*} v
   * @param {boolean} def
   * @returns {boolean}
   */
  function toBool(v, def) { return typeof v === 'boolean' ? v : def; }

  /**
   * @param {*} x
   * @returns {x is Record<string, any>}
   */
  function isObj(x){ return x && typeof x === 'object' && !Array.isArray(x); }

  /**
   * Deep-merge two plain objects. Arrays/primitives are replaced.
   * @param {Record<string, any>} dst
   * @param {Record<string, any>} src
   * @returns {Record<string, any>}
   */
  function deepMerge(dst, src){
    if (!isObj(dst)) dst = {};
    if (!isObj(src)) return src === undefined ? dst : src;
    /** @type {Record<string, any>} */
    var out = {};
    var k;
    for (k in dst) if (Object.prototype.hasOwnProperty.call(dst, k)) out[k] = dst[k];
    for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) {
      var dv = out[k], sv = src[k];
      out[k] = (isObj(dv) && isObj(sv)) ? deepMerge(dv, sv) : sv;
    }
    return out;
  }

  // Detect our own script tag to infer base paths (works under virtual directories).
  var scriptEl = d.currentScript || (function () {
    var all = d.getElementsByTagName('script');
    for (var i = all.length - 1; i >= 0; i--) {
      var s = all[i].getAttribute && all[i].getAttribute('src');
      if (s && /odv\.config\.js(\?|$)/i.test(s)) return all[i];
    }
    return null;
  })();

  var cfgSrc = scriptEl ? scriptEl.getAttribute('src') : '';
  var abs;
  try { abs = new URL(cfgSrc, d.baseURI || w.location.href); } catch { abs = null; }
  var baseHref = abs && abs.pathname
    ? abs.pathname.replace(/\/odv\.config\.js(?:\?.*)?$/i, '/')
    : (w.location.pathname || '/').replace(/[^/]+$/, '/');
  if (!/\/$/.test(baseHref)) baseHref += '/';
  var basePath = baseHref.replace(/\/$/, '');

  var existing = w.__ODV_CONFIG__ || {};
  var siteOverrides = w.__ODV_SITE_CONFIG__ || {};

  // ========================= ACTIVE (mode-less) CONFIG =========================
  var ACTIVE_CONFIG = {
    // UI & diagnostics
    exposeStackTraces: toBool(existing.exposeStackTraces, false),
    showPerfOverlay:   toBool(existing.showPerfOverlay,   false),

    // Where the app is mounted (derived above).
    basePath: basePath,
    baseHref: baseHref,

    // ---- INTERNATIONALIZATION -------------------------------------------------
    i18n: {
      default: 'en',
      supported: ['en', 'sv'],
      loadPath: baseHref + 'locales/{{lng}}/{{ns}}.json?v={{ver}}',
      // "auto" = use the current build id injected by Vite so updated locale files
      // are fetched automatically after each build without manual version bumps.
      version: 'auto'
    },

    // ---- SHORTCUTS ------------------------------------------------------------
    shortcuts: {
      print: {
        /**
         * Ctrl/Cmd+P behavior.
         * - "browser": keep the native browser shortcut
         * - "disable": cancel the shortcut without opening any dialog
         * - "dialog": cancel the shortcut and open OpenDocViewer's print dialog
         *
         * NOTE: this only affects keyboard interception. Browser menus / native context menus
         * cannot be reliably overridden by regular web-page code.
         * @type {"browser"|"disable"|"dialog"}
         */
        ctrlOrCmdP: "dialog"
      }
    },

    // ---- PRINT UI ------------------------------------------------------------
    print: {
      // Deprecated/no-op since PDF progress became the only print progress overlay.
      // Kept as a harmless compatibility key for older site-local configs.
      preparationNoticeThresholdPages: 0,

      // Warm print iframe preloads original page image blobs in a hidden iframe after all pages
      // are ready. It is only used for order-preserving multi-page jobs; active-page and reordered
      // custom jobs continue to use the regular print path.
      prewarmIframe: {
        // false is the default because this optimization has not shown a consistent benefit in
        // production-like use. Set to "auto" or true only for deployments that explicitly want it.
        enabled: false,
        // 0 means reuse the existing documentLoading adaptive thresholds instead of adding a
        // separate print-specific page limit.
        maxPages: 0
      },


      // Optional generated-PDF backend for print output. Direct print remains the default.
      // PDF print generates a PDF inside OpenDocViewer and lets the browser print that PDF.
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

      // Optional per-action button control for the print dialog footer.
      // Labels and tooltips may be localized objects, e.g. { en: "...", sv: "..." }.
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
            en: 'Use the browser print preview. The browser orientation setting applies to the whole print job.',
            sv: 'Använd webbläsarens utskriftsförhandsgranskning. Webbläsarens orientering gäller hela utskriften.'
          }
        },
        printPdf: {
          enabled: true,
          label: { en: 'Print via PDF', sv: 'Skriv ut via PDF' },
          tooltip: {
            en: 'OpenDocViewer generates a PDF before the browser prints it.',
            sv: 'OpenDocViewer skapar en PDF innan webbläsaren skriver ut den.'
          }
        }
      },

      // Optional copy marker. The dialog uses a checkbox, not a format dropdown.
      // When inactive, {{isCopy}}/{{printFormat}} are empty and no watermark/header marker is emitted.
      format: {
        enabled: true,
        // true  -> use option.value on physical print output when option.printValue is missing
        // false -> use the localized option.label on physical print output when option.printValue is missing
        useValueForOutput: true,
        headerMarker: { enabled: false },
        watermark: {
          enabled: true,
          // true  -> show a user-controlled checkbox in the print dialog
          // false -> hide the checkbox; combine with defaultChecked=true for forced copy watermark
          showOption: true,
          // false -> normal print by default; user must explicitly choose copy watermark
          defaultChecked: false,
          // "custom" renders the configured marker text as a generated overlay.
          // "copy" and "kopia" use the bundled transparent PNG assets.
          // "auto" chooses COPY for English and KOPIA for Swedish.
          mode: 'auto',
          assets: {
            copy: baseHref + 'assets/watermarks/copy.png',
            kopia: baseHref + 'assets/watermarks/kopia.png'
          },
          // Optional extra CSS appended inside the isolated print iframe for the watermark element.
          // Use this only for trusted, site-local visual tweaks.
          css: ''
        },
        /** @type {PrintFormatOption[]} */
        options: [
          {
            value: 'KOPIA',
            label: { en: 'Copy', sv: 'Kopia' },
            checkboxLabel: { en: 'Add copy watermark', sv: 'Lägg till KOPIA-vattenstämpel' },
            printValue: { en: 'COPY', sv: 'KOPIA' }
          }
        ]
      }
    },

    // ---- INTEGRATION ADAPTERS -------------------------------------------------
    integrations: {
      portableBundle: {
        // Optional mapping from semantic metadata aliases to metadata-record identifiers used by
        // an embedding host's object-document payload. Supported values per alias:
        //   - string:  one field id
        //   - array:   ordered fallback field ids
        //   - object:  { fieldId|fieldIds, prefer, label, type, contexts }
        //
        // `prefer` may be one of:
        //   - 'value'
        //   - 'lookupValue'
        //   - 'valueThenLookup'   (default)
        //   - 'lookupThenValue'
        //
        // The integration layer always preserves raw metadata records. This alias map is only for
        // convenient semantic names and optional presentation hints used later inside the app.
        // Keep concrete deployment values out of the public repo and set them only in a
        // deployment-local override file when needed.
        metadataAliases: {}
      }
    },

    // ---- HELP / ABOUT ---------------------------------------------------------
    help: {
      manual: {
        // Site-local HTML fragments can be added without rebuilding the React app.
        // The loader tries the site path first and falls back to the bundled default file.
        sitePathTemplate: baseHref + 'help/site/manual.{{lng}}.html',
        fallbackPathTemplate: baseHref + 'help/default/manual.{{lng}}.html',
        fallbackLanguage: 'en'
      },
      about: {
        githubUrl: 'https://github.com/Optimal2/OpenDocViewer',
        contactEmail: 'dev@optimal2.se'
      }
    },

    // ---- USER LOG -------------------------------------------------------------
    userLog: {
      enabled:  false,
      endpoint: "/ODVProxy/userlog/record",
      transport: "form",

      // Print dialog UI/validation knobs.
      ui: {
        /**
         * Control Reason/ForWhom visibility.
         * "auto": show when (userLog.enabled || printHeader.enabled),
         * "always": force show, "never": force hide.
         * @type {"auto"|"always"|"never"}
         */
        showReasonWhen:  "auto",
        /** @type {"auto"|"always"|"never"} */
        showForWhomWhen: "auto",

        fields: {
          reason: {
            required: true,
            // true keeps stable option.value on print/logs; false prints localized option.label when available.
            useValueForOutput: true,
            maxLen: 255,
            regex: null,
            regexFlags: "",
            /** @type {LocalizedString} */
            placeholder: { en: "Select reason…", sv: "Välj orsak…" },
            source: {
              /** @type {ReasonOption[]} */
              options: [
                { value: "Patient copy",    label: { en: "Patient copy",    sv: "Patientkopia" } },
                { value: "Internal review", label: { en: "Internal review", sv: "Intern granskning" } },
                { value: "Legal request",   label: { en: "Legal request",   sv: "Juridisk begäran" } },
                {
                  value: "Other",
                  label: { en: "Other", sv: "Annat" },
                  allowFreeText: true,
                  input: {
                    required: true,
                    maxLen: 140,
                    regex: null,
                    regexFlags: "",
                    /** @type {LocalizedString} */
                    placeholder: { en: "Type other reason…", sv: "Ange annan orsak…" },
                    /** @type {LocalizedString} */
                    prefix: { en: "Other: ", sv: "Annan: " },
                    /** @type {LocalizedString} */
                    suffix: { en: " (specify)", sv: " (ange)" }
                  }
                }
              ]
            },
            // Default by stable id (matches an option `value` when using options)
            default: null
          },

          forWhom: {
            required: false,
            maxLen: 120,
            regex: null,
            regexFlags: "",
            /** @type {LocalizedString} */
            placeholder: { en: "Who requested this?", sv: "Vem begärde detta?" }
          }
        }
      }
    },

    // ---- PRINT HEADER ---------------------------------------------------------
    printHeader: {
      enabled: true,
      position: "top",
      layout: "flow",
      heightPx: 22,
      applyTo: "all",
      /**
       * Tokenized template.
       * Default layout is "flow", which reserves page space so the header does not cover
       * the printed source image. Use layout: "overlay" only for explicit overlay behavior.
       * @type {LocalizedString}
       */
      template: {
        en: '[[{{isCopy}}, "<strong>{{isCopy}}</strong> | "]]{{date}} {{time}} | Page {{page}}/{{totalPages}}[[{{metadata.patientId}}, " | Patient ID: {{metadata.patientId}}"]][[{{reasonSelection.output}}, " | Reason: {{reasonSelection.output}}"]][[{{forWhom}}, " | For: {{forWhom}}"]][[{{UserId}}, " | Printed by: {{UserId}}"]]',
        sv: '[[{{isCopy}}, "<strong>{{isCopy}}</strong> | "]]{{date}} {{time}} | Sida {{page}}/{{totalPages}}[[{{metadata.patientId}}, " | Patient-ID: {{metadata.patientId}}"]][[{{reasonSelection.output}}, " | Orsak: {{reasonSelection.output}}"]][[{{forWhom}}, " | För: {{forWhom}}"]][[{{UserId}}, " | Utskriven av: {{UserId}}"]]'
      },
      css: `
.odv-print-header{ font:8.5px/1.15 Arial,Helvetica,sans-serif; color:#222;
  background:rgba(255,255,255,.35); padding:1.2mm 3mm; overflow:hidden; }
.odv-print-header strong{ color:#000; font-size:10px; letter-spacing:.06em; }
`.trim()
    },

    // ---- PRINT FOOTER ---------------------------------------------------------
    printFooter: {
      enabled: true,
      position: "bottom",
      layout: "flow",
      heightPx: 14,
      applyTo: "all",
      template: {
        en: '[[{{doc.documentId}}, "Document: {{doc.documentId}}"]][[{{doc.documentPageNumber}}, " (page: {{doc.documentPageNumber}})"]]',
        sv: '[[{{doc.documentId}}, "Dokument: {{doc.documentId}}"]][[{{doc.documentPageNumber}}, " (sida: {{doc.documentPageNumber}})"]]'
      },
      css: `
.odv-print-footer{ font:8px/1.1 Arial,Helvetica,sans-serif; color:#444;
  background:rgba(255,255,255,.25); padding:.9mm 3mm; overflow:hidden; }
`.trim()
    },

    // ---- LARGE-DOCUMENT LOADING -----------------------------------------------
    documentLoading: {
      // Runtime loading mode:
      //   'performance' -> eager worker-heavy rendering and large in-memory caches
      //   'memory'      -> conservative lazy rendering and aggressive cache eviction
      //   'auto'        -> start fast, then degrade one-way toward memory mode under pressure
      mode: 'auto',

      // Warning thresholds. Defaults favor stability/performance and avoid source-count warnings by default.
      warning: {
        sourceCountThreshold: 0,
        pageCountThreshold: 10000,
        // Start estimating total page volume after this many sources were analyzed.
        probePageThresholdSources: 2,
        // Above these values the dialog will recommend stopping and retrying smaller.
        minStopRecommendationSources: 0,
        minStopRecommendationPages: 10000
      },

      // Runtime memory heuristics. High-memory machines get more eager caching/warm-up,
      // while lower-memory machines stay conservative.
      // NOTE: the sample file intentionally shows a more conservative profile (4 GB / 1024 MiB)
      // as a broadly safe starting point, while these application defaults are more performance-
      // oriented for stronger desktops (8 GB / 2048 MiB).
      adaptiveMemory: {
        enabled: true,
        preferPerformanceWhenDeviceMemoryAtLeastGb: 8,
        preferPerformanceWhenJsHeapLimitAtLeastMiB: 2048,
        reuseFullImageThumbnailsBelowPageCount: 2000,
        // Keep auto mode on the fast eager path up to roughly this many pages unless memory usage
        // becomes truly catastrophic. That keeps normal 1k-2k page runs smooth.
        performanceWindowPageCount: 2000
      },

      // Network prefetch step used to grab expiring URLs before later page rendering.
      fetch: {
        // 'sequential' behaves like the older stable ticket-link flow:
        // fetch source 1 -> store/analyze -> enqueue render -> move on.
        // 'parallel-limited' keeps multiple prefetches in flight.
        strategy: 'sequential',

        // Only used when strategy === 'parallel-limited'.
        // Customer-optimised profile: keep the backend pressure moderate, but fail fast so one
        // slow source does not make the whole viewer feel stuck.
        prefetchConcurrency: 4,

        // Retries are disabled in this profile. In the observed customer environment, waiting for
        // another conservative attempt made the thumbnail pane feel slower than surfacing the
        // failed source quickly.
        prefetchRetryCount: 0,

        // Retained for deployments that explicitly re-enable retries.
        prefetchRetryBaseDelayMs: 750,
        // Abort a single prefetch attempt after this many milliseconds so one slow source does not
        // keep the viewer waiting on that spot in the sequence for too long.
        prefetchRequestTimeoutMs: 10000
      },

      // Temporary storage for the original source bytes.
      sourceStore: {
        // "memory" = always heap-only, "indexeddb" = always browser disk cache,
        // "adaptive" = start in memory and switch to IndexedDB above thresholds.
        mode: 'adaptive',
        switchToIndexedDbAboveSourceCount: 0,
        switchToIndexedDbAboveTotalMiB: 1536,

        // "none" = plain temp storage,
        // "aes-gcm-session" = temp payloads encrypted with an in-memory per-session key.
        protection: 'aes-gcm-session',

        // Best-effort cleanup of stale temp sessions left behind in IndexedDB.
        staleSessionTtlMs: 24 * 60 * 60 * 1000,

        // Small in-memory read cache for recently used temp-store blobs.
        blobCacheEntries: 12
      },

      // Persist already-rendered page blobs so a page normally only needs to be rasterized once.
      assetStore: {
        enabled: true,
        mode: 'adaptive',
        switchToIndexedDbAboveAssetCount: 0,
        switchToIndexedDbAboveTotalMiB: 4096,
        protection: 'aes-gcm-session',
        staleSessionTtlMs: 24 * 60 * 60 * 1000,
        blobCacheEntries: 16,
        // Dedicated thumbnails are skipped by default because the preferred runtime profile reuses
        // the rendered full-size page for both the main view and the thumbnail pane until memory
        // pressure forces a downgrade.
        persistThumbnails: false,
        // Keep original single-page raster sources by default for stability.
        // Set to true in site config if you explicitly want the original source released after the
        // full-page blob has been persisted.
        releaseSinglePageRasterSourceAfterFullPersist: false
      },

      // Lazy page rendering and in-memory object URL cache limits.
      render: {
        // 'eager-all'     -> warm every page for each source as soon as it is discovered
        // 'eager-nearby'  -> warm an initial range only (default for auto)
        // 'lazy-viewport' -> render only what the viewport needs
        strategy: 'eager-nearby',

        // 'hybrid-by-format' keeps PDF on the main/pdf.js path while raster + TIFF use workers
        // whenever possible.
        backend: 'hybrid-by-format',

        // 0 = choose from hardwareConcurrency/deviceMemory at runtime.
        workerCount: 0,
        useWorkersForRasterImages: true,
        useWorkersForTiff: true,
        maxConcurrentMainThreadRenders: 3,
        // Keep this aligned with the normalized runtime defaults from
        // `src/utils/documentLoadingConfig.js`. There is no hidden ViewerProvider-only default of 6
        // for this setting in the current code path.
        maxConcurrentAssetRenders: 3,
        warmupBatchSize: 48,
        loadingOverlayDelayMs: 90,
        fullPageScale: 1.5,
        // Full-page scale applies to PDF rendering in the current lazy page-asset pipeline.
        // Raster images and TIFF pages are not upscaled by this setting.
        // Real thumbnail raster size. The pane can still scale the image to fit the available width.
        thumbnailMaxWidth: 220,
        thumbnailMaxHeight: 310,

        // Customer-optimised thumbnail scheduling: warm the pane in the background while the viewer
        // still prioritises full-size page assets.
        thumbnailLoadingStrategy: 'eager',

        // Reuse the full rendered page for the thumbnail pane by default. Auto/hard memory
        // protection can still switch to dedicated thumbnails later if the browser starts to run
        // low on memory.
        thumbnailSourceStrategy: 'prefer-full-images',

        // When strategy is "adaptive", documents at or below this page count queue the
        // entire thumbnail set in the background while still keeping a fixed-height pane.
        thumbnailEagerPageThreshold: 10000,
        lookAheadPageCount: 12,
        lookBehindPageCount: 8,
        visibleThumbnailOverscan: 24,
        // In-memory object-URL cache limits. The rendered blobs may still remain in the asset store
        // even if an older object URL is later revoked from RAM.
        fullPageCacheLimit: 500,
        thumbnailCacheLimit: 8192,
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

    // ---- SYSTEM LOG -----------------------------------------------------------
    systemLog: {
      enabled:  false,
      endpoint: "/ODVProxy/log",
      token:    "REPLACE_WITH_SYSTEM_LOG_TOKEN"
    }
  };

  // Merge site overrides on top of defaults, then freeze & publish.
  var merged = deepMerge(ACTIVE_CONFIG, siteOverrides);
  var cfg = Object.freeze(merged);
  w.__ODV_CONFIG__ = cfg;
  Object.defineProperty(w, "__ODV_GET_CONFIG__", {
    value: function () { return cfg; },
    writable: false, enumerable: false, configurable: false
  });
})(window, document);
