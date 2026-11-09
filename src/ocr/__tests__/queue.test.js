// File: src/ocr/__tests__/queue.test.js
/**
 * The OCR page queue: one page at a time in window order (or `concurrency` pages on a pool, each
 * abortable on its own); outcomes land in the cache; a PDF
 * page with a usable text layer is skipped without recognition; replacing the window drops the
 * pages that have not started while the page in flight finishes; a document that leaves the
 * viewer takes its outcomes with it and aborts its in-flight page; pausing starts nothing new;
 * failures are recorded per page, and an engine that cannot start stops the queue. Engine,
 * prober and image loading are fakes, so nothing is recognised here.
 */
import { describe, expect, it, vi } from 'vitest';
import { OCR_OUTCOME_SOURCE, OCR_PAGE_STATUS, createOcrQueue } from '../queue.js';
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
    expect(engine.recognize).toHaveBeenCalledWith(`blob:${a.key}`, expect.any(Object));
    expect(latest().pages[a.key]).toEqual({ status: OCR_PAGE_STATUS.RECOGNIZING });
    expect(latest().pages[b.key]).toEqual({ status: OCR_PAGE_STATUS.QUEUED });
    expect(latest().busy).toBe(true);
    expect(queue.isBusy()).toBe(true);

    engine.pending[0].resolve(result('första'));
    await flush();
    expect(cache.get(a.key)).toEqual({ status: OCR_PAGE_STATUS.DONE, source: OCR_OUTCOME_SOURCE.RECOGNITION, text: 'första', confidence: 90, words: expect.any(Array), imageWidth: 1240, imageHeight: 1754, rulingLinePixels: 0 });
    expect(engine.recognize).toHaveBeenCalledTimes(2);

    engine.pending[1].resolve(result('andra'));
    await flush();
    expect(latest().pages[b.key].status).toBe(OCR_PAGE_STATUS.DONE);
    expect(latest().busy).toBe(false);
    expect(events).toEqual(['busy', 'busy', 'idle']);
  });

  it('takes a PDF page with a usable text layer as done from its own words, without the engine, and recognises one without', async () => {
    const layerWords = [{ text: 'Egen', confidence: 100, bbox: { x0: 60, y0: 50, x1: 90, y1: 64 } }];
    const probeTextLayer = vi.fn(async (sourceKey, pageIndex) => (
      pageIndex === 0
        ? { usable: true, verdict: 'usable', characters: 400, letters: 380, privateUse: 0, words: layerWords, text: 'Egen text', pageWidth: 595.28, pageHeight: 841.89 }
        : { usable: false, verdict: 'empty', characters: 3, letters: 3, privateUse: 0 }
    ));
    const { queue, engine, cache, snapshots } = makeQueue({ probeTextLayer });
    const [text, scan] = [candidate('file.pdf', 0, { fileExtension: 'pdf' }), candidate('file.pdf', 1, { fileExtension: 'pdf' })];
    queue.setWindow([text, scan]);
    await flush();

    expect(probeTextLayer).toHaveBeenCalledWith('file.pdf', 0);
    // The page's own text in the shape of a recognised page: searchable, with the base
    // viewport as the frame the boxes are in.
    expect(cache.get(text.key)).toEqual({
      status: OCR_PAGE_STATUS.DONE,
      source: OCR_OUTCOME_SOURCE.PDF_TEXT,
      text: 'Egen text',
      confidence: 100,
      words: layerWords,
      imageWidth: 595.28,
      imageHeight: 841.89,
      rulingLinePixels: 0,
    });
    expect(snapshots.some((snapshot) => snapshot.pages[text.key]?.status === OCR_PAGE_STATUS.PROBING)).toBe(true);
    expect(snapshots.some((snapshot) => snapshot.pages[text.key]?.status === OCR_PAGE_STATUS.RECOGNIZING)).toBe(false);
    // The engine ran once: for the scanned page only.
    expect(engine.recognize).toHaveBeenCalledTimes(1);
    expect(engine.recognize).toHaveBeenCalledWith(`blob:${scan.key}`, expect.any(Object));
    engine.pending[0].resolve(result('skannad'));
    await flush();
    expect(cache.get(scan.key)).toMatchObject({ status: OCR_PAGE_STATUS.DONE, source: OCR_OUTCOME_SOURCE.RECOGNITION });
  });

  it('gives a done outcome the language the injected guess returns, from the engine and from a text layer alike', async () => {
    const detectLanguage = vi.fn((outcome) => (outcome.words.some((word) => word.text === 'och') ? 'sv' : null));
    const layerWords = [{ text: 'och', confidence: 100, bbox: { x0: 60, y0: 50, x1: 90, y1: 64 } }];
    const probeTextLayer = vi.fn(async (sourceKey, pageIndex) => (pageIndex === 0
      ? { usable: true, verdict: 'usable', characters: 400, letters: 380, privateUse: 0, words: layerWords, text: 'och', pageWidth: 595.28, pageHeight: 841.89 }
      : { usable: false, verdict: 'empty', characters: 3, letters: 3, privateUse: 0 }));
    const { queue, engine, cache } = makeQueue({ probeTextLayer, detectLanguage });
    const [text, scan] = [candidate('file.pdf', 0, { fileExtension: 'pdf' }), candidate('file.pdf', 1, { fileExtension: 'pdf' })];
    queue.setWindow([text, scan]);
    await flush();
    expect(cache.get(text.key)).toMatchObject({ status: OCR_PAGE_STATUS.DONE, language: 'sv' });
    engine.pending[0].resolve(result('skannad'));
    await flush();
    // Unsure: no language on the outcome at all.
    expect(cache.get(scan.key).status).toBe(OCR_PAGE_STATUS.DONE);
    expect(cache.get(scan.key)).not.toHaveProperty('language');
    expect(detectLanguage).toHaveBeenCalledTimes(2);

    // A guess that throws costs nothing but the language.
    const throwing = makeQueue({ detectLanguage: () => { throw new Error('boom'); } });
    throwing.queue.setWindow([candidate('doc', 0)]);
    await flush();
    throwing.engine.pending[0].resolve(result('text'));
    await flush();
    expect(throwing.cache.get(candidate('doc', 0).key)).toMatchObject({ status: OCR_PAGE_STATUS.DONE });
    expect(throwing.cache.get(candidate('doc', 0).key)).not.toHaveProperty('language');
  });

  it('keeps a usable text layer without placeable words, or without a page size, as a skip, without the engine', async () => {
    const layerWords = [{ text: 'Egen', confidence: 100, bbox: { x0: 60, y0: 50, x1: 90, y1: 64 } }];
    const probeTextLayer = vi.fn(async (sourceKey, pageIndex) => (pageIndex === 0
      ? { usable: true, verdict: 'usable', characters: 400, letters: 380, privateUse: 0, words: [], text: 'Lodrät text', pageWidth: 595.28, pageHeight: 841.89 }
      : { usable: true, verdict: 'usable', characters: 400, letters: 380, privateUse: 0, words: layerWords, text: 'Egen', pageWidth: 0, pageHeight: 841.89 }
    ));
    const { queue, engine, cache } = makeQueue({ probeTextLayer });
    const [sideways, sizeless] = [candidate('file.pdf', 0, { fileExtension: 'pdf' }), candidate('file.pdf', 1, { fileExtension: 'pdf' })];
    queue.setWindow([sideways, sizeless]);
    await flush();
    const skip = {
      status: OCR_PAGE_STATUS.SKIPPED,
      reason: OCR_SKIP_REASON.TEXT_LAYER,
      assessment: { usable: true, verdict: 'usable', characters: 400, letters: 380, privateUse: 0 },
    };
    expect(cache.get(sideways.key)).toEqual(skip);
    expect(cache.get(sizeless.key)).toEqual(skip);
    expect(engine.recognize).not.toHaveBeenCalled();
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

  it('reports idle once for a run of skipped pages, however long, without recursing', async () => {
    // Within the cache's default limit: a window larger than the cache would evict pages that are
    // still planned and recognise them again without end, which is why the hook raises the
    // limit to the page count for a whole document.
    const { queue, engine, events, cache } = makeQueue({ onChange: () => {} });
    const skipped = Array.from({ length: 150 }, (_, index) => candidate('doc', index, { fileExtension: 'txt' }));
    queue.setWindow(skipped);
    await flush();
    expect(cache.has(skipped[149].key)).toBe(true);
    expect(engine.recognize).not.toHaveBeenCalled();
    expect(events.filter((event) => event === 'idle')).toHaveLength(1);
    // An empty window reports idle again, as before.
    queue.setWindow([]);
    expect(events.filter((event) => event === 'idle')).toHaveLength(2);
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
    expect(engine.recognize).toHaveBeenLastCalledWith(`blob:${c.key}`, expect.any(Object));
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
    expect(engine.recognize).toHaveBeenLastCalledWith(`blob:${next.key}`, expect.any(Object));
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

  describe('with a pool and concurrency above one', () => {
    /** A pool-shaped engine: `size`, and `recognize(image, control)` sets `control.abort` per job. */
    function makePool(size) {
      const pending = [];
      const aborted = [];
      let failure = null;
      return {
        size,
        pending,
        aborted,
        setFailure(kind) { failure = { kind, error: new Error(`OCR engine could not start (${kind})`) }; },
        recognize: vi.fn((image, control) => {
          const job = deferred();
          job.image = image;
          pending.push(job);
          control.abort = () => { aborted.push(image); job.reject(new Error('OCR engine was terminated')); };
          return job.promise.finally(() => { control.abort = null; });
        }),
        terminate: vi.fn(async () => {}),
        getFailure: () => failure,
      };
    }

    it('keeps as many pages in flight as the concurrency allows and refills as each finishes', async () => {
      const engine = makePool(2);
      const { queue, cache, events, latest } = makeQueue({ engine, concurrency: 2 });
      const [a, b, c] = [candidate('doc', 0), candidate('doc', 1), candidate('doc', 2)];
      queue.setWindow([a, b, c]);
      await flush();

      expect(engine.recognize).toHaveBeenCalledTimes(2);
      expect(engine.pending.map((job) => job.image)).toEqual([`blob:${a.key}`, `blob:${b.key}`]);
      expect(latest().pages[a.key]).toEqual({ status: OCR_PAGE_STATUS.RECOGNIZING });
      expect(latest().pages[b.key]).toEqual({ status: OCR_PAGE_STATUS.RECOGNIZING });
      expect(latest().pages[c.key]).toEqual({ status: OCR_PAGE_STATUS.QUEUED });
      expect(queue.isBusy()).toBe(true);
      expect(events).toEqual(['busy', 'busy']);

      // The second page finishes first: the third starts while the first is still running.
      engine.pending[1].resolve(result('andra'));
      await flush();
      expect(cache.get(b.key).text).toBe('andra');
      expect(engine.recognize).toHaveBeenCalledTimes(3);
      expect(engine.pending[2].image).toBe(`blob:${c.key}`);
      expect(latest().busy).toBe(true);
      expect(events).toEqual(['busy', 'busy', 'busy']);

      engine.pending[0].resolve(result('första'));
      engine.pending[2].resolve(result('tredje'));
      await flush();
      expect([a, b, c].map((entry) => cache.get(entry.key).text)).toEqual(['första', 'andra', 'tredje']);
      expect(latest().busy).toBe(false);
      expect(events[events.length - 1]).toBe('idle');
      expect(events.filter((event) => event === 'idle')).toHaveLength(1);
    });

    it('follows a changed concurrency: a lower one lets the pages in flight finish and starts no further page above it, a higher one refills', async () => {
      const engine = makePool(3);
      const { queue, cache } = makeQueue({ engine, concurrency: 3 });
      const [a, b, c, d, e] = [candidate('doc', 0), candidate('doc', 1), candidate('doc', 2), candidate('doc', 3), candidate('doc', 4)];
      queue.setWindow([a, b, c, d, e]);
      await flush();
      expect(engine.recognize).toHaveBeenCalledTimes(3);

      // Down to one: the three running pages finish, but the next page waits for all of them.
      queue.setConcurrency(1);
      engine.pending[0].resolve(result('a'));
      await flush();
      expect(engine.recognize).toHaveBeenCalledTimes(3);
      engine.pending[1].resolve(result('b'));
      await flush();
      expect(engine.recognize).toHaveBeenCalledTimes(3);
      engine.pending[2].resolve(result('c'));
      await flush();
      expect(engine.recognize).toHaveBeenCalledTimes(4);
      expect(engine.pending[3].image).toBe(`blob:${d.key}`);

      // Up to two: the remaining page starts at once beside the running one.
      queue.setConcurrency(2);
      await flush();
      expect(engine.recognize).toHaveBeenCalledTimes(5);
      expect(engine.pending[4].image).toBe(`blob:${e.key}`);
      // Below one is one.
      queue.setConcurrency(0);
      engine.pending[3].resolve(result('d'));
      engine.pending[4].resolve(result('e'));
      await flush();
      expect([a, b, c, d, e].every((entry) => cache.has(entry.key))).toBe(true);
    });

    it('applies a concurrency given with the window to the new plan, never pumping the old one', async () => {
      const engine = makePool(2);
      const { queue } = makeQueue({ engine, concurrency: 1 });
      // The old window at the end of the document, one page in flight.
      queue.setWindow([candidate('doc', 9), candidate('doc', 8)]);
      await flush();
      expect(engine.recognize).toHaveBeenCalledTimes(1);
      expect(engine.pending[0].image).toBe(`blob:${candidate('doc', 9).key}`);

      // The user jumps to page 3: the new window with a higher limit. Page 8 of the old plan
      // must not start; the second slot goes to the new window.
      queue.setWindow([candidate('doc', 3), candidate('doc', 4), candidate('doc', 5), candidate('doc', 2)], { concurrency: 2 });
      await flush();
      expect(engine.recognize).toHaveBeenCalledTimes(2);
      expect(engine.pending[1].image).toBe(`blob:${candidate('doc', 3).key}`);
      engine.pending[0].resolve(result('nio'));
      await flush();
      expect(engine.recognize).toHaveBeenCalledTimes(3);
      expect(engine.pending[2].image).toBe(`blob:${candidate('doc', 4).key}`);
      // Without the option the limit stays as it is.
      queue.setWindow([candidate('doc', 3), candidate('doc', 4), candidate('doc', 5), candidate('doc', 6)]);
      engine.pending[1].resolve(result('tre'));
      engine.pending[2].resolve(result('fyra'));
      await flush();
      expect(engine.recognize).toHaveBeenCalledTimes(5);
    });

    it('aborts only the pages of a document that left, through their own controls, and never the pool', async () => {
      const engine = makePool(2);
      const { queue, cache, latest } = makeQueue({ engine, concurrency: 2 });
      const [old, kept] = [candidate('old', 0), candidate('kept', 0)];
      queue.setWindow([old, kept]);
      await flush();
      expect(engine.recognize).toHaveBeenCalledTimes(2);

      queue.retainSources(new Set(['kept']));
      await flush();
      expect(engine.aborted).toEqual([`blob:${old.key}`]);
      expect(engine.terminate).not.toHaveBeenCalled();
      expect(latest().pages[old.key]).toBeUndefined();
      expect(cache.has(old.key)).toBe(false);

      // The kept page is untouched and finishes normally.
      engine.pending[1].resolve(result('kvar'));
      await flush();
      expect(cache.get(kept.key).text).toBe('kvar');
    });

    it('drops only the worker whose recognition never answers', async () => {
      vi.useFakeTimers();
      try {
        const engine = makePool(2);
        const { queue, cache } = makeQueue({ engine, concurrency: 2, timeouts: { probe: 50, image: 50, recognize: 100 } });
        const [slow, quick, next] = [candidate('doc', 0), candidate('doc', 1), candidate('doc', 2)];
        queue.setWindow([slow, quick, next]);
        await flush();
        // The quick page finishes after 60 ms; the next page starts then, 60 ms behind the slow one.
        await vi.advanceTimersByTimeAsync(60);
        engine.pending[1].resolve(result('snabb'));
        await flush();
        expect(engine.recognize).toHaveBeenCalledTimes(3);

        await vi.advanceTimersByTimeAsync(40);
        await flush();
        expect(cache.get(slow.key)).toEqual({ status: OCR_PAGE_STATUS.FAILED, reason: 'OCR recognition exceeded 100 ms' });
        expect(engine.aborted).toEqual([`blob:${slow.key}`]);
        expect(engine.terminate).not.toHaveBeenCalled();
        engine.pending[2].resolve(result('nästa'));
        await flush();
        expect(cache.get(next.key).status).toBe(OCR_PAGE_STATUS.DONE);
        expect(cache.get(quick.key).status).toBe(OCR_PAGE_STATUS.DONE);
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops every page after the pool reports it cannot start, and reports idle once all are down', async () => {
      const engine = makePool(2);
      const { queue, latest, events } = makeQueue({ engine, concurrency: 2 });
      const [a, b, c] = [candidate('doc', 0), candidate('doc', 1), candidate('doc', 2)];
      queue.setWindow([a, b, c]);
      await flush();
      engine.setFailure('csp');
      engine.pending[0].reject(new Error('OCR engine could not start (csp)'));
      await flush();
      expect(latest().engineFailure).toBe('csp');
      expect(latest().pages[a.key]).toEqual({ status: OCR_PAGE_STATUS.FAILED, reason: 'engine:csp' });
      // The other page in flight was still running: nothing new started in its place.
      expect(engine.recognize).toHaveBeenCalledTimes(2);
      expect(events).not.toContain('idle');
      engine.pending[1].reject(new Error('OCR engine could not start (csp)'));
      await flush();
      expect(latest().pages[b.key]).toEqual({ status: OCR_PAGE_STATUS.FAILED, reason: 'engine:csp' });
      expect(latest().pages[c.key]).toEqual({ status: OCR_PAGE_STATUS.QUEUED });
      expect(events[events.length - 1]).toBe('idle');
    });

    it('does not hand an abandoned page to the pool when its image arrives after the document left or the queue was disposed', async () => {
      const engine = makePool(2);
      const images = [deferred(), deferred()];
      let calls = 0;
      const getPageImage = vi.fn(() => images[calls++].promise);
      const { queue, cache, latest } = makeQueue({ engine, concurrency: 2, getPageImage });
      const [old, kept] = [candidate('old', 0), candidate('kept', 0)];
      queue.setWindow([old, kept]);
      await flush();
      expect(engine.recognize).not.toHaveBeenCalled();

      // The old document leaves while its image is still loading: the image arrives, no worker runs.
      queue.retainSources(new Set(['kept']));
      images[0].resolve({ blob: `blob:${old.key}`, width: 10, height: 10 });
      await flush();
      expect(engine.recognize).not.toHaveBeenCalled();
      expect(cache.has(old.key)).toBe(false);
      expect(latest().pages[old.key]).toBeUndefined();

      // Disposed while the kept page's image loads: nothing starts after the terminate.
      queue.dispose();
      images[1].resolve({ blob: `blob:${kept.key}`, width: 10, height: 10 });
      await flush();
      expect(engine.recognize).not.toHaveBeenCalled();
      expect(engine.terminate).toHaveBeenCalledTimes(1);
    });

    it('runs one page at a time without a concurrency, whatever the pool size', async () => {
      const engine = makePool(3);
      const { queue } = makeQueue({ engine });
      queue.setWindow([candidate('doc', 0), candidate('doc', 1)]);
      await flush();
      expect(engine.recognize).toHaveBeenCalledTimes(1);
    });
  });
});
