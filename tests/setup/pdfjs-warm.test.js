/** @vitest-environment node */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Code reading on 2026-10-31: these are the only suites that reach the real
// comparator (directly, or through an accepted appended-revision verdict).
// Mocked loadPdfjs suites and signature suites whose fixtures never receive an
// accepted appended-revision verdict deliberately do not pay the import cost.
const differentialSuites = [
  'src/utils/__tests__/pdfSignatureRenderCheck.test.js',
  'src/utils/__tests__/pdfSignatureRevisions.test.js',
  'src/utils/__tests__/pdfSignatureRenderCheckGuardsDisabled.test.js',
];

describe('targeted pdf.js test warm-up', () => {
  it.each(differentialSuites)('%s opts in from its own beforeAll', (file) => {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    expect(source).toContain("import { warmPdfjs } from '../../../tests/setup/pdfjs-warm.js';");
    // A structural assertion, not a timing threshold: deleting the warm-up from
    // any suite that needs it turns this guard red deterministically.
    expect(source).toContain('beforeAll(warmPdfjs);');
  });

  it('does not reload pdf.js in every Vitest worker through global setupFiles', () => {
    const config = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
    expect(config).not.toMatch(/setupFiles\s*:/);
  });
});
