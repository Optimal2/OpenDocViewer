// File: scripts/local-ci-agent-docs-output.test.mjs
// Lock: scripts/local-ci.ps1 step 4 must PRINT the freshness gate's own output
// (drift rows, status-letter legend, flagged file names) to the console before
// the cause-specific remedy, not just capture it. Without this, a red step 4
// prints the remedy sentence and nothing else, the "(listed above)" /
// "(see output above)" wording becomes a lie, and the operator cannot tell
// which file is stale from the local-ci log. The capture-then-silently-discard
// regression was introduced as a side-effect of phase 1's cause-specific
// routing in commit 66fafe0d; this test is the protection against it.
//
// Phase 2's rule: the gate output is written to the console BEFORE the
// remedy, on both the success path (so step 4 visibly goes green) and the
// failure path (so the drift list, legend and "is stale:" footer reach the
// console). The test is anchored to the step-4 block â€” a unique substring of
// the capture-and-render region â€” rather than to a line number, so a
// surrounding comment edit does not silently break the lock.
//
// Design choice (step-4 remedy lock): PARSER-BASED ALLOWLIST, not execution
// and not a spelling denylist. Executing step 4 would mean running
// `npm run doc:agent` plus the freshness gate under five forced failure
// causes from vitest -- slow, needing a real git worktree per cause, and
// three causes (cone sparse-checkout, index bit, git-query failure) cannot
// be provoked without mutating the developer's `.git`. Two earlier rounds
// (phases 5-6, 2026-10-14) enumerated forbidden spellings of a `$remedy`
// write (regex denylist: `+=`, `-f`, `${variable:remedy}`, `New-Variable`,
// aliases, [ref], ...) and both were beaten by new spellings, because
// PowerShell has several independent axes to the same variable. This lock
// therefore inverts the design: scripts/parse-local-ci-ast.ps1 parses the
// guarded script with PowerShell's own parser
// ([System.Management.Automation.Language.Parser]::ParseFile via pwsh,
// AST emitted as JSON) and the validator below accepts ONLY the listed
// shapes inside the step-4 remedy region. Anything not on the allowlist
// is RED with a named reason ("step-4 allowlist violation: ...").
//
// The step-4 remedy region is the statement block that holds the
// `$remedy = $null` initialiser, the cause-routing if/elseif/else chain
// and the final `Write-Host $remedy` call. Inside that region, and ONLY
// there, the allowlist is exactly:
//   1. `$remedy = $null` -- one plain, unqualified, non-splatted
//      assignment with the Equals operator, as the first statement.
//   2. One if/elseif/else chain with four `-match` clauses (each condition
//      is `$<plain variable> -match '<string constant>'`) and one bare
//      else. That yields the five cause branches.
//   3. Inside each branch body: zero or more helper assignments
//      `$<plain name> = <string>` (Equals only), followed by exactly one
//      `$remedy = <string>` (Equals only; `+=` and every other operator
//      are not on the list). A <string> is a single- or double-quoted
//      constant, or an expandable string whose ONLY embedded expressions
//      are plain, unqualified, non-splatted variables approved earlier in
//      the SAME branch (a helper assigned above in that branch). No
//      subexpression, no operator, no here-string, no command.
//   4. `Write-Host $remedy`, optionally with `-ForegroundColor <constant>`,
//      as the last statement -- the region's only command invocation.
// Every other statement, expression or reference inside the region --
// any other command or alias, pipeline, scope-qualified or provider
// variable path ($script:remedy, ${variable:remedy}, ${remedy}), [ref],
// member assignment, splatting, dot-sourcing, call operator, increment,
// or a second remedy assignment -- is RED. Code that step 4 legitimately
// needs beyond these shapes must live OUTSIDE the remedy region; inside
// the region there are no exceptions and no denylist to keep current.
// Comments never reach the AST, so code hidden after `#>` on a block-
// comment line is parsed as the statement it is and judged by the same
// list.
//
// Scope boundary (the claim is exactly this, no more): the lock judges
// the remedy region only. Statements elsewhere in local-ci.ps1, and any
// other output channel outside `Write-Host $remedy`, are out of scope by
// construction. If pwsh (or Windows PowerShell) is unavailable the test
// FAILS with a named reason; it never skips, because a skipped parser is
// a silent green. GitHub-hosted ubuntu runners ship pwsh, and the lockstep
// job in ci.yml already runs under `shell: pwsh`.
//
// This test is reachable from `npm test` (vitest) so CI's `npm test` step
// enforces it without a separate PowerShell harness.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { URL, fileURLToPath } from 'node:url';

const localCiPath = new URL('./local-ci.ps1', import.meta.url);
const source = fs.readFileSync(localCiPath, 'utf8');

function blockFromAnchor(source, anchor, openChar, closeChar) {
  const anchorAt = source.indexOf(anchor);
  assert.ok(anchorAt >= 0, `anchor not found: ${anchor}`);
  const openAt = source.indexOf(openChar, anchorAt + anchor.length);
  assert.ok(openAt >= 0, `open char not found after anchor: ${anchor}`);
  let depth = 0;
  for (let i = openAt; i < source.length; i++) {
    const ch = source[i];
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return source.substring(openAt, i + 1);
    }
  }
  throw new Error(`unterminated block: ${anchor}`);
}

/**
 * Walk backwards from `anchorAt` to find the enclosing `{` (skipping string
 * and comment noise so a `{` inside a literal does not match), then return
 * the block from that `{` to the next balanced `}` after the anchor.
 *
 * The if/elseif/elseif/elseif/else chain inside `else {` has no braces, so
 * `blockFromAnchor('$remedy = $null', ...)` would land on the outer `finally`
 * block. This helper instead finds the ENCLOSING `{`, which is the one
 * introduced by the surrounding `else {`.
 */
function enclosingBlock(source, anchor, openChar = '{', closeChar = '}') {
  const anchorAt = source.indexOf(anchor);
  assert.ok(anchorAt >= 0, `anchor not found: ${anchor}`);
  let i = anchorAt - 1;
  while (i >= 0) {
    const ch = source[i];
    if (ch === closeChar) {
      // Skip a string, line comment, or block comment that contains `{`.
      // Cheap heuristic: walk back to the matching closer before counting.
      const block = findBalancedBackward(source, i, closeChar, openChar);
      if (block === -1) throw new Error(`unbalanced close at ${i}`);
      i = block - 1;
      continue;
    }
    if (ch === openChar) {
      // Found the enclosing `{`. Now read the matching close AFTER the anchor.
      let depth = 1;
      let j = i + 1;
      let inLineComment = false;
      let inBlockComment = false;
      let stringQuote = '';
      let inString = false;
      while (j < source.length) {
        const c = source[j];
        if (inLineComment) { if (c === '\n') inLineComment = false; j++; continue; }
        if (inBlockComment) {
          if (c === '*' && source[j + 1] === '/') { inBlockComment = false; j += 2; continue; }
          j++; continue;
        }
        if (inString) {
          if (c === '\\') { j += 2; continue; }
          if (c === stringQuote) { inString = false; j++; continue; }
          j++; continue;
        }
        if (c === '/' && source[j + 1] === '/') { inLineComment = true; j += 2; continue; }
        if (c === '/' && source[j + 1] === '*') { inBlockComment = true; j += 2; continue; }
        if (c === '"') { inString = true; stringQuote = '"'; j++; continue; }
        if (c === "'") { inString = true; stringQuote = "'"; j++; continue; }
        if (c === openChar) { depth++; j++; continue; }
        if (c === closeChar) {
          depth--;
          if (depth === 0) return source.substring(i, j + 1);
          j++; continue;
        }
        j++;
      }
      throw new Error(`unterminated enclosing block for: ${anchor}`);
    }
    i--;
  }
  throw new Error(`no enclosing brace for: ${anchor}`);
}

/**
 * Find the offset of the matching open delimiter for the `closeChar` at
 * `closeAt`, walking backwards. Returns -1 if the chain is unbalanced.
 */
function findBalancedBackward(source, closeAt, closeChar, openChar) {
  let depth = 1;
  let i = closeAt - 1;
  let inLineComment = false;
  let inBlockComment = false;
  let stringQuote = '';
  let inString = false;
  while (i >= 0) {
    const c = source[i];
    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      i--; continue;
    }
    if (inBlockComment) {
      if (c === '/' && source[i + 1] === '*') { inBlockComment = false; i -= 2; continue; }
      i--; continue;
    }
    if (inString) {
      // Walk forward from the opening quote and stop at its matching close.
      const openAt = i;
      let j = openAt + 1;
      while (j < source.length) {
        if (source[j] === '\\') { j += 2; continue; }
        if (source[j] === stringQuote) break;
        j++;
      }
      i = j - 1;
      inString = false;
      continue;
    }
    if (c === '\n' && source[i + 1] === '/') {
      // Not reliable enough â€” fall back to skipping past the open quote
      // when we encounter a quote mark.
      i--; continue;
    }
    if (c === openChar) {
      depth--;
      if (depth === 0) return i;
      i--; continue;
    }
    if (c === closeChar) {
      depth++;
      i--; continue;
    }
    if (c === '"') { inString = true; stringQuote = '"'; i--; continue; }
    if (c === "'") { inString = true; stringQuote = "'"; i--; continue; }
    if (c === '/' && source[i - 1] === '*') { inBlockComment = true; i -= 2; continue; }
    if (c === '/' && source[i - 1] === '/') { inLineComment = true; i -= 2; continue; }
    i--;
  }
  return -1;
}

test('local-ci step 4 echoes the captured gate output before the remedy on failure', () => {
  // Anchor on the step-4 banner line ("[4/4] Verifying...") which is unique
  // to step 4 and sits inside the try block. The enclosing block of the
  // banner lands on the try block, which contains BOTH the foreach echo
  // loop and the Write-Host remedy.
  const step4Block = enclosingBlock(source, '[4/4] Verifying generated agent documentation is fresh');
  // The fix adds a `foreach { Write-Host $line ... }` loop BEFORE the
  // remedy branch so the gate's drift list, status-letter legend, and
  // flagged file names reach the console above the remedy. If a refactor
  // moves the echo out of step 4 or replaces it with a no-op, the
  // Write-Host $line assertion turns red.
  const writeHostLines = step4Block
    .split('\n')
    .filter((line) => /\bWrite-Host\b/.test(line))
    .map((line) => line.trim());
  // The first echo-loop Write-Host renders the captured $line. The banner
  // Write-Host (which prints the step header) is allowed to come first.
  assert.ok(
    writeHostLines.some((line) => /\bWrite-Host\s+\$line\b/.test(line)),
    'step 4 must Write-Host the captured $line (gate output) â€” otherwise the drift list is invisible above the remedy'
  );
  // The remedy line still ends the failure branch.
  assert.ok(
    writeHostLines.some((line) => /\bWrite-Host\s+\$remedy\b/.test(line)),
    'step 4 must Write-Host $remedy as the failure-branch footer'
  );
});

test('the captured gate output is rendered as a Write-Host loop, not silently discarded', () => {
  const step4Block = enclosingBlock(source, '[4/4] Verifying generated agent documentation is fresh');
  // The fix renders ErrorRecord objects as their text. Without the loop,
  // PowerShell renders captured ErrorRecord arrays as object noise on the
  // console â€” a different regression from "silently swallow", but the same
  // diagnostic loss. Both regressions are caught by the same anchor.
  assert.match(
    step4Block,
    /foreach\s*\(\s*\$line\s+in\s+@\(\s*\$agentDocsOutput\s*\)\s*\)/,
    'step 4 must iterate $agentDocsOutput and Write-Host each line â€” otherwise the gate output never reaches the console'
  );
  assert.match(
    step4Block,
    /\[System\.Management\.Automation\.ErrorRecord\]/,
    'step 4 must render ErrorRecord objects as their text, not as PowerShell object noise'
  );
});

test('every remedy string that refers to output above now points at the gate output, not the legacy "(listed above)"', () => {
  // The two stale strings from phase 1 ("(listed above)" and "(see output
  // above)") would still be lies if the gate output is not actually printed
  // above the remedy. The fix renames them to "(see gate output above)".
  // This test pins the new strings so a future regression to the old wording
  // also turns red. Anchor on `$remedy = $null` and walk back to the
  // enclosing `else {` so we land inside the failure branch, not the
  // surrounding `try/finally`.
  const step4Block = enclosingBlock(source, '$remedy = $null');
  assert.doesNotMatch(step4Block, /\(listed above\)/, 'no remedy string may still claim "(listed above)"');
  assert.doesNotMatch(step4Block, /\(see output above\)/, 'no remedy string may still claim "(see output above)"');
  assert.match(step4Block, /\(see gate output above\)/, 'remedy strings must point at "(see gate output above)"');
});

test('the four-way cause routing from phase 1 is still wired in step 4', () => {
  // Regression guard for phase 1's bug-for-bug fix. If a future cleanup drops
  // one of the four branches, the matching cause falls through to the generic
  // "unknown reason" advice and the operator is told to re-read stderr for a
  // cause the gate already named. Anchor on `$remedy = $null` and walk back
  // to the enclosing `else {` so we land inside the failure branch.
  const step4Block = enclosingBlock(source, '$remedy = $null');
  for (const fragment of ['Failed to run git', 'cone sparse-checkout', 'skip-worktree or assume-unchanged', 'is stale:']) {
    assert.match(step4Block, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `phase 1 cause branch missing: ${fragment}`);
  }
  assert.match(step4Block, /unknown reason/, 'the unknown-reason fallback must remain');
});

const VIOLATION = 'step-4 allowlist violation';
function violate(detail) {
  assert.fail(`${VIOLATION}: ${detail}`);
}

const parserScriptPath = fileURLToPath(new URL('./parse-local-ci-ast.ps1', import.meta.url));

// Parse PowerShell source text with PowerShell's own parser (pwsh, falling
// back to Windows PowerShell). FAILS loudly when no PowerShell is available:
// a skipped parser would be a silent green.
function parsePowerShell(sourceText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odv-step4-ast-'));
  try {
    const snippet = path.join(dir, 'snippet.ps1');
    fs.writeFileSync(snippet, sourceText, 'utf8');
    let lastError = null;
    for (const exe of ['pwsh', 'powershell']) {
      const res = spawnSync(exe, ['-NoProfile', '-File', parserScriptPath, '-Path', snippet], { encoding: 'utf8' });
      if (res.error) { lastError = res.error; continue; }
      assert.equal(res.status, 0, `PowerShell AST parser exited ${res.status}: ${res.stderr}`);
      return JSON.parse(res.stdout);
    }
    violate(`PowerShell (pwsh/powershell) is unavailable, so the step-4 allowlist parser cannot run (${lastError?.message ?? 'not found'}); refusing to skip`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function buildTree(parsed) {
  assert.deepEqual(parsed.parseErrors, [], `guarded script must parse cleanly: ${parsed.parseErrors.join('; ')}`);
  const byId = new Map(parsed.nodes.map((n) => [n.id, n]));
  const children = new Map();
  for (const n of parsed.nodes) {
    if (!children.has(n.parentId)) children.set(n.parentId, []);
    children.get(n.parentId).push(n);
  }
  for (const list of children.values()) list.sort((a, b) => a.start - b.start || a.end - b.end);
  return { byId, kids: (n) => children.get(n.id) ?? [] };
}

function describe(node) {
  const text = node.text.replace(/\s+/g, ' ').trim();
  return `${node.type} '${text.length > 60 ? text.slice(0, 60) + '...' : text}'`;
}

function isPlainVariable(node, name) {
  return node.type === 'VariableExpressionAst' && !node.splatted
    && node.userPath !== null && node.userPath.toLowerCase() === name.toLowerCase()
    && node.text === `$${name}`;
}

// Unwrap the CommandExpressionAst the parser puts around a plain value.
function unwrap(node, tree) {
  if (node.type !== 'CommandExpressionAst') return node;
  const inner = tree.kids(node);
  assert.equal(inner.length, 1, `unexpected ${describe(node)}`);
  return inner[0];
}

// Evaluate an allowlisted string: a string constant, or an expandable
// string whose only embedded expressions are approved variables.
function evalString(node, tree, approved, context) {
  const inner = unwrap(node, tree);
  if (inner.type === 'StringConstantExpressionAst') {
    if (/here/i.test(inner.stringConstantType ?? '')) violate(`${context} uses a here-string, which is not on the allowlist`);
    return inner.value;
  }
  if (inner.type === 'ExpandableStringExpressionAst') {
    let out = inner.value;
    for (const nested of tree.kids(inner)) {
      if (nested.type !== 'VariableExpressionAst') violate(`${context} embeds ${describe(nested)} in an expandable string; only approved variables may be embedded`);
      if (nested.splatted) violate(`${context} embeds a splatted variable in an expandable string`);
      const name = (nested.userPath ?? '').toLowerCase();
      if (nested.userPath === null || nested.userPath.includes(':') || nested.text !== `$${nested.userPath}` || !approved.has(name)) {
        violate(`${context} embeds variable '${nested.text}', which is not a plain helper variable approved earlier in the same branch`);
      }
      out = out.replace(nested.text, approved.get(name));
    }
    return out;
  }
  violate(`${context} is ${describe(inner)}, not a constant or expandable string on the allowlist`);
}

const BRANCH_KEYS = [
  ['Failed to run git', 'gitQuery'],
  ['cone sparse-checkout', 'cone'],
  ['skip-worktree or assume-unchanged', 'indexBit'],
  ['is stale:', 'stale'],
];

// Validate one branch body and return its composed remedy text.
function evalBranchBody(bodyBlock, tree, label) {
  const approved = new Map();
  let remedy = null;
  for (const stmt of tree.kids(bodyBlock)) {
    if (stmt.type !== 'AssignmentStatementAst') violate(`branch '${label}' contains ${describe(stmt)}; only plain '$name = <string>' assignments are allowed inside a branch`);
    const [left, right] = tree.kids(stmt);
    if (!left || left.type !== 'VariableExpressionAst') violate(`branch '${label}' contains an assignment whose left side is ${left ? describe(left) : 'missing'}; only a plain variable may be assigned`);
    if (left.splatted) violate(`branch '${label}' assigns a splatted variable '${left.text}'`);
    if (left.userPath === null || left.userPath.includes(':') || left.text !== `$${left.userPath}`) violate(`branch '${label}' assigns '${left.text}', a scope-qualified, provider or braced variable path, which is not on the allowlist`);
    if (stmt.operator !== 'Equals') violate(`branch '${label}' uses operator '${stmt.operator}' on '${left.text}'; only '=' is on the allowlist`);
    const value = evalString(right, tree, approved, `branch '${label}' assignment to '${left.text}'`);
    if (left.userPath.toLowerCase() === 'remedy') {
      if (remedy !== null) violate(`branch '${label}' assigns $remedy more than once; exactly one '$remedy = <string>' per branch is on the allowlist`);
      remedy = value;
    } else {
      approved.set(left.userPath.toLowerCase(), value);
    }
  }
  if (remedy === null) violate(`branch '${label}' has no '$remedy = <string>' assignment`);
  return remedy;
}

function evalCondition(pipeline, tree) {
  const elements = tree.kids(pipeline);
  if (elements.length !== 1) violate(`branch condition ${describe(pipeline)} must be a single -match expression`);
  const binary = unwrap(elements[0], tree);
  if (binary.type !== 'BinaryExpressionAst' || !/^(I?Match)$/i.test(binary.operator ?? '')) violate(`branch condition is ${describe(binary)}; only '$<variable> -match <string constant>' is on the allowlist`);
  const [left, right] = tree.kids(binary);
  if (!left || left.type !== 'VariableExpressionAst' || left.splatted || left.userPath === null || left.userPath.includes(':') || left.text !== `$${left.userPath}`) violate(`branch condition's left side is not a plain variable`);
  const pattern = unwrap(right, tree);
  if (pattern.type !== 'StringConstantExpressionAst') violate(`branch condition's pattern is ${describe(pattern)}, not a string constant`);
  return pattern.value;
}

function evalOutput(pipeline, tree) {
  const elements = tree.kids(pipeline);
  if (elements.length !== 1 || elements[0].type !== 'CommandAst') violate(`the output statement must be a single Write-Host command, got ${describe(pipeline)}`);
  const cmd = elements[0];
  if (cmd.invocationOperator !== 'Unknown') violate(`the output command uses invocation operator '${cmd.invocationOperator}'; call and dot-source operators are not on the allowlist`);
  if ((cmd.commandName ?? '').toLowerCase() !== 'write-host') violate(`command '${cmd.commandName}' is not on the allowlist; the region's only command is Write-Host`);
  const parts = tree.kids(cmd);
  if (parts.length < 2 || parts[0].type !== 'StringConstantExpressionAst') violate(`malformed Write-Host output call`);
  if (!isPlainVariable(parts[1], 'remedy')) violate(`Write-Host must print the plain variable $remedy, got ${describe(parts[1])}`);
  let i = 2;
  if (i < parts.length) {
    const param = parts[i];
    if (param.type !== 'CommandParameterAst' || (param.parameterName ?? '').toLowerCase() !== 'foregroundcolor') violate(`Write-Host parameter '${param.text}' is not on the allowlist; only -ForegroundColor may follow $remedy`);
    const arg = tree.kids(param)[0] ?? parts[i + 1];
    if (!arg || arg.type !== 'StringConstantExpressionAst') violate(`-ForegroundColor must take a constant argument`);
    i += tree.kids(param).length > 0 ? 1 : 2;
  }
  if (i !== parts.length) violate(`Write-Host output call has extra elements beyond '$remedy [-ForegroundColor <constant>]'`);
}

// Validate the remedy region in source text and return the five remedies.
function step4Remedies(sourceText) {
  const tree = buildTree(parsePowerShell(sourceText));
  const all = [...tree.byId.values()];
  const isRemedyAssign = (n) => n.type === 'AssignmentStatementAst' && tree.kids(n)[0] && isPlainVariable(tree.kids(n)[0], 'remedy');
  const init = all.find((n) => isRemedyAssign(n) && (() => { const r = unwrap(tree.kids(n)[1], tree); return r.type === 'VariableExpressionAst' && (r.userPath ?? '').toLowerCase() === 'null'; })());
  let regionBlock; let statements;
  if (init) {
    regionBlock = tree.byId.get(init.parentId);
    statements = tree.kids(regionBlock);
  } else {
    const chain = all.find((n) => n.type === 'IfStatementAst' && tree.kids(n).some((b) => b.type === 'StatementBlockAst' && tree.kids(b).some(isRemedyAssign)));
    if (!chain) violate(`no step-4 remedy region found (no '$remedy = $null' initialiser and no remedy if/else chain)`);
    regionBlock = tree.byId.get(chain.parentId);
    const siblings = tree.kids(regionBlock);
    statements = siblings.slice(siblings.indexOf(chain));
  }
  let idx = 0;
  if (init) {
    if (statements[0] !== init) violate(`'$remedy = $null' must be the first statement of the remedy region`);
    if (init.operator !== 'Equals') violate(`'$remedy = $null' must use '='`);
    idx = 1;
  }
  const chain = statements[idx];
  if (!chain || chain.type !== 'IfStatementAst') violate(`the remedy region's second statement must be the cause-routing if/else chain, got ${chain ? describe(chain) : 'end of region'}`);
  idx += 1;
  const output = statements[idx];
  if (!output || output.type !== 'PipelineAst') violate(`the remedy region must end with 'Write-Host $remedy', got ${output ? describe(output) : 'end of region'}`);
  idx += 1;
  if (idx !== statements.length) violate(`the remedy region contains ${describe(statements[idx])} after 'Write-Host $remedy'; nothing may follow the output call inside the region`);
  evalOutput(output, tree);
  if (chain.clauseCount !== 4 || !chain.hasElse) violate(`the cause-routing chain must have exactly four -match clauses and one bare else, got ${chain.clauseCount} clause(s), else=${chain.hasElse}`);
  const chainParts = tree.kids(chain);
  const expectedParts = chain.clauseCount * 2 + 1;
  if (chainParts.length !== expectedParts) violate(`malformed if/else chain (${chainParts.length} parts, expected ${expectedParts})`);
  const remedies = {};
  for (let c = 0; c < chain.clauseCount; c++) {
    const pattern = evalCondition(chainParts[c * 2], tree);
    const key = BRANCH_KEYS.find(([needle]) => pattern.includes(needle))?.[1];
    if (!key) violate(`branch condition pattern '${pattern}' does not name a known step-4 cause`);
    if (remedies[key] !== undefined) violate(`duplicate step-4 branch for '${key}'`);
    remedies[key] = evalBranchBody(chainParts[c * 2 + 1], tree, key);
  }
  remedies.fallback = evalBranchBody(chainParts[chainParts.length - 1], tree, 'fallback');
  for (const key of ['gitQuery', 'cone', 'indexBit', 'stale', 'fallback']) assert.ok(remedies[key] !== undefined, `missing step-4 branch: ${key}`);
  return remedies;
}

test('each step-4 cause branch assigns its OWN remedy text and no other branch\'s', () => {
  const remedies = step4Remedies(source);
  const signatures = {
    gitQuery: 'could not run a git query',
    cone: 'sparse-checkout reapply',
    indexBit: '--no-skip-worktree',
    stale: 'npm run doc:agent',
    fallback: 'unknown reason',
  };
  for (const [branch, remedy] of Object.entries(remedies)) {
    assert.ok(remedy.includes(signatures[branch]), `${branch} branch must assign its own remedy ("${signatures[branch]}"), got: ${remedy}`);
    for (const [other, signature] of Object.entries(signatures)) {
      if (other === branch) continue;
      assert.ok(!remedy.includes(signature), `${branch} branch must NOT contain the ${other} remedy ("${signature}"), got: ${remedy}`);
    }
  }
});

const SYNTHETIC = [
  `if ($x -match 'Failed to run git') { $remedy = "could not run a git query" }`,
  `elseif ($x -match 'cone sparse-checkout') { $remedy = "sparse-checkout reapply" }`,
  `elseif ($x -match 'skip-worktree or assume-unchanged') { $remedy = "clear --no-skip-worktree" }`,
  `elseif ($x -match 'is stale:') { $hint = "npm run doc:agent"; $remedy = "stale; run $hint" }`,
  `else { $remedy = "unknown reason" }`,
  `Write-Host $remedy`,
].join('\n');

test('step-4 allowlist accepts the plain synthetic chain and resolves same-branch helpers', () => {
  const remedies = step4Remedies(SYNTHETIC);
  assert.equal(remedies.cone, 'sparse-checkout reapply');
  assert.equal(remedies.stale, 'stale; run npm run doc:agent');
  assert.equal(remedies.fallback, 'unknown reason');
});

test('step-4 allowlist rejects every non-allowlisted spelling with a named reason', () => {
  const cone = '$remedy = "sparse-checkout reapply"';
  const cases = [
    // Composition forms from the first review (silent-green on 1e21de71).
    ['postfix -f operator', SYNTHETIC.replace(cone, '$remedy = "sparse-checkout reapply {0}" -f "--no-skip-worktree"')],
    ['postfix -replace operator', SYNTHETIC.replace(cone, '$remedy = "sparse-checkout reapply" -replace "x", "y"')],
    ['concatenation inside a resolved variable', SYNTHETIC.replace('$hint = "npm run doc:agent"', '$hint = "npm run" + " doc:agent"')],
    ['nested reassignment inside a branch', SYNTHETIC.replace('$remedy = "clear --no-skip-worktree"', '$remedy = "WRONG"\n  if ($y) { $remedy = "clear --no-skip-worktree" }')],
    ['nested if/else inside the fallback arm', SYNTHETIC.replace('else { $remedy = "unknown reason" }', 'else { $remedy = "unknown reason"\n  if ($z) { $remedy = "x" } else { $remedy = "y" } }')],
    ['stray write between chain and Write-Host', SYNTHETIC + '\n$remedy = "npm run doc:agent"'],
    ['+= append in a branch', SYNTHETIC.replace(cone, cone + '; $remedy += " --no-skip-worktree"')],
    // Indirect-write spellings from the HOLD rounds (silent-green on 8c273a0d / 5d9a98a9).
    ['braced provider path ${variable:remedy}', SYNTHETIC.replace(cone, cone + '; ${variable:remedy} = "npm run doc:agent"')],
    ['braced plain name ${remedy}', SYNTHETIC.replace(cone, cone + '; ${remedy} = "npm run doc:agent"')],
    ['scoped $script:remedy', SYNTHETIC.replace(cone, cone + '; $script:remedy = "npm run doc:agent"')],
    ['New-Variable named', SYNTHETIC.replace(cone, cone + '; New-Variable -Name remedy -Value "npm run doc:agent" -Force')],
    ['New-Variable positional', SYNTHETIC.replace(cone, cone + '; New-Variable remedy "npm run doc:agent" -Force')],
    ['Set-Variable named', SYNTHETIC.replace(cone, cone + '; Set-Variable -Name remedy -Value "npm run doc:agent"')],
    ['Set-Variable positional', SYNTHETIC.replace(cone, cone + '; Set-Variable remedy "npm run doc:agent"')],
    ['dynamic Set-Variable name', SYNTHETIC.replace(cone, cone + '; $n = "remedy"; Set-Variable -Name $n -Value "npm run doc:agent"')],
    ['alias clv (Clear-Variable)', SYNTHETIC.replace(cone, cone + '; clv remedy -Force')],
    ['alias rv (Remove-Variable)', SYNTHETIC.replace(cone, cone + '; rv remedy -Force')],
    ['-OutVariable via its -ov alias', SYNTHETIC.replace(cone, cone + '; Write-Output "x" -ov remedy')],
    ['Tee-Object -Variable', SYNTHETIC.replace(cone, cone + '; "x" | Tee-Object -Variable remedy')],
    ['Set-Content on variable: provider path', SYNTHETIC.replace(cone, cone + '; Set-Content -Path variable:remedy -Value "npm run doc:agent"')],
    ['quoted command name & "Set-Variable"', SYNTHETIC.replace(cone, cone + '; & "Set-Variable" -Name remedy -Value "npm run doc:agent"')],
    ['two-statement [ref] split', SYNTHETIC.replace(cone, cone + '; $rf = [ref]$remedy; $rf.Value = "npm run doc:agent"')],
    ['code after #> on a block-comment line', SYNTHETIC.replace(cone, cone + '\n<# keep #> $remedy = "npm run doc:agent"')],
    ['(Get-Variable remedy).Value assignment', SYNTHETIC.replace(cone, cone + '; (Get-Variable remedy).Value = "npm run doc:agent"')],
    ['cross-branch helper interpolation', SYNTHETIC.replace('$remedy = "sparse-checkout reapply"', '$remedy = "sparse-checkout reapply $hint"')],
    ['unresolved helper interpolation', SYNTHETIC.replace('$hint = "npm run doc:agent"; ', '')],
    // New spellings added by this round (not in either review).
    ['NEW: post-increment $remedy++', SYNTHETIC.replace(cone, cone + '; $remedy++')],
    ['NEW: splatted output Write-Host @remedy', SYNTHETIC.replace('Write-Host $remedy', 'Write-Host @remedy')],
    ['NEW: dot-sourced scriptblock in a branch', SYNTHETIC.replace(cone, cone + '; . $sb')],
    ['NEW: here-string remedy', SYNTHETIC.replace(cone, "$remedy = @'\nnpm run doc:agent\n'@")],
    ['NEW: method-call remedy', SYNTHETIC.replace(cone, '$remedy = "x".Replace("x", "npm run doc:agent")')],
  ];
  for (const [name, snippet] of cases) {
    assert.throws(() => step4Remedies(snippet), /step-4 allowlist violation:/, `case must be RED: ${name}`);
  }
});
