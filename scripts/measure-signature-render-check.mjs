// Time the pdf.js differential confirmation (src/utils/pdfSignatureRenderCheck.js)
// on synthetic fixtures: the largest appended-revision fixture of the security
// set, the committed regression files, and a realistic multi-page signed PDF.
// Usage: node scripts/measure-signature-render-check.mjs [pageCount ...]
// Prints one line per file: bytes, pages, outcome, comparator time, full
// signature inspection time and the resulting verdict. Node only; the browser
// runs the same code inside the signature worker.
//
// Page forms (opt-in; never part of the default run above):
//   node --expose-gc --max-old-space-size=8192 scripts/measure-signature-render-check.mjs \
//     --forms=text,flate-rgb,jpeg,smask [--pages=1,2,4,8] [--repeat=3]
// measures the page forms of scripts/signature-page-form-fixtures.mjs (text,
// flate-rgb, jpeg, smask, jpeg-text; the image forms carry one distinct 2480x3508
// A4-at-300-dpi image per page). Per form and page count it prints the DSS-only
// append (must be `same`) and a late-page content change (must be `different`)
// with the comparator time and a pdf.js-only baseline on the same bytes and
// document options: the comparator's document calls, then getOperatorList,
// getTextContent, getAnnotations and getJSActions per page on both revisions,
// waiting until every image/font object the operator list names has arrived,
// without encoding or hashing anything. The comparator minus the baseline is
// the check's own overhead. (pdf.js resolves getOperatorList before it has
// decoded the page's images and keeps decoding after the document is
// destroyed, so a baseline that does not wait for the objects both under-
// reports pdf.js and slows down the next measurement.) Each line also carries
// the peak RSS sampled during the comparison and the baseline. A linear fit per
// form gives the page count at which the comparator reaches its work-scaled
// budget (renderCheckBudgetMs; capped by RENDER_CHECK_MAX_PAGES), next to the
// former constant 20 000 ms. Positional page counts are ignored in this mode.
// RSS is a process high-water mark, so a side that runs after the other
// inherits its peak; for clean memory figures run one side per process with
// `--only=compare` or `--only=pdfjs` (DSS-only append, no fit).
import { readFileSync } from 'node:fs';
import { getHeapStatistics } from 'node:v8';
import { createSecurityFixtures, byteRange } from './signature-security-fixtures.mjs';
import { createMultiPageFixtures } from './signature-revision-fixtures.mjs';
import { createFixturePki } from './generate-signature-fixtures.mjs';
import { createRenderComparator, renderCheckBudgetMs, RENDER_CHECK_MAX_PAGES } from '../src/utils/pdfSignatureRenderCheck.js';
import { collectPdfSignatures } from '../src/utils/pdfSignatures.js';
import { createPageFormFixtures, PAGE_FORMS } from './signature-page-form-fixtures.mjs';

const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
if (flag('forms')) {
  await measurePageForms();
  process.exit(0);
}

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

/** Opt-in page-form measurement; see the header comment. */
async function measurePageForms() {
  const forms = flag('forms').split(',').filter(Boolean);
  for (const form of forms) if (!PAGE_FORMS.includes(form)) throw new Error(`unknown form ${form} (known: ${PAGE_FORMS.join(', ')})`);
  const counts = (flag('pages') ?? '1,2,4,8').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const repeat = Math.max(1, Number(flag('repeat')) || 1);
  const only = flag('only');
  if (only && only !== 'compare' && only !== 'pdfjs') throw new Error('--only must be compare or pdfjs');
  const sides = only ? [only] : ['compare', 'pdfjs'];
  const ms = (v) => v.toFixed(0);
  const mib = (bytes) => (bytes / 2 ** 20).toFixed(0);
  const median = (list) => [...list].sort((a, b) => a - b)[list.length >> 1];
  // [elapsed ms, result, peak RSS sampled every 5 ms]; pdf.js yields to the event loop between steps.
  const timed = async (fn) => {
    globalThis.gc?.();
    let peak = process.memoryUsage().rss;
    const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 5);
    const t0 = performance.now();
    try {
      const result = await fn();
      return [performance.now() - t0, result, Math.max(peak, process.memoryUsage().rss)];
    } finally {
      clearInterval(sampler);
    }
  };

  const t = performance.now();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const importMs = performance.now() - t;
  console.log(`pdf.js import ${ms(importMs)} ms (once per process, not in the fits) | node ${process.version} | heap limit ${(getHeapStatistics().heap_size_limit / 2 ** 20).toFixed(0)} MiB | gc ${globalThis.gc ? 'between runs' : 'not exposed'} | repeat ${repeat} (median)`);
  // The check's own per-byte work on decoded pixels: one buffer copy and one SHA-256.
  for (const [name, size] of [['RGB', 2480 * 3508 * 3], ['RGBA', 2480 * 3508 * 4]]) {
    const pixels = new Uint8Array(size).fill(7);
    const [copyMs] = await timed(() => new Uint8Array(size).set(pixels));
    const [hashMs] = await timed(() => globalThis.crypto.subtle.digest('SHA-256', pixels));
    console.log(`micro | 2480x3508 ${name} (${(size / 2 ** 20).toFixed(1)} MiB) | copy ${copyMs.toFixed(1)} ms | SHA-256 ${hashMs.toFixed(1)} ms`);
  }

  const documentOptions = { isOffscreenCanvasSupported: false, isImageDecoderSupported: false, fontExtraProperties: true,
    verbosity: pdfjs.VerbosityLevel?.ERRORS ?? 0 }; // the comparator's own options
  const RESOURCE_ID = /^(?:g_d\d+_f\d+|(?:g_d\d+_)?(?:img|mask|pattern)_p\d+_\d+)$/; // as in pdfSignatureRenderCheck.js
  const resourceIds = (value, out) => {
    if (typeof value === 'string' && RESOURCE_ID.test(value)) out.add(value);
    else if (Array.isArray(value)) for (const item of value) resourceIds(item, out);
    return out;
  };
  // pdf.js only: the calls the comparator makes, without encoding or hashing anything.
  const baseline = async (bytes, signedEnd) => {
    const tasks = [pdfjs.getDocument({ ...documentOptions, data: bytes.slice() }),
      pdfjs.getDocument({ ...documentOptions, data: bytes.slice(0, signedEnd) })];
    try {
      const docs = [];
      for (const task of tasks) docs.push(await task.promise);
      for (const doc of docs) {
        await doc.getFieldObjects();
        await doc.getOptionalContentConfig({ intent: 'display' });
        for (const call of ['getJSActions', 'getOpenAction', 'getAttachments', 'getOutline', 'getDestinations', 'getPageLabels']) await doc[call]();
      }
      for (let i = 1; i <= docs[0].numPages; i++) {
        await Promise.all(docs.map(async (doc) => {
          const page = await doc.getPage(i);
          try {
            const operators = await page.getOperatorList();
            await page.getTextContent();
            await page.getAnnotations({ intent: 'display' });
            await page.getJSActions();
            // Wait on the one container that receives the id (g_* ids are document-wide). A
            // callback left on the other container would keep the decoded pixels alive
            // until the document is destroyed, which is check overhead, not pdf.js work.
            for (const id of resourceIds(operators.argsArray, new Set())) {
              const objs = id.startsWith('g_') ? page.commonObjs : page.objs;
              await new Promise((resolve) => (objs.has(id) ? resolve() : objs.get(id, () => resolve())));
            }
          } finally {
            page.cleanup();
          }
        }));
      }
    } finally {
      await Promise.allSettled(tasks.map((task) => task.destroy()));
    }
  };
  const compare = async (bytes, signedEnd) => {
    const comparator = createRenderComparator(bytes);
    try {
      return await comparator.compare(signedEnd);
    } finally {
      await comparator.destroy();
    }
  };
  const inspect = async (bytes) => {
    const [inspectMs, report] = await timed(() => collectPdfSignatures(bytes));
    return `inspection ${ms(inspectMs)} ms | ${report.signatures.map((s) => `${s.kind}:${s.integrity}/${s.integrityCode}`).join(' ')}`;
  };
  const fit = (xs, ys) => {
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0; let sxx = 0; let syy = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    const slope = sxx ? sxy / sxx : NaN;
    return { slope, intercept: my - slope * mx, r2: syy ? (sxy * sxy) / (sxx * syy) : 1 };
  };

  const pki = await createFixturePki();
  for (const form of forms) {
    const run = (side, bytes, signedEnd) => (side === 'compare' ? compare(bytes, signedEnd) : baseline(bytes, signedEnd));
    { // Discarded warm-up, so the first measured page count does not pay for JIT compilation.
      const fx = await createPageFormFixtures(pki, form, 1);
      const br = byteRange(fx.dss);
      for (const side of sides) await run(side, fx.dss, br[2] + br[3]);
    }
    const rows = [];
    for (const pages of counts) {
      const [genMs, fx] = await timed(() => createPageFormFixtures(pki, form, pages));
      const br = byteRange(fx.dss);
      const signedEnd = br[2] + br[3];
      const runs = { compare: [], pdfjs: [], compareRss: 0, pdfjsRss: 0 };
      let check;
      for (let r = 0; r < repeat; r++) {
        // Alternate the order so neither side always runs on the other's leftovers.
        for (const side of r % 2 ? [...sides].reverse() : sides) {
          const [elapsed, result, rss] = await timed(() => run(side, fx.dss, signedEnd));
          if (side === 'compare') check = result;
          runs[side].push(elapsed);
          runs[`${side}Rss`] = Math.max(runs[`${side}Rss`], rss);
        }
      }
      if (only) {
        console.log(`${form} | ${pages} page(s) | DSS-only append | ${fx.dss.length} B | ${only} only | ${ms(median(runs[only]))} ms | peak rss ${mib(runs[`${only}Rss`])} MiB${check ? ` | ${check.outcome}` : ''}`);
        continue;
      }
      const row = { pages, compare: median(runs.compare), pdfjs: median(runs.pdfjs) };
      rows.push(row);
      console.log(`${form} | ${pages} page(s) | DSS-only append | ${fx.dss.length} B | ${check.outcome} (${check.detail}) | compare ${ms(row.compare)} ms (${ms(row.compare / pages)} ms/page, peak rss ${mib(runs.compareRss)} MiB) | pdf.js-only ${ms(row.pdfjs)} ms (peak rss ${mib(runs.pdfjsRss)} MiB) | fixture ${ms(genMs)} ms | ${await inspect(fx.dss)}`);
      const [changedMs, changed, changedRss] = await timed(() => compare(fx.contentChanged, signedEnd));
      console.log(`${form} | ${pages} page(s) | content change on page ${fx.changedPage} | ${fx.contentChanged.length} B | ${changed.outcome} (${changed.detail}) | compare ${ms(changedMs)} ms (peak rss ${mib(changedRss)} MiB) | ${await inspect(fx.contentChanged)}`);
    }
    if (rows.length < 2) continue;
    const xs = rows.map((r) => r.pages);
    const c = fit(xs, rows.map((r) => r.compare));
    const p = fit(xs, rows.map((r) => r.pdfjs));
    const last = rows[rows.length - 1];
    const pct = (part) => `${((100 * part) / c.slope).toFixed(0)}%`;
    console.log(`${form} | fit over ${xs.join(',')} pages | compare ${c.slope.toFixed(1)} ms/page + ${ms(c.intercept)} ms (r2 ${c.r2.toFixed(3)}) | pdf.js-only ${p.slope.toFixed(1)} ms/page + ${ms(p.intercept)} ms (r2 ${p.r2.toFixed(3)}, ${pct(p.slope)}) | check overhead ${(c.slope - p.slope).toFixed(1)} ms/page (${pct(c.slope - p.slope)})`);
    // First page count whose fitted time exceeds the work-scaled budget (the fit is linear, the budget piecewise linear).
    const amberAt = (extraMs) => {
      for (let n = 1; n <= RENDER_CHECK_MAX_PAGES; n++) if (c.intercept + extraMs + c.slope * n > renderCheckBudgetMs(n)) return `at ~${n} pages`;
      return `never (the ${RENDER_CHECK_MAX_PAGES}-page limit binds first)`;
    };
    const OLD_BUDGET_MS = 20000;
    console.log(`${form} | work-scaled budget exceeded ${amberAt(0)} (slope, warm pdf.js), ${amberAt(importMs)} (slope, cold: + import) | former constant ${OLD_BUDGET_MS} ms reached at ~${ms((OLD_BUDGET_MS - c.intercept) / c.slope)} pages (mean ${ms(last.compare / last.pages)} ms/page at ${last.pages} pages)`);
  }
}
