// File: src/utils/reloadCacheCrypto.js
/**
 * Short-lived reload-cache key helpers.
 *
 * The source and rendered-page IndexedDB stores normally use an in-memory AES key. That is safest,
 * but it also means an accidental F5 cannot read the temp blobs it just wrote. For explicitly
 * enabled short reload caches, keep the AES key in tab-scoped sessionStorage for the same TTL as
 * the cache records so a reload in the same tab can decrypt them again.
 */

const STORAGE_PREFIX = 'OpenDocViewer.reloadCacheKey.v1';

function getSessionStorage() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

function bytesToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || new ArrayBuffer(0));
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return globalThis.btoa(binary);
}

function base64ToBytes(value) {
  const binary = globalThis.atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function makeStorageKey(scope, sessionId) {
  return `${STORAGE_PREFIX}:${String(scope || 'default')}:${String(sessionId || '')}`;
}

async function importRawAesKey(rawBytes) {
  return globalThis.crypto.subtle.importKey(
    'raw',
    rawBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

async function generateExportableAesKey() {
  return globalThis.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * @param {string} sessionId
 * @param {number} ttlMs
 * @param {string=} scope
 * @returns {Promise<(CryptoKey|null)>}
 */
export async function getReloadCacheAesKey(sessionId, ttlMs, scope = 'default') {
  const safeSessionId = String(sessionId || '').trim();
  const safeTtlMs = Math.max(0, Number(ttlMs) || 0);
  const storage = getSessionStorage();
  if (!safeSessionId || safeTtlMs <= 0 || !storage) return null;
  if (!globalThis.crypto?.subtle || typeof globalThis.btoa !== 'function' || typeof globalThis.atob !== 'function') return null;

  const storageKey = makeStorageKey(scope, safeSessionId);
  const now = Date.now();

  try {
    const raw = storage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      const expiresAt = Number(parsed?.expiresAt || 0);
      const key = String(parsed?.key || '');
      if (expiresAt > now && key) {
        return importRawAesKey(base64ToBytes(key));
      }
    }
  } catch {
    try { storage.removeItem(storageKey); } catch {}
  }

  const generated = await generateExportableAesKey();
  const exported = await globalThis.crypto.subtle.exportKey('raw', generated);
  const expiresAt = now + safeTtlMs;

  try {
    storage.setItem(storageKey, JSON.stringify({
      expiresAt,
      key: bytesToBase64(exported),
    }));
  } catch {
    return generated;
  }

  return generated;
}
