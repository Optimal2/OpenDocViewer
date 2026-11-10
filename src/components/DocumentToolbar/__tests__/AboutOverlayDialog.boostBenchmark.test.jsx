// @vitest-environment jsdom
// File: src/components/DocumentToolbar/__tests__/AboutOverlayDialog.boostBenchmark.test.jsx
//
// The About dialog offers "Run OCR boost benchmark" only while `ocr.boostBenchmark.enabled`
// (with OCR on) is passed in: hidden with the switch off even when the regular OCR benchmark
// is on, shown with it on, and a completed run leaves a result with a JSON download.
// Plain createElement: the repo's ESLint setup does not parse JSX in test files.
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockTranslate } = vi.hoisted(() => ({
  // The dialog passes every user-facing string as defaultValue; returning it keeps the
  // assertions on the shipped English wording without loading the locale files.
  mockTranslate: (key, options) => options?.defaultValue ?? key,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));

import AboutOverlayDialog from '../AboutOverlayDialog.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = React.createElement;

const BOOST_RESULT = {
  schema: 'opendocviewer.ocr-boost-benchmark.v1',
  pageCount: 2,
  hardwareConcurrency: 8,
  scenarios: [{ label: 'workers-4' }, { label: 'workers-8' }],
  best: { label: 'workers-4', msPerPage: 100 },
  baseline: { label: 'workers-4', msPerPage: 100 },
};

/**
 * A run handler the test drives by hand: the dialog's onProgress callback is captured so the
 * test can emit progress events, then release the result.
 */
function deferredRun(result = BOOST_RESULT) {
  const captured = {};
  const promise = new Promise((resolve) => {
    captured.release = (events = []) => {
      for (const event of events) captured.options.onProgress(event);
      resolve(result);
    };
  });
  const onRun = vi.fn((options) => {
    captured.options = options;
    return promise;
  });
  return { onRun, captured };
}

describe('AboutOverlayDialog OCR boost benchmark', () => {
  let container;
  let root;

  function renderDialog(props) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(h(AboutOverlayDialog, { isOpen: true, onClose: () => {}, ...props }));
    });
  }

  function boostStatus() {
    return container.querySelector('[data-odv-ocr="boost-benchmark-status"]');
  }

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    container = undefined;
    root = undefined;
  });

  it('hides the boost benchmark UI when the switch is off, even with the regular OCR benchmark on', () => {
    renderDialog({ ocrBenchmarkEnabled: true, onRunOcrBenchmark: vi.fn() });
    // The regular OCR benchmark keeps its own button; the boost one stays hidden.
    expect(container.querySelector('[data-odv-ocr="benchmark-run"]')).not.toBeNull();
    expect(container.querySelector('[data-odv-ocr="boost-benchmark-run"]')).toBeNull();
    expect(boostStatus()).toBeNull();
    expect(container.querySelector('[data-odv-ocr="boost-benchmark-download"]')).toBeNull();
  });

  it('shows the boost button when enabled and completes a run with a JSON download', async () => {
    const { onRun, captured } = deferredRun();
    renderDialog({ ocrBoostBenchmarkEnabled: true, onRunOcrBoostBenchmark: onRun });
    const run = container.querySelector('[data-odv-ocr="boost-benchmark-run"]');
    expect(run).not.toBeNull();
    // Like the other benchmarks the status line shows while enabled, idle with no result yet.
    expect(boostStatus().getAttribute('data-odv-ocr-boost-benchmark-state')).toBe('idle');
    expect(boostStatus().textContent).toContain('No OCR boost benchmark result has been recorded.');
    expect(container.querySelector('[data-odv-ocr="boost-benchmark-download"]')).toBeNull();

    await act(async () => {
      run.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(boostStatus().getAttribute('data-odv-ocr-boost-benchmark-state')).toBe('running');

    await act(async () => {
      captured.release([{
        phase: 'running',
        completedRuns: 0,
        totalRuns: 6,
        scenarioLabel: 'workers-4',
        completedPages: 1,
        pageCount: 2,
        workerCount: 4,
      }]);
    });
    expect(boostStatus().getAttribute('data-odv-ocr-boost-benchmark-state')).toBe('done');
    expect(boostStatus().textContent).toContain('OCR boost benchmark completed.');
    const download = container.querySelector('[data-odv-ocr="boost-benchmark-download"]');
    expect(download).not.toBeNull();
  });

  /**
   * The skip event exactly as src/ocr/boostBenchmark.js emits it: `skipReason` is the raw enum,
   * the English sentence is `skipDetail`, and the numbers behind it are `skipFacts`. A test that
   * put the sentence in `skipReason` would assert a contract the viewer never sends.
   *
   * @param {Object} overrides
   * @returns {Object}
   */
  function skipEvent(overrides) {
    return {
      phase: 'running',
      completedRuns: 4,
      totalRuns: 6,
      scenarioLabel: 'boost-workers-24',
      completedPages: 0,
      pageCount: 2,
      workerCount: 24,
      skipped: true,
      ...overrides,
    };
  }

  it('explains a scenario skipped on the memory budget in words, not as the raw enum', async () => {
    const { onRun, captured } = deferredRun();
    renderDialog({ ocrBoostBenchmarkEnabled: true, onRunOcrBoostBenchmark: onRun });
    const run = container.querySelector('[data-odv-ocr="boost-benchmark-run"]');

    await act(async () => {
      run.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    // A skipped scenario reports its reason while the run continues.
    await act(async () => {
      captured.options.onProgress(skipEvent({
        skipReason: 'memory',
        skipDetail: '24 workers need about 3120 MiB, above the 2048 MiB budget (0.5 of 4 GiB)',
        skipFacts: { workerCount: 24, neededMiB: 3120, budgetMiB: 2048, deviceMemoryGiB: 4, deviceMemoryAssumed: false },
      }));
    });
    expect(boostStatus().getAttribute('data-odv-ocr-boost-benchmark-state')).toBe('running');
    const text = boostStatus().textContent;
    expect(text).toContain('Skipped boost-workers-24: 24 workers need about 3120 MiB, above the 2048 MiB budget.');
    // The raw enum must never be what the operator reads: "Skipped boost-workers-24: memory."
    // is the regression this asserts away.
    expect(text).not.toContain(': memory.');
    expect(text).not.toMatch(/\bmemory\b/);

    await act(async () => {
      captured.release([]);
    });
    expect(boostStatus().getAttribute('data-odv-ocr-boost-benchmark-state')).toBe('done');
  });

  it('explains a scenario skipped on the core count the same way', async () => {
    const { onRun, captured } = deferredRun();
    renderDialog({ ocrBoostBenchmarkEnabled: true, onRunOcrBoostBenchmark: onRun });
    const run = container.querySelector('[data-odv-ocr="boost-benchmark-run"]');
    await act(async () => {
      run.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      captured.options.onProgress(skipEvent({
        skipReason: 'cores',
        skipDetail: '24 workers exceed the 16 logical cores this client reports',
        skipFacts: { workerCount: 24, cores: 16 },
      }));
    });
    const text = boostStatus().textContent;
    expect(text).toContain('24 workers exceed the 16 logical cores of this client');
    expect(text).not.toContain(': cores.');
    expect(text).not.toMatch(/\bcores\b\./);
    await act(async () => { captured.release([]); });
  });

  it('falls back to the English detail for a skip reason this build does not know', async () => {
    const { onRun, captured } = deferredRun();
    renderDialog({ ocrBoostBenchmarkEnabled: true, onRunOcrBoostBenchmark: onRun });
    const run = container.querySelector('[data-odv-ocr="boost-benchmark-run"]');
    await act(async () => {
      run.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    // A newer boost module could add a reason; the sentence it ships with is better than the enum.
    await act(async () => {
      captured.options.onProgress(skipEvent({
        skipReason: 'thermal',
        skipDetail: '24 workers were refused because the client reported a thermal limit',
      }));
    });
    expect(boostStatus().textContent).toContain('24 workers were refused because the client reported a thermal limit');
    expect(boostStatus().textContent).not.toContain(': thermal.');
    await act(async () => { captured.release([]); });
  });
});
