// File: src/ocr/__tests__/queue.test.js
/**
 * The OCR page queue: one page at a time in window order; outcomes land in the cache; a PDF
 * page with a usable text layer is skipped without recognition; replacing the window drops the
 * pages that have not started while the page in flight finishes; a document that leaves the
 * viewer takes its outcomes with it and aborts its in-flight page; pausing starts nothing new;
 * failures are recorded per page, and an engine that cannot start stops the queue. Engine,
 * prober and image loading are fakes, so nothing is recognised here.
 */
import { describe, expect, it, vi } from 'vitest';
import { OCR_PAGE_STATUS, createOcrQueue } from '../queue.js';
import { createOcrResultCache } from '../resultCache.js';
import { OCR_SKIP_REASON } from '../classify.js';
import { makeOcrPageKey } from '../../utils/ocrPageKey.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = async (rounds = 25) => {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
};

function makeEngine() {
  const pending = [];
  let failure = null;
  return {
    pending,
    // Same shape as createOcrEngine's getFailure: `{ kind, error }`.
    setFailure(kind) { failure = { kind, error: new Error(`OCR engine could not start (${kind})`) }; },
    recognize: vi.fn(() => {
      const job = deferred();
      pending.push(job);
      return job.promise;
    }),
    terminate: vi.fn(async () => {}),
    getFailure: () => failure,
  };
}

function candidate(sourceKey, pageIndex, { fileExtension = 'png', status = 1, viewerIndex = pageIndex } = {}) {
  const page = { sourceKey, pageIndex, fileExtension, status, fullSizeStatus: 1 };
  return { key: makeOcrPageKey(sourceKey, pageIndex), sourceKey, pageIndex, viewerIndex, page };
}

function makeQueue(overrides = {}) {
  const engine = makeEngine();
  const cache = createOcrResultCache();
  const snapshots = [];
  const events = [];
  const queue = createOcrQueue({
    engine,
    cache,
    probeTextLayer: vi.fn(async () => ({ usable: false, verdict: 'empty' })),
    getPageImage: vi.fn(async (entry) => ({ blob: `blob:${entry.key}`, width: 1240, height: 1754 })),
    log: { warn: vi.fn(), debug: vi.fn() },
    onChange: (snapshot) => snapshots.push(snapshot),
    onBusy: () => events.push('busy'),
    onIdle: () => events.push('idle'),
    ...overrides,
  });
  return { queue, engine, cache, snapshots, events, latest: () => snapshots[snapshots.length - 1] };
}

const result = (text) => ({ text, confidence: 90, words: [{ text, confidence: 90, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } }] });

describe('createOcrQueue', () => {
  it('works through the window one page at a time and caches each outcome with the image size', async () => {
    const { queue, engine, cache, events, latest } = makeQueue();
    const [a, b] = [candidate('doc', 0), candidate('doc', 1)];
    queue.setWindow([a, b]);
    await flush();

    expect(engine.recognize).toHaveBeenCalledTimes(1);
    expect(engine.recognize).toHaveBeenCalledWith(`blob:${a.key}`);
    expect(latest().pages[a.key]).toEqual({ status: OCR_PAGE_STATUS.RECOGNIZING });
    expect(latest().pages[b.key]).toEqual({ status: OCR_PAGE_STATUS.QUEUED });
    expect(latest().busy).toBe(true);
    expect(queue.isBusy()).toBe(true);

    engine.pending[0].resolve(result('första'));
    await flush();
    expect(cache.get(a.key)).toEqual({ status: OCR_PAGE_STATUS.DONE, text: 'första', confidence: 90, words: expect.any(Array), imageWidth: 1240, imageHeight: 1754 });
    expect(engine.recognize).toHaveBeenCalledTimes(2);

    engine.pending[1].resolve(result('andra'));
    await flush();
    expect(latest().pages[b.key].status).toBe(OCR_PAGE_STATUS.DONE);
    expect(latest().busy).toBe(false);
    expect(events).toEqual(['busy', 'busy', 'idle']);
  });

  it('skips a PDF page with a usable text layer and recognises one without', async () => {
    const probeTextLayer = vi.fn(async (sourceKey, pageIndex) => (
      pageIndex === 0 ? { usable: true, verdict: 'usable', characters: 400 } : { usable: false, verdict: 'empty', characters: 3 }
    ));
    const { queue, engine, cache, snapshots } = makeQueue({ probeTextLayer });
    const [text, scan] = [candidate('file.pdf', 0, { fileExtension: 'pdf' }), candidate('file.pdf', 1, { fileExtension: 'pdf' })];
    queue.setWindow([text, scan]);
    await flush();

    expect(probeTextLayer).toHaveBeenCalledWith('file.pdf', 0);
    expect(cache.get(text.key)).toEqual({ status: OCR_PAGE_STATUS.SKIPPED, reason: OCR_SKIP_REASON.TEXT_LAYER, assessment: { usable: true, verdict: 'usable', characters: 400 } });
    expect(snapshots.some((snapshot) => snapshot.pages[text.key]?.status === OCR_PAGE_STATUS.PROBING)).toBe(true);
    expect(engine.recognize).toHaveBeenCalledTimes(1);
    engine.pending[0].resolve(result('skannad'));
    await flush();
    expect(cache.get(scan.key).status).toBe(OCR_PAGE_STATUS.DONE);
  });

  it('skips unsupported and failed pages without probing or loading an image', async () => {
    const { queue, engine, cache } = makeQueue();
    const [failed, unsupported] = [candidate('doc', 0, { status: -1 }), candidate('doc', 1, { fileExtension: 'txt' })];
    queue.setWindow([failed, unsupported]);
    await flush();
    expect(cache.get(failed.key)).toEqual({ status: OCR_PAGE_STATUS.SKIPPED, reason: OCR_SKIP_REASON.FAILED_PAGE });
    expect(cache.get(unsupported.key)).toEqual({ status: OCR_PAGE_STATUS.SKIPPED, reason: OCR_SKIP_REASON.UNSUPPORTED });
    expect(engine.recognize).not.toHaveBeenCalled();
  });

  it('does not recognise a cached page again', async () => {
    const { queue, engine } = makeQueue();
    const a = candidate('doc', 0);
    queue.setWindow([a]);
    await flush();
    engine.pending[0].resolve(result('en gång'));
    await flush();
    queue.setWindow([]);
    queue.setWindow([a]);
    await flush();
    expect(engine.recognize).toHaveBeenCalledTimes(1);
    expect(queue.getSnapshot().pages[a.key].text).toBe('en gång');
  });

  it('drops queued pages when the window moves, lets the page in flight finish and keeps it', async () => {
    const { queue, engine, cache, latest } = makeQueue();
    const [a, b, c] = [candidate('doc', 0), candidate('doc', 1), candidate('doc', 7)];
    queue.setWindow([a, b]);
    await flush();
    queue.setWindow([c]);
    await flush();

    expect(latest().pages[b.key]).toBeUndefined();
    expect(latest().pages[a.key]).toEqual({ status: OCR_PAGE_STATUS.RECOGNIZING });
    expect(latest().pages[c.key]).toEqual({ status: OCR_PAGE_STATUS.QUEUED });
    expect(engine.recognize).toHaveBeenCalledTimes(1);

    engine.pending[0].resolve(result('klar'));
    await flush();
    expect(cache.get(a.key).text).toBe('klar');
    expect(engine.recognize).toHaveBeenCalledTimes(2);
    expect(engine.recognize).toHaveBeenLastCalledWith(`blob:${c.key}`);
    expect(engine.terminate).not.toHaveBeenCalled();
  });

  it('forgets a document that left the viewer and aborts its page in flight by terminating the engine', async () => {
    const { queue, engine, cache, latest } = makeQueue();
    const [old, next] = [candidate('old', 0), candidate('new', 0)];
    queue.setWindow([old]);
    await flush();
    const pendingOld = engine.pending[0];
    queue.retainSources(new Set(['new']));
    expect(engine.terminate).toHaveBeenCalledTimes(1);
    expect(latest().pages[old.key]).toBeUndefined();

    // The old worker's answer (or its rejection) arrives after the terminate: discarded either way.
    pendingOld.resolve(result('för sent'));
    await flush();
    expect(cache.has(old.key)).toBe(false);
    expect(latest().pages[old.key]).toBeUndefined();

    queue.setWindow([next]);
    await flush();
    expect(engine.recognize).toHaveBeenCalledTimes(2);
    expect(engine.recognize).toHaveBeenLastCalledWith(`blob:${next.key}`);
  });

  it('drops cached outcomes of documents that are not retained', async () => {
    const { queue, engine, cache } = makeQueue();
    const a = candidate('gone', 0);
    queue.setWindow([a]);
    await flush();
    engine.pending[0].resolve(result('x'));
    await flush();
    expect(cache.has(a.key)).toBe(true);
    queue.retainSources(new Set(['other']));
    expect(cache.has(a.key)).toBe(false);
    expect(queue.getSnapshot().pages).toEqual({});
    // A window for a document that is not retained is ignored.
    queue.setWindow([a]);
    await flush();
    expect(engine.recognize).toHaveBeenCalledTimes(1);
  });

  it('starts nothing while paused and resumes where it left off', async () => {
    const { queue, engine, latest } = makeQueue();
    const [a, b] = [candidate('doc', 0), candidate('doc', 1)];
    queue.setPaused(true);
    queue.setWindow([a, b]);
    await flush();
    expect(engine.recognize).not.toHaveBeenCalled();
    expect(latest().pages[a.key]).toEqual({ status: OCR_PAGE_STATUS.QUEUED });

    queue.setPaused(false);
    await flush();
    expect(engine.recognize).toHaveBeenCalledTimes(1);

    // Pausing mid-page: the page finishes, the next one waits.
    queue.setPaused(true);
    engine.pending[0].resolve(result('a'));
    await flush();
    expect(latest().pages[a.key].status).toBe(OCR_PAGE_STATUS.DONE);
    expect(engine.recognize).toHaveBeenCalledTimes(1);
    queue.setPaused(false);
    await flush();
    expect(engine.recognize).toHaveBeenCalledTimes(2);
  });

  it('records a failed page and continues with the next', async () => {
    const log = { warn: vi.fn(), debug: vi.fn() };
    const { queue, engine, cache } = makeQueue({ log });
    const [a, b] = [candidate('doc', 0), candidate('doc', 1)];
    queue.setWindow([a, b]);
    await flush();
    engine.pending[0].reject(new Error('image decode failed'));
    await flush();
    expect(cache.get(a.key)).toEqual({ status: OCR_PAGE_STATUS.FAILED, reason: 'image decode failed' });
    expect(log.warn).toHaveBeenCalledWith('OCR of a page failed', expect.objectContaining({ sourceKey: 'doc', pageIndex: 0 }));
    expect(engine.recognize).toHaveBeenCalledTimes(2);
  });

  it('records a page whose image cannot be loaded', async () => {
    const getPageImage = vi.fn(async () => { throw new Error('Page image is unavailable'); });
    const { queue, engine, cache } = makeQueue({ getPageImage });
    const a = candidate('doc', 0);
    queue.setWindow([a]);
    await flush();
    expect(cache.get(a.key)).toEqual({ status: OCR_PAGE_STATUS.FAILED, reason: 'Page image is unavailable' });
    expect(engine.recognize).not.toHaveBeenCalled();
  });

  it('stops after the engine reports it cannot start, instead of failing every page', async () => {
    const { queue, engine, latest } = makeQueue();
    const [a, b] = [candidate('doc', 0), candidate('doc', 1)];
    queue.setWindow([a, b]);
    await flush();
    engine.setFailure('csp');
    engine.pending[0].reject(new Error('OCR engine could not start (csp)'));
    await flush();
    expect(latest().pages[a.key]).toEqual({ status: OCR_PAGE_STATUS.FAILED, reason: 'engine:csp' });
    expect(latest().pages[b.key]).toEqual({ status: OCR_PAGE_STATUS.QUEUED });
    expect(latest().engineFailure).toBe('csp');
    expect(engine.recognize).toHaveBeenCalledTimes(1);
    queue.setWindow([b]);
    await flush();
    expect(engine.recognize).toHaveBeenCalledTimes(1);
  });

  it('reports idle after the engine failed, so the owner can release the prober and the worker', async () => {
    const { queue, engine, events } = makeQueue();
    queue.setWindow([candidate('doc', 0), candidate('doc', 1)]);
    await flush();
    engine.setFailure('assets');
    engine.pending[0].reject(new Error('OCR engine could not start (assets)'));
    await flush();
    expect(queue.getSnapshot().engineFailure).toBe('assets');
    expect(events[events.length - 1]).toBe('idle');
  });

  it('fails a page whose step never answers instead of blocking the queue, and drops a worker that stops answering', async () => {
    vi.useFakeTimers();
    try {
      const probeTextLayer = vi.fn(() => new Promise(() => {}));
      const { queue, engine, cache } = makeQueue({ probeTextLayer, timeouts: { probe: 50, image: 50, recognize: 100 } });
      const [stuckProbe, scan, next] = [candidate('pdf', 0, { fileExtension: 'pdf' }), candidate('doc', 0), candidate('doc', 1)];
      queue.setWindow([stuckProbe, scan, next]);
      await flush();
      expect(engine.recognize).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(50);
      await flush();
      expect(cache.get(stuckProbe.key)).toEqual({ status: OCR_PAGE_STATUS.FAILED, reason: 'OCR text-layer probe exceeded 50 ms' });
      expect(engine.terminate).not.toHaveBeenCalled();
      expect(engine.recognize).toHaveBeenCalledTimes(1);

      // Recognition that never answers: the page fails and the worker is terminated.
      await vi.advanceTimersByTimeAsync(100);
      await flush();
      expect(cache.get(scan.key)).toEqual({ status: OCR_PAGE_STATUS.FAILED, reason: 'OCR recognition exceeded 100 ms' });
      expect(engine.terminate).toHaveBeenCalledTimes(1);
      expect(engine.recognize).toHaveBeenCalledTimes(2);
      engine.pending[1].resolve(result('next'));
      await flush();
      expect(cache.get(next.key).status).toBe(OCR_PAGE_STATUS.DONE);
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases the engine only when idle', async () => {
    const { queue, engine } = makeQueue();
    const a = candidate('doc', 0);
    queue.setWindow([a]);
    await flush();
    await expect(queue.releaseEngineIfIdle()).resolves.toBe(false);
    expect(engine.terminate).not.toHaveBeenCalled();
    engine.pending[0].resolve(result('x'));
    await flush();
    await expect(queue.releaseEngineIfIdle()).resolves.toBe(true);
    expect(engine.terminate).toHaveBeenCalledTimes(1);
  });

  it('terminates the engine on dispose and goes quiet', async () => {
    const { queue, engine, snapshots } = makeQueue();
    const a = candidate('doc', 0);
    queue.setWindow([a]);
    await flush();
    const count = snapshots.length;
    queue.dispose();
    expect(engine.terminate).toHaveBeenCalledTimes(1);
    engine.pending[0].resolve(result('late'));
    await flush();
    queue.setWindow([candidate('doc', 1)]);
    await flush();
    expect(snapshots.length).toBe(count);
    expect(engine.recognize).toHaveBeenCalledTimes(1);
    await expect(queue.releaseEngineIfIdle()).resolves.toBe(false);
  });
});
