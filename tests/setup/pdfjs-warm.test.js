/** @vitest-environment node */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pdfjsWarmed, warmPdfjs } from './pdfjs-warm.js';

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

describe('targeted pdf.js test warm-up', () => {
  it('loads and returns the exact module namespace used by the default differential', async () => {
    const warmed = await warmPdfjs();
    const comparatorSource = readFileSync(new URL('../../src/utils/pdfSignatureRenderCheck.js', import.meta.url), 'utf8');
    const defaultLoad = comparatorSource.match(
      /\boptions\.loadPdfjs\s*\?\?\s*\(\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]\s*\)\s*\)/
    );
    expect(defaultLoad, 'the comparator default must have a readable static pdf.js import').not.toBeNull();
    const differentialPdfjs = await import(/* @vite-ignore */ defaultLoad[1]);
    // Module identity binds behavior without a load-dependent timing threshold.
    expect(warmed === differentialPdfjs, 'warmPdfjs() must load and return the differential pdf.js namespace').toBe(true);
    expect(pdfjsWarmed(), 'warmPdfjs() must record completion only after its import resolves').toBe(true);
    expect(differentialPdfjs.getDocument).toBeTypeOf('function');
  });

  it.each(differentialSuites)('%s leaves both pdf.js specifiers unmocked', (file) => {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    expect(source).not.toMatch(mockedPdfjs);
  });

  it('does not reload pdf.js in every Vitest worker through global setupFiles', () => {
    const config = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
    expect(config).not.toMatch(/setupFiles\s*:/);
  });
});
