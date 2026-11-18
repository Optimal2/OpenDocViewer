// File: src/utils/__tests__/ocrLoader.test.js
/**
 * Proves the import boundary of the OCR module:
 *  - loadOcrModule never imports src/ocr/index.js while `ocr.enabled` is not the literal true
 *    (a counting mock of the module shows zero evaluations);
 *  - with the switch on the module is imported exactly once and shared;
 *  - with only `pdfTextLayer.enabled` the literal true, the text-only entry (src/ocr/pdfText.js)
 *    is imported once and the full module never; with both on, the full module alone;
 *  - statically, src/utils/ocrLoader.js is the only file outside src/ocr/ that references the
 *    folder or tesseract.js, and it does so with its two dynamic imports.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOcrModuleRequested, isPdfTextModuleRequested, loadOcrModule, resetOcrModuleForTests } from '../ocrLoader.js';

const state = vi.hoisted(() => ({ evaluations: 0, textEvaluations: 0 }));

vi.mock('../../ocr/index.js', () => {
  state.evaluations += 1;
  return { marker: 'mocked ocr module' };
});

vi.mock('../../ocr/pdfText.js', () => {
  state.textEvaluations += 1;
  return { marker: 'mocked text-only entry' };
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
    ['pdfTextLayer enabled false', { pdfTextLayer: { enabled: false } }],
    ['pdfTextLayer as the string "true"', { pdfTextLayer: { enabled: 'true' } }],
    ['pdfTextLayer as the number 1', { ocr: { enabled: false }, pdfTextLayer: { enabled: 1 } }],
    ['pdfTextLayer as a bare true', { pdfTextLayer: true }],
  ])('resolves null without importing the module for %s', async (_label, cfg) => {
    await expect(loadOcrModule(cfg)).resolves.toBeNull();
    expect(state.evaluations).toBe(0);
    expect(state.textEvaluations).toBe(0);
    expect(isOcrModuleRequested()).toBe(false);
    expect(isPdfTextModuleRequested()).toBe(false);
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
    // The full module never brought the text-only entry in through the loader.
    expect(isPdfTextModuleRequested()).toBe(false);
  });

  it('imports the text-only entry, and never the full module, with only pdfTextLayer.enabled true', async () => {
    const fullBefore = state.evaluations;
    const cfg = { ocr: { enabled: false }, pdfTextLayer: { enabled: true } };
    const first = loadOcrModule(cfg);
    expect(loadOcrModule(cfg)).toBe(first);
    const loaded = await first;
    expect(loaded.marker).toBe('mocked text-only entry');
    expect(state.textEvaluations).toBe(1);
    expect(state.evaluations).toBe(fullBefore);
    expect(isPdfTextModuleRequested()).toBe(true);
    expect(isOcrModuleRequested()).toBe(false);

    // A missing ocr section is off as well.
    await expect(loadOcrModule({ pdfTextLayer: { enabled: true } })).resolves.toBe(loaded);
    expect(state.textEvaluations).toBe(1);
  });

  it('hands over the full module when both switches are on', async () => {
    const loaded = await loadOcrModule({ ocr: { enabled: true }, pdfTextLayer: { enabled: true } });
    expect(loaded.marker).toBe('mocked ocr module');
    expect(isOcrModuleRequested()).toBe(true);
    expect(isPdfTextModuleRequested()).toBe(false);
  });

  it('reads the viewer config for the text-only entry when called without an argument', async () => {
    vi.stubGlobal('window', { __ODV_CONFIG__: { pdfTextLayer: { enabled: true } } });
    await expect(loadOcrModule()).resolves.toMatchObject({ marker: 'mocked text-only entry' });
    expect(isOcrModuleRequested()).toBe(false);
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
        if (rel === 'utils/ocrLoader.js' && isDynamic && (specifier === '../ocr/index.js' || specifier === '../ocr/pdfText.js')) continue;
        offenders.push(`${rel}: ${match[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
