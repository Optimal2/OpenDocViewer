// Bounded red-before-green proof. Each mutation is restored in finally; no git
// state is changed. Run only in an isolated worktree without concurrent edits.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const parser = 'src/utils/pdfSignatures.js';
const inspector = 'src/utils/pdfSignatureInspector.js';
const revisions = 'src/utils/pdfSignatureRevisions.js';
const originals = new Map([parser, inspector, revisions].map((file) => [file, readFileSync(file, 'utf8')]));
const tests = 'src/utils/__tests__/pdfSignatureSecurity.test.js';
const workerTests = 'src/utils/__tests__/pdfSignatureWorkerSecurity.test.js';
const inspectorTests = 'src/utils/__tests__/pdfSignatureInspector.test.js';
const revisionTests = 'src/utils/__tests__/pdfSignatureRevisions.test.js';
const signingTimeTests = 'src/utils/__tests__/pdfSignatureSigningTime.test.js';
const boundaryTests = 'src/utils/__tests__/pdfSignatureErrorBoundaries.test.js';
const mutations = [
  ['F1', parser, 'if (signerInfo.signedAttrs) {', 'if (signerInfo.signedAttrs && !encapsulated) {', tests, 'F1'],
  ['F2', parser, 'if (signerInfo.signedAttrs) {', 'if (signerInfo.signedAttrs && findAttribute(signerInfo.signedAttrs, OID_ATTR_MESSAGE_DIGEST)) {', tests, 'F2'],
  ['F3', parser, "other.info?.integrity === 'intact' &&", 'true &&', tests, 'F3'],
  ['F4', parser, 'const rangeValid = validByteRange(bytes, byteRange, fields.contentsRaw, sourceSpans);', 'const rangeValid = true;', tests, 'F4 widened'],
  ['F5', parser, 'const sid = signerInfo.sid;', 'return certs[0];\n  const sid = signerInfo.sid;', tests, 'F5 no certificate fallback: wrongIssuer'],
  ['F6', inspector, "return notCheckedSignatureReport(err?.code === 'timeout' ? 'timeout' : 'viewer-error', String(err?.message ?? err));", 'return collectPdfSignatures(bytes);', workerTests, 'F6 timeout'],
  ['F7', parser, 'let pdfLib;', "if (!new TextDecoder().decode(bytes).includes('/ByteRange')) return empty;\n  let pdfLib;", tests, 'F7'],
  ['F8', inspector, "if (workerHandle) markBroken(workerHandle, 'signature worker disposed');", 'workerHandle?.worker?.terminate();', workerTests, 'F8'],
  ['Minification', parser, 'return obj instanceof pdfLib.PDFDict;', "return obj?.constructor?.name === 'PDFDict';", tests, 'production minification'],
  ['F10b', parser, 'let pdfLib;', "if (!new TextDecoder().decode(bytes.subarray(0, 1028)).includes('%PDF-')) return empty;\n  let pdfLib;", 'src/utils/__tests__/pdfSignatures.test.js', 'F10'],
  ['F12', inspector, 'if (workerRecreations >= MAX_WORKER_RECREATIONS) return null;', 'return null;', workerTests, 'F12'],
  // Status model (docs-src/pdf-signatures.md "Status model").
  ['Curve OID check dropped (guess the curve from the key)', parser, 'return CURVE_OID_TO_POINT_SIZE.get(oidOf(params)) ?? null;',
    'return CURVE_OID_TO_POINT_SIZE.get(oidOf(params)) ?? 32;', tests, 'row 24b unknown ECDSA curve'],
  ['Typed viewer limits ignored', parser, "if (err instanceof ViewerLimitError) setIntegrity(info, 'not-checked-in-viewer', err.code, message);",
    "if (false) setIntegrity(info, 'not-checked-in-viewer', err.code, message);", tests, 'row 14b'],
  ['Structural limit lost in pdf-lib wrapping', parser, 'throw limit ?? err;', 'throw err;', tests, '50k nested'],
  ['Inspector read error fails open', inspector, "return notCheckedSignatureReport('viewer-error', `PDF bytes cannot be read: ${String(err?.message ?? err)}`);",
    'return { signatures: [] };', inspectorTests, 'I2'],
  ['Worker timeout code lost', inspector, "markBroken(handle, `signature worker timeout after ${timeoutMs} ms`, 'timeout');",
    'markBroken(handle, `signature worker timeout after ${timeoutMs} ms`);', workerTests, 'F6 timeout'],
  // Error-versus-information boundaries: a defect must never fall through to a green viewer limit.
  ['Missing digest OID treated as unsupported', parser, 'if (!digestOid) return signedDataFailure(',
    'if (false) return signedDataFailure(', boundaryTests, 'row 12 missing digest algorithm OID'],
  ['Unparseable TSTInfo treated as unsupported', parser, "setIntegrity(info, 'unreadable', 'cms-malformed', `document timestamp not parseable",
    "setIntegrity(info, 'not-checked-in-viewer', 'algorithm-unsupported', `document timestamp not parseable", boundaryTests, 'TSTInfo is not BER'],
  ['Oversized ECDSA INTEGER left to the generic error path', parser, "return 'malformed'; // an INTEGER longer than the curve's point size",
    "throw new RangeError('offset is out of bounds');", boundaryTests, 'longer than the curve size'],
  // Signing time: an unverified timestamp must never become the selected time.
  ['Unverified timestamp accepted as signing time', parser, 'if (!imprintMatches || !tst.genTime) {',
    'if (!tst.genTime) {', signingTimeTests, 'wrong imprint'],
  // Appended-revision classifier (docs-src/pdf-signatures.md "Appended revisions").
  ['Active signed xref chain reverted to last physical section wins', revisions,
    'const preSections = activeXrefChain(physicalPreSections, signedSection, pdfLib);',
    'const preSections = [...physicalPreSections].reverse();', revisionTests, 'unlinked decoy'],
  ['Xref consistency check removed', revisions, 'assertXrefConsistent(log, E, tail, preSections, pre, tailRecords);', '',
    revisionTests, 'shadow object'],
  ['Deleted entries ignored', revisions, "if (target === 'free' && inUseAtE(n))", 'if (false)', revisionTests, 'deletes a live object'],
  ['Object stream number reuse allowed', revisions, 'if (inUseAtE(c.num) || tailRecords.has(c.num)) stop(', 'if (false) stop(',
    revisionTests, 'reuses a signed object number'],
  ['Validation data wins over content', revisions, 'if (rContent.has(n)) changes.push(n);',
    'if (rValidation.has(n)) continue;\n    if (rContent.has(n)) changes.push(n);', revisionTests, 'shared by /DSS'],
  ['Visible timestamp widget allowed', revisions, 'return hidden || zeroArea;', 'return true;', revisionTests, 'visible timestamp widget'],
  ['Orphan objects accepted', revisions, 'else if (!rValidation.has(n)) inconclusive.push(n);', 'else if (false) inconclusive.push(n);',
    revisionTests, 'orphan object'],
  ['Unhooked parser trusted', revisions, 'if (!log?.hooked) return unclassified(', 'if (false) return unclassified(',
    revisionTests, 'only trusted while hooked'],
  ['Prev chain unchecked', revisions, '|| prev.asNumber() !== expected) stop(', '|| false) stop(', revisionTests, 'Prev does not chain'],
  ['Freeing a signed structural stream number allowed', revisions,
    'const inUseAtE = (n) => pre.has(n) || preStreamNums.has(n);', 'const inUseAtE = (n) => pre.has(n);',
    revisionTests, 'frees the signed'],
  ['Appended xref stream ignored as a dangling-reference fill', revisions,
    '...log.structural.filter((c) => c.start >= E).map((c) => c.num)',
    "...log.structural.filter((c) => c.start >= E && c.type === 'ObjStm').map((c) => c.num)",
    revisionTests, 'appended /Type /XRef stream'],
  ['Signed structural streams counted as filled later', revisions,
    '...log.structural.filter((c) => c.start >= E).map((c) => c.num)', '...log.structural.map((c) => c.num)',
    revisionTests, 'references the signed xref stream'],
  ['Appended entry for a signed structural stream rejected', revisions,
    "log.structural.some((c) => c.start < E && c.num === e.num && c.start === e.offset)) target = 'pre';",
    "false) target = 'pre';",
    revisionTests, 're-lists the signed object and xref streams'],
  ['Forward /Prev accepted without a rendering comparison', revisions,
    'if (!previous || previous.offset >= section.offset) stop(', 'if (!previous) stop(',
    revisionTests, 'DSS-only append -> documented warning'],
  ['Raw escaped security names trusted', revisions,
    'if (!r.nested && hasEscapedSecurityName(r.raw)) {', 'if (false) {',
    revisionTests, 'lowercase hex-escaped'],
  ['Structural linearization dictionaries skipped', revisions,
    'function assertLinearizationIgnored(log, E, pdfLib) {',
    'function assertLinearizationIgnored(log, E, pdfLib) {\n  log = { ...log, structural: [] };',
    revisionTests, 'first-object xref stream'],
  ['Linearization /L not checked against the signed length', revisions,
    'if (!(length instanceof PDFNumber) || !(length.asNumber() <= E)) {', 'if (false) {',
    revisionTests, '/L set before signing'],
  ['Bytes before the %PDF- header allowed', revisions,
    "if (!log.headerAtStart) stop('the file does not start with the %PDF- header');", '',
    revisionTests, 'hidden before the %PDF- header'],
  ['Linearization guard not called', revisions, 'assertLinearizationIgnored(log, E, pdfLib);', '',
    revisionTests, 'pdf.js reads a forged xref table']
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
