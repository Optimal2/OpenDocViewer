// File: src/utils/printWatermark.js
/**
 * OpenDocViewer — Print watermark mode helpers.
 *
 * Watermark mode is shared by the HTML print iframe and the generated-PDF backend so both print
 * paths use the same COPY/KOPIA/custom decision.
 */

/**
 * @param {*} i18n
 * @returns {string}
 */
function currentLanguage(i18n) {
  return String(i18n?.resolvedLanguage || i18n?.language || '').toLowerCase();
}

/**
 * @param {string} src
 * @returns {string}
 */
function toAbsoluteUrl(src) {
  const text = String(src || '').trim();
  if (!text) return '';
  try {
    const base = typeof document !== 'undefined'
      ? (document.baseURI || window.location?.href || '')
      : (typeof window !== 'undefined' ? window.location?.href || '' : '');
    return new URL(text, base || undefined).href;
  } catch {
    return '';
  }
}

/**
 * @param {*} mode
 * @returns {'auto'|'copy'|'kopia'|'custom'}
 */
export function normalizeWatermarkMode(mode) {
  const value = String(mode || 'custom').trim().toLowerCase();
  if (value === 'copy') return 'copy';
  if (value === 'kopia') return 'kopia';
  if (value === 'auto') return 'auto';
  return 'custom';
}

/**
 * @param {*} watermarkCfg
 * @param {*} i18n
 * @returns {'copy'|'kopia'|'custom'}
 */
export function resolveWatermarkMode(watermarkCfg, i18n) {
  const mode = normalizeWatermarkMode(watermarkCfg?.mode);
  if (mode === 'auto') return currentLanguage(i18n).startsWith('sv') ? 'kopia' : 'copy';
  return mode;
}

/**
 * Resolve the image asset for COPY/KOPIA watermark modes.
 * Custom mode intentionally returns an empty string so callers render text from configuration.
 * @param {*} watermarkCfg
 * @param {*} i18n
 * @returns {string}
 */
export function resolveWatermarkAssetSrc(watermarkCfg, i18n) {
  const mode = resolveWatermarkMode(watermarkCfg || {}, i18n);
  if (mode === 'custom') return '';

  const assets = watermarkCfg?.assets || watermarkCfg?.assetUrls || {};
  const raw = mode === 'kopia'
    ? (assets.kopia || assets.KOPIA || assets.sv || assets.copy)
    : (assets.copy || assets.COPY || assets.en || assets.kopia);
  return toAbsoluteUrl(raw);
}

export default {
  normalizeWatermarkMode,
  resolveWatermarkMode,
  resolveWatermarkAssetSrc,
};
