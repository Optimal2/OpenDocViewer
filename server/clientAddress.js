// File: server/clientAddress.js
/** The client's address without a port, for the rate limit key and the log records. */

import net from 'node:net';

const IPV4_WITH_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/;
// An IPv4-mapped IPv6 address ends in dotted IPv4, so a port after it can be told apart.
const MAPPED_IPV4_WITH_PORT = /^(::ffff:\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/i;
// Address, then an optional zone index of ordinary interface-name characters.
const BRACKETED_IPV6 = /^\[([0-9a-f:.]+)(%[0-9a-z_.-]+)?\](?::\d{1,5})?$/i;

/**
 * A reverse proxy may add the client's source port to the address it forwards (IIS ARR does by
 * default: "203.0.113.5:49152", "[2001:db8::1]:49152"). The port differs for every connection,
 * so an address with a port must not be the key of a rate limit, and it makes the log harder to
 * search. This removes a trailing port from an IPv4 address and from an IPv4-mapped IPv6
 * address, and unwraps the bracket form of an IPv6 address. Any other IPv6 address without
 * brackets is never touched, since its last group cannot be told from a port. Anything that is
 * not recognized is returned as it is.
 * @param {*} value
 * @returns {*}
 */
export function normalizeClientAddress(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();

  const v4 = IPV4_WITH_PORT.exec(text);
  if (v4 && net.isIPv4(v4[1])) return v4[1];

  const mapped = MAPPED_IPV4_WITH_PORT.exec(text);
  if (mapped && net.isIPv6(mapped[1])) return mapped[1];

  const v6 = BRACKETED_IPV6.exec(text);
  if (v6 && net.isIPv6(v6[1])) return v6[1] + (v6[2] || '');

  return value;
}
