// File: server/clientAddress.js
/** The client's address without a port, for the rate limit key and the log records. */

import net from 'node:net';

const IPV4_WITH_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/;
const BRACKETED_IPV6 = /^\[([^\]]+)\](?::\d{1,5})?$/;

/**
 * A reverse proxy may add the client's source port to the address it forwards (IIS ARR does by
 * default: "203.0.113.5:49152", "[2001:db8::1]:49152"). The port differs for every connection,
 * so an address with a port must not be the key of a rate limit, and it makes the log harder to
 * search. This removes a trailing port from an IPv4 address and unwraps the bracket form of an
 * IPv6 address. An IPv6 address without brackets is never touched, since its last group cannot
 * be told from a port. Anything that is not recognized is returned as it is.
 * @param {*} value
 * @returns {*}
 */
export function normalizeClientAddress(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();

  const v4 = IPV4_WITH_PORT.exec(text);
  if (v4 && net.isIPv4(v4[1])) return v4[1];

  const v6 = BRACKETED_IPV6.exec(text);
  // A zone index ("%eth0") is not part of what net.isIPv6 checks.
  if (v6 && net.isIPv6(v6[1].split('%')[0])) return v6[1];

  return value;
}
