// Run in an isolated worktree, without concurrent edits/tests of these files.
// Each deliberately broken behavior must fail an assertion; always restore sources.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const mutations = [
  {
    name: 'main-thread annotation rendering disabled',
    file: 'src/utils/pageAssetRenderer.js',
    from: 'page.render({ canvasContext: ctx, viewport })',
    to: 'page.render({ canvasContext: ctx, viewport, annotationMode: 0 })',
    ui: true, filter: 'main-thread.*widget states',
  },
  {
    name: 'worker annotation rendering disabled',
    file: 'src/workers/pdfPageWorker.js',
    from: 'page.render({ canvasContext: ctx, viewport })',
    to: 'page.render({ canvasContext: ctx, viewport, annotationMode: 0 })',
    ui: true, filter: 'worker.*widget states',
  },
  {
    name: 'overview list regresses to listbox',
    file: 'src/components/SignatureOverviewDialog.jsx',
    from: 'className="odv-signature-overview-list"',
    to: 'className="odv-signature-overview-list" role="listbox"',
    filter: 'uses list items',
  },
  {
    name: 'suspended overview loses inert',
    file: 'src/components/SignatureOverviewDialog.jsx',
    from: 'inert={suspended ? true : undefined}',
    to: 'inert={undefined}',
    filter: 'is inert and aria-hidden',
  },
];

for (const mutation of mutations) {
  const original = readFileSync(mutation.file, 'utf8');
  if (!original.includes(mutation.from)) throw new Error(`Mutation no longer matches: ${mutation.name}`);
  try {
    writeFileSync(mutation.file, original.replace(mutation.from, mutation.to));
    const args = mutation.ui
      ? ['node_modules/@playwright/test/cli.js', 'test', 'tests/ui/signature-appearance.spec.mjs', '--grep', mutation.filter]
      : ['node_modules/vitest/vitest.mjs', 'run', 'src/components/__tests__/signatureOverview.test.jsx', '-t', mutation.filter];
    const result = spawnSync(process.execPath, args, {
      encoding: 'utf8', timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error || result.signal) throw new Error(`Unmeasured test: ${result.error ?? result.signal}`);
    const output = result.stdout + result.stderr;
    // Require the specific assertion failure, not a startup/import/server error.
    const assertion = mutation.ui ? 'toBeGreaterThan' : 'AssertionError';
    if (result.status !== 1 || !output.includes(assertion)) {
      throw new Error(`Expected assertion failure for ${mutation.name}:\n${output}`);
    }
    console.log(`Detected: ${mutation.name} (test exit 1, assertion failure)`);
  } finally {
    writeFileSync(mutation.file, original);
  }
}
console.log('All 4 regression proofs detected; sources restored. Run the unmodified suites again.');
