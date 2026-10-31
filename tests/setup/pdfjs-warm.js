// Test-only warm-up: production signature inspection and its time budgets are unchanged.
// On 2026-10-31 (Node 22.23.3, Vitest 5.0.5, 24-core hub), a fresh pdf.js import
// measured 318 ms without load and 1,074 ms with 23 CPU busy-loop processes;
// the immediately repeated import measured 0.061 ms and 0.075 ms respectively.
// Only suites that execute the real pdf.js differential opt in from beforeAll.
// A global setupFiles import instead made every test file pay this cost during
// worker startup and repeatedly exceeded Vitest's 60 s worker-response limit.
/** Load and cache the exact pdf.js module namespace used by the differential. */
export async function warmPdfjs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}
