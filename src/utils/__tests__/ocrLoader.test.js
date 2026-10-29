// File: src/utils/__tests__/ocrLoader.test.js
/**
 * Proves the import boundary of the OCR module:
 *  - loadOcrModule never imports src/ocr/index.js while `ocr.enabled` is not the literal true
 *    (a counting mock of the module shows zero evaluations);
 *  - with the switch on the module is imported exactly once and shared;
 *  - statically, src/utils/ocrLoader.js is the only file outside src/ocr/ that references the
 *    folder or tesseract.js, and it does so with a dynamic import.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOcrModuleRequested, loadOcrModule, resetOcrModuleForTests } from '../ocrLoader.js';

const state = vi.hoisted(() => ({ evaluations: 0 }));

vi.mock('../../ocr/index.js', () => {
  state.evaluations += 1;
  return { marker: 'mocked ocr module' };
});

afterEach(() => {
  resetOcrModuleForTests();
  vi.unstubAllGlobals();
});

describe('loadOcrModule', () => {
  it.each([
    ['no config', undefined],
    ['an empty config', {}],
    ['enabled false', { ocr: { enabled: false } }],
    ['the string "true"', { ocr: { enabled: 'true' } }],
    ['the number 1', { ocr: { enabled: 1 } }],
  ])('resolves null without importing the module for %s', async (_label, cfg) => {
    await expect(loadOcrModule(cfg)).resolves.toBeNull();
    expect(state.evaluations).toBe(0);
    expect(isOcrModuleRequested()).toBe(false);
  });

  it('reads the viewer config when called without an argument and keeps the module out while off', async () => {
    vi.stubGlobal('window', { __ODV_CONFIG__: { ocr: { enabled: false } } });
    await expect(loadOcrModule()).resolves.toBeNull();
    expect(state.evaluations).toBe(0);
  });

  it('imports the module once with the literal true and shares the promise', async () => {
    const first = loadOcrModule({ ocr: { enabled: true } });
    const second = loadOcrModule({ ocr: { enabled: true } });
    expect(first).toBe(second);
    const loaded = await first;
    expect(loaded.marker).toBe('mocked ocr module');
    expect(state.evaluations).toBe(1);
    expect(isOcrModuleRequested()).toBe(true);

    await expect(loadOcrModule({ ocr: { enabled: true } })).resolves.toBe(loaded);
    expect(state.evaluations).toBe(1);

    // A later call with the switch off is still a no-op and does not touch the cached module.
    await expect(loadOcrModule({ ocr: { enabled: false } })).resolves.toBeNull();
    expect(state.evaluations).toBe(1);
  });
});

describe('static import boundary of src/ocr/', () => {
  const srcRoot = fileURLToPath(new URL('../../', import.meta.url));

  function sourceFiles(dir, out = []) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === '__tests__') continue;
        sourceFiles(full, out);
      } else if (/\.(?:js|jsx)$/.test(entry) && !/\.test\.(?:js|jsx)$/.test(entry)) {
        out.push(full);
      }
    }
    return out;
  }

  it('only src/utils/ocrLoader.js references src/ocr/ or tesseract.js, and only dynamically', () => {
    const offenders = [];
    for (const file of sourceFiles(srcRoot)) {
      const rel = relative(srcRoot, file).split('\\').join('/');
      if (rel.startsWith('ocr/')) continue;
      const code = readFileSync(file, 'utf8');
      const references = [...code.matchAll(/(?:from\s*|import\s*\(?\s*)['"]([^'"]*(?:\/ocr\/|tesseract\.js|odv-ocr-assets)[^'"]*)['"]/g)];
      for (const match of references) {
        const specifier = match[1];
        const isDynamic = /^import\s*\(/.test(match[0]);
        if (rel === 'utils/ocrLoader.js' && isDynamic && specifier === '../ocr/index.js') continue;
        offenders.push(`${rel}: ${match[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
