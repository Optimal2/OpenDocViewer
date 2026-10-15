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
// Phase 7 (this round) anchors the region to step 4 itself and binds
// each branch to the cause it really tests. The previous anchor was the
// first `$remedy = $null` in the file, so an allowlist-shaped decoy
// region placed before step 4 (for example wrapped in
// `if ($false) { ... }`) was validated instead of the real region and
// the real region was never judged. Branch identity was likewise
// derived from a needle substring of the `-match` pattern, so adding
// `|skip-worktree or assume-unchanged` to the cone branch's pattern kept
// the suite green while that branch printed the cone remedy for an
// index-bit fault. Both constructions are RED probes below.
//
// The step-4 remedy region is anchored to step 4's own structure in the
// AST: the unique "[4/4] Verifying generated agent documentation is
// fresh" banner, the single `if ($agentDocsExit -eq 0)` gate-exit test
// inside the statement block that banner sits in, and that test's bare
// `else` block. That else block -- and only that block -- is the remedy
// region: it holds the `$remedy = $null` initialiser, the cause-routing
// if/elseif/else chain and the final `Write-Host $remedy` call.
// Exactly one remedy region is allowed in the whole file: every
// assignment statement in the file whose target is $remedy (a plain,
// scope-qualified, provider or braced variable path, splatted, or a
// member/[ref] left side that contains $remedy) must lie inside the
// anchored region. Any such assignment elsewhere -- including a fully
// allowlist-shaped decoy region before or after step 4, wrapped in
// `if ($false) { ... }` or not -- is RED with a named reason.
// Inside the anchored region, and ONLY there, the allowlist is exactly:
//   1. `$remedy = $null` -- one plain, unqualified, non-splatted
//      assignment with the Equals operator, as the first statement.
//   2. One if/elseif/else chain with four `-match` clauses and one bare
//      else. That yields the five cause branches. Each clause condition
//      has exactly this AST shape: a single BinaryExpressionAst with
//      operator Imatch (PowerShell `-match`), whose left side is the
//      plain variable $agentDocsOutput and whose right side is a
//      single-quoted string constant whose value is EXACTLY one of the
//      four expected patterns (branch key in parentheses):
//        '(?m)^\s*Failed to run git\b|^\s*git .* exited with code\b|^\s*Failed to run git\b' (gitQuery)
//        '(?s)cone sparse-checkout' (cone)
//        '(?s)skip-worktree or assume-unchanged' (indexBit)
//        '(?s)is stale:' (stale)
//      Branch identity is that exact pattern match, never a substring:
//      a pattern that merely contains a known needle, carries an extra
//      regex alternative (`|...`), or differs in any character is RED,
//      as is a condition with extra operands (`-and`/`-or` around the
//      match, a negated or parenthesised match) or a different operator
//      (`-cmatch`, `-like`, ...), because then the condition is not the
//      single exact Imatch shape above. Each expected pattern may be
//      used by at most one clause.
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
// the anchored remedy region, plus the whole-file scan for $remedy
// assignment statements described above (exactly one remedy region).
// Statements elsewhere in local-ci.ps1 that do not assign $remedy, and
// any other output channel outside `Write-Host $remedy`, are out of
// scope by construction. If pwsh (or Windows PowerShell) is unavailable the test
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
  const parent = (n) => byId.get(n.parentId) ?? null;
  const isWithin = (n, ancestor) => {
    let cur = n;
    while (cur) {
      if (cur.id === ancestor.id) return true;
      cur = parent(cur);
    }
    return false;
  };
  return { byId, kids: (n) => children.get(n.id) ?? [], parent, isWithin };
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

// The exact -match pattern value for each cause branch, in the form the
// real step 4 (and the synthetic fixture below) writes it. Branch identity
// is an exact equality against this list, never a substring: a pattern
// that contains one of these values plus an extra `|alternative`, or any
// other deviation, matches no entry and is RED.
const BRANCH_PATTERNS = [
  ['(?m)^\\s*Failed to run git\\b|^\\s*git .* exited with code\\b|^\\s*Failed to run git\\b', 'gitQuery'],
  ['(?s)cone sparse-checkout', 'cone'],
  ['(?s)skip-worktree or assume-unchanged', 'indexBit'],
  ['(?s)is stale:', 'stale'],
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
  if (elements.length !== 1) violate(`branch condition ${describe(pipeline)} must be a single exact '$agentDocsOutput -match <pattern>' expression; extra operands are not on the allowlist`);
  const binary = unwrap(elements[0], tree);
  if (binary.type !== 'BinaryExpressionAst' || binary.operator !== 'Imatch') violate(`branch condition is ${describe(binary)} with operator '${binary.operator ?? 'none'}'; only a single '$agentDocsOutput -match <exact pattern>' (Imatch) condition is on the allowlist -- a different operator or extra operands around the match are RED`);
  const operands = tree.kids(binary);
  if (operands.length !== 2) violate(`branch condition ${describe(binary)} must have exactly two operands ($agentDocsOutput and the pattern); extra operands are not on the allowlist`);
  const [left, right] = operands;
  if (!left || left.type !== 'VariableExpressionAst' || left.splatted || left.userPath !== 'agentDocsOutput' || left.text !== '$agentDocsOutput') violate(`branch condition's left side is ${left ? describe(left) : 'missing'}; the exact condition must test the plain variable $agentDocsOutput`);
  const pattern = unwrap(right, tree);
  if (pattern.type !== 'StringConstantExpressionAst') violate(`branch condition's pattern is ${describe(pattern)}, not a string constant; the exact condition must be '$agentDocsOutput -match <single-quoted exact pattern>'`);
  if (pattern.stringConstantType !== 'SingleQuoted') violate(`branch condition's pattern must be a single-quoted string constant, got ${pattern.stringConstantType}; the exact condition shape is '$agentDocsOutput -match <single-quoted exact pattern>'`);
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

function isRemedyVariable(node) {
  if (node.type !== 'VariableExpressionAst' || node.userPath === null) return false;
  const segments = node.userPath.toLowerCase().split(':');
  return segments[segments.length - 1] === 'remedy';
}

// True when an assignment statement targets $remedy: the left side is a
// $remedy variable path (plain, scoped, provider, braced or splatted) or a
// member/[ref]-style left side that contains a $remedy variable.
function targetsRemedy(assignNode, tree, all) {
  const left = tree.kids(assignNode)[0];
  if (!left) return false;
  return all.some((n) => n.type === 'VariableExpressionAst' && isRemedyVariable(n) && tree.isWithin(n, left));
}

// Validate the remedy region in source text and return the five remedies.
// The region is anchored to step 4 (banner -> gate-exit else block), never
// to the first `$remedy = $null` in the file, and exactly one remedy
// region is allowed in the whole file.
function step4Remedies(sourceText) {
  const tree = buildTree(parsePowerShell(sourceText));
  const all = [...tree.byId.values()];
  const isRemedyAssign = (n) => n.type === 'AssignmentStatementAst' && tree.kids(n)[0] && isPlainVariable(tree.kids(n)[0], 'remedy');

  // --- Anchor: step 4's own banner and gate-exit structure. ---
  const banners = all.filter((n) => n.type === 'StringConstantExpressionAst' && n.value === '[4/4] Verifying generated agent documentation is fresh');
  if (banners.length !== 1) violate(`expected exactly one step-4 banner ('[4/4] Verifying generated agent documentation is fresh') anchoring the remedy region, found ${banners.length}`);
  let step4Block = tree.parent(banners[0]);
  while (step4Block && !['StatementBlockAst', 'NamedBlockAst', 'ScriptBlockAst'].includes(step4Block.type)) step4Block = tree.parent(step4Block);
  if (!step4Block) violate(`the step-4 banner is not inside any block, so no remedy region can be anchored to step 4`);
  const isGateExitTest = (n) => {
    if (n.type !== 'IfStatementAst' || n.clauseCount !== 1 || !n.hasElse) return false;
    const parts = tree.kids(n);
    if (parts.length !== 3) return false;
    const condElements = tree.kids(parts[0]);
    if (condElements.length !== 1) return false;
    const binary = unwrap(condElements[0], tree);
    if (binary.type !== 'BinaryExpressionAst' || binary.operator !== 'Ieq') return false;
    const [left, right] = tree.kids(binary);
    if (!left || !isPlainVariable(left, 'agentDocsExit')) return false;
    const value = right ? unwrap(right, tree) : null;
    return value !== null && value.type === 'ConstantExpressionAst' && value.value === '0';
  };
  const gateTests = all.filter((n) => isGateExitTest(n) && tree.isWithin(n, step4Block));
  if (gateTests.length !== 1) violate(`expected exactly one 'if ($agentDocsExit -eq 0) ... else' gate-exit test inside step 4 anchoring the remedy region, found ${gateTests.length}; the remedy region must be that test's else block`);
  const gateParts = tree.kids(gateTests[0]);
  const regionBlock = gateParts[gateParts.length - 1];
  if (!regionBlock || regionBlock.type !== 'StatementBlockAst') violate(`the step-4 gate-exit test's else clause is not a statement block, so no remedy region is anchored to step 4`);

  // --- Exactly one remedy region in the whole file. ---
  for (const n of all) {
    if (n.type === 'AssignmentStatementAst' && targetsRemedy(n, tree, all) && !tree.isWithin(n, regionBlock)) {
      violate(`extra $remedy assignment outside the anchored step-4 remedy region: ${describe(n)}; exactly one remedy region is allowed and it must be the else block of step 4's 'if ($agentDocsExit -eq 0)' -- a decoy remedy region elsewhere in the file is RED`);
    }
  }

  const statements = tree.kids(regionBlock);
  let idx = 0;
  const init = statements[0];
  if (!init || !isRemedyAssign(init)) violate(`'$remedy = $null' must be the first statement of the anchored step-4 remedy region, got ${init ? describe(init) : 'end of region'}`);
  if (init.operator !== 'Equals') violate(`'$remedy = $null' must use '='`);
  {
    const rhs = unwrap(tree.kids(init)[1], tree);
    if (rhs.type !== 'VariableExpressionAst' || (rhs.userPath ?? '').toLowerCase() !== 'null') violate(`the anchored step-4 remedy region must start with '$remedy = $null', got ${describe(init)}`);
  }
  idx = 1;
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
    const exact = BRANCH_PATTERNS.filter(([expected]) => expected === pattern);
    if (exact.length !== 1) violate(`branch condition pattern '${pattern}' does not exactly match exactly one expected step-4 cause pattern; extra regex alternatives, a different needle or any other deviation from the exact pattern are RED (expected exactly one of: ${BRANCH_PATTERNS.map(([p]) => `'${p}'`).join(', ')})`);
    const key = exact[0][1];
    if (remedies[key] !== undefined) violate(`duplicate step-4 branch for '${key}'; each expected cause pattern may be used by at most one branch`);
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
  `Write-Host "[4/4] Verifying generated agent documentation is fresh"`,
  `if ($agentDocsExit -eq 0) { $agentDocsPassed = $true }`,
  `else {`,
  `$remedy = $null`,
  `if ($agentDocsOutput -match '(?m)^\\s*Failed to run git\\b|^\\s*git .* exited with code\\b|^\\s*Failed to run git\\b') { $remedy = "could not run a git query" }`,
  `elseif ($agentDocsOutput -match '(?s)cone sparse-checkout') { $remedy = "sparse-checkout reapply" }`,
  `elseif ($agentDocsOutput -match '(?s)skip-worktree or assume-unchanged') { $remedy = "clear --no-skip-worktree" }`,
  `elseif ($agentDocsOutput -match '(?s)is stale:') { $hint = "npm run doc:agent"; $remedy = "stale; run $hint" }`,
  `else { $remedy = "unknown reason" }`,
  `Write-Host $remedy`,
  `}`,
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

test('step-4 lock rejects decoy remedy regions and non-exact branch conditions (phase 7)', () => {
  // An allowlist-shaped remedy region on its own: same init, chain and
  // output shapes the lock accepts inside step 4. Placed anywhere other
  // than step 4's gate-exit else block it is a decoy (finding F1).
  const decoyRegion = [
    `$remedy = $null`,
    `if ($agentDocsOutput -match '(?s)cone sparse-checkout') { $remedy = "sparse-checkout reapply" }`,
    `elseif ($agentDocsOutput -match '(?s)skip-worktree or assume-unchanged') { $remedy = "clear --no-skip-worktree" }`,
    `else { $remedy = "unknown reason" }`,
    `Write-Host $remedy`,
  ].join('\n');
  const outsideRegion = /extra \$remedy assignment outside the anchored step-4 remedy region/;
  const decoyCases = [
    // The reviewer's construction: decoy wrapped in if ($false) before step 4.
    ['F1 reviewer: decoy in if ($false) before step 4', `if ($false) {\n${decoyRegion}\n}\n${SYNTHETIC}`],
    // Variations of the same anchor bypass.
    ['F1 variation: bare decoy block before step 4', `{\n${decoyRegion}\n}\n${SYNTHETIC}`],
    ['F1 variation: decoy in if ($false) after step 4', `${SYNTHETIC}\nif ($false) {\n${decoyRegion}\n}`],
    ['F1 variation: single extra $remedy assignment before step 4', `$remedy = "npm run doc:agent"\n${SYNTHETIC}`],
    ['F1 variation: scoped decoy assignment before step 4', `$script:remedy = "npm run doc:agent"\n${SYNTHETIC}`],
    ['F1 variation: decoy assignment inside step 4 but outside the gate-exit else', SYNTHETIC.replace('if ($agentDocsExit -eq 0)', 'if ($false) { $remedy = "npm run doc:agent" }\nif ($agentDocsExit -eq 0)')],
  ];
  for (const [name, snippet] of decoyCases) {
    assert.throws(() => step4Remedies(snippet), outsideRegion, `case must be RED with the outside-region reason: ${name}`);
  }

  const notExact = /does not exactly match exactly one expected step-4 cause pattern/;
  const coneCondition = `$agentDocsOutput -match '(?s)cone sparse-checkout'`;
  const conditionCases = [
    // The reviewer's construction: cone pattern extended with the
    // index-bit alternative, so the cone remedy answers an index fault.
    ['F2 reviewer: cone -match extended with |skip-worktree or assume-unchanged', SYNTHETIC.replace(`'(?s)cone sparse-checkout'`, `'(?s)cone sparse-checkout|skip-worktree or assume-unchanged'`), notExact],
    // Variations: other branches extended, and the needle without its
    // exact wrapper.
    ['F2 variation: index-bit -match extended with |cone sparse-checkout', SYNTHETIC.replace(`'(?s)skip-worktree or assume-unchanged'`, `'(?s)skip-worktree or assume-unchanged|cone sparse-checkout'`), notExact],
    ['F2 variation: stale -match extended with |cone sparse-checkout', SYNTHETIC.replace(`'(?s)is stale:'`, `'(?s)is stale:|cone sparse-checkout'`), notExact],
    ['F2 variation: cone needle without the exact (?s) wrapper', SYNTHETIC.replace(`'(?s)cone sparse-checkout'`, `'cone sparse-checkout'`), notExact],
    // Extra operands / different operator around an otherwise exact match.
    ['F2 variation: extra -or operand on the cone condition', SYNTHETIC.replace(coneCondition, `${coneCondition} -or $agentDocsOutput -match '(?s)is stale:'`), /only a single '\$agentDocsOutput -match <exact pattern>'/],
    ['F2 variation: different operator -cmatch on the cone condition', SYNTHETIC.replace(coneCondition, `$agentDocsOutput -cmatch '(?s)cone sparse-checkout'`), /only a single '\$agentDocsOutput -match <exact pattern>'/],
    ['F2 variation: different variable on the cone condition', SYNTHETIC.replace(coneCondition, `$otherOutput -match '(?s)cone sparse-checkout'`), /must test the plain variable \$agentDocsOutput/],
  ];
  for (const [name, snippet, reason] of conditionCases) {
    assert.throws(() => step4Remedies(snippet), reason, `case must be RED with its named reason: ${name}`);
  }
});
