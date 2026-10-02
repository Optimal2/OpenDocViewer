// Bounded red-before-green proof. Each mutation is restored in finally; no git
// state is changed. Run only in an isolated worktree without concurrent edits.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const parser = 'src/utils/pdfSignatures.js';
const inspector = 'src/utils/pdfSignatureInspector.js';
const originals = new Map([parser, inspector].map((file) => [file, readFileSync(file, 'utf8')]));
const tests = 'src/utils/__tests__/pdfSignatureSecurity.test.js';
const workerTests = 'src/utils/__tests__/pdfSignatureWorkerSecurity.test.js';
const mutations = [
  ['F1', parser, 'if (signerInfo.signedAttrs) {', 'if (signerInfo.signedAttrs && !encapsulated) {', tests, 'F1'],
  ['F2', parser, 'if (signerInfo.signedAttrs) {', 'if (signerInfo.signedAttrs && findAttribute(signerInfo.signedAttrs, OID_ATTR_MESSAGE_DIGEST)) {', tests, 'F2'],
  ['F3', parser, "other.info?.integrity === 'intact' &&", 'true &&', tests, 'F3'],
  ['F4', parser, 'const rangeValid = validByteRange(bytes, byteRange, fields.contentsRaw, sourceSpans);', 'const rangeValid = true;', tests, 'F4 widened'],
  ['F5', parser, 'const sid = signerInfo.sid;', 'return certs[0];\n  const sid = signerInfo.sid;', tests, 'F5 no certificate fallback: wrongIssuer'],
  ['F6', inspector, 'return unreadableSignatureReport(String(err?.message ?? err));', 'return collectPdfSignatures(bytes);', workerTests, 'F6 timeout'],
  ['F7', parser, 'let pdfLib;', "if (!new TextDecoder().decode(bytes).includes('/ByteRange')) return empty;\n  let pdfLib;", tests, 'F7'],
  ['F8', inspector, "if (workerHandle) markBroken(workerHandle, 'signature worker disposed');", 'workerHandle?.worker?.terminate();', workerTests, 'F8'],
  ['Minification', parser, 'return obj instanceof pdfLib.PDFDict;', "return obj?.constructor?.name === 'PDFDict';", tests, 'production minification'],
  ['F10b', parser, 'let pdfLib;', "if (!new TextDecoder().decode(bytes.subarray(0, 1028)).includes('%PDF-')) return empty;\n  let pdfLib;", 'src/utils/__tests__/pdfSignatures.test.js', 'F10'],
  ['F12', inspector, 'if (workerRecreations >= MAX_WORKER_RECREATIONS) return null;', 'return null;', workerTests, 'F12']
];

function run(file, name) {
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', file, '-t', name], {
    encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024
  });
  if (result.error || result.signal) throw new Error(`Test could not be measured: ${result.error ?? result.signal}`);
  const output = result.stdout + result.stderr;
  const summary = output.match(/Tests\s+[^\n]+/)?.[0] ?? 'missing test summary';
  console.log(`${name}: exit ${result.status}; ${summary}`);
  if (result.status !== 1 || !output.includes('AssertionError')) throw new Error(`Expected assertion failure, got:\n${output}`);
}

try {
  if (process.argv.includes('--baseline')) {
    for (const file of originals.keys()) {
      const baseline = spawnSync('git', ['show', `9e73b809bba6fc8dcc84c1fe18c08ef17552f0e1:${file}`], { encoding: 'utf8' });
      if (baseline.status !== 0) throw new Error(baseline.stderr);
      writeFileSync(file, baseline.stdout);
    }
    run(tests, 'F[1-57]');
    run(workerTests, 'F[68]');
    for (const [file, content] of originals) writeFileSync(file, content);
  }
  for (const [id, file, from, to, testFile, name] of mutations) {
    const original = originals.get(file);
    if (!original.includes(from)) throw new Error(`Mutation ${id} no longer matches source`);
    try {
      writeFileSync(file, original.replace(from, to));
      run(testFile, name);
    } finally { writeFileSync(file, original); }
  }
  console.log(`All ${mutations.length} mutation groups were killed; original sources restored.`);
} finally {
  for (const [file, content] of originals) writeFileSync(file, content);
}
