// File: src/utils/olderConfigNameWarnings.js
/**
 * Console warnings for the older configuration names that still take precedence over the
 * documented key.
 *
 * Three readers let an older name win over the key the documentation describes
 * (`src/logging/systemLogger.js`, the PDF orientation readers and
 * `src/utils/pdfPrintCacheKey.js`). That precedence is kept as it is in this version and will
 * be turned around in a later major version. Until then the person who administers the site
 * is told, once per page load and per older name, which name to replace and with what.
 *
 * The shipped defaults in `public/odv.config.js` contain none of these names, so a name found
 * in the runtime configuration always comes from the site. A warning names keys only and never
 * a value: `logToken` is a secret.
 */

/**
 * @typedef {Object} OlderConfigName
 * @property {string} older Name as written in the site configuration.
 * @property {string} documented The documented key (or keys) to use instead.
 */

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Each entry answers whether its older name is set to a value that the reader accepts, which
 * is exactly when the older name decides the result. The conditions mirror the readers.
 * @type {Array<{older:string, documented:string, inUse:function(Object, Object): boolean}>}
 */
const OLDER_NAMES = [
  // src/logging/systemLogger.js: a top-level value of the right type is used before systemLog.*.
  { older: 'logEndpoint', documented: 'systemLog.endpoint', inUse: (cfg) => typeof cfg.logEndpoint === 'string' },
  { older: 'logToken', documented: 'systemLog.token', inUse: (cfg) => typeof cfg.logToken === 'string' },
  { older: 'logEnabled', documented: 'systemLog.enabled', inUse: (cfg) => typeof cfg.logEnabled === 'boolean' },
  // usePrintRangeConfig.js, pdfPrebuildPlan.js, printPdf.js and pdfWorker.js: a non-empty mode
  // is used before orientation.defaultAuto / orientation.fixedMode.
  {
    older: 'print.pdf.orientation.mode',
    documented: 'print.pdf.orientation.defaultAuto and print.pdf.orientation.fixedMode',
    inUse: (_cfg, pdf) => isObject(pdf.orientation) && Boolean(pdf.orientation.mode),
  },
  {
    older: 'print.pdf.orientationMode',
    documented: 'print.pdf.orientation.defaultAuto and print.pdf.orientation.fixedMode',
    inUse: (_cfg, pdf) => Boolean(pdf.orientationMode),
  },
  // src/utils/pdfPrintCacheKey.js: `languageMode ?? cacheLanguageMode` at the top level is used
  // before print.pdf.cacheLanguageMode whenever the result is not undefined.
  {
    older: 'languageMode',
    documented: 'print.pdf.cacheLanguageMode',
    inUse: (cfg) => cfg.languageMode !== undefined && cfg.languageMode !== null,
  },
  {
    older: 'cacheLanguageMode',
    documented: 'print.pdf.cacheLanguageMode',
    inUse: (cfg) => cfg.cacheLanguageMode !== undefined,
  },
];

/**
 * The older names that are in use in a runtime configuration.
 * @param {*} runtimeConfig
 * @returns {Array<OlderConfigName>}
 */
export function findOlderConfigNamesInUse(runtimeConfig) {
  // The configuration object is host-owned: a getter or a Proxy in it can throw on any access.
  // Nothing here may let such an error out, because this runs before the viewer is mounted.
  const found = [];
  try {
    if (!isObject(runtimeConfig)) return [];
    let pdf = {};
    try {
      const print = runtimeConfig.print;
      const candidate = isObject(print) ? print.pdf : undefined;
      if (isObject(candidate)) pdf = candidate;
    } catch {
      pdf = {};
    }
    for (const entry of OLDER_NAMES) {
      let inUse;
      try {
        inUse = entry.inUse(runtimeConfig, pdf);
      } catch {
        // A value that cannot be read is not worth a warning.
        inUse = false;
      }
      if (inUse) found.push({ older: entry.older, documented: entry.documented });
    }
  } catch {
    return [];
  }
  return found;
}

/**
 * @param {OlderConfigName} name
 * @returns {string}
 */
export function formatOlderConfigNameWarning(name) {
  return `[ODV] Site config uses the older name "${name.older}". Use "${name.documented}" instead. `
    + 'The older name still takes precedence in this version; a later major version will let the documented key win.';
}

/** Older names already reported during this page load. */
const reported = new Set();

/**
 * Warn in the browser console about each older name in use, once per page load and per name.
 * Does nothing outside a window (a worker never warns, so nothing is reported twice).
 * @param {*} runtimeConfig
 * @param {function(string): void} [warn]
 * @returns {Array<OlderConfigName>} The names reported by this call.
 */
export function warnAboutOlderConfigNames(runtimeConfig, warn) {
  if (typeof window === 'undefined') return [];
  const fresh = [];
  // Whatever goes wrong in here, the warning must never stop the viewer from starting.
  try {
    const write = typeof warn === 'function' ? warn : (message) => console.warn(message);
    for (const name of findOlderConfigNamesInUse(runtimeConfig)) {
      if (reported.has(name.older)) continue;
      reported.add(name.older);
      fresh.push(name);
      try {
        write(formatOlderConfigNameWarning(name));
      } catch {
        // A console that throws is not a reason to fail.
      }
    }
  } catch {
    // Deliberately silent.
  }
  return fresh;
}

/** For tests: forget what has been reported, as a new page load would. */
export function resetOlderConfigNameWarnings() {
  reported.clear();
}
