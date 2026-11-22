// File: src/utils/__tests__/assetRenderLimitDocs.test.js
/**
 * maxConcurrentAssetRenders no longer follows maxConcurrentMainThreadRenders. A site that
 * lowers only the main-thread limit keeps the shipped asset-render limit, so the sample site
 * configuration has to say that the two are set separately.
 */

import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';
import { getDocumentLoadingConfig } from '../documentLoadingConfig.js';

afterEach(() => vi.unstubAllGlobals());

function readRender(render) {
  const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
  try {
    dom.window.__ODV_SITE_CONFIG__ = { documentLoading: { render } };
    dom.window.eval(readFileSync('public/odv.config.js', 'utf8'));
    vi.stubGlobal('window', dom.window);
    return getDocumentLoadingConfig().render;
  } finally {
    dom.window.close();
  }
}

it('keeps the shipped asset-render limit when a site lowers only the main-thread limit', () => {
  const onlyMainThread = readRender({ maxConcurrentMainThreadRenders: 1 });
  expect(onlyMainThread.maxConcurrentMainThreadRenders).toBe(1);
  expect(onlyMainThread.maxConcurrentAssetRenders).toBe(3);

  const both = readRender({ maxConcurrentMainThreadRenders: 1, maxConcurrentAssetRenders: 1 });
  expect(both.maxConcurrentAssetRenders).toBe(1);
});

it.each(['public/odv.site.config.sample.js', 'public/odv.config.js'])(
  '%s says next to both keys that the asset-render limit is set separately',
  (file) => {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    const commentAbove = (key) => {
      const index = lines.findIndex((line) => new RegExp(`^\\s*${key}:`).test(line));
      expect(index, `${key} in ${file}`).toBeGreaterThan(0);
      const comment = [];
      for (let i = index - 1; i >= 0 && /^\s*\/\//.test(lines[i]); i -= 1) comment.unshift(lines[i]);
      return comment.join('\n');
    };
    expect(commentAbove('maxConcurrentAssetRenders')).toMatch(/Independent from maxConcurrentMainThreadRenders/);
    expect(commentAbove('maxConcurrentMainThreadRenders')).toMatch(/maxConcurrentAssetRenders/);
  },
);
