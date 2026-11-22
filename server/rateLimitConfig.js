// File: server/rateLimitConfig.js
/** Settings and reporting for the per-client rate limits of the log servers. */

/**
 * Read a requests-per-minute limit from an environment value.
 *
 * - not set or empty: the default
 * - "0" or "off" (any case): no limit
 * - a positive whole number: that limit
 * - anything else: the default, with a warning text for the start-up log
 *
 * A default of 0 means that the server has no limit unless one is set.
 *
 * @param {string} name Name of the environment variable, for the warning.
 * @param {(string|undefined)} raw
 * @param {number} defaultLimit
 * @returns {{ limit: number, enabled: boolean, warning: (string|null) }}
 */
export function resolveRateLimitPerMinute(name, raw, defaultLimit) {
  const text = String(raw ?? '').trim();
  const fallback = { limit: defaultLimit, enabled: defaultLimit > 0 };
  if (text === '') return { ...fallback, warning: null };
  if (text === '0' || text.toLowerCase() === 'off') return { limit: 0, enabled: false, warning: null };
  if (/^[0-9]{1,9}$/.test(text) && Number(text) > 0) return { limit: Number(text), enabled: true, warning: null };
  const defaultText = defaultLimit > 0 ? `the default of ${defaultLimit} requests per minute` : 'the default, which is no limit';
  return { ...fallback, warning: `${name} is not a positive whole number, "0" or "off". Using ${defaultText}.` };
}

/**
 * Report a rejected client at most once per window, so that records lost to the rate limit are
 * visible in the error log without one line per rejected request.
 *
 * The reporter is called with the same key that the rate limit counts on, so "once per client"
 * means once per counted client (the limiter counts IPv6 per /56 block), and with the address
 * of the rejected request for the line itself. A client counts as reported only when its line
 * has been written. `write` may return a promise: while it is pending the client is held, so
 * that concurrent rejections do not each write a line, and when it rejects the client is
 * released again. A write that fails, at once or later, does not silence the client.
 * @param {{ write: function(string): (void|Promise<*>), windowMs: (number|undefined), now: (function(): number|undefined), maxClients: (number|undefined) }} options
 * @returns {function(string, string=): boolean} Call with the rate limit key and the client
 *   address (the key when omitted); true when a line was written.
 */
export function createRejectionReporter({ write, windowMs = 60_000, now = Date.now, maxClients = 10_000 }) {
  /** @type {Map<string, number>} */
  const lastReported = new Map();
  return (clientKey, address = clientKey) => {
    const key = String(clientKey ?? 'unknown');
    const time = now();
    const previous = lastReported.get(key);
    if (previous !== undefined && time - previous < windowMs) return false;
    if (lastReported.size >= maxClients) {
      for (const [client, reportedAt] of lastReported) {
        if (time - reportedAt >= windowMs) lastReported.delete(client);
      }
      // Still full of clients reported within the window: start over rather than grow.
      if (lastReported.size >= maxClients) lastReported.clear();
    }
    const outcome = write(String(address ?? key));
    lastReported.set(key, time);
    if (outcome && typeof outcome.then === 'function') {
      outcome.then(undefined, () => {
        // Only release the mark this call set; a later report may have replaced it.
        if (lastReported.get(key) === time) lastReported.delete(key);
      });
    }
    return true;
  };
}
