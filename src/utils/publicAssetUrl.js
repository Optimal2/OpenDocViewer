// File: src/utils/publicAssetUrl.js
/**
 * Resolve a public asset path against the viewer base URL.
 *
 * This keeps asset references stable when the app is served from a sub-path and avoids sprinkling
 * hard-coded relative URLs like `lost.png` throughout the codebase.
 */

/**
 * @param {(string|null|undefined)} assetPath
 * @returns {string}
 */
export function getPublicAssetUrl(assetPath) {
  const file = String(assetPath || '').trim().replace(/^\/+/, '');
  if (!file) return '';

  const runtimeBase =
    (typeof window !== 'undefined' && window.__ODV_CONFIG__ && window.__ODV_CONFIG__.baseHref)
    || (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL)
    || '/';

  const base = String(runtimeBase || '/').replace(/\/+$/, '/');
  return `${base}${file}`;
}

export default {
  getPublicAssetUrl,
};
