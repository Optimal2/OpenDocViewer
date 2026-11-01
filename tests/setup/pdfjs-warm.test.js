/** @vitest-environment node */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pdfjsWarmed, warmPdfjs } from './pdfjs-warm.js';
import { readComparatorDefaultLoad, suiteOptsIntoWarmup } from './pdfjs-warm-guard.js';

// Code reading on 2026-10-31: these are the only suites that reach the real
// comparator (directly, or through an accepted appended-revision verdict).
// Mocked loadPdfjs suites and signature suites whose fixtures never receive an
// accepted appended-revision verdict deliberately do not pay the import cost.
const differentialSuites = [
  'src/utils/__tests__/pdfSignatureRenderCheck.test.js',
  'src/utils/__tests__/pdfSignatureRevisions.test.js',
  'src/utils/__tests__/pdfSignatureRenderCheckGuardsDisabled.test.js',
];

const mockedPdfjs = /\bvi\.(?:doMock|mock)\s*\(\s*['"]pdfjs-dist\/legacy\/build\/pdf(?:\.mjs)?['"]/;

const readSuite = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

describe('targeted pdf.js test warm-up', () => {
  it('loads and returns the exact module namespace used by the default differential', async () => {
    const warmed = await warmPdfjs();
    const comparatorSource = readFileSync(new URL('../../src/utils/pdfSignatureRenderCheck.js', import.meta.url), 'utf8');
    const specifier = readComparatorDefaultLoad(comparatorSource);
    expect(specifier, 'the comparator default must have a readable static pdf.js import').not.toBeNull();
    const differentialPdfjs = await import(/* @vite-ignore */ specifier);
    // Module identity binds behavior without a load-dependent timing threshold.
    expect(warmed === differentialPdfjs, 'warmPdfjs() must load and return the differential pdf.js namespace').toBe(true);
    expect(pdfjsWarmed(), 'warmPdfjs() must record completion only after its import resolves').toBe(true);
    expect(differentialPdfjs.getDocument).toBeTypeOf('function');
  });

  it.each(differentialSuites)('%s leaves both pdf.js specifiers unmocked', (file) => {
    const source = readSuite(file);
    expect(source).not.toMatch(mockedPdfjs);
  });

  it.each(differentialSuites)('%s opts into the pdf.js warm-up', (file) => {
    expect(suiteOptsIntoWarmup(readSuite(file))).toBe(true);
  });

  it('does not reload pdf.js in every Vitest worker through global setupFiles', () => {
    const config = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
    expect(config).not.toMatch(/setupFiles\s*:/);
  });

  describe('warm-up opt-in guard', () => {
    it.each(differentialSuites)('flags %s with the opt-in removed entirely', (file) => {
      const removed = readSuite(file)
        .replace(/import\s*\{[^}]*\}\s*from\s*'[^']*pdfjs-warm\.js';\r?\n/, '')
        .replace('beforeAll(warmPdfjs);', '');
      expect(removed, 'fixture must drop both the import and the beforeAll').not.toContain('warmPdfjs');
      expect(suiteOptsIntoWarmup(removed)).toBe(false);
    });

    it.each(differentialSuites)('flags %s with the opt-in commented out', (file) => {
      const commented = readSuite(file).replace('beforeAll(warmPdfjs);', '// beforeAll(warmPdfjs);');
      expect(suiteOptsIntoWarmup(commented)).toBe(false);
    });

    it.each(differentialSuites)('flags %s with the opt-in inside a skipped block', (file) => {
      const source = readSuite(file);
      const skipped = source.replace(
        'beforeAll(warmPdfjs);',
        "describe.skip('warm-up', () => {\n  beforeAll(warmPdfjs);\n});"
      );
      expect(suiteOptsIntoWarmup(skipped)).toBe(false);
      const itSkipped = source.replace(
        'beforeAll(warmPdfjs);',
        "it.skip('warm-up', () => {\n  beforeAll(warmPdfjs);\n});"
      );
      expect(suiteOptsIntoWarmup(itSkipped)).toBe(false);
      const todo = source.replace(
        'beforeAll(warmPdfjs);',
        "describe.todo('warm-up', () => {\n  beforeAll(warmPdfjs);\n});"
      );
      expect(suiteOptsIntoWarmup(todo)).toBe(false);
    });

    it.each(differentialSuites)('flags %s with a fire-and-forget warm-up call', (file) => {
      const source = readSuite(file);
      const floating = source.replace('beforeAll(warmPdfjs);', 'beforeAll(() => { warmPdfjs(); });');
      expect(suiteOptsIntoWarmup(floating)).toBe(false);
      const unawaitedAsync = source.replace(
        'beforeAll(warmPdfjs);',
        'beforeAll(async () => { warmPdfjs(); });'
      );
      expect(suiteOptsIntoWarmup(unawaitedAsync)).toBe(false);
      // Boundary: wrappers that settle only after the import resolves still count.
      const implicitReturn = source.replace('beforeAll(warmPdfjs);', 'beforeAll(() => warmPdfjs());');
      expect(suiteOptsIntoWarmup(implicitReturn)).toBe(true);
      const awaited = source.replace(
        'beforeAll(warmPdfjs);',
        'beforeAll(async () => { await warmPdfjs(); });'
      );
      expect(suiteOptsIntoWarmup(awaited)).toBe(true);
    });
  });
});
