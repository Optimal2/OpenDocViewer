// File: public/odv.config.js
/**
 * OpenDocViewer — Runtime Configuration (public/odv.config.js)
 *
 * Works under an IIS application folder (e.g., /OpenDocViewer).
 * The script computes basePath from its own <script src=".../odv.config.js"> URL.
 *
 * DESIGN (mode-less):
 *   This file exposes ALL knobs at all times. You enable/disable features by
 *   flipping booleans (no comment/uncomment “modes” needed here).
 *
 * LAYERED CONFIG (site-specific overrides):
 *   If present, a site-local override object `window.__ODV_SITE_CONFIG__` will be
 *   deep-merged on top of this default config. Load order in your HTML should be:
 *     <script src="./odv.site.config.js"></script>
 *     <script src="./odv.config.js"></script>
 *
 * UI Logic (used by the print dialog):
 *   - Show "Reason" / "For whom" inputs when (userLog.enabled || printHeader.enabled),
 *     unless you force visibility via ui.showReasonWhen / ui.showForWhomWhen.
 *   - Validation (required, maxLen, regex) comes from userLog.ui.fields.*.
 *   - Reason dropdown can be inline (options[]) or loaded from source.url.
 *   - A reason option may request extra free text via allowFreeText + input{...}.
 *
 * CACHING:
 *   Keep this file uncached (web.config sets Cache-Control: no-store).
 */

(function (w, d) {
  function toBool(v, def) { return typeof v === 'boolean' ? v : def; }

  // --- tiny deep merge (objects only; arrays/values are replaced) ---
  function isObj(x){ return x && typeof x === 'object' && !Array.isArray(x); }
  function deepMerge(dst, src){
    if (!isObj(dst)) dst = {};
    if (!isObj(src)) return src === undefined ? dst : src;
    var out = {};
    var k;
    for (k in dst) if (Object.prototype.hasOwnProperty.call(dst, k)) out[k] = dst[k];
    for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) {
      var dv = out[k], sv = src[k];
      out[k] = (isObj(dv) && isObj(sv)) ? deepMerge(dv, sv) : sv;
    }
    return out;
  }

  // Compute app base from THIS file's URL (robust for virtual directories).
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

  // E.g.: /OpenDocViewer/odv.config.js  -> baseHref: /OpenDocViewer/
  var baseHref = '/';
  if (abs && abs.pathname) {
    baseHref = abs.pathname.replace(/\/odv\.config\.js(?:\?.*)?$/i, '/');
  } else {
    // Fallback: use the directory of the current location
    baseHref = (w.location.pathname || '/').replace(/[^/]+$/, '/');
  }
  if (!/\/$/.test(baseHref)) baseHref += '/';
  var basePath = baseHref.replace(/\/$/, ''); // without trailing slash, e.g. "/OpenDocViewer"

  // If a previous config exists, allow it to seed a few booleans (ops can inline something before us).
  var existing = w.__ODV_CONFIG__ || {};
  // Optional site-specific overrides (loaded BEFORE this file).
  var siteOverrides = w.__ODV_SITE_CONFIG__ || {};

  // ========================= ACTIVE (mode-less) CONFIG =========================
  var ACTIVE_CONFIG = {
    // UI & diagnostics
    exposeStackTraces: toBool(existing.exposeStackTraces, false),
    showPerfOverlay:   toBool(existing.showPerfOverlay,   false),

    // Where the app is mounted (derived above); useful for building URLs.
    basePath: basePath,    // e.g. "/OpenDocViewer"
    baseHref: baseHref,    // e.g. "/OpenDocViewer/"

    // ---- USER LOG -------------------------------------------------------------
    // Default: ENABLED — proxied via a dedicated IIS app at /ODVProxy/.
    userLog: {
      enabled:  true,
      endpoint: "/ODVProxy/userlog/record", // IIS proxy to http://localhost:3002/userlog/record
      transport: "form",

      // Print dialog UI/validation knobs.
      // The dialog will show inputs only when (userLog.enabled || printHeader.enabled),
      // unless you force visibility with "always"/"never" below.
      ui: {
        showReasonWhen:  "auto",  // "auto" | "always" | "never"
        showForWhomWhen: "auto",  // "auto" | "always" | "never"

        fields: {
          reason: {
            required: true,
            maxLen: 255,
            // regex: null → viewer uses a permissive default that caps to maxLen
            regex: null,          // or e.g. "^([\\s\\S]{0,255})$"
            regexFlags: "",
            placeholder: "Select reason…",
            source: {
              // Inline options (used if no URL is provided)
              options: [
                { value: "Patient copy" },
                { value: "Internal review" },
                { value: "Legal request" },
                // Example of an option that requests additional free text:
                { value: "Other", allowFreeText: true,
                  input: {
                    required: true,
                    maxLen: 140,
                    regex: null,       // or "^([\\s\\S]{0,140})$"
                    regexFlags: "",
                    placeholder: "Type other reason…",
                    prefix: "",        // prepend to the user's text
                    suffix: ""         // append after the user's text
                  }
                }
              ],
              // To load reasons at runtime instead, set a same-origin URL and (optionally) a small cache TTL:
              // url: basePath + "/userlog/reasons.json",
              // cacheTtlSec: 300
            },
            default: null          // e.g., "Patient copy"
          },

          forWhom: {
            required: false,
            maxLen: 120,
            regex: null,           // or "^([\\s\\S]{0,120})$"
            regexFlags: "",
            placeholder: "Who requested this?"
          }
        }
      }
    },

    // ---- PRINT HEADER ---------------------------------------------------------
    // When enabled, a header/footer band is added to printed pages.
    printHeader: {
      enabled: true,             // ENABLED by default
      position: "top",           // "top" | "bottom"
      heightPx: 32,              // reserved space; dialog may warn if too small
      applyTo: "all",            // "all" | "first" | "last"
      // Tokenized template (simple ${...} substitution).
      // Available tokens: date (YYYY-MM-DD), time (HH:MM 24h), now, page, totalPages,
      // reason, forWhom, user.id, user.name, doc.id, doc.title, doc.pageCount, viewer.version
      template:
        "${date} ${time} | ${doc.title||''} | Reason: ${reason||''} | For: ${forWhom||''} | Page ${page}/${totalPages}",
      // Optional CSS injected only for print media; scoping class provided by viewer
      css: [
        ".odv-print-header{ font:12px/1.2 Arial,Helvetica,sans-serif; color:#444; ",
        "  background:rgba(255,255,255,.85); padding:4mm 6mm; }",
        ".odv-print-header strong{ color:#000; }"
      ].join("\n")
    },

    // ---- SYSTEM LOG -----------------------------------------------------------
    // Default: ENABLED — proxied via the IIS app at /ODVProxy/.
    systemLog: {
      enabled:  true,
      endpoint: "/ODVProxy/log",   // IIS proxy to http://localhost:3001/log
      token:    "REPLACE_WITH_SYSTEM_LOG_TOKEN" // paste the token generated by Manage-ODV-LogServers.ps1
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
