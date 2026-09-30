// File: src/components/DocumentToolbar/printFieldLabels.js
/**
 * File: src/components/DocumentToolbar/printFieldLabels.js
 *
 * Visible label for an optional/required print-dialog field. The locale carries two keys per
 * field: `label` (the bare name, shown with an asterisk when the site makes the field required)
 * and `optionalLabel` (the name with an "optional" marker, shown when the field is optional).
 * The marker therefore follows the site config instead of being fixed in the locale text.
 */

/**
 * @param {function(string, Object=): string} t i18next translate function
 * @param {string} baseKey locale key prefix, e.g. 'printDialog.forWhom'
 * @param {boolean} required whether the site config makes the field required
 * @returns {string}
 */
export function resolvePrintFieldLabel(t, baseKey, required) {
  const label = t(`${baseKey}.label`);
  if (required) return label;
  return t(`${baseKey}.optionalLabel`, { defaultValue: label });
}
