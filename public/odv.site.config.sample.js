// File: public/odv.site.config.sample.js
/**
 * OpenDocViewer — Site-specific Overrides (SAMPLE)
 *
 * HOW TO USE
 *   1) Copy this file to the same folder as `odv.config.js` (usually /public).
 *   2) Rename it to:  odv.site.config.js
 *
 * LOCALIZED VALUES:
 *   Any user-facing string may be a plain string OR a LocalizedString map:
 *     { en: "Select reason…", sv: "Välj orsak…" }
 * Keep `value` as a stable id; use optional `label` for localized display.
 */
(function (w) {
  w.__ODV_SITE_CONFIG__ = {
    // ===== UI & diagnostics ====================================================
    exposeStackTraces: false,
    showPerfOverlay: false,

    // ===== USER LOG (proxied via /ODVProxy/) ==================================
    userLog: {
      enabled: true,
      endpoint: "/ODVProxy/userlog/record",
      transport: "form",

      ui: {
        // "auto": show when (userLog.enabled || printHeader.enabled),
        // "always": force show, "never": force hide
        showReasonWhen:  "auto",
        showForWhomWhen: "auto",

        fields: {
          // ---- Reason field (dropdown with optional extra) -------------------
          reason: {
            required: true,
            maxLen: 255,
            regex: null,
            regexFlags: "",
            // Localized placeholder (EN + SV)
            placeholder: { en: "Select reason…", sv: "Välj orsak…" },

            // Inline options. Keep `value` as the stable id used for logging.
            source: {
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
                    // Localized affixes for the free-text part appended to the value
                    placeholder: { en: "Type other reason…", sv: "Ange annan orsak…" },
                    prefix:      { en: "Other: ",            sv: "Annan: " },
                    suffix:      { en: " (specify)",         sv: " (ange)" }
                  }
                }
              ]
              // You may alternatively load reasons from a URL:
              // ,url: "/OpenDocViewer/userlog/reasons.json"
              // ,cacheTtlSec: 300
            },

            // Default selected reason by stable id (matches an option `value`)
            default: null
          },

          // ---- For whom field -------------------------------------------------
          forWhom: {
            required: false,
            maxLen: 120,
            regex: null,
            regexFlags: "",
            placeholder: { en: "Who requested this?", sv: "Vem begärde detta?" }
          }
        }
      }
    },

    // ===== PRINT HEADER (non-optional when enabled) ============================
    printHeader: {
      enabled: true,
      position: "top",
      heightPx: 32,
      applyTo: "all",
      // Localized template with tokens described in the default config
      template: {
        en: "${date} ${time} | ${doc.title||''} | Reason: ${reason||''} | For: ${forWhom||''} | Page ${page}/${totalPages}",
        sv: "${date} ${time} | ${doc.title||''} | Orsak: ${reason||''} | För: ${forWhom||''} | Sida ${page}/${totalPages}"
      },
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
      token: "REPLACE_WITH_SYSTEM_LOG_TOKEN"
    }
  };
})(window);
