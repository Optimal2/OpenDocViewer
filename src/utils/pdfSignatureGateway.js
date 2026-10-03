/**
 * Optional gateway trust enrichment. Source routes and received pack frames identify files;
 * viewer ordering, bootstrap mode and host metadata never determine file identity.
 * @module utils/pdfSignatureGateway
 */
import { getWorstSignatureIntegrity, normalizeSignatureIntegrity } from './pdfSignatureStatus.js';

const UNAVAILABLE = 'server validation unavailable';
const DISABLED = 'Signature validation is not enabled on this gateway.';
const TIMEOUT_MS = 20000;
const TRUST_VALUES = ['valid', 'invalid', 'unknown'];

/**
 * Resolve only HTTP source routes on the viewer's own origin, preserving the path base.
 * @param {string} sourceUrl The URL already used by DocumentLoader.
 * @param {string} [baseUrl] Browser base for relative source URLs.
 * @param {{url: string, fileIndex: number}} [sourcePack] Actual received pack frame identity.
 * @returns {{endpoint: string, session: string}|null}
 */
export function getGatewaySignatureContext(sourceUrl, baseUrl = globalThis.document?.baseURI, sourcePack) {
  try {
    if (sourcePack !== undefined) {
      // Never fall back to a display index or unrelated source URL for pack bytes.
      if (!Number.isInteger(sourcePack?.fileIndex) || sourcePack.fileIndex < 0
          || sourcePack.fileIndex > 2147483647) return null;
      sourceUrl = sourcePack.url;
    }
    if (typeof sourceUrl !== 'string' || !sourceUrl) return null;
    const url = new URL(sourceUrl, baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    // The document URL and HTML base URI are not trust anchors.
    if (url.origin !== new URL(globalThis.location?.href).origin) return null;
    const match = sourcePack !== undefined
      ? url.pathname.match(/^(.*)\/source-pack\/([^/]+)$/)
      : url.pathname.match(/^(.*)\/source\/([^/]+)\/(0|[1-9]\d*)$/);
    if (!match) return null;
    const fileIndex = sourcePack !== undefined ? sourcePack.fileIndex : Number(match[3]);
    if (fileIndex > 2147483647) return null;
    const sessionKey = decodeURIComponent(match[2]);
    if (!/^[A-Za-z0-9_-]+$/.test(sessionKey)) return null;
    const session = `${url.origin}${match[1]}/signatures/${encodeURIComponent(sessionKey)}`;
    return { endpoint: `${session}/${fileIndex}`, session };
  } catch { return null; }
}

function isTime(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

function unchecked(signature) {
  return { ...signature, trust: 'not-checked', trustReason: UNAVAILABLE, serverValidationUnavailable: true };
}

function unavailable(report) {
  return { ...report, signatures: report.signatures.map(unchecked) };
}

/**
 * The gateway answered that server validation is switched off. Trust stays unchecked; the
 * client-only marker lets the dialog explain that configuration (never accepted from the server).
 * @param {*} report
 * @returns {*}
 */
function validationDisabled(report) {
  return { ...report, signatures: report.signatures.map((signature) => ({ ...signature, serverValidationDisabled: true })) };
}

/**
 * Accept only unambiguous server entries. Missing/duplicate field identities
 * cannot establish trust. The browser's integrity can only stay equal or worsen.
 * @param {*} report Browser report.
 * @param {*} server Gateway JSON report.
 * @returns {*} Enriched report, or unchecked signatures for malformed data.
 */
export function mergeGatewaySignatureReport(report, server) {
  if (!Array.isArray(server?.signatures) || server.signatures.length > 256
      || (server.validatedAt != null && !isTime(server.validatedAt))) return unavailable(report);
  const byField = new Map();
  for (const signature of server.signatures) {
    if (!signature || !TRUST_VALUES.includes(signature.trust)
        || normalizeSignatureIntegrity(signature.integrity) !== signature.integrity
        || !isTime(signature.validationTime)
        || (signature.trustReason != null && typeof signature.trustReason !== 'string')
        || (signature.integrityReason != null && typeof signature.integrityReason !== 'string')
        || (signature.fieldName !== null && typeof signature.fieldName !== 'string')
        || (signature.signingTimeSource === 'timestamp' && !isTime(signature.signingTime))) return unavailable(report);
    if (!signature.fieldName) continue;
    if (byField.has(signature.fieldName)) return unavailable(report);
    byField.set(signature.fieldName, signature);
  }
  const names = report.signatures.map((signature) => signature.fieldName);
  return {
    ...report,
    ...(server.validatedAt ? { validatedAt: server.validatedAt } : {}),
    signatures: report.signatures.map((signature) => {
      const remote = byField.get(signature.fieldName);
      if (!remote || names.filter((name) => name === signature.fieldName).length !== 1) return unchecked(signature);
      const integrity = getWorstSignatureIntegrity([signature, remote]);
      return {
        ...signature,
        integrity,
        ...(integrity !== signature.integrity ? { integrityReason: remote.integrityReason ?? null } : {}),
        trust: remote.trust,
        trustReason: remote.trustReason ?? null,
        serverValidationUnavailable: false,
        serverValidationDisabled: false,
        validationTime: remote.validationTime,
        ...(remote.signingTimeSource === 'timestamp'
          ? { signingTime: remote.signingTime, signingTimeSource: 'timestamp' } : {}),
      };
    }),
  };
}

/**
 * Create viewer-local state for disabled gateway sessions. Calls run in the
 * existing serial inspection queue; this client never fetches document bytes.
 * @returns {{enrich: function(*, string, Object=): Promise<*>}}
 */
export function createGatewaySignatureClient() {
  const disabledSessions = new Set();
  return {
    async enrich(report, sourceUrl, sourcePack) {
      const context = getGatewaySignatureContext(sourceUrl, undefined, sourcePack);
      if (!context || report.signatures.length === 0) return report;
      if (disabledSessions.has(context.session)) return validationDisabled(report);
      const controller = new AbortController();
      let timer;
      try {
        const request = async () => {
          const response = await fetch(context.endpoint, {
            method: 'GET', headers: { Accept: 'application/json' },
            credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
          });
          const body = await response.json();
          return { response, body };
        };
        const { response, body } = await Promise.race([
          request(),
          new Promise((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, TIMEOUT_MS);
          }),
        ]);
        if (response.status === 404 && body?.error === DISABLED) {
          disabledSessions.add(context.session);
          return validationDisabled(report);
        }
        if (!response.ok) return unavailable(report);
        return mergeGatewaySignatureReport(report, body);
      } catch {
        return unavailable(report);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
