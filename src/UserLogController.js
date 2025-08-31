/**
 * UserLogController — client-side controller for **user** print logs (backend-agnostic).
 *
 * RUNTIME CONFIG (public/odv.config.js)
 *   window.__ODV_GET_CONFIG__?.() or window.__ODV_CONFIG__ exposes:
 *     userLog: {
 *       enabled: boolean,
 *       endpoint: string,        // absolute or app-root-relative
 *       transport?: 'json'|'form'// optional; 'form' → x-www-form-urlencoded(reason, forWhom)
 *     }
 *
 * REQUIREMENTS
 *   - Must not block printing. Use sendBeacon when possible (same-origin),
 *     otherwise fall back to fetch({ keepalive:true, credentials:'include' }) with a short abort.
 *   - Always send cookies/session when using fetch (credentials:'include').
 *   - No secrets/tokens added by this client; rely on site cookies/session.
 *   - Be backend-agnostic: if enabled & endpoint exists → POST.
 *
 * USAGE
 *   import userLog from './UserLogController.js';
 *   userLog.setViewerVersion(__APP_VERSION__); // optional build-time inject
 *   userLog.setUserResolver(function() { return { id: 'u1', name: 'Alice' }; }); // optional
 *   await userLog.initContext({ sessionId: 'sess-123', iframeId: 'iframeHolder' }); // optional
 *   userLog.submitPrint({
 *     docId, fileName, pageCount, pages, copies,
 *     reason, forWhom
 *   }); // fire-and-forget
 */

/**
 * @typedef {Object} UserIdentity
 * @property {?string} [id]
 * @property {?string} [name]
 */

/**
 * @typedef {Object} BootContext
 * @property {?string} [sessionId]
 * @property {?string} [iframeId]
 */

/**
 * @typedef {Object} PrintLogPayload
 * @property {string}  [action]     Name of action, e.g., "print".
 * @property {?string} [reason]
 * @property {?string} [forWhom]
 * @property {?string} [docId]
 * @property {?string} [fileName]
 * @property {?number} [pageCount]
 * @property {?string} [pages]
 * @property {?number} [copies]
 * @property {?string} [ts]         ISO timestamp
 */

/** True when running in dev (for debug logging only). */
const __DEV__ = (() => { try { return !!(import.meta && import.meta.env && import.meta.env.DEV); } catch { return false; } })();

/** Dev-only logger. */
function debug(msg, extra) {
  if (!__DEV__) return;
  try {
    if (extra !== undefined) console.debug('[ODV userLog] ' + msg, extra);
    else console.debug('[ODV userLog] ' + msg);
  } catch {}
}

/** Safely read runtime config from window. */
function getRuntimeConfig() {
  try {
    if (typeof window !== 'undefined') {
      if (typeof window.__ODV_GET_CONFIG__ === 'function') return window.__ODV_GET_CONFIG__() || {};
      if (window.__ODV_CONFIG__) return window.__ODV_CONFIG__ || {};
    }
  } catch {}
  return {};
}

/** Make absolute using document.baseURI when available. */
function toAbsoluteUrl(url) {
  if (!url) return '';
  try {
    const base = (typeof document !== 'undefined' && document.baseURI) ? document.baseURI : 'http://localhost/';
    return new URL(String(url), base).toString();
  } catch { return ''; }
}

/** Determine if the target URL is same-origin with current document. */
function isSameOrigin(absUrl) {
  try {
    const u = new URL(absUrl);
    const l = new URL((typeof document !== 'undefined' && document.baseURI) ? document.baseURI : window.location.href);
    return u.protocol === l.protocol && u.host === l.host;
  } catch { return true; } // be permissive: treat unknown as same-origin to allow beacon
}

/** Return timezone offset as "+HH:MM" or "-HH:MM". */
function tzOffset() {
  const m = -new Date().getTimezoneOffset();
  const s = m >= 0 ? '+' : '-';
  const a = Math.abs(m);
  const hh = String(Math.floor(a / 60)).padStart(2, '0');
  const mm = String(a % 60).padStart(2, '0');
  return s + hh + ':' + mm;
}

/** Base64 from ArrayBuffer (for cookie fingerprint). */
function abToBase64(buf) {
  try {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  } catch { return ''; }
}

/** Async SHA-256 of a string → "sha256-<base64>" (or null). */
async function sha256Base64(s) {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;
    const enc = new TextEncoder();
    const digest = await crypto.subtle.digest('SHA-256', enc.encode(String(s)));
    return 'sha256-' + abToBase64(digest);
  } catch { return null; }
}

class UserLogController {
  constructor() {
    /** @private */ this.viewerVersion = null;
    /** @private */ this.identityResolver = null; // function(): UserIdentity|null
    /** @private */ this.context = { sessionId: null, iframeId: null, createdAt: null, cookieFingerprint: null };
    // Opportunistic capture; do not block startup.
    this._captureCookieFingerprint();
  }

  /**
   * Optional identity resolver supplied by host app.
   * @param {function(): (UserIdentity|null|undefined)} fn
   */
  setUserResolver(fn) {
    if (typeof fn === 'function') this.identityResolver = fn;
  }

  /**
   * Optional viewer version to add in meta.viewerVersion.
   * @param {string|null|undefined} v
   */
  setViewerVersion(v) {
    this.viewerVersion = v != null ? String(v) : null;
  }

  /**
   * Initialize context near iframe/viewer creation.
   * Captures sessionId/iframeId and first-seen timestamp. Cookie hash captured once.
   * @param {BootContext} ctx
   * @returns {Promise<void>}
   */
  async initContext(ctx = {}) {
    if (!this.context.createdAt) this.context.createdAt = new Date().toISOString();
    if (ctx.sessionId != null) this.context.sessionId = String(ctx.sessionId || '');
    if (ctx.iframeId != null) this.context.iframeId = String(ctx.iframeId || '');
    if (!this.context.cookieFingerprint) await this._captureCookieFingerprint();
  }

  /** Internal: hash document.cookie once (non-blocking). */
  async _captureCookieFingerprint() {
    try {
      const cookie = (typeof document !== 'undefined' && typeof document.cookie === 'string') ? document.cookie : '';
      if (!cookie) return;
      const fp = await sha256Base64(cookie);
      if (fp) this.context.cookieFingerprint = fp;
      debug('cookie fingerprint captured');
    } catch {}
  }

  /**
   * Submit a "print" user-log event. **Fire-and-forget**; never block UI.
   * Transport:
   *   - when cfg.userLog.transport === 'form' (or endpoint contains 'DocumentView/LogPrint'):
   *       → x-www-form-urlencoded with only reason & forWhom (compat with legacy external app)
   *   - otherwise → JSON envelope (rich event)
   * Credentials:
   *   - fetch fallback always uses { credentials:'include' } to reuse site session/cookies.
   *   - sendBeacon is only used for same-origin URLs (browsers attach cookies automatically).
   * @param {PrintLogPayload} payload
   */
  submitPrint(payload = {}) {
    try {
      const cfg = getRuntimeConfig();
      const ul = (cfg && cfg.userLog) ? cfg.userLog : null;
      if (!ul || ul.enabled !== true || !ul.endpoint) { debug('userLog disabled or missing endpoint'); return; }

      const absUrl = toAbsoluteUrl(ul.endpoint);
      if (!absUrl) { debug('invalid endpoint'); return; }

      const useForm = (ul.transport === 'form') || /DocumentView\/LogPrint/i.test(absUrl);

      if (useForm) {
        // Compatibility path: only send reason & forWhom
        const params = new URLSearchParams();
        if (payload.reason != null)  params.set('reason',  String(payload.reason));
        if (payload.forWhom != null) params.set('forWhom', String(payload.forWhom));

        // Prefer beacon if same-origin; else fetch with credentials
        if (isSameOrigin(absUrl) && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
          try {
            const blob = new Blob([params.toString()], { type: 'application/x-www-form-urlencoded; charset=UTF-8' });
            const ok = navigator.sendBeacon(absUrl, blob);
            debug('sendBeacon(form) sent', { ok });
            return;
          } catch { /* fall through */ }
        }

        let ac = null; let timer = null;
        try { ac = typeof AbortController !== 'undefined' ? new AbortController() : null; } catch {}
        try { if (ac) timer = setTimeout(() => { try { ac.abort(); } catch {} }, 4000); } catch {}

        try {
          fetch(absUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: params.toString(),
            credentials: 'include',
            // @ts-ignore
            keepalive: true,
            signal: ac ? ac.signal : undefined
          }).then(() => debug('fetch(form) sent'))
            .catch(() => debug('fetch(form) failed (silent)'))
            .finally(() => { if (timer) try { clearTimeout(timer); } catch {} });
        } catch {}
        return;
      }

      // JSON envelope
      const nowIso = payload.ts || new Date().toISOString();
      const identity = (typeof this.identityResolver === 'function') ? (this.identityResolver() || null) : null;

      const bodyObj = {
        event:  { name: 'print', ts: nowIso },
        doc:    {
          id: payload.docId ?? null,
          title: payload.fileName ?? null,
          pageCount: (typeof payload.pageCount === 'number' ? payload.pageCount : (payload.pageCount ?? null))
        },
        user:   { id: identity?.id ?? null, name: identity?.name ?? null },
        client: {
          userAgent: (typeof navigator !== 'undefined') ? (navigator.userAgent || '') : '',
          language:  (typeof navigator !== 'undefined') ? (navigator.language || '') : '',
          timezone:  tzOffset()
        },
        meta:   {
          reason: payload.reason ?? null,
          forWhom: payload.forWhom ?? null,
          viewerVersion: this.viewerVersion ?? null,
          pages: payload.pages ?? null,
          copies: (typeof payload.copies === 'number') ? payload.copies : (payload.copies ?? null)
        },
        session: {
          id: this.context.sessionId ?? null,
          iframeId: this.context.iframeId ?? null,
          createdAt: this.context.createdAt ?? null,
          cookieFingerprint: this.context.cookieFingerprint ?? null
        }
      };

      const bodyJson = JSON.stringify(bodyObj);

      // Prefer beacon if same-origin; else fetch with credentials
      if (isSameOrigin(absUrl) && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        try {
          const ok = navigator.sendBeacon(absUrl, new Blob([bodyJson], { type: 'application/json' }));
          debug('sendBeacon(json) sent', { ok });
          return;
        } catch { /* fall through */ }
      }

      let ac = null; let timer = null;
      try { ac = typeof AbortController !== 'undefined' ? new AbortController() : null; } catch {}
      try { if (ac) timer = setTimeout(() => { try { ac.abort(); } catch {} }, 4000); } catch {}

      try {
        fetch(absUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyJson,
          credentials: 'include',
          // @ts-ignore
          keepalive: true,
          signal: ac ? ac.signal : undefined
        }).then(() => debug('fetch(json) sent'))
          .catch(() => debug('fetch(json) failed (silent)'))
          .finally(() => { if (timer) try { clearTimeout(timer); } catch {} });
      } catch {}

    } catch {
      // swallow — logging must never break printing
    }
  }
}

/** Export singleton instance. */
const userLog = new UserLogController();
export default userLog;
