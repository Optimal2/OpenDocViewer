// File: src/integrations/ompThemeBridge.js
/**
 * File: src/integrations/ompThemeBridge.js
 *
 * Opt-in cross-origin theme bridge for the shared OMP theme preference.
 *
 * The bridge is OFF by default: it only listens when the runtime config provides
 * a non-empty list of allowed origins (`theme.bridge.allowedOrigins`). Every
 * inbound message is checked for:
 * - an allowed `event.origin` (exact match, never a wildcard),
 * - `event.source` equal to the embedding parent window,
 * - the exact versioned message shape `{ kind, version: 1, mode, revision }`,
 * - a revision newer than the locally stored one.
 *
 * Outbound announcements use the exact allowed origin as `targetOrigin` (never
 * `*`). Applying a remote change never announces it back, so a change cannot
 * ping-pong between frames.
 */

import { sharedThemeRevisionTime } from '../utils/ompThemePreference.js';

export const OMP_THEME_BRIDGE_KIND = 'omp:theme-preference';
export const OMP_THEME_BRIDGE_VERSION = 1;
const SHARED_THEME_MODES = Object.freeze(['system', 'light', 'dark']);
const MAX_REVISION_CLOCK_SKEW_MS = 5_000;

/**
 * Remote theme preference received over the bridge.
 * @typedef {Object} RemoteThemePreference
 * @property {('system'|'light'|'dark')} mode
 * @property {string} revision
 */

/**
 * Validate an inbound postMessage payload. Returns the preference, or null when
 * the shape, version, mode or revision is wrong.
 *
 * @param {*} data
 * @returns {(RemoteThemePreference|null)}
 */
export function parseThemeBridgeMessage(data) {
  try {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (data.kind !== OMP_THEME_BRIDGE_KIND) return null;
    if (data.version !== OMP_THEME_BRIDGE_VERSION) return null;
    if (!SHARED_THEME_MODES.includes(data.mode)) return null;
    if (typeof data.revision !== 'string' || !data.revision) return null;
    return { mode: data.mode, revision: data.revision };
  } catch {
    return null;
  }
}

/**
 * Check an event origin against the configured allow-list (exact match only).
 * An empty or missing list disables the bridge.
 *
 * @param {*} origin
 * @param {*} allowedOrigins
 * @returns {boolean}
 */
export function isThemeBridgeOriginAllowed(origin, allowedOrigins) {
  if (typeof origin !== 'string' || !origin) return false;
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) return false;
  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) return false;
  } catch {
    return false;
  }
  return allowedOrigins.some((entry) => typeof entry === 'string' && entry !== '' && entry === origin);
}

/**
 * Order two revisions by their base-36 creation time, as OMP does. A missing local revision accepts any
 * well-formed remote revision.
 *
 * @param {string} candidate
 * @param {(string|null|undefined)} current
 * @returns {boolean}
 */
export function isRevisionNewer(candidate, current) {
  if (!current) return true;
  return sharedThemeRevisionTime(candidate) > sharedThemeRevisionTime(current);
}

/**
 * Start listening for theme changes from allowed origins. The callback receives
 * validated, newer remote preferences; it must apply them silently (mirroring
 * without announcing) so nothing echoes back. Returns a stop function.
 *
 * @param {Object} options
 * @param {Array<string>} options.allowedOrigins
 * @param {function(RemoteThemePreference): void} options.onRemotePreference
 * @param {function(): (string|null)} [options.getCurrentRevision]
 * @returns {function(): void}
 */
export function startOmpThemeBridge({ allowedOrigins, onRemotePreference, getCurrentRevision }) {
  const allowList = Array.isArray(allowedOrigins)
    ? allowedOrigins.filter((origin) => isThemeBridgeOriginAllowed(origin, allowedOrigins))
    : [];
  if (allowList.length === 0 || typeof window === 'undefined' || window.parent === window) return () => {};
  // Source is restricted to window.parent; keep independent clocks per origin
  // in case that WindowProxy navigates between allowed senders.
  const senderClocks = new Map();
  /** @param {MessageEvent} event */
  const onMessage = (event) => {
    try {
      if (allowList.length === 0) return;
      if (!isThemeBridgeOriginAllowed(event?.origin, allowList)) return;
      if (!event?.source || event.source !== window.parent) return;
      const parsed = parseThemeBridgeMessage(event.data);
      if (!parsed) return;
      const senderTime = sharedThemeRevisionTime(parsed.revision);
      const previous = senderClocks.get(event.origin);
      if (previous && senderTime <= previous.seen) return;
      // Record even revisions that lose to a local choice, so replay cannot
      // acquire a later timestamp merely by arriving again.
      const clock = { seen: senderTime, accepted: previous?.accepted ?? -1 };
      senderClocks.set(event.origin, clock);
      // Bound the stored clock while preserving order for genuinely newer
      // sender revisions whose arrivals share the same millisecond.
      const clamped = Math.min(senderTime, Date.now() + MAX_REVISION_CLOCK_SKEW_MS);
      const acceptedTime = Math.max(clamped, clock.accepted + 1);
      if (acceptedTime !== senderTime) {
        parsed.revision = parsed.revision.replace(/^[^-]+/, acceptedTime.toString(36));
      }
      const current = typeof getCurrentRevision === 'function' ? getCurrentRevision() : null;
      if (!isRevisionNewer(parsed.revision, current)) return;
      clock.accepted = acceptedTime;
      onRemotePreference(parsed);
    } catch {
      // ignore malformed events
    }
  };

  try {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('message', onMessage);
    }
  } catch {
    // ignore; bridge simply stays inactive
  }

  return () => {
    try {
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('message', onMessage);
      }
    } catch {
      // ignore
    }
  };
}

/**
 * Announce a local (user-initiated) theme change to the embedded parent frame,
 * once per allowed origin with that origin as the exact targetOrigin. No-op when
 * the bridge is off, when the viewer is top-level, or when storage/event access
 * is denied. Callers must only invoke this for local changes, never when
 * applying a remote one.
 *
 * @param {Object} options
 * @param {('system'|'light'|'dark')} options.mode
 * @param {string} options.revision
 * @param {Array<string>} options.allowedOrigins
 * @returns {void}
 */
export function announceThemeToAllowedOrigins({ mode, revision, allowedOrigins }) {
  try {
    const allowList = Array.isArray(allowedOrigins)
      ? allowedOrigins.filter((origin) => isThemeBridgeOriginAllowed(origin, allowedOrigins))
      : [];
    if (allowList.length === 0) return;
    if (typeof window === 'undefined' || !window.parent || window.parent === window) return;
    if (!SHARED_THEME_MODES.includes(mode)) return;
    if (typeof revision !== 'string' || !revision) return;
    const message = {
      kind: OMP_THEME_BRIDGE_KIND,
      version: OMP_THEME_BRIDGE_VERSION,
      mode,
      revision,
    };
    for (const targetOrigin of allowList) {
      window.parent.postMessage(message, targetOrigin);
    }
  } catch {
    // ignore; announcement is best-effort
  }
}
