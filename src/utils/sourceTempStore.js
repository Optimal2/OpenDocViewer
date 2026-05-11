// File: src/utils/sourceTempStore.js
/**
 * OpenDocViewer — Browser-side temporary source storage.
 *
 * PURPOSE
 *   Decouple source fetching from later page rasterization. The loader can fetch expiring URLs early,
 *   store the original bytes in a short-lived client-side temp layer, and let the viewer render page
 *   images lazily on demand.
 *
 * STORAGE STRATEGY
 *   - memory: keep everything in JS heap (small runs only)
 *   - indexeddb: keep payloads in browser disk-backed storage
 *   - adaptive: start in memory, promote to IndexedDB above configured thresholds
 *
 * SECURITY MODEL
 *   Optional AES-GCM wraps IndexedDB payloads with a per-session key that stays in memory only.
 *   The intent is pragmatic protection against casual inspection of temp data, not resistance against
 *   a fully privileged local attacker.
 */

import logger from '../logging/systemLogger.js';
import { getDocumentLoadingConfig } from './documentLoadingConfig.js';
import { getReloadCacheAesKey } from './reloadCacheCrypto.js';

const DB_NAME = 'OpenDocViewerTempStore';
const DB_VERSION = 1;
const STORE_NAME = 'sources';

/**
 * @param {string} sourceKey
 * @param {string} sessionId
 * @returns {string}
 */
function makeStorageKey(sourceKey, sessionId) {
  return `${sessionId}::${sourceKey}`;
}

/**
 * @returns {boolean}
 */
function hasIndexedDb() {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * @returns {boolean}
 */
function hasWebCrypto() {
  try {
    return !!(globalThis.crypto && globalThis.crypto.subtle && globalThis.crypto.getRandomValues);
  } catch {
    return false;
  }
}

let fallbackSessionCounter = 0;

/**
 * @returns {string}
 */
function createSessionId() {
  try {
    const cryptoObj = globalThis.crypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
      return cryptoObj.randomUUID();
    }
    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
      const bytes = cryptoObj.getRandomValues(new Uint8Array(16));
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      return `odv_${Date.now().toString(36)}_${hex}`;
    }
  } catch {}

  fallbackSessionCounter += 1;
  const perfNow = typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : 0;
  return `odv_${Date.now().toString(36)}_${Math.floor(perfNow * 1000).toString(36)}_${fallbackSessionCounter.toString(36)}`;
}

/**
 * @param {IDBRequest} request
 * @returns {Promise<any>}
 */
function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

/**
 * @param {IDBTransaction} tx
 * @returns {Promise<void>}
 */
function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

/**
 * @returns {Promise<IDBDatabase>}
 */
function openTempStoreDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? req.transaction.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: 'id' });

      if (!store.indexNames.contains('sessionId')) store.createIndex('sessionId', 'sessionId', { unique: false });
      if (!store.indexNames.contains('createdAt')) store.createIndex('createdAt', 'createdAt', { unique: false });
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB temp store'));
  });
}


/**
 * @typedef {Object} SourceStoreStats
 * @property {'memory'|'indexeddb'} mode
 * @property {number} sourceCount
 * @property {number} totalBytes
 * @property {boolean} encrypted
 * @property {boolean} indexedDbAvailable
 */

/**
 * @typedef {Object} SourceMeta
 * @property {string} sourceKey
 * @property {string} sessionId
 * @property {string} storageKey
 * @property {string} fileExtension
 * @property {string} mimeType
 * @property {string} originalUrl
 * @property {number} fileIndex
 * @property {number} sizeBytes
 * @property {number} createdAt
 * @property {boolean} encrypted
 */

/**
 * @typedef {Object} PutSourceOptions
 * @property {string} sourceKey
 * @property {Blob} blob
 * @property {string=} fileExtension
 * @property {string=} mimeType
 * @property {string=} originalUrl
 * @property {number=} fileIndex
 */

class BlobLruCache {
  /**
   * @param {number} limit
   */
  constructor(limit) {
    this.limit = Math.max(1, Number(limit) || 1);
    /** @type {Map<string, Blob>} */
    this.map = new Map();
  }

  /**
   * @param {string} key
   * @returns {(Blob|null)}
   */
  get(key) {
    if (!this.map.has(key)) return null;
    const value = this.map.get(key) || null;
    this.map.delete(key);
    if (value) this.map.set(key, value);
    return value;
  }

  /**
   * @param {string} key
   * @param {Blob} value
   * @returns {void}
   */
  set(key, value) {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.limit) {
      const oldestKey = this.map.keys().next().value;
      this.map.delete(oldestKey);
    }
  }

  clear() {
    this.map.clear();
  }
}

/**
 * @param {Object=} opts
 * @returns {SourceTempStore}
 */
export function createSourceTempStore(opts = {}) {
  return new SourceTempStore(opts);
}

export class SourceTempStore {
  /**
   * @param {Object=} opts
   */
  constructor(opts = {}) {
    const cfg = getDocumentLoadingConfig();
    this.config = {
      ...cfg.sourceStore,
      ...opts,
    };

    this.reloadCacheTtlMs = Math.max(0, Number(this.config.reloadCacheTtlMs) || 0);
    this.sessionId = String(opts.sessionId || '').trim() || createSessionId();
    /** @type {Map<string, { blob: Blob, meta: SourceMeta }>} */
    this.memoryEntries = new Map();
    /** @type {Map<string, SourceMeta>} */
    this.meta = new Map();
    this.blobCache = new BlobLruCache(this.config.blobCacheEntries);

    this.sourceCount = 0;
    this.totalBytes = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;

    /** @type {'memory'|'indexeddb'} */
    this.mode = 'memory';
    this.requestedMode = String(this.config.mode || 'adaptive').toLowerCase();
    this.indexedDbAvailable = hasIndexedDb();
    this.encryptionRequested = this.config.protection === 'aes-gcm-session';
    this.encryptionAvailable = this.encryptionRequested && hasWebCrypto();
    this.dbPromise = null;
    this.keyPromise = null;
    this.cleanupPromise = null;
    this.writeQueue = Promise.resolve();

    const expectedSourceCount = Math.max(0, Number(this.config.expectedSourceCount) || 0);
    const countThreshold = Math.max(0, Number(this.config.switchToIndexedDbAboveSourceCount) || 0);
    if (
      (this.reloadCacheTtlMs > 0 && this.indexedDbAvailable) ||
      this.requestedMode === 'indexeddb'
      || (this.requestedMode === 'adaptive' && countThreshold > 0 && expectedSourceCount >= countThreshold)
    ) {
      this.mode = this.indexedDbAvailable ? 'indexeddb' : 'memory';
    }

    if (this.mode === 'indexeddb' && !this.indexedDbAvailable) {
      logger.warn('IndexedDB temp store requested but unavailable; falling back to memory mode');
      this.mode = 'memory';
    }
  }

  /**
   * @returns {Promise<SourceTempStore>}
   */
  async ready() {
    if (this.mode === 'indexeddb') await this.ensureDb();
    await this.cleanupStaleSessions();
    return this;
  }

  /**
   * @returns {string}
   */
  getSessionId() {
    return this.sessionId;
  }

  /**
   * @returns {SourceStoreStats}
   */
  getStats() {
    return {
      mode: this.mode,
      sourceCount: this.sourceCount,
      totalBytes: this.totalBytes,
      encrypted: this.mode === 'indexeddb' && this.encryptionAvailable,
      indexedDbAvailable: this.indexedDbAvailable,
      reloadCacheTtlMs: this.reloadCacheTtlMs,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
    };
  }

  /**
   * Update runtime thresholds for the active session. Demotion back from IndexedDB to memory is
   * intentionally unsupported; sessions only move toward more conservative storage.
   *
   * @param {Object=} nextConfig
   * @returns {void}
   */
  updateConfig(nextConfig = {}) {
    this.config = {
      ...this.config,
      ...(nextConfig || {}),
    };
    this.requestedMode = String(this.config.mode || this.requestedMode || 'adaptive').toLowerCase();
    if (this.blobCache) this.blobCache.limit = Math.max(1, Number(this.config.blobCacheEntries) || this.blobCache.limit || 1);
  }

  /**
   * Force promotion to IndexedDB for the current session when supported.
   *
   * @returns {Promise<SourceStoreStats>}
   */
  async promoteToIndexedDb() {
    this.requestedMode = 'indexeddb';
    await this.maybePromote();
    return this.getStats();
  }

  /**
   * @template T
   * @param {function(): Promise<T>} fn
   * @returns {Promise<T>}
   */
  enqueueWrite(fn) {
    const next = this.writeQueue.then(fn, fn);
    this.writeQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  /**
   * @param {PutSourceOptions} options
   * @returns {Promise<SourceMeta>}
   */
  async putSource(options) {
    return this.enqueueWrite(async () => {
      const blob = options?.blob instanceof Blob ? options.blob : new Blob();
      const sourceKey = String(options?.sourceKey || '');
      if (!sourceKey) throw new Error('putSource requires sourceKey');

      const meta = {
        sourceKey,
        sessionId: this.sessionId,
        storageKey: makeStorageKey(sourceKey, this.sessionId),
        fileExtension: String(options?.fileExtension || '').toLowerCase(),
        mimeType: String(options?.mimeType || blob.type || 'application/octet-stream'),
        originalUrl: String(options?.originalUrl || ''),
        fileIndex: Number.isFinite(options?.fileIndex) ? Number(options.fileIndex) : 0,
        sizeBytes: Number(blob.size || 0),
        createdAt: Date.now(),
        encrypted: this.mode === 'indexeddb' && this.encryptionAvailable,
      };

      const previousMeta = this.meta.get(sourceKey) || null;
      const isUpdate = !!previousMeta;

      if (this.mode === 'memory') {
        this.memoryEntries.set(sourceKey, { blob, meta });
        this.meta.set(sourceKey, meta);
        this.blobCache.set(sourceKey, blob);
        if (!isUpdate) {
          this.sourceCount += 1;
          this.totalBytes += meta.sizeBytes;
        } else {
          this.totalBytes += meta.sizeBytes - previousMeta.sizeBytes;
        }
        await this.maybePromote();
        return this.meta.get(sourceKey) || meta;
      }

      await this.putIndexedDbEntry(meta, blob);
      this.meta.set(sourceKey, meta);
      this.blobCache.set(sourceKey, blob);
      if (!isUpdate) {
        this.sourceCount += 1;
        this.totalBytes += meta.sizeBytes;
      } else {
        this.totalBytes += meta.sizeBytes - previousMeta.sizeBytes;
      }
      return meta;
    });
  }

  /**
   * @param {string} sourceKey
   * @returns {(SourceMeta|null)}
   */
  getMeta(sourceKey) {
    return this.meta.get(String(sourceKey || '')) || null;
  }

  /**
   * @param {string} sourceKey
   * @returns {Promise<(Blob|null)>}
   */
  async getBlob(sourceKey) {
    const key = String(sourceKey || '');
    if (!key) return null;

    const cached = this.blobCache.get(key);
    if (cached) return cached;

    if (this.mode === 'memory') {
      const entry = this.memoryEntries.get(key);
      const blob = entry?.blob || null;
      if (blob) this.blobCache.set(key, blob);
      return blob;
    }

    const record = await this.getIndexedDbRecord(key);
    if (!record) {
      if (this.reloadCacheTtlMs > 0) this.cacheMisses += 1;
      return null;
    }
    let blob = null;
    try {
      blob = await this.recordToBlob(record);
    } catch (error) {
      if (this.reloadCacheTtlMs > 0) this.cacheMisses += 1;
      logger.warn('Failed to read cached source blob; falling back to network source', {
        sourceKey: key,
        error: String(error?.message || error),
      });
      return null;
    }
    if (blob && this.reloadCacheTtlMs > 0) this.cacheHits += 1;
    if (blob && this.reloadCacheTtlMs > 0) {
      void this.touchIndexedDbRecord(key).catch(() => {});
    }
    if (blob && !this.meta.has(key)) {
      const restoredMeta = this.recordToMeta(record);
      this.meta.set(key, restoredMeta);
      this.sourceCount += 1;
      this.totalBytes += Number(restoredMeta.sizeBytes || 0);
    }
    if (blob) this.blobCache.set(key, blob);
    return blob;
  }

  /**
   * @param {string} sourceKey
   * @returns {Promise<(ArrayBuffer|null)>}
   */
  async getArrayBuffer(sourceKey) {
    const blob = await this.getBlob(sourceKey);
    return blob ? blob.arrayBuffer() : null;
  }

  /**
   * @param {string} sourceKey
   * @returns {Promise<void>}
   */
  async deleteSource(sourceKey) {
    const key = String(sourceKey || '');
    if (!key) return;

    await this.enqueueWrite(async () => {
      const previousMeta = this.meta.get(key) || null;
      if (this.blobCache?.map) this.blobCache.map.delete(key);

      if (this.mode === 'memory') {
        this.memoryEntries.delete(key);
        this.meta.delete(key);
        if (previousMeta) {
          this.sourceCount = Math.max(0, this.sourceCount - 1);
          this.totalBytes = Math.max(0, this.totalBytes - Number(previousMeta.sizeBytes || 0));
        }
        return;
      }

      try {
        const db = await this.ensureDb();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const txDone = transactionDone(tx);
        const request = tx.objectStore(STORE_NAME).delete(makeStorageKey(key, this.sessionId));
        await requestToPromise(request);
        await txDone;
      } finally {
        this.meta.delete(key);
        if (previousMeta) {
          this.sourceCount = Math.max(0, this.sourceCount - 1);
          this.totalBytes = Math.max(0, this.totalBytes - Number(previousMeta.sizeBytes || 0));
        }
      }
    });
  }


  /**
   * @returns {Promise<void>}
   */
  async cleanup() {
    await this.enqueueWrite(async () => {
      this.blobCache.clear();
      this.memoryEntries.clear();
      this.meta.clear();
      this.sourceCount = 0;
      this.totalBytes = 0;
      this.cacheHits = 0;
      this.cacheMisses = 0;

      if (this.mode !== 'indexeddb' || !this.indexedDbAvailable || this.reloadCacheTtlMs > 0) return;

      try {
        const db = await this.ensureDb();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('sessionId');
        await new Promise((resolve, reject) => {
          const req = index.openCursor(IDBKeyRange.only(this.sessionId));
          req.onerror = () => reject(req.error || new Error('Failed to iterate temp store session records'));
          req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) {
              resolve(undefined);
              return;
            }
            cursor.delete();
            cursor.continue();
          };
        });
        await transactionDone(tx);
      } catch (error) {
        logger.warn('Failed to clean IndexedDB temp store session', {
          error: String(error?.message || error),
        });
      }
    });
  }

  /**
   * @returns {Promise<void>}
   */
  async cleanupStaleSessions() {
    if (!this.indexedDbAvailable) return;
    if (this.cleanupPromise) return this.cleanupPromise;

    this.cleanupPromise = (async () => {
      try {
        const db = await this.ensureDb();
        const ttlMs = this.reloadCacheTtlMs > 0 ? this.reloadCacheTtlMs : Number(this.config.staleSessionTtlMs);
        const cutoff = Date.now() - Math.max(1000, ttlMs || 0);
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const index = tx.objectStore(STORE_NAME).index('createdAt');
        await new Promise((resolve, reject) => {
          const range = IDBKeyRange.upperBound(cutoff);
          const req = index.openCursor(range);
          req.onerror = () => reject(req.error || new Error('Failed to iterate stale temp-store records'));
          req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) {
              resolve(undefined);
              return;
            }
            cursor.delete();
            cursor.continue();
          };
        });
        await transactionDone(tx);
      } catch (error) {
        logger.warn('Failed to clean stale temp-store sessions', {
          error: String(error?.message || error),
        });
      } finally {
        this.cleanupPromise = null;
      }
    })();

    return this.cleanupPromise;
  }

  /**
   * @returns {Promise<IDBDatabase>}
   */
  async ensureDb() {
    if (!this.indexedDbAvailable) throw new Error('IndexedDB is not available');
    if (!this.dbPromise) this.dbPromise = openTempStoreDb();
    return this.dbPromise;
  }

  /**
   * @returns {Promise<(CryptoKey|null)>}
   */
  async ensureKey() {
    if (!this.encryptionAvailable) return null;
    if (!this.keyPromise) {
      if (this.reloadCacheTtlMs > 0) {
        this.keyPromise = getReloadCacheAesKey(this.sessionId, this.reloadCacheTtlMs, 'source')
          .then((key) => key || globalThis.crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
          ));
      } else {
        this.keyPromise = globalThis.crypto.subtle.generateKey(
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      }
    }
    return this.keyPromise;
  }

  /**
   * @returns {Promise<void>}
   */
  async maybePromote() {
    if (!this.indexedDbAvailable) return;
    if (this.mode !== 'memory') return;
    if (this.requestedMode === 'memory') return;

    const sourceThreshold = Math.max(0, Number(this.config.switchToIndexedDbAboveSourceCount) || 0);
    const sizeThresholdMiB = Math.max(0, Number(this.config.switchToIndexedDbAboveTotalMiB) || 0);
    const aboveSourceThreshold = sourceThreshold > 0 && this.sourceCount >= sourceThreshold;
    const aboveSizeThreshold = sizeThresholdMiB > 0 && this.totalBytes >= sizeThresholdMiB * 1024 * 1024;
    if (this.requestedMode !== 'indexeddb' && !aboveSourceThreshold && !aboveSizeThreshold) return;

    logger.info('Promoting temp store from memory to IndexedDB', {
      sourceCount: this.sourceCount,
      totalBytes: this.totalBytes,
    });

    try {
      await this.ensureDb();
      const entries = Array.from(this.memoryEntries.entries());
      for (const [sourceKey, entry] of entries) {
        const promotedMeta = {
          ...entry.meta,
          encrypted: this.encryptionAvailable,
        };
        await this.putIndexedDbEntry(promotedMeta, entry.blob);
        this.meta.set(sourceKey, promotedMeta);
        this.memoryEntries.set(sourceKey, { blob: entry.blob, meta: promotedMeta });
      }
      this.mode = 'indexeddb';
      this.memoryEntries.clear();
      this.blobCache.clear();
    } catch (error) {
      logger.warn('Failed to promote temp store to IndexedDB; continuing in memory mode', {
        error: String(error?.message || error),
      });
      this.mode = 'memory';
    }
  }

  /**
   * @param {SourceMeta} meta
   * @param {Blob} blob
   * @returns {Promise<void>}
   */
  async putIndexedDbEntry(meta, blob) {
    const record = await this.makeIndexedDbRecord(meta, blob);
    const db = await this.ensureDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const txDone = transactionDone(tx);
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(record);
    await requestToPromise(request);
    await txDone;
  }

  /**
   * @param {SourceMeta} meta
   * @param {Blob} blob
   * @returns {Promise<Object>}
   */
  async makeIndexedDbRecord(meta, blob) {
    const base = {
      id: meta.storageKey,
      sessionId: meta.sessionId,
      sourceKey: meta.sourceKey,
      fileExtension: meta.fileExtension,
      mimeType: meta.mimeType,
      originalUrl: meta.originalUrl,
      fileIndex: meta.fileIndex,
      sizeBytes: meta.sizeBytes,
      createdAt: meta.createdAt,
      encrypted: false,
      payload: null,
      iv: null,
    };

    const buffer = await blob.arrayBuffer();
    if (!this.encryptionAvailable) {
      return {
        ...base,
        payload: buffer,
      };
    }

    const key = await this.ensureKey();
    if (!key) {
      return {
        ...base,
        payload: buffer,
      };
    }

    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const cipherBuffer = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      buffer
    );

    return {
      ...base,
      encrypted: true,
      payload: cipherBuffer,
      iv: Array.from(iv),
    };
  }

  /**
   * @param {string} sourceKey
   * @returns {Promise<(Object|null)>}
   */
  async getIndexedDbRecord(sourceKey) {
    const db = await this.ensureDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const txDone = transactionDone(tx);
    const store = tx.objectStore(STORE_NAME);
    const record = await requestToPromise(store.get(makeStorageKey(sourceKey, this.sessionId)));
    await txDone;
    return record || null;
  }

  /**
   * @param {string} sourceKey
   * @returns {Promise<void>}
   */
  async touchIndexedDbRecord(sourceKey) {
    const db = await this.ensureDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const txDone = transactionDone(tx);
    const store = tx.objectStore(STORE_NAME);
    const storageKey = makeStorageKey(sourceKey, this.sessionId);
    const record = await requestToPromise(store.get(storageKey));
    if (record) {
      record.createdAt = Date.now();
      await requestToPromise(store.put(record));
    }
    await txDone;
  }

  /**
   * @param {*} record
   * @returns {SourceMeta}
   */
  recordToMeta(record) {
    return {
      sourceKey: String(record?.sourceKey || ''),
      sessionId: String(record?.sessionId || ''),
      storageKey: String(record?.id || ''),
      fileExtension: String(record?.fileExtension || '').toLowerCase(),
      mimeType: String(record?.mimeType || 'application/octet-stream'),
      originalUrl: String(record?.originalUrl || ''),
      fileIndex: Number.isFinite(record?.fileIndex) ? Number(record.fileIndex) : 0,
      sizeBytes: Number(record?.sizeBytes || 0),
      createdAt: Number(record?.createdAt || 0),
      encrypted: !!record?.encrypted,
    };
  }

  /**
   * @param {*} record
   * @returns {Promise<(Blob|null)>}
   */
  async recordToBlob(record) {
    if (!record || !record.payload) return null;

    let buffer = record.payload;
    if (record.encrypted) {
      const key = await this.ensureKey();
      if (!key) throw new Error('Encrypted temp-store payload cannot be read without a session key');
      const iv = new Uint8Array(Array.isArray(record.iv) ? record.iv : []);
      buffer = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        record.payload
      );
    }

    return new Blob([buffer], { type: String(record.mimeType || 'application/octet-stream') });
  }
}
