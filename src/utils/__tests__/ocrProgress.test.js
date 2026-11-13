// File: src/utils/__tests__/ocrProgress.test.js
/**
 * The estimate of how long the pages waiting for OCR will take: measured between finished pages
 * only, over the pages finished lately, silent until enough pages say what the pace is and
 * again when no page has been finished for the length of the window; and the words for it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  OCR_PROGRESS_FALLBACK, OCR_PROGRESS_MIN_PAGES, OCR_PROGRESS_WINDOW_MS, createOcrProgressEstimator, describeOcrTimeLeft,
} from '../ocrProgress.js';

/** An estimator on a clock the test moves. */
function onClock(options = {}) {
  const clock = { at: 1000000 };
  const estimator = createOcrProgressEstimator({ now: () => clock.at, ...options });
  return {
    estimator,
    /** Let `seconds` pass, then report `done` finished pages. */
    after(seconds, done) {
      clock.at += seconds * 1000;
      estimator.record(done);
    },
    wait(seconds) { clock.at += seconds * 1000; },
  };
}

describe('createOcrProgressEstimator', () => {
  it('ships a one-minute window and asks for three finished pages', () => {
    expect(OCR_PROGRESS_WINDOW_MS).toBe(60000);
    expect(OCR_PROGRESS_MIN_PAGES).toBe(3);
  });

  it('says nothing until three pages have been finished after the first one seen to finish', () => {
    const { estimator, after } = onClock();
    estimator.record(0);
    expect(estimator.remainingMs(100)).toBeNull();
    after(5, 1); // the starting point
    expect(estimator.remainingMs(99)).toBeNull();
    after(2, 2);
    after(2, 3);
    expect(estimator.remainingMs(97)).toBeNull();
    after(2, 4);
    // Three pages in six seconds: two seconds a page, 96 pages waiting.
    expect(estimator.remainingMs(96)).toBe(192000);
  });

  it('does not count the time before the first finished page as slow recognition', () => {
    const { estimator, after } = onClock();
    estimator.record(0);
    // Half a minute of loading before the first page is finished, then a page a second.
    after(30, 1);
    after(1, 2);
    after(1, 3);
    after(1, 4);
    expect(estimator.remainingMs(10)).toBe(10000);
  });

  it('does not take the pages finished before it looked for a pace', () => {
    const { estimator, after } = onClock();
    // The toolbar appears with 50 pages done already (their results were kept).
    estimator.record(50);
    expect(estimator.remainingMs(50)).toBeNull();
    after(1, 51);
    after(1, 52);
    after(1, 53);
    expect(estimator.remainingMs(47)).toBeNull();
    after(1, 54);
    expect(estimator.remainingMs(46)).toBe(46000);
  });

  it('takes several pages finished at once as that many pages', () => {
    const { estimator, after } = onClock();
    estimator.record(0);
    after(1, 2);
    after(4, 10);
    // Eight pages in four seconds.
    expect(estimator.remainingMs(20)).toBe(10000);
  });

  it('follows the pace as it changes: the pages finished within the window decide', () => {
    const { estimator, after } = onClock();
    estimator.record(0);
    // A slow start: a page every ten seconds for a minute and a half.
    for (let done = 1; done <= 10; done += 1) after(10, done);
    expect(estimator.remainingMs(90)).toBe(900000);
    // More workers: a page a second for two minutes. The slow pages have left the window.
    for (let done = 11; done <= 130; done += 1) after(1, done);
    expect(estimator.remainingMs(60)).toBe(60000);
  });

  it('keeps the last few pages however old they are, so a slow client still gets an estimate', () => {
    const { estimator, after } = onClock();
    estimator.record(0);
    // A page every forty seconds: only two fit in the window.
    for (let done = 1; done <= 6; done += 1) after(40, done);
    // The last four measurements span three pages in 120 seconds.
    expect(estimator.remainingMs(10)).toBe(400000);
  });

  it('says nothing when nothing waits, and nothing when no page has been finished for the length of the window', () => {
    const { estimator, after, wait } = onClock();
    estimator.record(0);
    for (let done = 1; done <= 5; done += 1) after(2, done);
    expect(estimator.remainingMs(0)).toBeNull();
    expect(estimator.remainingMs(10)).toBe(20000);
    wait(60);
    expect(estimator.remainingMs(10)).toBe(20000);
    wait(0.001);
    expect(estimator.remainingMs(10)).toBeNull();
  });

  it('takes a page finished more than a window after the one before it as a new starting point: a pause is no pace', () => {
    const { estimator, after } = onClock();
    estimator.record(0);
    // A page every ten seconds, then ten minutes of nothing (a print prepared, a load).
    for (let done = 1; done <= 5; done += 1) after(10, done);
    expect(estimator.remainingMs(100)).toBe(1000000);
    after(600, 6);
    // Not five hours: nothing, until three pages say what the pace is now.
    expect(estimator.remainingMs(99)).toBeNull();
    after(10, 7);
    after(10, 8);
    expect(estimator.remainingMs(97)).toBeNull();
    after(10, 9);
    expect(estimator.remainingMs(96)).toBe(960000);
    // A gap of exactly the window is still a pace (a slow client).
    after(60, 10);
    // The last four measurements: three pages in eighty seconds.
    expect(estimator.remainingMs(90)).toBe(90 * 80000 / 3);
  });

  it('says when its pace runs out: a window after the last finished page', () => {
    const { estimator, after, wait } = onClock();
    expect(estimator.expiresInMs()).toBeNull();
    estimator.record(0);
    expect(estimator.expiresInMs()).toBeNull();
    after(1, 1);
    expect(estimator.expiresInMs()).toBe(60000);
    wait(45);
    expect(estimator.expiresInMs()).toBe(15000);
    wait(100);
    expect(estimator.expiresInMs()).toBe(0);
    after(1, 2);
    expect(estimator.expiresInMs()).toBe(60000);
  });

  it('starts again when the count goes down: another document', () => {
    const { estimator, after } = onClock();
    estimator.record(0);
    for (let done = 1; done <= 5; done += 1) after(1, done);
    expect(estimator.remainingMs(10)).toBe(10000);
    after(1, 0);
    expect(estimator.remainingMs(10)).toBeNull();
    after(3, 1);
    after(3, 2);
    after(3, 3);
    expect(estimator.remainingMs(10)).toBeNull();
    after(3, 4);
    expect(estimator.remainingMs(10)).toBe(30000);
  });

  it('reads counts that are no whole numbers as the pages they hold, and nonsense as none', () => {
    const { estimator, after } = onClock();
    estimator.record(undefined);
    after(1, 1);
    after(1, 2);
    after(1, 3);
    after(1, 4);
    expect(estimator.remainingMs(2.9)).toBe(2000);
    expect(estimator.remainingMs(-4)).toBeNull();
    expect(estimator.remainingMs('many')).toBeNull();
  });
});

describe('describeOcrTimeLeft', () => {
  it('says under a minute as that, rounds minutes up, and splits hours', () => {
    expect(describeOcrTimeLeft(0)).toEqual({ key: 'underMinute' });
    expect(describeOcrTimeLeft(59999)).toEqual({ key: 'underMinute' });
    expect(describeOcrTimeLeft(60000)).toEqual({ key: 'minutes', minutes: 1 });
    expect(describeOcrTimeLeft(60001)).toEqual({ key: 'minutes', minutes: 2 });
    expect(describeOcrTimeLeft(59 * 60000)).toEqual({ key: 'minutes', minutes: 59 });
    expect(describeOcrTimeLeft(59 * 60000 + 1)).toEqual({ key: 'hours', hours: 1, minutes: 0 });
    expect(describeOcrTimeLeft(125 * 60000)).toEqual({ key: 'hours', hours: 2, minutes: 5 });
  });

  it('has no words for no estimate', () => {
    for (const value of [null, undefined, NaN, Infinity, -1, '60000']) expect(describeOcrTimeLeft(value)).toBeNull();
  });
});

describe('ocr.progress in the locale files', () => {
  const placeholders = (text) => (String(text).match(/\{[a-zA-Z]+\}/g) || []).sort();

  it.each(['sv', 'en'])('has every key of the fallbacks in %s, with the same placeholders', (language) => {
    const strings = JSON.parse(readFileSync(`public/locales/${language}/common.json`, 'utf8')).ocr.progress;
    expect(Object.keys(strings).sort()).toEqual(Object.keys(OCR_PROGRESS_FALLBACK).sort());
    for (const [key, fallback] of Object.entries(OCR_PROGRESS_FALLBACK)) {
      expect(placeholders(strings[key]), `${language}.${key}`).toEqual(placeholders(fallback));
    }
  });

  it('keeps the English file identical to the fallbacks', () => {
    const strings = JSON.parse(readFileSync('public/locales/en/common.json', 'utf8')).ocr.progress;
    expect(strings).toEqual({ ...OCR_PROGRESS_FALLBACK });
  });
});
