// File: server/userLogPayload.js
/** Compatibility reader for form posts and the viewer's JSON print envelope. */

export function readPrintLogFields(body) {
  return {
    reason: body?.reason ?? body?.meta?.reason ?? null,
    forWhom: body?.forWhom ?? body?.meta?.forWhom ?? null,
  };
}
