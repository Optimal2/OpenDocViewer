/** @vitest-environment node */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { warmPdfjs } from './pdfjs-warm.js';

// Code reading on 2026-10-31: these are the only suites that reach the real
// comparator (directly, or through an accepted appended-revision verdict).
// Mocked loadPdfjs suites and signature suites whose fixtures never receive an
// accepted appended-revision verdict deliberately do not pay the import cost.
const differentialSuites = [
  'src/utils/__tests__/pdfSignatureRenderCheck.test.js',
  'src/utils/__tests__/pdfSignatureRevisions.test.js',
  'src/utils/__tests__/pdfSignatureRenderCheckGuardsDisabled.test.js',
];

const warmImport = /import\s*\{\s*warmPdfjs\s*\}\s*from\s*['"]\.\.\/\.\.\/\.\.\/tests\/setup\/pdfjs-warm\.js['"]\s*;?/;
const warmBeforeAll = /beforeAll\s*\(\s*(?:warmPdfjs\b|(?:async\s*)?\(\s*\)\s*=>\s*(?:\{\s*(?:await\s+|return\s+)?)?warmPdfjs\s*\(\s*\))/;

describe('targeted pdf.js test warm-up', () => {
  it('loads and returns the exact module namespace used by the default differential', async () => {
    const warmed = await warmPdfjs();
    const differentialPdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // Module identity binds behavior without a load-dependent timing threshold.
    expect(warmed === differentialPdfjs, 'warmPdfjs() must load and return the differential pdf.js namespace').toBe(true);
    expect(differentialPdfjs.getDocument).toBeTypeOf('function');
  });

  it.each(differentialSuites)('%s opts in from its own beforeAll', (file) => {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    expect(source).toMatch(warmImport);
    // Deleting the opt-in is red; direct and callback-wrapper forms are green.
    expect(source).toMatch(warmBeforeAll);
  });

  it('accepts equivalent beforeAll callback wrappers', () => {
    expect('beforeAll(() => warmPdfjs());').toMatch(warmBeforeAll);
    expect('beforeAll(async () => { await warmPdfjs(); });').toMatch(warmBeforeAll);
  });

  it('does not reload pdf.js in every Vitest worker through global setupFiles', () => {
    const config = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
    expect(config).not.toMatch(/setupFiles\s*:/);
  });
});
