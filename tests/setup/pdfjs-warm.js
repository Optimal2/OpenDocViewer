// Test-only warm-up: production signature inspection and its time budgets are unchanged.
// On 2026-10-31 (Node 22.23.3, Vitest 5.0.5, 24-core hub), a fresh pdf.js import
// measured 318 ms without load and 1,074 ms with 23 CPU busy-loop processes;
// the immediately repeated import measured 0.061 ms and 0.075 ms respectively.
// Only unmocked suites that execute the real pdf.js differential opt in from
// beforeAll. Under Vite, 'pdfjs-dist/legacy/build/pdf' and the explicit '.mjs'
// specifier resolve to the same file and module namespace: the extension is not
// an isolation boundary. Never warm either specifier from a suite that mocks it.
// A global setupFiles import instead made every test file pay this cost during
// worker startup and repeatedly exceeded Vitest's 60 s worker-response limit.
let warmed = false;

/** Load and cache the exact pdf.js module namespace used by the differential. */
export async function warmPdfjs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  warmed = true;
  return pdfjs;
}

/** Whether this test file's pdf.js warm-up has actually completed. */
export function pdfjsWarmed() {
  return warmed;
}
