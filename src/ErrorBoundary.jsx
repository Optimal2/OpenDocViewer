// File: src/ErrorBoundary.jsx
/**
 * File: src/ErrorBoundary.jsx
 *
 * OpenDocViewer — React Error Boundary
 *
 * PURPOSE
 *   - Catch unexpected render/runtime errors in descendant components.
 *   - Prevent the entire app from unmounting when a component crashes.
 *   - Show a safe, user-friendly fallback by default and optionally reveal
 *     stack traces for diagnostics based on runtime configuration.
 *
 * RUNTIME TOGGLE (ops-friendly; no rebuild required)
 *   - exposeStackTraces (boolean):
 *       * Source of truth is public/odv.config.js via window.__ODV_CONFIG__ (or __ODV_GET_CONFIG__).
 *       * You may also set <meta name="odv-exposeStackTraces" content="true|false"> in index.html.
 *       * In development builds, detailed stacks are always shown.
 *
 * IMPORTANT PROJECT NOTE (gotcha):
 *   - Elsewhere in the app we import from the **root** 'file-type' package, not 'file-type/browser'.
 *     With file-type v21 the '/browser' subpath is not exported and will break Vite builds.
 *     See README “Design notes & gotchas” before changing this.
 *
 * Provenance for this baseline (traceability): :contentReference[oaicite:0]{index=0}
 */

import React from 'react';
import i18next from 'i18next';
import logger from './LogController';

/**
 * Determine whether we are in development mode.
 * Vite injects import.meta.env.MODE; we also check NODE_ENV for safety.
 */
const IS_DEV =
  (typeof import.meta !== 'undefined' && import.meta?.env?.MODE === 'development') ||
  (typeof process !== 'undefined' && process?.env?.NODE_ENV === 'development');

/**
 * Tiny helper to translate with safe fallback (NS: 'common').
 * @param {string} key
 * @param {string} defaultValue
 * @param {Object=} options
 * @returns {string}
 */
function tr(key, defaultValue, options) {
  try {
    return i18next.t(key, { ns: 'common', defaultValue, ...(options || {}) });
  } catch {
    return defaultValue;
  }
}

/**
 * Coerce unknown values to boolean using common string/number forms.
 * @param {*} v
 * @param {boolean} fallback
 * @returns {boolean}
 */
function toBool(v, fallback) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
  }
  if (typeof v === 'number') return v !== 0;
  return fallback;
}

/**
 * Read a runtime configuration flag (SSR-safe).
 * - Prefers `window.__ODV_GET_CONFIG__()` if present (installed by public/odv.config.js).
 * - Falls back to `window.__ODV_CONFIG__`.
 * - Finally, checks a matching <meta> tag: e.g., name="odv-exposeStackTraces".
 *
 * @param {string} name
 * @param {boolean} [fallback=false]
 * @returns {boolean}
 */
function readConfigFlag(name, fallback = false) {
  try {
    // Preferred helper (returns a frozen snapshot)
    if (typeof window !== 'undefined' && typeof window.__ODV_GET_CONFIG__ === 'function') {
      const cfg = window.__ODV_GET_CONFIG__();
      if (cfg && typeof cfg[name] !== 'undefined') return toBool(cfg[name], fallback);
    }
    // Direct global
    if (typeof window !== 'undefined' && window.__ODV_CONFIG__) {
      const v = /** @type {*} */ (window.__ODV_CONFIG__)[name];
      if (typeof v !== 'undefined') return toBool(v, fallback);
    }
    // Meta tag fallback (e.g., <meta name="odv-exposeStackTraces" content="true">)
    if (typeof document !== 'undefined') {
      const meta = document.querySelector(`meta[name="odv-${name}"]`);
      if (meta) return toBool(meta.getAttribute('content'), fallback);
    }
  } catch {
    /* ignore and return fallback */
  }
  return fallback;
}

/**
 * Props for the ErrorBoundary component.
 * @typedef {Object} ErrorBoundaryProps
 * @property {React.ReactNode} children
 * @property {(React.ReactNode|FallbackRenderer|undefined)} fallback
 *           Optional custom fallback UI. May be a node or a render function (see FallbackRenderer typedef in src/types/jsdoc-types.js).
 * @property {(function(): void|undefined)} onReset
 *           Optional callback when the user clicks "Try again".
 * @property {(boolean|undefined)} showDetailsByDefault
 *           If true, expands the details section initially (when stacks are hidden).
 */

/**
 * Internal state for the ErrorBoundary.
 * @typedef {Object} ErrorBoundaryState
 * @property {boolean} hasError
 * @property {*} error
 * @property {(React.ErrorInfo|null)} errorInfo
 * @property {boolean} showDetails
 */

/**
 * React Error Boundary implementation with:
 *  - runtime-controlled stack visibility
 *  - copy-to-clipboard helper for diagnostics
 *  - reset handler to re-render child tree
 */
export default class ErrorBoundary extends React.Component {
  /** @param {ErrorBoundaryProps} props */
  constructor(props) {
    super(props);
    /** @type {ErrorBoundaryState} */
    this.state = { hasError: false, error: null, errorInfo: null, showDetails: !!props?.showDetailsByDefault };
  }

  /** @param {*} error */
  static getDerivedStateFromError(error) {
    /** @type {ErrorBoundaryState} */
    const next = { hasError: true, error, errorInfo: null, showDetails: false };
    return next;
  }

  /**
   * Log error details for diagnostics. We always log full details (message, stack, componentStack)
   * to the console/backend, regardless of whether we expose stacks to end users.
   * @param {*} error
   * @param {React.ErrorInfo} errorInfo
   * @returns {void}
   */
  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    logger.error('Unhandled error in ErrorBoundary', {
      message: error?.message,
      stack: error?.stack,
      componentStack: errorInfo?.componentStack,
    });
  }

  /**
   * Reset the boundary and optionally call the external onReset handler.
   * Prefer this over full page reloads so stateful parents can recover.
   * @returns {void}
   */
  reset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, showDetails: !!this.props?.showDetailsByDefault });
    if (typeof this.props.onReset === 'function') {
      try { this.props.onReset(); } catch { /* ignore */ }
    }
  };

  /**
   * Copy a concise diagnostic bundle to the clipboard (best effort).
   * @returns {Promise.<void>}
   */
  copyDetails = async () => {
    try {
      const parts = [];
      parts.push(`Error: ${this.state.error?.message || String(this.state.error)}`);
      if (this.state.error?.stack) parts.push('\nStack:\n' + this.state.error.stack);
      if (this.state.errorInfo?.componentStack) parts.push('\nComponent Stack:\n' + this.state.errorInfo.componentStack);
      const text = parts.join('\n');
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        logger.info('Error details copied to clipboard');
      }
    } catch {
      // Silent failure; copying is convenience only.
    }
  };

  /**
   * @returns {React.ReactNode}
   */
  render() {
    if (!this.state.hasError) return this.props.children;

    const exposeStackTraces = IS_DEV || readConfigFlag('exposeStackTraces', false);

    // Support a custom fallback (node or render function)
    if (this.props.fallback) {
      if (typeof this.props.fallback === 'function') {
        return /** @type {FallbackRenderer} */ (this.props.fallback)({
          error: /** @type {*} */ (this.state.error),
          errorInfo: this.state.errorInfo,
          reset: this.reset,
        });
      }
      return /** @type {React.ReactNode} */ (this.props.fallback);
    }

    // Inline, self-contained styles to avoid coupling to app CSS
    const wrap = {
      padding: 16,
      margin: 8,
      border: '1px solid rgba(0,0,0,0.15)',
      borderRadius: 6,
      background: 'rgba(255,255,255,0.9)',
      color: '#222',
      maxWidth: 920,
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
    };
    const title = { marginTop: 0, marginBottom: 8 };
    const btn = {
      display: 'inline-block',
      marginRight: 8,
      marginTop: 8,
      padding: '6px 10px',
      fontSize: 14,
      borderRadius: 4,
      border: '1px solid rgba(0,0,0,0.2)',
      background: '#f5f5f5',
      cursor: 'pointer',
    };
    const pre = { whiteSpace: 'pre-wrap', background: '#fafafa', padding: 12, borderRadius: 4, overflowX: 'auto' };

    return (
      <div role="alert" aria-live="polite" style={wrap}>
        <h2 style={title}>{tr('errorBoundary.title', 'Something went wrong')}</h2>

        {!exposeStackTraces ? (
          <>
            <p>{tr('errorBoundary.generic', 'The application encountered an unexpected error.')}</p>
            <details open={this.state.showDetails} onToggle={(e) => this.setState({ showDetails: e.currentTarget.open })}>
              <summary>{tr('errorBoundary.detailsSummary', 'Details (for support)')}</summary>
              <pre style={pre}>
{String(this.state.error?.message || this.state.error || 'Unknown error')}
              </pre>
            </details>
            <div>
              <button type="button" style={btn} onClick={this.reset}>{tr('errorBoundary.tryAgain', 'Try again')}</button>
              <button type="button" style={btn} onClick={() => { try { window.location.reload(); } catch {} }}>{tr('errorBoundary.reload', 'Reload')}</button>
              <button type="button" style={btn} onClick={this.copyDetails}>{tr('errorBoundary.copyDetails', 'Copy details')}</button>
            </div>
          </>
        ) : (
          <>
            <p style={{ marginTop: 0, marginBottom: 8 }}>
              {String(this.state.error)}
            </p>
            {this.state.error?.stack ? (
              <>
                <h3 style={{ marginBottom: 6 }}>{tr('errorBoundary.stackTrace', 'Stack Trace')}</h3>
                <pre style={pre}>{this.state.error.stack}</pre>
              </>
            ) : null}
            {this.state.errorInfo?.componentStack ? (
              <>
                <h3 style={{ marginBottom: 6 }}>{tr('errorBoundary.componentStack', 'Component Stack')}</h3>
                <pre style={pre}>{this.state.errorInfo.componentStack}</pre>
              </>
            ) : null}
            <div>
              <button type="button" style={btn} onClick={this.reset}>{tr('errorBoundary.tryAgain', 'Try again')}</button>
              <button type="button" style={btn} onClick={() => { try { window.location.reload(); } catch {} }}>{tr('errorBoundary.reload', 'Reload')}</button>
              <button type="button" style={btn} onClick={this.copyDetails}>{tr('errorBoundary.copyDetails', 'Copy details')}</button>
            </div>
          </>
        )}
      </div>
    );
  }
}
