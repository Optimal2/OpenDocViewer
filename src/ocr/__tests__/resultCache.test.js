// File: src/ocr/__tests__/resultCache.test.js
/**
 * The OCR result cache keeps outcomes in memory only, bounded by a least-recently-used limit,
 * and drops a document's outcomes when that document is no longer retained.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_OCR_CACHE_LIMIT, createOcrResultCache } from '../resultCache.js';

const outcome = (text) => ({ status: 'done', text });

describe('createOcrResultCache', () => {
  it('stores and returns outcomes per key', () => {
    const cache = createOcrResultCache();
    cache.set('doc\u001f0', 'doc', outcome('one'));
    expect(cache.has('doc\u001f0')).toBe(true);
    expect(cache.get('doc\u001f0')).toEqual(outcome('one'));
    expect(cache.get('doc\u001f1')).toBeUndefined();
    expect(cache.size()).toBe(1);
  });

  it('ignores empty keys and empty outcomes', () => {
    const cache = createOcrResultCache();
    cache.set('', 'doc', outcome('x'));
    cache.set('doc\u001f0', 'doc', null);
    expect(cache.size()).toBe(0);
  });

  it('evicts the least recently used outcome beyond the limit, counting reads as use', () => {
    const cache = createOcrResultCache({ limit: 2 });
    cache.set('a', 'doc', outcome('a'));
    cache.set('b', 'doc', outcome('b'));
    cache.get('a');
    cache.set('c', 'doc', outcome('c'));
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
  });

  it('defaults to DEFAULT_OCR_CACHE_LIMIT pages', () => {
    const cache = createOcrResultCache();
    for (let index = 0; index <= DEFAULT_OCR_CACHE_LIMIT; index += 1) cache.set(`k${index}`, 'doc', outcome(index));
    expect(cache.size()).toBe(DEFAULT_OCR_CACHE_LIMIT);
    expect(cache.has('k0')).toBe(false);
  });

  it('drops outcomes of documents that are not retained and reports their keys', () => {
    const cache = createOcrResultCache();
    cache.set('a\u001f0', 'a', outcome('a0'));
    cache.set('a\u001f1', 'a', outcome('a1'));
    cache.set('b\u001f0', 'b', outcome('b0'));
    expect(cache.retainSources(new Set(['b'])).sort()).toEqual(['a\u001f0', 'a\u001f1']);
    expect(cache.entries()).toEqual([['b\u001f0', outcome('b0')]]);
    expect(cache.retainSources(new Set())).toEqual(['b\u001f0']);
    expect(cache.size()).toBe(0);
  });

  it('lists entries oldest first and clears', () => {
    const cache = createOcrResultCache();
    cache.set('x', 'doc', outcome(1));
    cache.set('y', 'doc', outcome(2));
    cache.set('x', 'doc', outcome(3));
    expect(cache.entries().map(([key]) => key)).toEqual(['y', 'x']);
    cache.clear();
    expect(cache.size()).toBe(0);
  });
});
