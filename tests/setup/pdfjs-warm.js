// Test-only warm-up: production signature inspection and its time budgets are unchanged.
// On 2026-10-31 (Node 22.23.3, Vitest 5.0.5, 24-core hub), a fresh pdf.js import
// measured 318 ms without load and 1,074 ms with 23 CPU busy-loop processes;
// the immediately repeated import measured 0.061 ms and 0.075 ms respectively.
// Without this setup file, the first differential in each signature test file paid
// the cold import inside the comparison's fail-closed startup budget. setupFiles
// runs before that test file, and Vitest 5.0.5 shares this module namespace with
// the test's own import. tests/setup/pdfjs-warm.test.js guards that invariant.
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

// Symbol.for avoids a colliding string key while allowing the separate guard test
// to verify both that setup ran and that its import is the exact same namespace.
globalThis[Symbol.for('opendocviewer.test.pdfjs-warm')] = { module: pdfjs };
