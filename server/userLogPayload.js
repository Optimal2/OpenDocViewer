// File: server/userLogPayload.js
/** Compatibility reader for form posts and the viewer's JSON print envelope. */

export function readPrintLogFields(body) {
  return {
    reason: body?.reason ?? body?.meta?.reason ?? null,
    forWhom: body?.forWhom ?? body?.meta?.forWhom ?? null,
  };
}

/**
 * The print log has never carried "$" or "#" in the recipient. They are replaced with "_"
 * instead of rejecting the request, so that the print record is always written.
 * @param {*} value
 * @returns {string}
 */
export function neutralizeForWhom(value) {
  return String(value).replace(/[$#]/g, '_');
}
