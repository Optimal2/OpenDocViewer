// File: src/app/bootConfig.js
/**
 * Runtime boot loader that resolves configuration scripts before React starts.
 *
 * High-level flow:
 * - derive the application base path from the current URL
 * - probe and load optional `odv.site.config.js`
 * - probe and load required `odv.config.js`
 * - import `src/index.jsx` only after the runtime configuration surface is available
 *
 * The fetch probe is deliberate: it avoids executing an SPA fallback HTML page or a resource with
 * the wrong MIME type as if it were JavaScript.
 */

/** Return the application base path (always with a trailing slash) derived from the current page URL. */
function getAppBase() {
  try {
    const u = new URL(document.baseURI || window.location.href);
    let p = u.pathname || '/';
    if (!p.endsWith('/')) p = p.replace(/[^/]+$/, '');
    return p;
  } catch {
    const p = window.location.pathname || '/';
    return p.endsWith('/') ? p : p.replace(/[^/]+$/, '/');
  }
}

/** Heuristic: does a content-type look like JavaScript? */
function isJsContentType(ct) {
  if (!ct || typeof ct !== 'string') return false;
  ct = ct.toLowerCase();
  return (
    ct.includes('application/javascript') ||
    ct.includes('text/javascript') ||
    ct.includes('application/ecmascript') ||
    ct.includes('text/ecmascript') ||
    ct.includes('application/x-javascript')
  );
}

/** Probe a candidate script URL and only accept it when the response looks like JavaScript. */
async function probeScriptUrl(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (r.ok && isJsContentType(r.headers.get('content-type'))) return { ok: true, url };
    if (r.ok) return { ok: false, url }; // 200 but wrong type (likely HTML SPA)
  } catch { /* fall through to GET */ }
  try {
    const r = await fetch(url, { method: 'GET', cache: 'no-store' });
    if (r.ok && isJsContentType(r.headers.get('content-type'))) return { ok: true, url };
    return { ok: false, url };
  } catch {
    return { ok: false, url };
  }
}

/** Load a classic script and resolve when it executes (or errors). */
function loadClassicScript(src) {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;  // preserve order
    s.defer = false;  // execute ASAP after insertion
    s.onload = () => resolve({ ok: true, src });
    s.onerror = () => resolve({ ok: false, src });
    document.head.appendChild(s);
  });
}

/** Try multiple candidate URLs (in order) until one probes as JS, then load it. */
async function loadFromCandidates(name, candidates, { optional = false } = {}) {
  for (const url of candidates) {
    const probe = await probeScriptUrl(url);
    if (probe.ok) {
      const res = await loadClassicScript(url);
      if (res.ok) return { ok: true, url };
      // If injecting failed, try next candidate
    }
  }
  if (!optional) console.error('[ODV] Failed to load', name, 'from any of:', candidates);
  return { ok: !!optional, url: null };
}

(async function boot() {
  const base = getAppBase(); // e.g., "/OpenDocViewer/" in IIS, or "/" in dev
  const bust = () => Date.now();

  // 1) Optional site overrides — ONLY try from app base (no root fallback → no 404 noise).
  await loadFromCandidates(
    'odv.site.config.js',
    [ base + 'odv.site.config.js?_=' + bust() ],
    { optional: true }
  );

  // 2) Required default config — try app base, then site root (dev).
  const mainCfg = await loadFromCandidates(
    'odv.config.js',
    [ base + 'odv.config.js?_=' + bust(), '/odv.config.js?_=' + bust() ],
    { optional: false }
  );
  if (!mainCfg.ok) return; // cannot run without defaults

  // 3) Start the React application only after runtime configuration has been loaded.
  await import('/src/index.jsx');
})();
