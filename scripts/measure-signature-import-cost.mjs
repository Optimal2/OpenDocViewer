// Separate the cold pdf.js module import from document opening and the actual
// pdf.js differential comparison (src/utils/pdfSignatureRenderCheck.js).
// Usage: node scripts/measure-signature-import-cost.mjs [--repeat=3] [--pages=20] [--load=N]
// Every run prints a machine profile (Node, cores, RAM, measured CPU busy
// fraction) and medians for cold/warm import, opening both revisions, the
// combined startup sums (startupColdMs/startupWarmMs) and the warm compare.
// Reference numbers live in docs-src/pdf-signatures.md; re-run to reproduce.
//
// Every repeat is a fresh Node process. It prints JSON for (a) the first,
// cold import and a second, warm import of the same module, (b) getDocument +
// promise for the full and signed revisions with the module already warm, and
// (c) createRenderComparator().compare() with the module and both documents
// already warm. The fixture is the same 20-page signed DSS-only append used by
// measure-signature-render-check.mjs by default. --load=N keeps N busy-loop
// processes alive during all repeats; use availableParallelism() - 1 to model
// the default Vitest fork count on the hub. The parent prints every sample and
// then median, minimum, maximum and max-min spread in milliseconds.
//
// Sample run on 24 cores, 63.9 GiB RAM, Node 22.23.3, 20 pages, three fresh
// processes per row (median [min-max], ms; 2026-11-01; re-run to reproduce):
//   no load:  cold import 390.3 [380.2-422.7], warm import 0.060 [0.058-0.061],
//             open both 123.4 [119.1-128.1], startup cold 513.8 [508.3-541.8],
//             warm startup 123.5 [119.1-128.1], warm compare 754.5 [655.4-762.9]
//   23 load:  cold import 545.2 [480.0-676.4], warm import 0.066 [0.061-0.067],
//             open both 174.2 [159.7-222.7], startup cold 719.4 [639.7-899.1],
//             warm startup 174.3 [159.7-222.8], warm compare 1111.3 [995.8-2133.1]
import { spawn } from 'node:child_process';
import { availableParallelism, cpus, freemem, totalmem } from 'node:os';
import { byteRange } from './signature-security-fixtures.mjs';
import { createMultiPageFixtures } from './signature-revision-fixtures.mjs';
import { createFixturePki } from './generate-signature-fixtures.mjs';
import { createRenderComparator } from '../src/utils/pdfSignatureRenderCheck.js';

const flag = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const integerFlag = (name, fallback, minimum) => {
  const value = Number(flag(name) ?? fallback);
  if (!Number.isInteger(value) || value < minimum) throw new Error(`--${name} must be an integer >= ${minimum}`);
  return value;
};
const repeat = integerFlag('repeat', 3, 1);
// Machine profile: --load=N only simulates CPU contention with busy loops, so
// every run also records the real machine state: logical core count,
// total/available RAM, and the measured CPU busy fraction across all cores
// over the repeat loop (os.cpus() snapshots, Windows-compatible).
const machineProfile = () => ({
  node: process.version,
  cores: availableParallelism(),
  memTotalBytes: totalmem(),
  memFreeBytes: freemem()
});
const cpuTimes = () => cpus().reduce((acc, cpu) => {
  const t = cpu.times;
  acc.idle += t.idle;
  acc.total += t.idle + t.user + t.nice + t.sys + t.irq;
  return acc;
}, { idle: 0, total: 0 });
const cpuBusyFraction = (before, after) => (after.total > before.total
  ? 1 - (after.idle - before.idle) / (after.total - before.total)
  : NaN);
const gib = (bytes) => (bytes / 2 ** 30).toFixed(1);
const pages = integerFlag('pages', 20, 1);
const load = integerFlag('load', 0, 0);

if (process.argv.includes('--child')) {
  const sample = await measureInFreshProcess(pages);
  console.log(JSON.stringify(sample));
} else {
  const burners = Array.from({ length: load }, () => spawn(process.execPath, ['--eval', 'while (true) {}'], { stdio: 'ignore' }));
  try {
    const profileStart = machineProfile();
    const cpuStart = cpuTimes();
    console.log(`machine | node ${profileStart.node} | cores ${profileStart.cores} | mem ${gib(profileStart.memTotalBytes)} GiB total, ${gib(profileStart.memFreeBytes)} GiB free | repeat ${repeat} | pages ${pages} | requested load ${load} busy processes`);
    const samples = [];
    for (let index = 0; index < repeat; index++) {
      const sample = await runFreshChild(pages);
      samples.push(sample);
      console.log(`sample ${index + 1} | ${JSON.stringify(sample)}`);
    }
    const profileEnd = machineProfile();
    const busy = cpuBusyFraction(cpuStart, cpuTimes());
    console.log(`machine | ${gib(profileEnd.memFreeBytes)} GiB free at end | measured cpu busy ${(100 * busy).toFixed(1)}% of all cores over the run (requested load ${load})`);
    const metrics = ['coldImportMs', 'warmImportMs', 'documentOpenMs', 'openFullMs', 'openSignedMs', 'startupColdMs', 'startupWarmMs', 'compareMs', 'comparePerPageMs'];
    for (const metric of metrics) {
      const values = samples.map((sample) => sample[metric]);
      const sorted = [...values].sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
      const summary = { median, min: sorted[0], max: sorted.at(-1), spread: sorted.at(-1) - sorted[0] };
      console.log(`${metric} | ${Object.entries(summary).map(([key, value]) => `${key} ${value.toFixed(3)} ms`).join(' | ')}`);
    }
    console.log(`summary | ${JSON.stringify({ machine: { ...profileStart, memFreeEndBytes: profileEnd.memFreeBytes, cpuBusyFraction: busy, requestedLoad: load }, repeat, pages, samples })}`);
  } finally {
    for (const burner of burners) burner.kill();
  }
}

/** Run one isolated sample. Dynamic import is deliberately the only pdf.js load. */
async function measureInFreshProcess(pageCount) {
  const pki = await createFixturePki();
  const fixture = await createMultiPageFixtures(pki, pageCount);
  const bytes = fixture.dss;
  const range = byteRange(bytes);
  const signedEnd = range[2] + range[3];

  let started = performance.now();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const coldImportMs = performance.now() - started;
  started = performance.now();
  await import('pdfjs-dist/legacy/build/pdf.mjs');
  const warmImportMs = performance.now() - started;

  const documentOptions = {
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    fontExtraProperties: true,
    verbosity: pdfjs.VerbosityLevel?.ERRORS ?? 0
  };
  const open = async (data) => {
    const openStarted = performance.now();
    const task = pdfjs.getDocument({ ...documentOptions, data });
    const document = await task.promise;
    return { task, document, elapsedMs: performance.now() - openStarted };
  };
  const openStarted = performance.now();
  const full = await open(bytes.slice());
  const signed = await open(bytes.slice(0, signedEnd));
  const documentOpenMs = performance.now() - openStarted;

  // Feed the real comparator the already-resolved loading tasks. Its document
  // and page digest code, resource decoding, encoding and hashing are unchanged;
  // only module import and getDocument + promise have already been paid for.
  const preopened = [full.task, signed.task];
  const warmPdfjs = {
    ...pdfjs,
    getDocument: () => {
      const task = preopened.shift();
      if (!task) throw new Error('the comparator requested an unexpected extra document');
      return task;
    }
  };
  const comparator = createRenderComparator(bytes, { loadPdfjs: async () => warmPdfjs });
  started = performance.now();
  const check = await comparator.compare(signedEnd);
  const compareMs = performance.now() - started;
  await comparator.destroy();
  if (check.outcome !== 'same') throw new Error(`warm comparison failed: ${JSON.stringify(check)}`);

  return {
    node: process.version,
    pages: pageCount,
    bytes: bytes.length,
    coldImportMs,
    warmImportMs,
    documentOpenMs,
    startupColdMs: coldImportMs + documentOpenMs,
    startupWarmMs: warmImportMs + documentOpenMs,
    openFullMs: full.elapsedMs,
    openSignedMs: signed.elapsedMs,
    compareMs,
    comparePerPageMs: compareMs / pageCount,
    outcome: check.outcome
  };
}

/** The parent itself never imports pdf.js, so each child has a cold module cache. */
function runFreshChild(pageCount) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [process.argv[1], '--child', `--pages=${pageCount}`], { stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`measurement child exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (error) {
        reject(new Error(`invalid measurement child output: ${stdout}\n${error.message}`));
      }
    });
  });
}
