// Foreground regression proofs. Run in an isolated worktree without parallel edits/tests.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const gateway = 'src/utils/pdfSignatureGateway.js';
const hook = 'src/hooks/usePdfSignatureReports.js';
const status = 'src/utils/pdfSignatureStatus.js';
const badge = 'src/components/SignatureStatusBadge.jsx';
const dialog = 'src/components/SignatureDetailsDialog.jsx';
const provider = 'src/contexts/ViewerProvider.jsx';
const hookTests = 'src/hooks/__tests__/pdfSignatureGateway.test.jsx';
const unitTests = 'src/utils/__tests__/pdfSignatureGateway.test.js';
const uiTests = 'src/components/__tests__/pdfSignatureGatewayUi.test.jsx';
const mutations = [
  ['source index', gateway, '${session}/${match[3]}', '${session}/0', hookTests, 'G1'],
  ['non-gateway detection', gateway, "return { endpoint: `${session}/${match[3]}`, session };",
    'return null;', hookTests, 'G1'],
  ['unsigned guard', gateway, 'report.signatures.length === 0', 'false', hookTests, 'G2'],
  ['cache', hook, 'if (!entries.has(key))', "if (entries.get(key)?.state !== 'pending')", hookTests, 'G1'],
  ['serial queue', hook, 'const INSPECTION_CONCURRENCY = 1;', 'const INSPECTION_CONCURRENCY = Infinity;', hookTests, 'G3'],
  ['early browser report', hook, 'setReports((previous) => ({ ...previous, [sourceKey]: report }));', '// Early report disabled.', hookTests, 'G3'],
  ['disabled session', gateway, 'disabledSessions.add(context.session);', '// Disabled cache removed.', hookTests, 'G4'],
  ['ordinary 404', gateway, 'response.status === 404 && body?.error === DISABLED', 'response.status === 404', hookTests, 'G5'],
  ['error trust', gateway, "trust: 'not-checked', trustReason: UNAVAILABLE", "trust: 'valid', trustReason: UNAVAILABLE", hookTests, 'G5'],
  ['bounded timeout', gateway, 'const TIMEOUT_MS = 20000;', 'const TIMEOUT_MS = 40000;', hookTests, 'G6'],
  ['abort', gateway, 'controller.abort(); reject', 'reject', hookTests, 'G6'],
  ['removed document', hook, 'if (isCurrent() && report)', 'if (report)', hookTests, 'G7'],
  ['badge wiring', badge, 'getReportSignatureSeverity(report.signatures)', "'ok'", uiTests, 'G8'],
  ['unchecked line', dialog, '!trustChecked ? (', 'true ? (', uiTests, 'G9'],
  ['validation time', dialog, 'trustChecked && signature?.validationTime', 'false', uiTests, 'G9'],
  ['timestamp label', dialog, "case 'timestamp':\n      return t('signatures.timeSource.timestamp'", "case 'disabled-timestamp':\n      return t('signatures.timeSource.timestamp'", uiTests, 'G9'],
  ['provider wiring', provider, 'getSourceUrl: getSignatureSourceUrl,', 'getSourceUrl: undefined,', 'src/contexts/ViewerProvider.signatures.test.jsx', 'G10'],
  ['URL protocol', gateway, "!['http:', 'https:'].includes(url.protocol)", 'false', unitTests, 'G11'],
  ['field identity', gateway, 'byField.get(signature.fieldName)', 'server.signatures[0]', unitTests, 'G12'],
  ['better server integrity', gateway, 'getWorstSignatureIntegrity([signature, remote])', 'remote.integrity', unitTests, 'G13'],
  ['worse server integrity', gateway, 'getWorstSignatureIntegrity([signature, remote])', 'signature.integrity', unitTests, 'G13'],
  ['timestamp only', gateway, "...(remote.signingTimeSource === 'timestamp'", '...(true', unitTests, 'G14'],
  ['duplicate field identity', gateway, 'if (byField.has(signature.fieldName)) return unavailable(report);', '// Duplicate accepted.', unitTests, 'G15'],
  ['malformed trust', gateway, '!TRUST_VALUES.includes(signature.trust)', 'false', unitTests, 'G16'],
  ['invalid trust severity', status, "trust === 'invalid'", 'false', unitTests, 'G17'],
  ['unknown trust severity', status, "trust === 'unknown'", 'false', unitTests, 'G17'],
];
const originals = new Map([...new Set(mutations.map(([, file]) => file))].map((file) => [file, readFileSync(file, 'utf8')]));
try {
  for (const [name, file, from, to, testFile, testName] of mutations) {
    const source = originals.get(file).replaceAll('\r\n', '\n');
    if (!source.includes(from)) throw new Error(`Mutation anchor missing: ${name}`);
    try {
      writeFileSync(file, source.replace(from, to));
      const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', testFile, '-t', testName], {
        encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
      });
      const output = result.stdout + result.stderr;
      console.log(`${name}: exit ${result.status}; ${output.match(/Tests\s+[^\n]+/)?.[0] ?? 'no summary'}`);
      if (result.error || result.signal || result.status !== 1 || !output.includes('AssertionError')) {
        throw new Error(`Expected measured assertion failure: ${result.error ?? result.signal ?? output}`);
      }
    } finally { writeFileSync(file, originals.get(file)); }
  }
  console.log(`All ${mutations.length} gateway mutations detected; sources restored.`);
} finally {
  for (const [file, source] of originals) writeFileSync(file, source);
}
