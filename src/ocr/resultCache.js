// File: src/ocr/resultCache.js
/**
 * In-memory cache of OCR outcomes, one entry per document page.
 *
 * The cache is the only place recognised text is kept: it lives in the page's JavaScript heap for
 * the session, is bounded (least recently used entries go first), drops a document's entries
 * when that document leaves the viewer, and is never written to localStorage, IndexedDB or any
 * server. Part of the lazy OCR chunk.
 */

/** Pages kept per session before the least recently used outcome is dropped. */
export const DEFAULT_OCR_CACHE_LIMIT = 200;

/**
 * @typedef {Object} OcrResultCache
 * @property {function(string): boolean} has
 * @property {function(string): (Object|undefined)} get  Returns the outcome and marks it recently used.
 * @property {function(string, string, Object): void} set  `set(key, sourceKey, outcome)`.
 * @property {function(string): boolean} delete
 * @property {function(Set<string>): Array<string>} retainSources
 *   Drops every outcome whose source key is not in the set; returns the dropped keys.
 * @property {function(): Array<Array<*>>} entries  `[key, outcome]` pairs, oldest first.
 * @property {function(): void} clear
 * @property {function(): number} size
 */

/**
 * @param {Object=} options
 * @param {number=} options.limit  Maximum number of cached pages (default DEFAULT_OCR_CACHE_LIMIT).
 * @returns {OcrResultCache}
 */
export function createOcrResultCache({ limit = DEFAULT_OCR_CACHE_LIMIT } = {}) {
  const max = Math.max(1, Math.floor(Number(limit)) || DEFAULT_OCR_CACHE_LIMIT);
  /** @type {Map<string, { sourceKey: string, outcome: Object }>} */
  const store = new Map();

  return {
    has(key) {
      return store.has(key);
    },
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      store.delete(key);
      store.set(key, entry);
      return entry.outcome;
    },
    set(key, sourceKey, outcome) {
      if (!key || !outcome) return;
      store.delete(key);
      store.set(key, { sourceKey: String(sourceKey ?? ''), outcome });
      while (store.size > max) {
        const oldest = store.keys().next().value;
        store.delete(oldest);
      }
    },
    delete(key) {
      return store.delete(key);
    },
    retainSources(sourceKeys) {
      const dropped = [];
      for (const [key, entry] of store) {
        if (!sourceKeys.has(entry.sourceKey)) dropped.push(key);
      }
      for (const key of dropped) store.delete(key);
      return dropped;
    },
    entries() {
      return [...store].map(([key, entry]) => [key, entry.outcome]);
    },
    clear() {
      store.clear();
    },
    size() {
      return store.size;
    },
  };
}
