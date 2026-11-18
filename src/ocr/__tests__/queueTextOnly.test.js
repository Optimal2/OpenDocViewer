// File: src/ocr/__tests__/queueTextOnly.test.js
/**
 * The page queue without recognition (`recognition: false`: `pdfTextLayer.enabled` with OCR
 * off). A PDF page with usable text of its own is done from that text exactly as with OCR on;
 * every other page (a raster page, a PDF page whose text is empty or garbled) is skipped with
 * the reason `recognition-off`; no page image is ever asked for and no engine is ever called,
 * whether the queue was given none (the text-only entry has none to give) or one. A failed
 * read is the page's own failure, and the queue lives without an engine through its whole
 * life: pause, a document leaving, the idle release and disposal.
 */
import { describe, expect, it, vi } from 'vitest';
import { OCR_OUTCOME_SOURCE, OCR_PAGE_STATUS, createOcrQueue } from '../queue.js';
import { createOcrResultCache } from '../resultCache.js';
import { OCR_SKIP_REASON } from '../classify.js';
import { makeOcrPageKey } from '../../utils/ocrPageKey.js';

const flush = async (rounds = 25) => {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
};

function candidate(sourceKey, pageIndex, { fileExtension = 'pdf', status = 1 } = {}) {
  const page = { sourceKey, pageIndex, fileExtension, status, fullSizeStatus: 1 };
  return { key: makeOcrPageKey(sourceKey, pageIndex), sourceKey, pageIndex, viewerIndex: pageIndex, page };
}

const word = (text) => ({ text, confidence: 100, bbox: { x0: 10, y0: 10, x1: 60, y1: 24 } });
const usable = (text) => ({
  usable: true, verdict: 'usable', characters: 80, letters: 70, privateUse: 0, words: [word(text)], text, pageWidth: 595, pageHeight: 842,
});

function makeQueue(overrides = {}) {
  const cache = createOcrResultCache();
  const events = [];
  const getPageImage = vi.fn(async () => { throw new Error('no page image may be asked for'); });
  const log = { warn: vi.fn(), debug: vi.fn() };
  const queue = createOcrQueue({
    engine: null,
    recognition: false,
    cache,
    probeTextLayer: vi.fn(async () => usable('egen text')),
    getPageImage,
    log,
    onBusy: () => events.push('busy'),
    onIdle: () => events.push('idle'),
    ...overrides,
  });
  return { queue, cache, events, getPageImage, log };
}

describe('createOcrQueue without recognition', () => {
  it('gives a PDF page with usable text of its own the same outcome as with OCR on', async () => {
    const { queue, cache, getPageImage } = makeQueue();
    const a = candidate('doc', 0);
    queue.setWindow([a]);
    await flush();
    expect(cache.get(a.key)).toEqual({
      status: OCR_PAGE_STATUS.DONE,
      source: OCR_OUTCOME_SOURCE.PDF_TEXT,
      text: 'egen text',
      confidence: 100,
      words: [word('egen text')],
      imageWidth: 595,
      imageHeight: 842,
      rulingLinePixels: 0,
    });
    expect(getPageImage).not.toHaveBeenCalled();
  });

  it('skips a raster page without probing it or asking for its image', async () => {
    const probeTextLayer = vi.fn(async () => usable('x'));
    const { queue, cache, getPageImage } = makeQueue({ probeTextLayer });
    const tiff = candidate('scan', 0, { fileExtension: 'tif' });
    const png = candidate('scan', 1, { fileExtension: 'png' });
    queue.setWindow([tiff, png]);
    await flush();
    expect(cache.get(tiff.key)).toEqual({ status: OCR_PAGE_STATUS.SKIPPED, reason: OCR_SKIP_REASON.RECOGNITION_OFF });
    expect(cache.get(png.key)).toEqual({ status: OCR_PAGE_STATUS.SKIPPED, reason: OCR_SKIP_REASON.RECOGNITION_OFF });
    expect(probeTextLayer).not.toHaveBeenCalled();
    expect(getPageImage).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', { usable: false, verdict: 'empty', characters: 3, letters: 3, privateUse: 0 }],
    ['garbled', { usable: false, verdict: 'garbled', characters: 400, letters: 20, privateUse: 300 }],
  ])('leaves a PDF page whose own text is %s an image, with the verdict kept', async (_label, assessment) => {
    const { queue, cache, getPageImage } = makeQueue({ probeTextLayer: vi.fn(async () => assessment) });
    const a = candidate('doc', 0);
    queue.setWindow([a]);
    await flush();
    expect(cache.get(a.key)).toEqual({
      status: OCR_PAGE_STATUS.SKIPPED,
      reason: OCR_SKIP_REASON.RECOGNITION_OFF,
      assessment: { usable: false, ...assessment },
    });
    expect(getPageImage).not.toHaveBeenCalled();
  });

  it('keeps the existing outcomes for own text that cannot be placed, a failed page and an unsupported format', async () => {
    const unplaceable = { ...usable('x'), words: [] };
    const { queue, cache } = makeQueue({ probeTextLayer: vi.fn(async () => unplaceable) });
    const text = candidate('doc', 0);
    const failed = candidate('doc', 1, { status: -1 });
    const other = candidate('doc', 2, { fileExtension: 'docx' });
    queue.setWindow([text, failed, other]);
    await flush();
    expect(cache.get(text.key)).toMatchObject({ status: OCR_PAGE_STATUS.SKIPPED, reason: OCR_SKIP_REASON.TEXT_LAYER });
    expect(cache.get(failed.key)).toEqual({ status: OCR_PAGE_STATUS.SKIPPED, reason: OCR_SKIP_REASON.FAILED_PAGE });
    expect(cache.get(other.key)).toEqual({ status: OCR_PAGE_STATUS.SKIPPED, reason: OCR_SKIP_REASON.UNSUPPORTED });
  });

  it('records a failed read as the page\'s own failure and goes on to the next page', async () => {
    const probeTextLayer = vi.fn()
      .mockRejectedValueOnce(new Error('Invalid PDF structure'))
      .mockResolvedValueOnce(usable('andra sidan'));
    const { queue, cache, log, events } = makeQueue({ probeTextLayer });
    const [a, b] = [candidate('doc', 0), candidate('doc', 1)];
    queue.setWindow([a, b]);
    await flush();
    expect(cache.get(a.key)).toEqual({ status: OCR_PAGE_STATUS.FAILED, reason: 'Invalid PDF structure' });
    expect(cache.get(b.key)).toMatchObject({ status: OCR_PAGE_STATUS.DONE, source: OCR_OUTCOME_SOURCE.PDF_TEXT });
    expect(queue.getSnapshot().engineFailure).toBeNull();
    expect(log.warn).toHaveBeenCalledWith('OCR of a page failed', expect.objectContaining({ pageIndex: 0 }));
    expect(events[events.length - 1]).toBe('idle');
  });

  it('never calls an engine it was given', async () => {
    const engine = { recognize: vi.fn(), terminate: vi.fn(async () => {}), getFailure: () => null };
    const { queue, cache } = makeQueue({ engine, probeTextLayer: vi.fn(async () => ({ usable: false, verdict: 'empty' })) });
    const pages = [candidate('doc', 0), candidate('scan', 0, { fileExtension: 'jpg' })];
    queue.setWindow(pages);
    await flush();
    expect(engine.recognize).not.toHaveBeenCalled();
    for (const entry of pages) expect(cache.get(entry.key)).toMatchObject({ status: OCR_PAGE_STATUS.SKIPPED, reason: OCR_SKIP_REASON.RECOGNITION_OFF });
  });

  it('recognises nothing without an engine even when recognition was not turned off', async () => {
    // The text-only entry has no engine to hand over; the queue must not try to call one.
    const { queue, cache } = makeQueue({ recognition: undefined });
    const png = candidate('scan', 0, { fileExtension: 'png' });
    queue.setWindow([png]);
    await flush();
    expect(cache.get(png.key)).toEqual({ status: OCR_PAGE_STATUS.SKIPPED, reason: OCR_SKIP_REASON.RECOGNITION_OFF });
  });

  it('reads several pages at a time, pauses, drops a document that leaves and is disposed without an engine', async () => {
    const waiting = [];
    const probeTextLayer = vi.fn(() => new Promise((resolve) => { waiting.push(resolve); }));
    const { queue, cache } = makeQueue({ probeTextLayer, concurrency: 2 });
    const [a, b, c] = [candidate('one', 0), candidate('one', 1), candidate('two', 0)];
    queue.setWindow([a, b, c]);
    await flush();
    expect(probeTextLayer).toHaveBeenCalledTimes(2);
    expect(queue.isBusy()).toBe(true);

    queue.setPaused(true);
    waiting[0](usable('a'));
    await flush();
    expect(cache.get(a.key)).toMatchObject({ status: OCR_PAGE_STATUS.DONE });
    // Paused: the third page is not started.
    expect(probeTextLayer).toHaveBeenCalledTimes(2);

    // The first document leaves while its second page is still being read.
    queue.retainSources(new Set(['two']));
    expect(cache.get(a.key)).toBeUndefined();
    waiting[1](usable('b'));
    await flush();
    expect(cache.get(b.key)).toBeUndefined();

    queue.setPaused(false);
    await flush();
    expect(probeTextLayer).toHaveBeenCalledTimes(3);
    waiting[2](usable('c'));
    await flush();
    expect(cache.get(c.key)).toMatchObject({ status: OCR_PAGE_STATUS.DONE, text: 'c' });

    await expect(queue.releaseEngineIfIdle()).resolves.toBe(true);
    expect(() => queue.dispose()).not.toThrow();
  });
});
