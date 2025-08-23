// File: src/integration/urlParams.js

function pick(q, keys) {
  for (const k of keys) {
    const v = q.get(k);
    if (v != null && v !== '') return v;
  }
  return null;
}

/**
 * Reads common query params used by your current demo and other hosts.
 * Returns: { source:'url-params', data:{ folder, extension, endNumber } } or null
 */
export function readFromUrlParams() {
  const q = new URLSearchParams(window.location.search);
  const folder = pick(q, ['folder', 'path']);
  const extension = pick(q, ['extension', 'ext', 'type']);
  const endRaw = pick(q, ['endNumber', 'pages', 'total', 'end']);
  const endNumber = endRaw ? Number(endRaw) : null;

  if (folder && extension && Number.isFinite(endNumber) && endNumber > 0) {
    return { source: 'url-params', data: { folder, extension, endNumber } };
  }
  return null;
}
