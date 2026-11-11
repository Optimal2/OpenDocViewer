// File: src/ocr/__tests__/imagePreparer.test.js
/**
 * createOcrImagePreparer with a fake worker: requests go to the worker with the resolved options
 * and are matched to replies by id; the worker's log lines reach the logger; a decode failure is
 * the rejection it always was (no retry); an `unsupported` reply, a worker failure, a worker that
 * cannot be created and a browser without workers all end on the main-thread copy of the code
 * (never a failed page); repeated failures pin the session to the main thread with one warning;
 * the worker is ended after the idle time and restarted by the next page; dispose finishes the
 * pending pages on the main thread; the shared instance is one per module until disposed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OCR_IMAGE_PREPARER_IDLE_MS, OCR_IMAGE_PREPARER_MAX_FAILURES, OCR_IMAGE_PREPARER_REQUEST_TIMEOUT_MS, createOcrImagePreparer,
  disposeOcrImagePreparer, getOcrImagePreparer,
} from '../imagePreparer.js';

vi.mock('../../logging/systemLogger.js', () => ({ default: { warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../prepareWorker.js?worker', () => ({ default: class { constructor() { throw new Error('no real worker in tests'); } } }));

/** A worker that records what it was sent and lets the test answer. */
class FakeWorker {
  constructor() {
    this.posted = [];
    this.terminated = 0;
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
    FakeWorker.created.push(this);
  }

  postMessage(message) {
    if (this.refuse) throw new Error('refused');
    this.posted.push(message);
  }

  terminate() { this.terminated += 1; }

  reply(message) { this.onmessage({ data: message }); }
}
FakeWorker.created = [];

const image = new Blob(['scan'], { type: 'image/png' });
const cleaned = new Blob(['cleaned'], { type: 'image/png' });

function setup(overrides = {}) {
  FakeWorker.created = [];
  const log = { warn: vi.fn(), debug: vi.fn() };
  const main = vi.fn(async (blob, options) => ({ blob, width: 7, height: 9, rulingLinePixels: 0, via: 'main', options }));
  const timers = [];
  const preparer = createOcrImagePreparer({
    createWorker: () => new FakeWorker(),
    workersSupported: true,
    prepareOnMainThread: main,
    log,
    // Like a real timer, a fired handle is gone from the list.
    setTimer: (fn, ms) => {
      const handle = { ms, fn: () => { const at = timers.indexOf(handle); if (at >= 0) timers.splice(at, 1); fn(); } };
      timers.push(handle);
      return handle;
    },
    clearTimer: (handle) => { const at = timers.indexOf(handle); if (at >= 0) timers.splice(at, 1); },
    ...overrides,
  });
  return { preparer, log, main, timers, worker: () => FakeWorker.created[FakeWorker.created.length - 1] };
}

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

afterEach(() => { disposeOcrImagePreparer(); });

describe('createOcrImagePreparer', () => {
  it('sends the image and the resolved options to the worker and resolves with its reply', async () => {
    const { preparer, log, main, worker } = setup();
    const promise = preparer.prepare(image, { removeRulingLines: true, fallbackSize: { width: 1, height: 2 }, maxPixels: 500 });
    const sent = worker().posted[0];
    expect(sent).toMatchObject({ type: 'prepare', id: 1, removeRulingLines: true, fallbackSize: { width: 1, height: 2 }, maxPixels: 500 });
    expect(sent.blob).toBe(image);
    worker().reply({
      type: 'prepared', id: 1, ok: true, blob: cleaned, width: 120, height: 40, rulingLinePixels: 90,
      log: [{ level: 'debug', message: 'removed', details: { rulingLinePixels: 90 } }, { level: 'warn', message: 'odd', details: undefined }],
    });
    expect(await promise).toEqual({ blob: cleaned, width: 120, height: 40, rulingLinePixels: 90 });
    expect(log.debug).toHaveBeenCalledWith('removed', { rulingLinePixels: 90 });
    expect(log.warn).toHaveBeenCalledWith('odd', undefined);
    expect(main).not.toHaveBeenCalled();
    expect(preparer.inspect()).toEqual({ mode: 'worker', workerAlive: true, pending: 0, failures: 0 });
  });

  it('keeps several pages in flight and matches replies by id, whatever their order', async () => {
    const { preparer, worker } = setup();
    const first = preparer.prepare(image, { removeRulingLines: true });
    const second = preparer.prepare(new Blob(['two']), { removeRulingLines: false });
    expect(worker().posted.map((m) => m.id)).toEqual([1, 2]);
    expect(worker().posted[1].removeRulingLines).toBe(false);
    expect(preparer.inspect().pending).toBe(2);
    worker().reply({ type: 'prepared', id: 2, ok: true, blob: image, width: 2, height: 2, rulingLinePixels: 0 });
    worker().reply({ type: 'prepared', id: 1, ok: true, blob: cleaned, width: 1, height: 1, rulingLinePixels: 5 });
    expect((await first).rulingLinePixels).toBe(5);
    expect((await second).width).toBe(2);
    expect(FakeWorker.created).toHaveLength(1);
  });

  it('passes a decode failure on as the rejection it always was, without redoing it on the main thread', async () => {
    const { preparer, main, worker } = setup();
    const promise = preparer.prepare(image, { removeRulingLines: true });
    worker().reply({ type: 'prepared', id: 1, ok: false, error: 'Image could not be decoded', log: [] });
    await expect(promise).rejects.toThrow('Image could not be decoded');
    expect(main).not.toHaveBeenCalled();
    expect(worker().terminated).toBe(0);
  });

  it('falls back to the main thread for the session when the worker scope has no decoder or canvas', async () => {
    const { preparer, log, main, worker } = setup();
    const promise = preparer.prepare(image, { removeRulingLines: true });
    worker().reply({ type: 'prepared', id: 1, ok: false, unsupported: true });
    expect((await promise).via).toBe('main');
    expect(main).toHaveBeenCalledWith(image, expect.objectContaining({ removeRulingLines: true, log }));
    expect(worker().terminated).toBe(1);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('no image decoder or canvas'));
    expect(log.warn).not.toHaveBeenCalled();
    await preparer.prepare(image, { removeRulingLines: true });
    expect(FakeWorker.created).toHaveLength(1);
    expect(preparer.inspect().mode).toBe('main');
  });

  it('redoes the other pages pending in an unsupported worker on the main thread too, so none waits forever', async () => {
    const { preparer, main, worker } = setup();
    const first = preparer.prepare(image, { removeRulingLines: true });
    const second = preparer.prepare(new Blob(['two']), { removeRulingLines: true });
    const third = preparer.prepare(new Blob(['three']), { removeRulingLines: false });
    worker().reply({ type: 'prepared', id: 1, ok: false, unsupported: true });
    expect((await first).via).toBe('main');
    expect((await second).via).toBe('main');
    expect((await third).via).toBe('main');
    expect(main).toHaveBeenCalledTimes(3);
    expect(main.mock.calls[2][1].removeRulingLines).toBe(false);
    expect(preparer.inspect()).toMatchObject({ mode: 'main', workerAlive: false, pending: 0 });
  });

  it('redoes the pending pages on the main thread when the worker fails, starts a new worker next time, and pins the session after repeated failures', async () => {
    const { preparer, log, main, worker } = setup();
    const first = preparer.prepare(image, { removeRulingLines: true });
    const crashed = worker();
    crashed.onerror({ message: 'worker crashed' });
    expect((await first).via).toBe('main');
    expect(crashed.terminated).toBe(1);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('redoing its pages on the main thread'), { error: 'worker crashed', failures: 1 });
    expect(preparer.inspect()).toMatchObject({ mode: 'worker', workerAlive: false, failures: 1 });

    const second = preparer.prepare(image, { removeRulingLines: true });
    expect(FakeWorker.created).toHaveLength(2);
    worker().onmessageerror({ data: 'garbage' });
    expect((await second).via).toBe('main');
    expect(log.warn).toHaveBeenLastCalledWith(expect.stringContaining('rest of the session'), { error: 'garbage', failures: OCR_IMAGE_PREPARER_MAX_FAILURES });
    expect(preparer.inspect().mode).toBe('main');

    await preparer.prepare(image, { removeRulingLines: true });
    expect(FakeWorker.created).toHaveLength(2);
    expect(main).toHaveBeenCalledTimes(3);
  });

  it('ignores a reply from a worker it has already given up on, so no page is resolved twice', async () => {
    const { preparer, main, worker } = setup();
    const promise = preparer.prepare(image, { removeRulingLines: true });
    const crashed = worker();
    crashed.onerror({ message: 'crashed' });
    const redone = await promise;
    expect(redone.via).toBe('main');
    // The late reply of the terminated worker finds no pending page.
    expect(() => crashed.reply({ type: 'prepared', id: 1, ok: true, blob: cleaned, width: 1, height: 1, rulingLinePixels: 1 })).not.toThrow();
    expect(await promise).toBe(redone);
    expect(main).toHaveBeenCalledTimes(1);
    expect(preparer.inspect().pending).toBe(0);
  });

  it('treats a worker that gives no reply in time as failed: the pages are redone on the main thread before the queue gives up', async () => {
    const { preparer, log, main, timers, worker } = setup({ requestTimeoutMs: 777 });
    const first = preparer.prepare(image, { removeRulingLines: true });
    const second = preparer.prepare(new Blob(['two']), { removeRulingLines: true });
    expect(timers.map((t) => t.ms)).toEqual([777, 777]);
    const silent = worker();
    timers[0].fn();
    expect((await first).via).toBe('main');
    expect((await second).via).toBe('main');
    expect(silent.terminated).toBe(1);
    expect(timers).toHaveLength(0);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('gave no reply within 777 ms'), { error: 'gave no reply within 777 ms', failures: 1 });
    expect(main).toHaveBeenCalledTimes(2);
    // A reply in time clears its timer, and the idle timer takes its place.
    const third = preparer.prepare(image, { removeRulingLines: true });
    expect(timers.map((t) => t.ms)).toEqual([777]);
    worker().reply({ type: 'prepared', id: 3, ok: true, blob: image, width: 1, height: 1, rulingLinePixels: 0 });
    await third;
    expect(timers.map((t) => t.ms)).toEqual([OCR_IMAGE_PREPARER_IDLE_MS]);
    expect(OCR_IMAGE_PREPARER_REQUEST_TIMEOUT_MS).toBeLessThan(30000);
  });

  it('prepares on the main thread when the worker cannot be created or refuses the image', async () => {
    const { preparer, log, main } = setup({ createWorker: () => { throw new Error('blocked'); } });
    expect((await preparer.prepare(image, { removeRulingLines: true })).via).toBe('main');
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('could not be created'), { error: 'blocked', failures: 1 });
    expect(main).toHaveBeenCalledTimes(1);

    const refusing = setup();
    const promise = refusing.preparer.prepare(image, { removeRulingLines: true });
    expect(refusing.worker().posted).toHaveLength(1);
    // The fake refuses its messages once the flag is set; set it and send another page.
    refusing.worker().refuse = true;
    const second = refusing.preparer.prepare(image, { removeRulingLines: true });
    expect((await second).via).toBe('main');
    expect(refusing.log.warn).toHaveBeenCalledWith(expect.stringContaining('refused the page image'), expect.objectContaining({ error: 'refused' }));
    // The first page was pending in the failed worker and is redone on the main thread too.
    expect((await promise).via).toBe('main');
  });

  it('prepares on the main thread, without a worker, in a browser that has none', async () => {
    const { preparer, main } = setup({ workersSupported: false });
    expect((await preparer.prepare(image, { removeRulingLines: true })).via).toBe('main');
    expect(FakeWorker.created).toHaveLength(0);
    expect(main).toHaveBeenCalledTimes(1);
    expect(preparer.inspect()).toEqual({ mode: 'main', workerAlive: false, pending: 0, failures: 0 });
  });

  it('ends the worker after the idle time and starts a new one for the next page', async () => {
    const { preparer, timers, worker } = setup({ idleMs: 1234 });
    const promise = preparer.prepare(image, { removeRulingLines: true });
    // Only the reply timer runs while a page is pending; the idle timer starts with the reply.
    expect(timers.map((t) => t.ms)).toEqual([OCR_IMAGE_PREPARER_REQUEST_TIMEOUT_MS]);
    worker().reply({ type: 'prepared', id: 1, ok: true, blob: image, width: 1, height: 1, rulingLinePixels: 0 });
    await promise;
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(1234);
    const first = worker();
    timers[0].fn();
    expect(first.terminated).toBe(1);
    expect(preparer.inspect().workerAlive).toBe(false);
    preparer.prepare(image, { removeRulingLines: true });
    expect(FakeWorker.created).toHaveLength(2);
    expect(worker()).not.toBe(first);
  });

  it('does not end a worker that got a new page before the idle time ran out', async () => {
    const { preparer, timers, worker } = setup();
    const first = preparer.prepare(image, { removeRulingLines: true });
    worker().reply({ type: 'prepared', id: 1, ok: true, blob: image, width: 1, height: 1, rulingLinePixels: 0 });
    await first;
    expect(timers).toHaveLength(1);
    preparer.prepare(image, { removeRulingLines: true });
    // The idle timer is withdrawn; only the new page's reply timer remains.
    expect(timers.map((t) => t.ms)).toEqual([OCR_IMAGE_PREPARER_REQUEST_TIMEOUT_MS]);
    expect(worker().terminated).toBe(0);
    expect(OCR_IMAGE_PREPARER_IDLE_MS).toBe(20000);
  });

  it('finishes the pending pages on the main thread when disposed, and keeps working on the main thread after', async () => {
    const { preparer, main, worker } = setup();
    const pendingPage = preparer.prepare(image, { removeRulingLines: true });
    const target = worker();
    preparer.dispose();
    expect(target.terminated).toBe(1);
    expect((await pendingPage).via).toBe('main');
    expect((await preparer.prepare(image, { removeRulingLines: false })).via).toBe('main');
    expect(FakeWorker.created).toHaveLength(1);
    expect(main).toHaveBeenCalledTimes(2);
    await flush();
  });
});

describe('the shared preparer', () => {
  it('is one instance until disposed, then a new one', () => {
    const first = getOcrImagePreparer();
    expect(getOcrImagePreparer()).toBe(first);
    disposeOcrImagePreparer();
    const second = getOcrImagePreparer();
    expect(second).not.toBe(first);
    expect(() => disposeOcrImagePreparer()).not.toThrow();
    expect(() => disposeOcrImagePreparer()).not.toThrow();
  });
});
