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
 * @property {LocalizedString} [label]  // optional localized display label (falls back to value)
 * @property {boolean} [allowFreeText]
 * @property {ReasonFreeText} [input]
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
      enabled: true,            // non-optional when enabled
      position: "top",          // "top" | "bottom"
      heightPx: 32,
      applyTo: "all",           // "all" | "first" | "last"
      /**
       * Tokenized template (simple ${...} substitution).
       * Available tokens: date (YYYY-MM-DD), time (HH:MM 24h), now, page, totalPages,
       * reason, forWhom, user.id, user.name, doc.id, doc.title, doc.pageCount, viewer.version
       * @type {LocalizedString}
       */
      template: {
        en: "${date} ${time} | ${doc.title||''} | Reason: ${reason||''} | For: ${forWhom||''} | Page ${page}/${totalPages}",
        sv: "${date} ${time} | ${doc.title||''} | Orsak: ${reason||''} | För: ${forWhom||''} | Sida ${page}/${totalPages}"
      },
      // Print-only CSS scoped to `.odv-print-header`
      css: [
        ".odv-print-header{ font:12px/1.2 Arial,Helvetica,sans-serif; color:#444; ",
        "  background:rgba(255,255,255,.85); padding:4mm 6mm; }",
        ".odv-print-header strong{ color:#000; }"
      ].join("\n")
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
        pageCountThreshold: 5000,
        // Start estimating total page volume after this many sources were analyzed.
        probePageThresholdSources: 2,
        // Above these values the dialog will recommend stopping and retrying smaller.
        minStopRecommendationSources: 0,
        minStopRecommendationPages: 10000
      },

      // Runtime memory heuristics. High-memory machines get more eager caching/warm-up,
      // while lower-memory machines stay conservative.
      adaptiveMemory: {
        enabled: true,
        preferPerformanceWhenDeviceMemoryAtLeastGb: 8,
        preferPerformanceWhenJsHeapLimitAtLeastMiB: 2048,
        reuseFullImageThumbnailsBelowPageCount: 600
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
        switchToIndexedDbAboveTotalMiB: 768,

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
        switchToIndexedDbAboveTotalMiB: 1536,
        protection: 'aes-gcm-session',
        staleSessionTtlMs: 24 * 60 * 60 * 1000,
        blobCacheEntries: 16,
        persistThumbnails: true,
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
        maxConcurrentMainThreadRenders: 2,
        maxConcurrentAssetRenders: 2,
        warmupBatchSize: 24,
        loadingOverlayDelayMs: 90,
        fullPageScale: 1.5,
        // Full-page scale applies to PDF rendering in the current lazy page-asset pipeline.
        // Raster images and TIFF pages are not upscaled by this setting.
        // Real thumbnail raster size. The pane can still scale the image to fit the available width.
        thumbnailMaxWidth: 220,
        thumbnailMaxHeight: 310,

        // Customer-optimised thumbnail strategy: keep the pane warm by queueing the whole set in
        // the background. This costs more RAM/work, but the pane feels much more immediate.
        thumbnailLoadingStrategy: 'eager',

        // Dedicated thumbnail rasters keep the pane lighter and avoid decoding full-size images
        // for every thumbnail tile in large image-heavy runs.
        thumbnailSourceStrategy: 'dedicated',

        // When strategy is "adaptive", documents at or below this page count queue the
        // entire thumbnail set in the background while still keeping a fixed-height pane.
        thumbnailEagerPageThreshold: 10000,
        lookAheadPageCount: 12,
        lookBehindPageCount: 8,
        visibleThumbnailOverscan: 24,
        // In-memory object-URL cache limits. The rendered blobs may still remain in the asset store
        // even if an older object URL is later revoked from RAM.
        fullPageCacheLimit: 256,
        thumbnailCacheLimit: 8192,
        // Limits for open decoded multi-page source objects kept by the lazy renderer.
        maxOpenPdfDocuments: 16,
        maxOpenTiffDocuments: 16
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