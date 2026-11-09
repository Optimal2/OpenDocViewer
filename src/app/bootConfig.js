// File: src/app/bootConfig.js
/**
 * Runtime boot loader that resolves configuration scripts before React starts.
 *
 * High-level flow:
 * - derive the application base path from the current URL (or from the page's `odv-app-base`
 *   meta tag, used by the stand-alone manual page one folder below the base)
 * - probe and load optional `odv.site.config.js`
 * - probe and load required `odv.config.js`
 * - import `src/index.jsx` only after the runtime configuration surface is available
 *
 * The fetch probe is deliberate: it avoids executing an SPA fallback HTML page or a resource with
 * the wrong MIME type as if it were JavaScript.
 */

/**
 * Read a `<meta name="..." content="...">` value from the page. Pages other than the viewer's own
 * index.html (the stand-alone manual under `manual/`) declare where the ODV base is and which entry
 * to start this way; `<meta>` tags survive the Vite build unchanged, unlike script attributes.
 */
function getPageMeta(name) {
  try {
    const value = document.querySelector(`meta[name="${name}"]`)?.getAttribute('content');
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
}

/**
 * Return the application base path (always with a trailing slash) derived from the current page URL.
 * A page in a subfolder sets `<meta name="odv-app-base" content="../">` so the runtime configuration
 * is loaded from the ODV base (one level up), exactly as the viewer loads it.
 */
function getAppBase() {
  const relativeBase = getPageMeta('odv-app-base');
  if (relativeBase) {
    try {
      const p = new URL(relativeBase, document.baseURI || window.location.href).pathname || '/';
      return p.endsWith('/') ? p : p + '/';
    } catch { /* fall back to the page's own folder */ }
  }
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
    if (r.ok) return { ok: false, url, reason: 'wrong-content-type' };
  } catch { /* fall through to GET */ }
  try {
    const r = await fetch(url, { method: 'GET', cache: 'no-store' });
    if (r.ok && isJsContentType(r.headers.get('content-type'))) return { ok: true, url };
    return { ok: false, url, reason: r.ok ? 'wrong-content-type' : 'not-found' };
  } catch {
    return { ok: false, url, reason: 'not-found' };
  }
}

/** Load a classic script and resolve when it executes (or errors). */
function loadClassicScript(src, { nonce = '', integrity = '' } = {}) {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;  // preserve order
    s.defer = false;  // execute ASAP after insertion
    if (nonce) s.nonce = nonce;
    if (integrity) s.integrity = integrity;
    let executionFailed = false;
    const onExecutionError = (event) => {
      if (event.filename === s.src) executionFailed = true;
    };
    const finish = (ok) => {
      window.removeEventListener('error', onExecutionError);
      resolve({ ok, src });
    };
    window.addEventListener('error', onExecutionError);
    s.onload = () => finish(!executionFailed);
    s.onerror = () => finish(false);
    document.head.appendChild(s);
  });
}

function getBootstrapScriptElement() {
  try {
    return document.querySelector('script[data-odv-bootstrap]');
  } catch {
    return null;
  }
}

function getBootstrapScriptNonce() {
  try {
    const script = getBootstrapScriptElement();
    return typeof script?.nonce === 'string' ? script.nonce : '';
  } catch {
    return '';
  }
}

function getBootstrapScriptIntegrityValue(name) {
  try {
    const script = getBootstrapScriptElement();
    const value = script?.dataset?.[name];
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
}

/** Try multiple candidate URLs (in order) until one probes as JS, then load it. */
async function loadFromCandidates(name, candidates, { optional = false, nonce = '', integrity = '' } = {}) {
  for (const url of candidates) {
    const isSite = name === 'odv.site.config.js';
    const status = { attempted: true, url, loaded: false, reason: 'not-found' };
    if (isSite) window.__ODV_SITE_CONFIG_STATUS__ = status;
    const probe = await probeScriptUrl(url);
    status.reason = probe.reason || 'not-found';
    if (probe.ok) {
      const res = await loadClassicScript(url, { nonce, integrity });
      status.loaded = res.ok;
      status.reason = res.ok ? 'ok' : 'script-error-or-integrity';
      if (res.ok) return { ok: true, url };
      // If injecting failed, try next candidate
    }
    if (isSite && status.reason !== 'not-found') {
      console.warn(`[ODV] Site config not loaded: ${status.reason}`, url);
    }
    if (isSite && !status.loaded) delete window.__ODV_SITE_CONFIG__;
  }
  if (!optional) console.error('[ODV] Failed to load', name, 'from any of:', candidates);
  return { ok: !!optional, url: null };
}

(async function boot() {
  const base = getAppBase(); // e.g., "/OpenDocViewer/" in IIS, or "/" in dev
  const bust = () => Date.now();
  const nonce = getBootstrapScriptNonce();
  const siteConfigIntegrity = getBootstrapScriptIntegrityValue('odvSiteConfigIntegrity');
  const defaultConfigIntegrity = getBootstrapScriptIntegrityValue('odvConfigIntegrity');

  // 1) Optional site overrides — ONLY try from app base (no root fallback → no 404 noise).
  await loadFromCandidates(
    'odv.site.config.js',
    [ base + 'odv.site.config.js?_=' + bust() ],
    { optional: true, nonce, integrity: siteConfigIntegrity }
  );

  // 2) Required default config — try app base, then site root (dev).
  const mainCfg = await loadFromCandidates(
    'odv.config.js',
    [ base + 'odv.config.js?_=' + bust(), '/odv.config.js?_=' + bust() ],
    { optional: false, nonce, integrity: defaultConfigIntegrity }
  );
  if (!mainCfg.ok) return; // cannot run without defaults

  // 3) Start the React application only after runtime configuration has been loaded. The
  //    stand-alone manual page (manual/index.html, `<meta name="odv-page" content="manual">`)
  //    starts its own small entry instead of the viewer; both are lazy chunks of this module.
  if (getPageMeta('odv-page') === 'manual') {
    await import('/src/manual-page/main.jsx');
    return;
  }
  await import('/src/index.jsx');
})();
