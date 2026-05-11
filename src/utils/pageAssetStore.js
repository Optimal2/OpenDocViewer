// File: src/utils/pageAssetStore.js
/**
 * OpenDocViewer — Browser-side rendered page-asset storage.
 *
 * Stores rendered page blobs (full pages and thumbnails) so a page only needs to be rasterized once
 * per session. Object URLs can still be evicted aggressively from RAM, but the underlying rendered
 * blobs remain recoverable from memory or IndexedDB without re-rendering from the original source.
 */

import logger from '../logging/systemLogger.js';
import { getDocumentLoadingConfig } from './documentLoadingConfig.js';
import { getReloadCacheAesKey } from './reloadCacheCrypto.js';

const DB_NAME = 'OpenDocViewerPageAssetStore';
const DB_VERSION = 1;
const STORE_NAME = 'assets';

/**
 * @param {string} assetKey
 * @param {string} sessionId
 * @returns {string}
 */
function makeStorageKey(assetKey, sessionId) {
  return `${sessionId}::${assetKey}`;
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
      return `odv_asset_${Date.now().toString(36)}_${hex}`;
    }
  } catch {}

  fallbackSessionCounter += 1;
  const perfNow = typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : 0;
  return `odv_asset_${Date.now().toString(36)}_${Math.floor(perfNow * 1000).toString(36)}_${fallbackSessionCounter.toString(36)}`;
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
function openAssetStoreDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? req.transaction.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: 'id' });

      if (!store.indexNames.contains('sessionId')) store.createIndex('sessionId', 'sessionId', { unique: false });
      if (!store.indexNames.contains('createdAt')) store.createIndex('createdAt', 'createdAt', { unique: false });
      if (!store.indexNames.contains('sourceKey')) store.createIndex('sourceKey', 'sourceKey', { unique: false });
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB asset store'));
  });
}

/**
 * @typedef {Object} PageAssetStoreStats
 * @property {'memory'|'indexeddb'} mode
 * @property {number} assetCount
 * @property {number} totalBytes
 * @property {boolean} encrypted
 * @property {boolean} indexedDbAvailable
 */

/**
 * @typedef {Object} StoredPageAssetMeta
 * @property {string} assetKey
 * @property {string} sessionId
 * @property {string} storageKey
 * @property {string} sourceKey
 * @property {number} pageIndex
 * @property {'full'|'thumbnail'} variant
 * @property {string} mimeType
 * @property {number} width
 * @property {number} height
 * @property {number} sizeBytes
 * @property {number} createdAt
 * @property {boolean} encrypted
 */

/**
 * @typedef {Object} PutPageAssetOptions
 * @property {string} assetKey
 * @property {string} sourceKey
 * @property {number} pageIndex
 * @property {'full'|'thumbnail'} variant
 * @property {Blob} blob
 * @property {string=} mimeType
 * @property {number=} width
 * @property {number=} height
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
 * @returns {PageAssetStore}
 */
export function createPageAssetStore(opts = {}) {
  return new PageAssetStore(opts);
}

export class PageAssetStore {
  /**
   * @param {Object=} opts
   */
  constructor(opts = {}) {
    const cfg = getDocumentLoadingConfig();
    this.config = {
      ...cfg.assetStore,
      ...opts,
    };

    this.reloadCacheTtlMs = Math.max(0, Number(this.config.reloadCacheTtlMs) || 0);
    this.sessionId = String(opts.sessionId || '').trim() || createSessionId();
    /** @type {Map<string, { blob: Blob, meta: StoredPageAssetMeta }>} */
    this.memoryEntries = new Map();
    /** @type {Map<string, StoredPageAssetMeta>} */
    this.meta = new Map();
    this.blobCache = new BlobLruCache(this.config.blobCacheEntries);

    this.assetCount = 0;
    this.totalBytes = 0;

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

    const expectedAssetCount = Math.max(0, Number(this.config.expectedAssetCount) || 0);
    const countThreshold = Math.max(0, Number(this.config.switchToIndexedDbAboveAssetCount) || 0);
    if (
      (this.reloadCacheTtlMs > 0 && this.indexedDbAvailable) ||
      this.requestedMode === 'indexeddb'
      || (this.requestedMode === 'adaptive' && countThreshold > 0 && expectedAssetCount >= countThreshold)
    ) {
      this.mode = this.indexedDbAvailable ? 'indexeddb' : 'memory';
    }

    if (this.mode === 'indexeddb' && !this.indexedDbAvailable) {
      logger.warn('IndexedDB page-asset store requested but unavailable; falling back to memory mode');
      this.mode = 'memory';
    }
  }

  /**
   * @returns {Promise<PageAssetStore>}
   */
  async ready() {
    if (this.mode === 'indexeddb') await this.ensureDb();
    await this.cleanupStaleSessions();
    return this;
  }

  /**
   * @returns {PageAssetStoreStats}
   */
  getStats() {
    return {
      mode: this.mode,
      assetCount: this.assetCount,
      totalBytes: this.totalBytes,
      encrypted: this.mode === 'indexeddb' && this.encryptionAvailable,
      indexedDbAvailable: this.indexedDbAvailable,
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
   * @returns {Promise<PageAssetStoreStats>}
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
   * @param {PutPageAssetOptions} options
   * @returns {Promise<StoredPageAssetMeta>}
   */
  async putAsset(options) {
    return this.enqueueWrite(async () => {
      const blob = options?.blob instanceof Blob ? options.blob : new Blob();
      const assetKey = String(options?.assetKey || '');
      if (!assetKey) throw new Error('putAsset requires assetKey');

      const meta = {
        assetKey,
        sessionId: this.sessionId,
        storageKey: makeStorageKey(assetKey, this.sessionId),
        sourceKey: String(options?.sourceKey || ''),
        pageIndex: Math.max(0, Number(options?.pageIndex) || 0),
        variant: String(options?.variant || 'full').toLowerCase() === 'thumbnail' ? 'thumbnail' : 'full',
        mimeType: String(options?.mimeType || blob.type || 'application/octet-stream'),
        width: Math.max(1, Number(options?.width) || 1),
        height: Math.max(1, Number(options?.height) || 1),
        sizeBytes: Number(blob.size || 0),
        createdAt: Date.now(),
        encrypted: this.mode === 'indexeddb' && this.encryptionAvailable,
      };

      const previousMeta = this.meta.get(assetKey) || null;
      const isUpdate = !!previousMeta;

      if (this.mode === 'memory') {
        this.memoryEntries.set(assetKey, { blob, meta });
        this.meta.set(assetKey, meta);
        this.blobCache.set(assetKey, blob);
        if (!isUpdate) {
          this.assetCount += 1;
          this.totalBytes += meta.sizeBytes;
        } else {
          this.totalBytes += meta.sizeBytes - previousMeta.sizeBytes;
        }
        await this.maybePromote();
        return this.meta.get(assetKey) || meta;
      }

      await this.putIndexedDbEntry(meta, blob);
      this.meta.set(assetKey, meta);
      this.blobCache.set(assetKey, blob);
      if (!isUpdate) {
        this.assetCount += 1;
        this.totalBytes += meta.sizeBytes;
      } else {
        this.totalBytes += meta.sizeBytes - previousMeta.sizeBytes;
      }
      return meta;
    });
  }

  /**
   * @param {string} assetKey
   * @returns {Promise<({ meta:StoredPageAssetMeta, blob:Blob }|null)>}
   */
  async getAsset(assetKey) {
    const key = String(assetKey || '');
    if (!key) return null;

    const meta = this.meta.get(key) || null;
    const cached = this.blobCache.get(key);
    if (meta && cached) return { meta, blob: cached };

    if (this.mode === 'memory') {
      const entry = this.memoryEntries.get(key) || null;
      if (!entry) return null;
      this.blobCache.set(key, entry.blob);
      return entry;
    }

    const record = await this.getIndexedDbRecord(key);
    if (!record) return null;
    let blob = null;
    try {
      blob = await this.recordToBlob(record);
    } catch (error) {
      logger.warn('Failed to read cached page asset; rerendering from source', {
        assetKey: key,
        error: String(error?.message || error),
      });
      return null;
    }
    if (blob && this.reloadCacheTtlMs > 0) {
      void this.touchIndexedDbRecord(key).catch(() => {});
    }
    const nextMeta = this.recordToMeta(record);
    const wasKnown = this.meta.has(key);
    this.meta.set(key, nextMeta);
    if (!wasKnown) {
      this.assetCount += 1;
      this.totalBytes += Number(nextMeta.sizeBytes || 0);
    }
    if (blob) this.blobCache.set(key, blob);
    return blob ? { meta: nextMeta, blob } : null;
  }

  /**
   * @returns {Promise<void>}
   */
  async cleanup() {
    await this.enqueueWrite(async () => {
      this.blobCache.clear();
      this.memoryEntries.clear();
      this.meta.clear();
      this.assetCount = 0;
      this.totalBytes = 0;

      if (this.mode !== 'indexeddb' || !this.indexedDbAvailable || this.reloadCacheTtlMs > 0) return;

      try {
        const db = await this.ensureDb();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const index = tx.objectStore(STORE_NAME).index('sessionId');
        await new Promise((resolve, reject) => {
          const req = index.openCursor(IDBKeyRange.only(this.sessionId));
          req.onerror = () => reject(req.error || new Error('Failed to iterate page-asset session records'));
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
        logger.warn('Failed to clean IndexedDB page-asset session', {
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
          req.onerror = () => reject(req.error || new Error('Failed to iterate stale page-asset records'));
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
        logger.warn('Failed to clean stale page-asset sessions', {
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
    if (!this.dbPromise) this.dbPromise = openAssetStoreDb();
    return this.dbPromise;
  }

  /**
   * @returns {Promise<(CryptoKey|null)>}
   */
  async ensureKey() {
    if (!this.encryptionAvailable) return null;
    if (!this.keyPromise) {
      if (this.reloadCacheTtlMs > 0) {
        this.keyPromise = getReloadCacheAesKey(this.sessionId, this.reloadCacheTtlMs, 'asset')
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

    const assetThreshold = Math.max(0, Number(this.config.switchToIndexedDbAboveAssetCount) || 0);
    const sizeThresholdMiB = Math.max(0, Number(this.config.switchToIndexedDbAboveTotalMiB) || 0);
    const aboveAssetThreshold = assetThreshold > 0 && this.assetCount >= assetThreshold;
    const aboveSizeThreshold = sizeThresholdMiB > 0 && this.totalBytes >= sizeThresholdMiB * 1024 * 1024;
    if (this.requestedMode !== 'indexeddb' && !aboveAssetThreshold && !aboveSizeThreshold) return;

    logger.info('Promoting page-asset store from memory to IndexedDB', {
      assetCount: this.assetCount,
      totalBytes: this.totalBytes,
    });

    try {
      await this.ensureDb();
      const entries = Array.from(this.memoryEntries.entries());
      for (const [assetKey, entry] of entries) {
        const promotedMeta = {
          ...entry.meta,
          encrypted: this.encryptionAvailable,
        };
        await this.putIndexedDbEntry(promotedMeta, entry.blob);
        this.meta.set(assetKey, promotedMeta);
        this.memoryEntries.set(assetKey, { blob: entry.blob, meta: promotedMeta });
      }
      this.mode = 'indexeddb';
      this.memoryEntries.clear();
      this.blobCache.clear();
    } catch (error) {
      logger.warn('Failed to promote page-asset store to IndexedDB; continuing in memory mode', {
        error: String(error?.message || error),
      });
      this.mode = 'memory';
    }
  }

  /**
   * @param {StoredPageAssetMeta} meta
   * @param {Blob} blob
   * @returns {Promise<void>}
   */
  async putIndexedDbEntry(meta, blob) {
    const record = await this.makeIndexedDbRecord(meta, blob);
    const db = await this.ensureDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const txDone = transactionDone(tx);
    const request = tx.objectStore(STORE_NAME).put(record);
    await requestToPromise(request);
    await txDone;
  }

  /**
   * @param {StoredPageAssetMeta} meta
   * @param {Blob} blob
   * @returns {Promise<Object>}
   */
  async makeIndexedDbRecord(meta, blob) {
    const base = {
      id: meta.storageKey,
      sessionId: meta.sessionId,
      assetKey: meta.assetKey,
      sourceKey: meta.sourceKey,
      pageIndex: meta.pageIndex,
      variant: meta.variant,
      mimeType: meta.mimeType,
      width: meta.width,
      height: meta.height,
      sizeBytes: meta.sizeBytes,
      createdAt: meta.createdAt,
      encrypted: false,
      payload: null,
      iv: null,
    };

    const buffer = await blob.arrayBuffer();
    if (!this.encryptionAvailable) return { ...base, payload: buffer };

    const key = await this.ensureKey();
    if (!key) return { ...base, payload: buffer };

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
   * @param {Object} record
   * @returns {StoredPageAssetMeta}
   */
  recordToMeta(record) {
    return {
      assetKey: String(record?.assetKey || ''),
      sessionId: String(record?.sessionId || ''),
      storageKey: String(record?.id || ''),
      sourceKey: String(record?.sourceKey || ''),
      pageIndex: Math.max(0, Number(record?.pageIndex) || 0),
      variant: String(record?.variant || 'full').toLowerCase() === 'thumbnail' ? 'thumbnail' : 'full',
      mimeType: String(record?.mimeType || 'application/octet-stream'),
      width: Math.max(1, Number(record?.width) || 1),
      height: Math.max(1, Number(record?.height) || 1),
      sizeBytes: Number(record?.sizeBytes || 0),
      createdAt: Number(record?.createdAt || 0),
      encrypted: !!record?.encrypted,
    };
  }

  /**
   * @param {string} assetKey
   * @returns {Promise<(Object|null)>}
   */
  async getIndexedDbRecord(assetKey) {
    const db = await this.ensureDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const txDone = transactionDone(tx);
    const store = tx.objectStore(STORE_NAME);
    const record = await requestToPromise(store.get(makeStorageKey(assetKey, this.sessionId)));
    await txDone;
    return record || null;
  }

  /**
   * @param {string} assetKey
   * @returns {Promise<void>}
   */
  async touchIndexedDbRecord(assetKey) {
    const db = await this.ensureDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const txDone = transactionDone(tx);
    const store = tx.objectStore(STORE_NAME);
    const storageKey = makeStorageKey(assetKey, this.sessionId);
    const record = await requestToPromise(store.get(storageKey));
    if (record) {
      record.createdAt = Date.now();
      await requestToPromise(store.put(record));
    }
    await txDone;
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
      if (!key) throw new Error('Encrypted page-asset payload cannot be read without a session key');
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
