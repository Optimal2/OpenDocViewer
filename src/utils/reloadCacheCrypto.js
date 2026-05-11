// File: src/utils/reloadCacheCrypto.js
/**
 * Short-lived reload-cache key helpers.
 *
 * The source and rendered-page IndexedDB stores normally use an in-memory AES key. That is safest,
 * but it also means an accidental F5 cannot read the temp blobs it just wrote. For explicitly
 * enabled short reload caches, keep the AES key in browser storage for the same TTL as the cache
 * records. localStorage lets the same-origin WebClient/ODV flow reuse data after a new WebClient
 * session, while sessionStorage remains a fallback and migration source for already-open tabs.
 */

const STORAGE_PREFIX = 'OpenDocViewer.reloadCacheKey.v1';

const storageStateByKey = new Map();

function getLocalStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function getSessionStorage() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

function getKeyStorages() {
  return [
    { kind: 'local', storage: getLocalStorage() },
    { kind: 'session', storage: getSessionStorage() },
  ].filter((entry) => !!entry.storage);
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

function rememberStorageState(storageKey, state) {
  storageStateByKey.set(storageKey, String(state || 'unknown'));
}

function writeKeyRecord(storageKey, record) {
  const serialized = JSON.stringify(record);
  const persisted = [];
  for (const entry of getKeyStorages()) {
    try {
      entry.storage.setItem(storageKey, serialized);
      persisted.push(entry.kind);
    } catch {
      // A full or blocked localStorage should not break document loading. The caller still receives
      // the in-memory CryptoKey and the diagnostics report that the key was not persisted there.
    }
  }
  return persisted;
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
 * @param {string=} scope
 * @returns {string}
 */
export function getReloadCacheAesKeyStorageState(sessionId, scope = 'default') {
  const safeSessionId = String(sessionId || '').trim();
  if (!safeSessionId) return 'none';
  const storageKey = makeStorageKey(scope, safeSessionId);
  if (storageStateByKey.has(storageKey)) return storageStateByKey.get(storageKey) || 'unknown';
  const available = getKeyStorages().map((entry) => entry.kind).join('+');
  return available ? `available:${available}` : 'unavailable';
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
  if (!safeSessionId || safeTtlMs <= 0) return null;
  if (!globalThis.crypto?.subtle || typeof globalThis.btoa !== 'function' || typeof globalThis.atob !== 'function') return null;

  const storageKey = makeStorageKey(scope, safeSessionId);
  const storages = getKeyStorages();
  if (!storages.length) {
    rememberStorageState(storageKey, 'unavailable');
    return null;
  }

  const now = Date.now();

  for (const entry of storages) {
    try {
      const raw = entry.storage.getItem(storageKey);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const expiresAt = Number(parsed?.expiresAt || 0);
      const key = String(parsed?.key || '');
      if (expiresAt > now && key) {
        const persisted = writeKeyRecord(storageKey, parsed);
        rememberStorageState(storageKey, `hit:${entry.kind}->${persisted.join('+') || 'memory'}`);
        return importRawAesKey(base64ToBytes(key));
      }
      try { entry.storage.removeItem(storageKey); } catch {}
    } catch {
      try { entry.storage.removeItem(storageKey); } catch {}
    }
  }

  const generated = await generateExportableAesKey();
  const exported = await globalThis.crypto.subtle.exportKey('raw', generated);
  const expiresAt = now + safeTtlMs;
  const persisted = writeKeyRecord(storageKey, {
    expiresAt,
    key: bytesToBase64(exported),
  });

  rememberStorageState(storageKey, `generated:${persisted.join('+') || 'memory'}`);

  return generated;
}
