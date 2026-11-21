// File: src/utils/pdfLayout.js
/** Normalize a non-negative PDF layout setting without treating numeric zero as missing. */
export function normalizePdfLayoutValue(value, fallback) {
  if (value === 0) return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric !== 0 ? Math.max(0, numeric) : fallback;
}
