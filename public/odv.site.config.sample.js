// File: public/odv.site.config.sample.js
/**
 * OpenDocViewer — Site-specific Overrides (SAMPLE)
 *
 * HOW TO USE
 *   1) Copy this file to the same folder as `odv.config.js` (usually /public).
 *   2) Rename it to:  odv.site.config.js
 *   3) Open /odv-admin.html to edit and download a new override anytime.
 *
 * WHAT THIS DOES
 *   The viewer deep-merges this object into its default config at runtime.
 *   Omit any keys you don't want to override. Arrays and primitive values replace
 *   defaults; objects merge recursively.
 *
 * TIP
 *   Keep this file out of your upgrade payload so site customizations persist.
 */
(function (w) {
  w.__ODV_SITE_CONFIG__ = {
    // ===== UI & diagnostics ====================================================
    // These can help with troubleshooting on specific sites.
    exposeStackTraces: false,
    showPerfOverlay: false,

    // ===== USER LOG (proxied via /ODVProxy/) ==================================
    userLog: {
      enabled: true,
      endpoint: "/ODVProxy/userlog/record",
      transport: "form", // reserved for future transports

      ui: {
        // Show the Reason/For whom fields when (userLog.enabled || printHeader.enabled),
        // unless you force visibility here:
        //   - "auto": show when useful
        //   - "always": always show
        //   - "never": never show
        showReasonWhen:  "auto",
        showForWhomWhen: "auto",

        fields: {
          // ---- Reason field (dropdown or free text) --------------------------
          reason: {
            required: true,
            maxLen: 255,
            regex: null,          // e.g. "^([\\s\\S]{0,255})$"
            regexFlags: "",
            placeholder: "Select reason…",

            // You may provide inline options OR a URL (future).
            // If both are provided, the app will prefer `url`.
            source: {
              options: [
                { value: "Patient copy" },
                { value: "Internal review" },
                { value: "Legal request" },
                {
                  value: "Other",
                  allowFreeText: true,
                  input: {
                    required: true,
                    maxLen: 140,
                    regex: null,       // e.g. "^([\\s\\S]{0,140})$"
                    regexFlags: "",
                    placeholder: "Type other reason…",
                    prefix: "",
                    suffix: ""
                  }
                }
              ]
              // url: "/OpenDocViewer/userlog/reasons.json",
              // cacheTtlSec: 300
            },

            // Default selected reason (must match one of the options' `value` when using options)
            default: null // e.g. "Patient copy"
          },

          // ---- For whom field -------------------------------------------------
          forWhom: {
            required: false,
            maxLen: 120,
            regex: null,           // e.g. "^([\\s\\S]{0,120})$"
            regexFlags: "",
            placeholder: "Who requested this?"
          }
        }
      }
    },

    // ===== PRINT HEADER (non-optional when enabled) ============================
    printHeader: {
      enabled: true,           // show header overlay in print preview/print
      position: "top",         // "top" | "bottom"
      heightPx: 32,            // informational only (admins can style via CSS)
      applyTo: "all",          // "all" | "first" | "last"

      // Tokens:
      //   ${date} (YYYY-MM-DD), ${time} (HH:MM 24h), ${now}, ${page}, ${totalPages},
      //   ${reason}, ${forWhom}, ${user.id}, ${user.name}, ${doc.id}, ${doc.title}, ${doc.pageCount}, ${viewer.version}
      template: "${date} ${time} | ${doc.title||''} | Reason: ${reason||''} | For: ${forWhom||''} | Page ${page}/${totalPages}",

      // Print-only CSS scoped to `.odv-print-header`
      css: [
        ".odv-print-header{ font:12px/1.2 Arial,Helvetica,sans-serif; color:#444;",
        "  background:rgba(255,255,255,.85); padding:4mm 6mm; }",
        ".odv-print-header strong{ color:#000; }"
      ].join("\n")
    },

    // ===== SYSTEM LOG (proxied via /ODVProxy/) ================================
    systemLog: {
      enabled: true,
      endpoint: "/ODVProxy/log",
      token: "REPLACE_WITH_SYSTEM_LOG_TOKEN" // paste the generated token
    }
  };
})(window);
