// File: src/utils/manualEnabled.js
/**
 * The single switch that turns the user manual off for an installation.
 *
 * Runtime config `help.manual.enabled` (boolean). Absent, or any value other than the boolean
 * `false`, means enabled, so deployments that never set the key keep the manual exactly as before.
 * The stand-alone manual page reads it through this helper; a config object whose getters throw
 * is treated as enabled as well, for the same reason.
 */

/**
 * @param {(Object|null|undefined)} config Runtime configuration (e.g. `getRuntimeConfig()`).
 * @returns {boolean} False only when `config.help.manual.enabled` is exactly `false`.
 */
export function isManualEnabled(config) {
  try {
    return config?.help?.manual?.enabled !== false;
  } catch {
    return true;
  }
}

export default isManualEnabled;
