// File: server/userLogOrigin.js
/** Evaluate the browser origin signals used by the user print-log endpoint. */

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * The hosts the browser may have addressed: the request's own Host header and, only when the
 * request arrives over loopback, the X-Forwarded-Host that the reverse proxy on the same
 * machine sets to the public host. A reverse proxy replaces Host with the upstream address,
 * so the forwarded value is what Origin/Referer must be compared with. A forwarded host from
 * any other address is ignored.
 * @param {{host:(string|undefined), forwardedHost:(string|undefined), remoteAddress:(string|undefined)}} request
 * @returns {Array<string>}
 */
export function resolveUserLogHosts({ host = '', forwardedHost = '', remoteAddress = '' } = {}) {
  const hosts = [];
  const own = String(host || '').trim().toLowerCase();
  if (own) hosts.push(own);
  if (LOOPBACK_ADDRESSES.has(String(remoteAddress || '').trim().toLowerCase())) {
    // With several proxies in a row the last entry is the one the nearest proxy added.
    const forwarded = String(forwardedHost || '').split(',').pop().trim().toLowerCase();
    if (forwarded && !hosts.includes(forwarded)) hosts.push(forwarded);
  }
  return hosts;
}

export function isAllowedUserLogOrigin({
  host = '', forwardedHost = '', remoteAddress = '', origin = '', referer = '', secFetchSite = '', strict = false,
} = {}) {
  const hostOf = (value) => {
    try { return new URL(value).host; } catch { return ''; }
  };
  const hosts = resolveUserLogHosts({ host, forwardedHost, remoteAddress });
  const matches = (value) => {
    const candidate = hostOf(value);
    return candidate !== '' && hosts.includes(candidate);
  };

  if (origin) return matches(origin);
  if (referer) return matches(referer);
  if (secFetchSite) return String(secFetchSite).toLowerCase() === 'same-origin';
  // Compatibility trade-off: non-browser clients often send none of these headers.
  return !strict;
}
