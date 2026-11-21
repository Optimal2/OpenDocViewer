// File: server/userLogOrigin.js
/** Evaluate the browser origin signals used by the user print-log endpoint. */

export function isAllowedUserLogOrigin({ host = '', origin = '', referer = '', secFetchSite = '', strict = false } = {}) {
  const hostOf = (value) => {
    try { return new URL(value).host; } catch { return ''; }
  };

  if (origin) return hostOf(origin) === host;
  if (referer) return hostOf(referer) === host;
  if (secFetchSite) return String(secFetchSite).toLowerCase() === 'same-origin';
  // Compatibility trade-off: non-browser clients often send none of these headers.
  return !strict;
}
