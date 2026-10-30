// Time the pdf.js differential confirmation (src/utils/pdfSignatureRenderCheck.js)
// on synthetic fixtures: the largest appended-revision fixture of the security
// set, the committed regression files, and a realistic multi-page signed PDF.
// Usage: node scripts/measure-signature-render-check.mjs [pageCount ...]
// Prints one line per file: bytes, pages, outcome, comparator time, full
// signature inspection time and the resulting verdict. Node only; the browser
// runs the same code inside the signature worker.
import { readFileSync } from 'node:fs';
import { createSecurityFixtures, byteRange } from './signature-security-fixtures.mjs';
import { createMultiPageFixtures } from './signature-revision-fixtures.mjs';
import { createFixturePki } from './generate-signature-fixtures.mjs';
import { createRenderComparator } from '../src/utils/pdfSignatureRenderCheck.js';
import { collectPdfSignatures } from '../src/utils/pdfSignatures.js';

const pageCounts = process.argv.slice(2).map(Number).filter((n) => n > 0);
const fixtures = await createSecurityFixtures();
const files = [];
const walk = (value, path) => {
  if (value instanceof Uint8Array) files.push([path, value]);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
};
walk(fixtures, '');
const appended = files.filter(([, bytes]) => {
  try { const br = byteRange(bytes, true); return br[2] + br[3] < bytes.length; } catch { return false; }
});
const largest = appended.reduce((a, b) => (b[1].length > a[1].length ? b : a));
const measured = [[`largest appended fixture (${largest[0]})`, largest[1]]];
for (const name of ['attack-escaped-root-key.pdf', 'attack-startxref-in-stream-data.pdf']) {
  measured.push([name, new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))]);
}
const pki = await createFixturePki();
for (const pages of pageCounts.length ? pageCounts : [20, 50]) {
  const multi = await createMultiPageFixtures(pki, pages);
  measured.push([`${pages}-page signed, DSS-only append`, multi.dss]);
  measured.push([`${pages}-page signed, content change on page ${pages - 3}`, multi.contentChanged]);
}

for (const [label, bytes] of measured) {
  const br = byteRange(bytes);
  let t = performance.now();
  const comparator = createRenderComparator(bytes);
  const check = await comparator.compare(br[2] + br[3]);
  await comparator.destroy();
  const compareMs = performance.now() - t;
  t = performance.now();
  const report = await collectPdfSignatures(bytes);
  const inspectMs = performance.now() - t;
  const verdict = report.signatures.map((s) => `${s.kind}:${s.integrity}/${s.integrityCode}`).join(' ');
  console.log(`${label} | ${bytes.length} B | ${check.outcome} (${check.detail}) | compare ${compareMs.toFixed(0)} ms | inspection ${inspectMs.toFixed(0)} ms | ${verdict}`);
}
