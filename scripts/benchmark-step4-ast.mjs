// Run with Node 22: node scripts/benchmark-step4-ast.mjs <label> <scratch>.
// The import hook observes real parser calls without changing their results.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';

const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
const trace = process.env.ODV_AST_TRACE;
if (trace) {
  const original = childProcess.spawnSync;
  childProcess.spawnSync = function (exe, args, options) {
    const result = original.call(this, exe, args, options);
    if (args?.some((arg) => String(arg).endsWith('parse-local-ci-ast.ps1'))) {
      const fileAt = args.indexOf('-Path');
      const manifestAt = args.indexOf('-ManifestPath');
      const paths = fileAt >= 0 ? [args[fileAt + 1]]
        : manifestAt >= 0 ? JSON.parse(fs.readFileSync(args[manifestAt + 1], 'utf8')) : [];
      let outputs;
      try { const parsed = JSON.parse(result.stdout); outputs = fileAt >= 0 ? [parsed] : parsed.results; } catch { /* Record failed calls too. */ }
      const inputs = paths.map((file, i) => {
        const source = fs.readFileSync(file, 'utf8');
        const sourceHash = hash(source);
        fs.writeFileSync(path.join(trace, `${sourceHash}.ps1`), source);
        const output = outputs?.[i];
        const outputHash = output ? hash(JSON.stringify(output)) : null;
        if (output) fs.writeFileSync(path.join(trace, `${sourceHash}.json`), JSON.stringify(output));
        return { sourceHash, outputHash };
      });
      fs.appendFileSync(path.join(trace, 'calls.jsonl'), JSON.stringify({ exe, status: result.status, error: result.error?.code, inputs }) + '\n');
    }
    return result;
  };
  syncBuiltinESMExports();
} else {
  const [label, scratch] = process.argv.slice(2);
  if (!label || !scratch) throw new Error('Usage: node scripts/benchmark-step4-ast.mjs <label> <scratch>');
  if (label === 'verify') {
    const { createPowerShellParser } = await import('./parse-local-ci-ast.mjs');
    const corpusUrl = new URL('../docs-src/evidence/remedy-lock-performance/corpus.json', import.meta.url);
    const corpus = JSON.parse(fs.readFileSync(corpusUrl, 'utf8')).map((item) => ({
      ...item, source: item.source ?? fs.readFileSync(new URL(item.sourceFile, corpusUrl), 'utf8'),
    }));
    const parser = createPowerShellParser();
    parser.prewarm(corpus.map((item) => item.source));
    for (const item of corpus) {
      assert.equal(hash(item.source), item.sourceHash, 'captured source hash');
      assert.equal(hash(JSON.stringify(parser.parse(item.source))), item.astHash, `AST equivalence: ${item.sourceHash}`);
    }
    console.log(`Verified ${corpus.length} captured source/AST hash pairs.`);
    process.exit(0);
  }
  const capture = path.resolve(scratch, label);
  if (fs.existsSync(capture)) throw new Error('Use a fresh label/scratch directory so parser counts cannot mix runs.');
  fs.mkdirSync(capture, { recursive: true });
  const args = ['node_modules/vitest/vitest.mjs', 'run', 'scripts/local-ci-agent-docs-output.test.mjs'];
  const start = performance.now();
  const result = childProcess.spawnSync(process.execPath, args, {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ODV_AST_TRACE: capture, NODE_OPTIONS: `--import=${import.meta.url}` },
  });
  const wallMs = performance.now() - start;
  const callsFile = path.join(capture, 'calls.jsonl');
  const calls = fs.existsSync(callsFile) ? fs.readFileSync(callsFile, 'utf8').trim().split('\n').map(JSON.parse) : [];
  const inputs = calls.flatMap((call) => call.inputs);
  const summary = { label, node: process.version, command: 'node ' + args.join(' '), exit: result.status,
    error: result.error?.code ?? null, wallMs, parserCalls: calls.length, parsedInputs: inputs.length,
    distinctInputs: new Set(inputs.map((input) => input.sourceHash)).size };
  const evidence = path.resolve('docs-src/evidence/remedy-lock-performance');
  fs.mkdirSync(evidence, { recursive: true });
  const sanitize = (text) => text.replaceAll(process.cwd(), '<worktree>')
    .replaceAll(process.cwd().replaceAll('\\', '/'), '<worktree>').replaceAll(os.homedir(), '<home>');
  fs.writeFileSync(path.join(evidence, `${label}.json`), JSON.stringify(summary, null, 2) + '\n');
  fs.writeFileSync(path.join(evidence, `${label}.log`), sanitize((result.stdout ?? '') + (result.stderr ?? '')).trimEnd() + '\n');
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = result.status ?? 1;
}
