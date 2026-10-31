/** @vitest-environment node */
// The work-scaled time budget, the per-page watchdog and the single-container
// resource resolution of the pdf.js differential (docs-src/pdf-signatures.md
// "pdf.js differential confirmation"). A fake pdf.js stands in for the viewer's
// build so that page work can take tens of seconds of fake time: like pdf.js,
// it resolves the operator list BEFORE the page's image arrives in `page.objs`,
// so a comparison that does not wait for the decoded object compares nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createRenderComparator, renderCheckBudgetMs, renderCheckLimits, renderCheckVerdict, resolveResource,
  RENDER_CHECK_MAX_TOTAL_MS, RENDER_CHECK_PAGE_WATCHDOG_MS, RENDER_CHECK_PER_PAGE_MS, RENDER_CHECK_STARTUP_MS
} from '../pdfSignatureRenderCheck.js';

const FILE_LENGTH = 100;
const SIGNED_END = 50;
const PAINT_IMAGE = 85;

/** A pdf.js object container: get(id) when resolved, get(id, callback) otherwise. */
class Objs {
  constructor() { this.values = new Map(); this.waiting = new Map(); this.registered = []; }
  has(id) { return this.values.has(id); }
  get(id, callback) {
    if (!callback) return this.values.get(id);
    this.registered.push(id);
    if (this.values.has(id)) return callback(this.values.get(id));
    this.waiting.set(id, [...(this.waiting.get(id) ?? []), callback]);
    return undefined;
  }
  resolve(id, value) {
    this.values.set(id, value);
    for (const callback of this.waiting.get(id) ?? []) callback(value);
    this.waiting.delete(id);
  }
}

/**
 * @param {Object} spec
 * @param {number} spec.pages
 * @param {number} [spec.pageMs] fake ms until a page's operator list is ready
 * @param {number} [spec.imageMs] further fake ms until its image arrives
 * @param {number} [spec.images] images per page
 * @param {Function} [spec.pixels] (revision, pageIndex, imageIndex) => Uint8Array of an image
 * @param {number} [spec.stallPage] 1-based page whose operator list never arrives
 * @param {Function} [spec.afterImage] (revision, pageIndex, imageIndex, data) => void, run once an image has resolved
 */
function fakePdfjs({ pages, pageMs = 0, imageMs = 10, images = 1, pixels = () => new Uint8Array(16), stallPage = null, afterImage = () => {} }) {
  const later = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));
  const optional = Object.assign(new Map(), { name: null, creator: null, getOrder: () => null });
  const getDocument = ({ data }) => {
    const revision = data.length === FILE_LENGTH ? 'final' : 'signed';
    const commonObjs = new Objs();
    const doc = {
      numPages: pages,
      getFieldObjects: async () => null,
      getOptionalContentConfig: async () => optional,
      getJSActions: async () => null,
      getOpenAction: async () => null,
      getAttachments: async () => null,
      getOutline: async () => null,
      getDestinations: async () => ({}),
      getPageLabels: async () => null,
      getPage: async (number) => {
        const objs = new Objs();
        const ids = Array.from({ length: images }, (_, k) => `img_p${number - 1}_${k + 1}`);
        return {
          view: [0, 0, 595, 842], rotate: 0, userUnit: 1, objs, commonObjs,
          getOperatorList: () => {
            if (number === stallPage) return new Promise(() => {});
            return later(pageMs).then(() => {
              ids.forEach((id, k) => setTimeout(() => {
                const data = pixels(revision, number - 1, k);
                objs.resolve(id, { width: 4, height: 4, kind: 3, data });
                afterImage(revision, number - 1, k, data);
              }, imageMs));
              return { fnArray: ids.map(() => PAINT_IMAGE), argsArray: ids.map((id) => [id, 4, 4]) };
            });
          },
          getTextContent: async () => ({ items: [], styles: {} }),
          getAnnotations: async () => [],
          getJSActions: async () => null,
          cleanup: () => {}
        };
      }
    };
    return { promise: Promise.resolve(doc), destroy: async () => {} };
  };
  return async () => ({ getDocument });
}

/** Drive fake time in small steps; every digest settles as a microtask (see beforeEach). */
async function settle(promise) {
  let result;
  let done = false;
  promise.then((value) => { result = value; done = true; });
  const started = Date.now();
  for (let i = 0; i < 20000 && !done; i++) await vi.advanceTimersByTimeAsync(100);
  if (!done) throw new Error('comparison did not settle');
  return { result, elapsedMs: Date.now() - started };
}

async function compareWith(spec, options = {}) {
  const onProgress = vi.fn();
  const comparator = createRenderComparator(new Uint8Array(FILE_LENGTH), { loadPdfjs: fakePdfjs(spec), onProgress, ...options });
  try {
    return { ...(await settle(comparator.compare(SIGNED_END))), onProgress };
  } finally {
    await comparator.destroy();
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  // WebCrypto settles on a later event-loop turn in real time, which fake time cannot wait
  // for; the same SHA-256 resolving as a microtask keeps the fake clock deterministic.
  vi.stubGlobal('crypto', { subtle: { digest: async (_alg, data) => createHash('sha256').update(data).digest() } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('the budget scales with the page count', () => {
  it('startup + pages x per page, bounded by the total cap', () => {
    expect(renderCheckBudgetMs(0)).toBe(RENDER_CHECK_STARTUP_MS);
    expect(renderCheckBudgetMs(1)).toBe(RENDER_CHECK_STARTUP_MS + RENDER_CHECK_PER_PAGE_MS);
    expect(renderCheckBudgetMs(60)).toBe(RENDER_CHECK_STARTUP_MS + 60 * RENDER_CHECK_PER_PAGE_MS);
    expect(renderCheckBudgetMs(60)).toBeGreaterThan(renderCheckBudgetMs(30));
    expect(renderCheckBudgetMs(30)).toBeGreaterThan(renderCheckBudgetMs(1));
    expect(renderCheckBudgetMs(1000)).toBe(RENDER_CHECK_MAX_TOTAL_MS);
  });

  it('the chosen numbers keep the measured headroom (docs-src/pdf-signatures.md)', () => {
    const slowestMsPerPage = 800; // jpeg-text, measured 799.6 ms/page + 105 ms
    expect(RENDER_CHECK_PER_PAGE_MS).toBeGreaterThanOrEqual(3 * slowestMsPerPage);
    // 200 pages of the slowest measured form complete inside the cap.
    expect(renderCheckBudgetMs(200)).toBeGreaterThan(200 * slowestMsPerPage + 1500);
    // The old constant 20 s budget timed out at ~25 such pages; 60 pages now fit.
    expect(renderCheckBudgetMs(60)).toBeGreaterThan(60 * slowestMsPerPage + 1500);
    // The watchdog is well above one slow page and far below the whole budget.
    expect(RENDER_CHECK_PAGE_WATCHDOG_MS).toBeGreaterThanOrEqual(10 * slowestMsPerPage);
    expect(RENDER_CHECK_PAGE_WATCHDOG_MS * 10).toBeLessThanOrEqual(RENDER_CHECK_MAX_TOTAL_MS);
  });

  it('overrides apply only to positive numbers', () => {
    expect(renderCheckLimits({ perPageMs: 7, startupMs: -1, maxTotalMs: Number.NaN })).toEqual({
      startupMs: RENDER_CHECK_STARTUP_MS, perPageMs: 7, maxTotalMs: RENDER_CHECK_MAX_TOTAL_MS, pageWatchdogMs: RENDER_CHECK_PAGE_WATCHDOG_MS
    });
  });
});

describe('end to end with a slow fake pdf.js', () => {
  it('30 pages of 1 s each (30 s, past the old constant 20 s budget) compare "same"', async () => {
    const { result, elapsedMs, onProgress } = await compareWith({ pages: 30, pageMs: 1000 });
    expect(elapsedMs).toBeGreaterThan(20000);
    expect(result).toEqual({ outcome: 'same', detail: '30 page(s) identical in pdf.js' });
    expect(renderCheckVerdict(result)).toBeNull();
    expect(onProgress).toHaveBeenCalledTimes(30);
  });

  it('an image that differs only after the operator list resolved is "different" on its page', async () => {
    const pixels = (revision, index) => new Uint8Array(16).fill(revision === 'final' && index === 27 ? 9 : 1);
    const { result } = await compareWith({ pages: 30, pageMs: 1000, imageMs: 500, pixels });
    expect(result).toEqual({ outcome: 'different', detail: 'page 28 operator list' });
    expect(renderCheckVerdict(result)).toMatchObject({ integrity: 'modified-after-signing', code: 'content-changed-after-signing' });
  });

  it('a stalled page fails closed after the per-page watchdog, not after the whole budget', async () => {
    const { result, elapsedMs } = await compareWith({ pages: 30, pageMs: 100, stallPage: 3 });
    expect(result).toMatchObject({ outcome: 'unavailable', code: 'timeout', detail: `page 3 took longer than ${RENDER_CHECK_PAGE_WATCHDOG_MS} ms` });
    // Pages 1-2 plus the watchdog, far below this document's budget of 5 s + 30 x 2.5 s = 80 s.
    expect(elapsedMs).toBeGreaterThanOrEqual(RENDER_CHECK_PAGE_WATCHDOG_MS);
    expect(elapsedMs).toBeLessThan(RENDER_CHECK_PAGE_WATCHDOG_MS + 5000);
    expect(renderCheckBudgetMs(30)).toBe(80000);
    expect(renderCheckVerdict(result)).toMatchObject({ integrity: 'indeterminate', code: 'timeout' });
  });

  it('pages that each stay under the watchdog but together exceed the scaled budget time out', async () => {
    // 4 pages x 4 s = 16 s > 5 s + 4 x 2.5 s = 15 s.
    const { result } = await compareWith({ pages: 4, pageMs: 4000 });
    expect(result).toMatchObject({ outcome: 'unavailable', code: 'timeout', detail: 'time budget of 15000 ms for 4 page(s) exceeded' });
  });

  it('the total cap holds for all comparisons of one file together', async () => {
    const comparator = createRenderComparator(new Uint8Array(FILE_LENGTH), {
      loadPdfjs: fakePdfjs({ pages: 4, pageMs: 1000 }), budget: { maxTotalMs: 6000 }
    });
    expect((await settle(comparator.compare(SIGNED_END))).result.outcome).toBe('same');
    const second = (await settle(comparator.compare(SIGNED_END))).result;
    expect(second).toMatchObject({ outcome: 'unavailable', code: 'timeout' });
    await comparator.destroy();
  });

  it('large blobs are bound to their position and length: bytes shifted between two images differ', async () => {
    const size = 70000; // above the in-place hashing threshold
    // The same concatenated bytes on page 2, split 70001 + 69999 instead of 70000 + 70000.
    const shifted = (revision, page, k) => new Uint8Array(revision === 'final' && page === 1 ? size + (k === 0 ? 1 : -1) : size).fill(5);
    expect((await compareWith({ pages: 3, images: 2, pixels: shifted })).result).toEqual({ outcome: 'different', detail: 'page 2 operator list' });
    expect((await compareWith({ pages: 3, images: 2, pixels: () => new Uint8Array(size).fill(5) })).result.outcome).toBe('same');
    const oneByte = (revision, page, k) => {
      const data = new Uint8Array(size).fill(5);
      if (revision === 'final' && page === 2 && k === 1) data[size - 1] = 6;
      return data;
    };
    expect((await compareWith({ pages: 3, images: 2, pixels: oneByte })).result).toEqual({ outcome: 'different', detail: 'page 3 operator list' });
  });
});

describe('a resource is awaited only on the container that receives it', () => {
  const page = () => ({ objs: new Objs(), commonObjs: new Objs() });

  it('a page-local id never registers on commonObjs', async () => {
    const p = page();
    const pending = resolveResource(p, 'img_p0_1');
    expect(p.objs.registered).toEqual(['img_p0_1']);
    expect(p.commonObjs.registered).toEqual([]);
    p.objs.resolve('img_p0_1', 'pixels');
    expect(await pending).toBe('pixels');
  });

  it('a g_* id never registers on page.objs', async () => {
    const p = page();
    for (const id of ['g_d0_f1', 'g_d0_img_p0_1']) {
      const pending = resolveResource(p, id);
      p.commonObjs.resolve(id, id.toUpperCase());
      expect(await pending).toBe(id.toUpperCase());
    }
    expect(p.commonObjs.registered).toEqual(['g_d0_f1', 'g_d0_img_p0_1']);
    expect(p.objs.registered).toEqual([]);
  });

  it('an already resolved object is read without registering a callback', async () => {
    const p = page();
    p.objs.resolve('img_p0_1', 'ready');
    expect(await resolveResource(p, 'img_p0_1')).toBe('ready');
    expect(p.objs.registered).toEqual([]);
  });
});

describe('a large blob is re-validated before it is hashed', () => {
  it('a large blob detached or resized before it is hashed fails closed (viewer-error), never "same"', async () => {
    const size = 70000; // above the in-place hashing threshold
    // Each page's first image really differs between the revisions; its second is identical.
    const pixels = (revision, page, k) => new Uint8Array(new ArrayBuffer(size, { maxByteLength: size })).fill(revision === 'final' && k === 0 ? 9 : 1);
    // The first image is already encoded (its H record holds a live reference) while the
    // comparison waits for the second; it is then detached or shrunk before ops.digest().
    const between = (change) => {
      const first = new Map();
      return (revision, page, k, data) => {
        if (k === 0) first.set(`${revision}/${page}`, data);
        else change(first.get(`${revision}/${page}`));
      };
    };
    const detach = between((data) => { structuredClone(data.buffer, { transfer: [data.buffer] }); });
    const shrink = between((data) => { data.buffer.resize(size - 1); });
    for (const afterImage of [detach, shrink]) {
      // Without the re-validation both revisions would hash the first image as empty input: "same".
      const { result } = await compareWith({ pages: 2, images: 2, pixels, afterImage });
      expect(result.outcome).not.toBe('same');
      expect(result).toMatchObject({ outcome: 'unavailable', code: 'viewer-error', detail: 'pdf.js data changed length or was detached before it was hashed' });
      expect(renderCheckVerdict(result)).toMatchObject({ integrity: 'indeterminate', code: 'viewer-error' });
    }
    // The same resizable buffers left alone still compare on their content.
    expect((await compareWith({ pages: 2, images: 2, pixels })).result).toEqual({ outcome: 'different', detail: 'page 1 operator list' });
  });
});
