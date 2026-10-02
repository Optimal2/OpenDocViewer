// Foreground regression proof; temporary mutations are restored even on failure.
// Run in an isolated worktree without simultaneous edits/tests of these files.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const hook = 'src/hooks/usePdfSignatureReports.js';
const status = 'src/utils/pdfSignatureStatus.js';
const inspector = 'src/utils/pdfSignatureInspector.js';
const provider = 'src/contexts/ViewerProvider.jsx';
const hookTests = 'src/hooks/__tests__/usePdfSignatureReports.test.jsx';
const workerTests = 'src/utils/__tests__/pdfSignatureWorkerSecurity.test.js';
const providerTests = 'src/contexts/ViewerProvider.signatures.test.jsx';
const originals = new Map([hook, status, inspector, provider].map((file) => [file, readFileSync(file, 'utf8')]));
const mutations = [
  ['F1 cleanup drops pending results', hook, '    pumpRef.current();\n  }, [allPages',
    '    pumpRef.current();\n    return () => entries.clear();\n  }, [allPages', hookTests, 'F1'],
  ['F2 unbounded concurrency', hook, 'const INSPECTION_CONCURRENCY = 1;', 'const INSPECTION_CONCURRENCY = Infinity;', hookTests, 'F2'],
  ['F2 missing transfer', inspector, 'transfer ? [bytes.buffer] : []', '[]', workerTests, 'F2'],
  ['F3 mixed unknown status', status, 'normalizeSignatureIntegrity(entry?.integrity)', "String(entry?.integrity || '')", 'src/utils/__tests__/pdfSignatureStatus.test.js', 'F3'],
  ['F4 disposal no longer settles requests', inspector, "if (workerHandle) markBroken(workerHandle, 'signature worker disposed');", 'workerHandle?.worker?.terminate();', workerTests, 'F8'],
  ['F5 disconnected provider reports', provider, '    signatureReports,', '    signatureReports: {},', providerTests, 'F5'],
  ['F5 missing unmount disposal', provider, '    disposePdfSignatureWorker();', '    // Disposal intentionally disabled for regression proof.', providerTests, 'F5'],
];

try {
  // Verify the original F1 implementation also fails the new pending-rerender test.
  const baseline = spawnSync('git', ['show', `053dc89b99021447807f83cec8007b8705276667:${hook}`], { encoding: 'utf8' });
  if (baseline.status !== 0) throw new Error(baseline.stderr);
  try {
    writeFileSync(hook, baseline.stdout);
    run('F1 reviewed baseline', hookTests, 'F1');
  } finally { writeFileSync(hook, originals.get(hook)); }

  for (const [id, file, from, to, testFile, name] of mutations) {
    const original = originals.get(file);
    // Source may use CRLF after checkout.
    const normalized = original.replaceAll('\r\n', '\n');
    if (!normalized.includes(from)) throw new Error(`Mutation no longer matches: ${id}`);
    try {
      writeFileSync(file, normalized.replace(from, to));
      run(id, testFile, name);
    } finally { writeFileSync(file, original); }
  }
  console.log(`All ${mutations.length + 1} regression proofs detected; sources restored.`);
} finally {
  for (const [file, original] of originals) writeFileSync(file, original);
}

function run(id, file, name) {
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', file, '-t', name], {
    encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.signal) throw new Error(`Unmeasured test: ${result.error ?? result.signal}`);
  const output = result.stdout + result.stderr;
  console.log(`${id}: exit ${result.status}; ${output.match(/Tests\s+[^\n]+/)?.[0] ?? 'no test summary'}`);
  if (result.status !== 1 || !output.includes('AssertionError')) throw new Error(`Expected assertion failure:\n${output}`);
}
