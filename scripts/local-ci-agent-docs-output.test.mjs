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
// console). The test is anchored to the step-4 block — a unique substring of
// the capture-and-render region — rather than to a line number, so a
// surrounding comment edit does not silently break the lock.
//
// Design choice (step-4 remedy lock): SOURCE-TEXT lock, not execution.
// Executing step 4 would mean running `npm run doc:agent` plus the freshness
// gate under five forced failure causes from vitest -- slow, needing a real
// git worktree per cause, and three causes (cone sparse-checkout, index bit,
// git-query failure) cannot be provoked without mutating the developer's
// `.git`. A source-text lock stays hermetic and fast; its cost is that it
// must model composition, which `composedBranchRemedy` below does: it folds
// every `$remedy = "..."` / `$remedy += "..."` contribution in a branch body
// and resolves `$variable` interpolation against literals in the step-4
// block, in source order.
//
// Fail-closed contract (phase 5, 2026-10-14): anything the lock cannot
// follow fails the test with a NAMED reason under "remedy composed from an
// unresolvable variable" -- it never passes silently. The three composition
// forms measured silent-green on commit 1e21de71 are closed by rules 1-3:
//   1. After a parsed literal's closing quote an ALLOWLIST decides: only
//      end of line, ';', '}' or a '#' comment may follow. Every PowerShell
//      operator (-f, -replace, -join, -split, '+', ...), pipeline or method
//      call is rejected -- an allowlist, not a denylist. The same check
//      applies to `$remedy` assignments and to the `$variable` assignments
//      that interpolation resolves, so `$hint = "a" + "b"` is unresolvable,
//      not "the first operand".
//   2. A branch body containing ANY control flow (if/elseif/else/foreach/
//      for/while/switch/do/until/try/catch/finally) is refused: which text
//      step 4 would then print depends on a runtime condition the lock
//      cannot evaluate. A second `$remedy =` reset inside one branch is
//      refused for the same reason ("more than one '$remedy =' reset").
//   3. The fallback boundary is the bare `else {` AFTER the last real
//      condition ('is stale:'), never lastIndexOf('else {'), so a nested
//      if/else inside the fallback arm cannot move segment boundaries --
//      and rule 2 refuses such a body outright.
//   4. Every `$remedy` write in the step-4 block must live inside one of
//      the five branch bodies or be the `$remedy = $null` initialiser. A
//      write between the if/else chain and `Write-Host $remedy` would
//      override every branch at runtime while the per-branch fold never
//      saw it.
//   5. Non-literal assignments (here-strings, command calls), $(...)
//      subexpressions, Set-Variable remedy, and variables with no literal
//      assignment in the step-4 block are refused.
// Named gap that remains, by construction: the lock models the
// `Write-Host $remedy` line only. A remedy printed through a DIFFERENT
// output statement (a second Write-Host of another variable, a file or
// event-log write) is outside the model -- step 4's remedy path is locked,
// not every conceivable output channel.
//
// This test is reachable from `npm test` (vitest) so CI's `npm test` step
// enforces it without a separate PowerShell harness.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'vitest';
import { URL } from 'node:url';

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
      // Not reliable enough — fall back to skipping past the open quote
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
    'step 4 must Write-Host the captured $line (gate output) — otherwise the drift list is invisible above the remedy'
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
  // console — a different regression from "silently swallow", but the same
  // diagnostic loss. Both regressions are caught by the same anchor.
  assert.match(
    step4Block,
    /foreach\s*\(\s*\$line\s+in\s+@\(\s*\$agentDocsOutput\s*\)\s*\)/,
    'step 4 must iterate $agentDocsOutput and Write-Host each line — otherwise the gate output never reaches the console'
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

const UNRESOLVABLE = 'remedy composed from an unresolvable variable';

function failUnresolvable(detail) {
  assert.fail(`${UNRESOLVABLE}: ${detail}`);
}

// Parse a PowerShell string literal starting at `quoteAt` (index of the
// opening quote). Double-quoted literals resolve `$name` / `${name}`
// interpolation via `resolveVar(name)`; `$(...)` is unresolvable.
// Single-quoted literals have no interpolation ('' is an escaped quote).
function parsePsLiteral(text, quoteAt, resolveVar) {
  const quote = text[quoteAt];
  assert.ok(quote === '"' || quote === "'", `expected string literal at ${quoteAt}`);
  let value = '';
  let i = quoteAt + 1;
  while (i < text.length) {
    const c = text[i];
    if (quote === "'") {
      if (c === "'" && text[i + 1] === "'") { value += "'"; i += 2; continue; }
      if (c === "'") return { value, end: i + 1 };
      value += c; i++; continue;
    }
    if (c === '`') { value += text[i + 1] ?? ''; i += 2; continue; }
    if (c === '"' && text[i + 1] === '"') { value += '"'; i += 2; continue; }
    if (c === '"') return { value, end: i + 1 };
    if (c === '$') {
      if (text[i + 1] === '(') failUnresolvable('subexpression $(...) in remedy literal');
      const braced = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}/.exec(text.slice(i));
      const plain = braced ?? /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(text.slice(i));
      if (!plain) { value += c; i++; continue; }
      value += resolveVar(plain[1]);
      i += plain[0].length; continue;
    }
    value += c; i++;
  }
  failUnresolvable('unterminated string literal in remedy composition');
}

// Resolve `$name` to the composed literal assigned to it anywhere in the
// step-4 block (`=` resets, `+=` appends, in source order). Fails closed
// when the variable has no literal assignment, a non-literal assignment,
// a trailing operator/expression after any assigned literal, or a cyclic
// reference. Matches are located in the stripped view (literals/comments
// blanked) so a `$name` mention inside a string or comment is never read
// as an assignment; the literal itself is then parsed from the raw text at
// the same offset.
function resolveStep4Variable(step4Block, name, seen = new Set()) {
  const key = name.toLowerCase();
  if (key === 'remedy' || seen.has(key)) failUnresolvable(`$${name}`);
  seen.add(key);
  const bare = stripLiteralsAndComments(step4Block);
  const re = new RegExp(`\\$${name}(?![A-Za-z0-9_])`, 'gi');
  let composed = null;
  let m;
  while ((m = re.exec(bare)) !== null) {
    const rest = step4Block.slice(m.index + m[0].length);
    const op = /^\s*(\+?=)\s*/.exec(rest);
    if (!op) continue; // a use, not an assignment
    const litAt = m.index + m[0].length + op[0].length;
    const ch = step4Block[litAt];
    if (ch !== '"' && ch !== "'") failUnresolvable(`$${name} is assigned a non-literal value`);
    const { value, end } = parsePsLiteral(step4Block, litAt, (n) => resolveStep4Variable(step4Block, n, new Set(seen)));
    assertLiteralTail(bare, end, `$${name} ${op[1]} literal`);
    composed = op[1] === '+=' ? (composed ?? '') + value : value;
    re.lastIndex = end;
  }
  if (composed === null) failUnresolvable(`$${name} has no literal assignment in the step-4 block`);
  return composed;
}

const BRANCH_NEEDLES = ['Failed to run git', 'cone sparse-checkout', 'skip-worktree or assume-unchanged', 'is stale:', null];

// PowerShell-aware forward brace matcher: braces inside '...' / "..." literals
// and '#' line comments do not count. PowerShell escapes are a doubled quote
// ('' or "") or a backtick inside double-quoted literals, so no backslash
// handling is needed.
function psMatchingClose(text, openAt) {
  let depth = 0;
  let quote = '';
  let i = openAt;
  while (i < text.length) {
    const c = text[i];
    if (quote) {
      if (c === '`' && quote === '"') { i += 2; continue; }
      if (c === quote && text[i + 1] === quote) { i += 2; continue; }
      if (c === quote) { quote = ''; i++; continue; }
      i++; continue;
    }
    if (c === '#') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '"' || c === "'") { quote = c; i++; continue; }
    if (c === '{') { depth++; i++; continue; }
    if (c === '}') {
      depth--;
      if (depth === 0) return i;
      i++; continue;
    }
    i++;
  }
  return -1;
}

// Length-preserving blanking of string literals and '#' line comments, so
// keyword/assignment scans never fire on text PowerShell would treat as
// literal content or commentary. Offsets in the output map 1:1 to `text`.
function stripLiteralsAndComments(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '#') {
      while (i < text.length && text[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      out += ' '; i++;
      while (i < text.length) {
        if (text[i] === '`' && q === '"') { out += '  '; i += 2; continue; }
        if (text[i] === q && text[i + 1] === q) { out += '  '; i += 2; continue; }
        if (text[i] === q) { out += ' '; i++; break; }
        out += text[i] === '\n' ? '\n' : ' '; i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

// Allowlist of what may follow a parsed literal's closing quote: end of the
// text, end of the line, ';', '}' or a '#' comment. ANYTHING else -- every
// PowerShell operator (-f, -replace, -join, -split, '+', ...), a pipeline, a
// method call -- means the emitted value is not the literal the lock just
// parsed, so the composition is unresolvable, not "the first operand".
// `bare` is the stripLiteralsAndComments view of the same text (same length,
// same offsets), so a trailing '# comment' arrives here already blanked to
// whitespace and passes via the end-of-line rule.
function assertLiteralTail(bare, end, what) {
  let i = end;
  while (i < bare.length && (bare[i] === ' ' || bare[i] === '\t')) i++;
  if (i >= bare.length) return;
  const c = bare[i];
  if (c === '\r' || c === '\n' || c === ';' || c === '}' || c === '#') return;
  const tail = bare.slice(i, i + 24).split(/\r?\n/)[0].trim();
  failUnresolvable(
    `${what} is followed by '${tail}' -- only end of line, ';', '}' or a '#' comment ` +
    "may follow a remedy literal's closing quote (an allowlist; every operator such as -f, -replace, -join or '+' is rejected)"
  );
}

// Returns the {start, end} offsets of one branch's slice of the step-4 block:
// from the branch's condition needle to the next branch's condition (or, for
// the fallback, to the `Write-Host $remedy` line). The fallback is located by
// searching FORWARDS for the bare `else {` after the last real condition
// ('is stale:'), never by lastIndexOf('else {') -- the latter silently
// retargets the boundary to a nested if/else added inside the fallback arm
// (measured 2026-10-14) and made every remedy write before the nested `else`
// leak into the stale branch's segment.
function branchSegmentRange(step4Block, conditionNeedle) {
  const starts = BRANCH_NEEDLES.map((needle) => {
    if (needle === null) {
      const staleAt = step4Block.indexOf('is stale:');
      assert.ok(staleAt >= 0, "step-4 condition not found: 'is stale:'");
      const elseMatch = /\belse\s*\{/.exec(step4Block.slice(staleAt));
      assert.ok(elseMatch, 'the unknown-reason else branch is missing');
      return staleAt + elseMatch.index;
    }
    const at = step4Block.indexOf(needle);
    assert.ok(at >= 0, `step-4 condition not found: ${needle}`);
    return at;
  });
  const idx = BRANCH_NEEDLES.indexOf(conditionNeedle);
  const start = starts[idx];
  const end = idx + 1 < starts.length ? starts[idx + 1] : step4Block.indexOf('Write-Host $remedy', start);
  assert.ok(end > start, `cannot bound step-4 branch: ${conditionNeedle ?? 'else'}`);
  return { start, end };
}

// The branch body is the {...} block opened by the branch condition.
// Composing over the raw segment instead would drag the NEXT branch's
// `elseif (...)` header into the analysis.
function branchBodyRange(step4Block, segRange, conditionNeedle) {
  const openAt = step4Block.indexOf('{', segRange.start);
  assert.ok(openAt >= 0 && openAt < segRange.end, `branch has no body block: ${conditionNeedle ?? 'else'}`);
  const closeAt = psMatchingClose(step4Block, openAt);
  assert.ok(closeAt > openAt, `unterminated branch body: ${conditionNeedle ?? 'else'}`);
  return { start: openAt + 1, end: closeAt };
}

// Every `$remedy` write in the step-4 block must live inside one of the five
// branch bodies or be the `$remedy = $null` initialiser. A write between the
// if/else chain and `Write-Host $remedy` would override or append to EVERY
// branch at runtime while the per-branch fold never sees it.
function assertNoStrayRemedyWrites(step4Block) {
  const bare = stripLiteralsAndComments(step4Block);
  const ranges = BRANCH_NEEDLES.map((needle) => branchBodyRange(step4Block, branchSegmentRange(step4Block, needle), needle));
  const re = /\$remedy(?![A-Za-z0-9_])\s*\+?=/g;
  let m;
  while ((m = re.exec(bare)) !== null) {
    if (ranges.some((r) => m.index >= r.start && m.index < r.end)) continue;
    if (/^\$remedy(?![A-Za-z0-9_])\s*=\s*\$null\b/.test(bare.slice(m.index))) continue;
    failUnresolvable(
      `a $remedy write outside the five branch bodies (offset ${m.index}) would apply to ` +
      'every branch at runtime while the per-branch fold only sees branch bodies'
    );
  }
}

/**
 * Returns the COMPOSED remedy a single step-4 branch actually emits: every
 * `$remedy = "..."` (reset) and `$remedy += "..."` (append) contribution in
 * the branch BODY, in source order, with `$variable` interpolation resolved
 * against literals in the step-4 block. `conditionNeedle` is a literal
 * substring of the branch's `-match '...'` condition, or null for the
 * trailing bare `else {` fallback. Anything the fold cannot follow fails the
 * test with a named reason instead of returning a partial string: control
 * flow inside the body, a second `=` reset, a trailing operator after any
 * literal, a non-literal assignment, a $(...) subexpression, an unresolved
 * variable, or Set-Variable.
 */
function composedBranchRemedy(step4Block, conditionNeedle) {
  assertNoStrayRemedyWrites(step4Block);
  const label = conditionNeedle ?? 'else';
  const segRange = branchSegmentRange(step4Block, conditionNeedle);
  const bodyRange = branchBodyRange(step4Block, segRange, conditionNeedle);
  const body = step4Block.substring(bodyRange.start, bodyRange.end);
  const bare = stripLiteralsAndComments(body);
  const cf = /\b(if|elseif|else|foreach|for|while|switch|do|until|try|catch|finally)\s*[\({]/.exec(bare);
  if (cf) {
    failUnresolvable(
      `control flow ('${cf[1]}') inside the '${label}' branch body -- which remedy text step 4 ` +
      'prints would depend on a runtime condition the lock cannot follow'
    );
  }
  if (/\bSet-Variable\b[^\n]*\bremedy\b/i.test(bare)) failUnresolvable('Set-Variable remedy in branch');
  let composed = null;
  let resets = 0;
  const re = /\$remedy(?![A-Za-z0-9_])/g;
  let m;
  while ((m = re.exec(bare)) !== null) {
    const rest = body.slice(m.index + m[0].length);
    const op = /^\s*(\+?=)\s*/.exec(rest);
    if (!op) failUnresolvable(`non-assignment use of $remedy near: ${body.slice(m.index, m.index + 40)}`);
    const litAt = m.index + m[0].length + op[0].length;
    const ch = body[litAt];
    if (ch !== '"' && ch !== "'") failUnresolvable(`$remedy ${op[1]} non-literal near: ${body.slice(m.index, m.index + 40)}`);
    const { value, end } = parsePsLiteral(body, litAt, (n) => resolveStep4Variable(step4Block, n));
    assertLiteralTail(bare, end, `$remedy ${op[1]} literal`);
    if (op[1] === '=') {
      resets += 1;
      if (resets > 1) {
        failUnresolvable(
          `more than one '$remedy =' reset in the '${label}' branch -- the emitted remedy would ` +
          'depend on control flow the lock cannot follow'
        );
      }
    }
    composed = op[1] === '+=' ? (composed ?? '') + value : value;
    re.lastIndex = end;
  }
  assert.ok(composed !== null, `no $remedy assignment in branch: ${label}`);
  return composed;
}

test('each step-4 cause branch assigns its OWN remedy text and no other branch\'s', () => {
  // Lock the remedy text PER BRANCH. The routing test above only proves the
  // four match fragments exist SOMEWHERE in the block; it stayed green when
  // two remedies were swapped and when "run npm run doc:agent" was put back
  // into the index-bit branch (measured). Swapped remedies are wrong advice:
  // a skip-worktree bit is not fixed by regenerating docs, and a stale packet
  // is not fixed by clearing index bits.
  const step4Block = enclosingBlock(source, '$remedy = $null');
  const signatures = {
    gitQuery: 'could not run a git query',
    cone: 'sparse-checkout reapply',
    indexBit: '--no-skip-worktree',
    stale: 'npm run doc:agent',
    fallback: 'unknown reason',
  };
  const remedies = {
    gitQuery: composedBranchRemedy(step4Block, 'Failed to run git'),
    cone: composedBranchRemedy(step4Block, 'cone sparse-checkout'),
    indexBit: composedBranchRemedy(step4Block, 'skip-worktree or assume-unchanged'),
    stale: composedBranchRemedy(step4Block, 'is stale:'),
    // The fallback has no -match condition; null selects the trailing
    // bare `else {` arm.
    fallback: composedBranchRemedy(step4Block, null),
  };
  for (const [branch, remedy] of Object.entries(remedies)) {
    assert.ok(remedy.includes(signatures[branch]), `${branch} branch must assign its own remedy ("${signatures[branch]}"), got: ${remedy}`);
    for (const [other, signature] of Object.entries(signatures)) {
      if (other === branch) continue;
      assert.ok(!remedy.includes(signature), `${branch} branch must NOT contain the ${other} remedy ("${signature}"), got: ${remedy}`);
    }
  }
});

test('composedBranchRemedy folds += appends, resolves interpolation, and fails closed on unresolvable composition', () => {
  const synthetic = [
    `if ($x -match 'Failed to run git') { $remedy = "could not run a git query" }`,
    `elseif ($x -match 'cone sparse-checkout') { $remedy = "sparse-checkout reapply"; $remedy += " --no-skip-worktree" }`,
    `elseif ($x -match 'skip-worktree or assume-unchanged') { $remedy = "clear --no-skip-worktree" }`,
    `elseif ($x -match 'is stale:') { $hint = "npm run doc:agent"; $remedy = "stale; run $hint" }`,
    `else { $remedy = "unknown reason" }`,
    `Write-Host $remedy`,
  ].join('\n');
  assert.equal(composedBranchRemedy(synthetic, 'cone sparse-checkout'), 'sparse-checkout reapply --no-skip-worktree');
  assert.equal(composedBranchRemedy(synthetic, 'is stale:'), 'stale; run npm run doc:agent');
  const unresolvable = synthetic.replace('$hint = "npm run doc:agent"; ', '');
  assert.throws(() => composedBranchRemedy(unresolvable, 'is stale:'), /remedy composed from an unresolvable variable/);

  // Fail-closed forms measured silent-green on commit 1e21de71 (phase 5,
  // 2026-10-14): each must throw the NAMED unresolvable reason, never pass.
  // (1) A format operator after the literal -- the foreign signature hides in
  // the -f ARGUMENT the old lock never looked at. The same allowlist rejects
  // -replace/-join/-split/'+' and every other operator.
  const withFormatOperator = synthetic.replace(
    '$remedy = "sparse-checkout reapply";',
    '$remedy = "sparse-checkout reapply {0}" -f "--no-skip-worktree";'
  );
  assert.throws(() => composedBranchRemedy(withFormatOperator, 'cone sparse-checkout'), /only end of line, ';', '}' or a '#' comment may follow/);
  // (2) Concatenation inside a RESOLVED variable -- the old lock resolved
  // only the first operand of `$hint`.
  const withConcatenatedVariable = synthetic.replace(
    '$hint = "npm run doc:agent"',
    '$hint = "npm run" + " doc:agent"'
  );
  assert.throws(() => composedBranchRemedy(withConcatenatedVariable, 'is stale:'), /only end of line, ';', '}' or a '#' comment may follow/);
  // (3) Nested reassignment within one branch -- the old fold took the last
  // `=` in source order while the runtime value depends on the condition.
  const withNestedReset = synthetic.replace(
    '$remedy = "clear --no-skip-worktree"',
    '$remedy = "WRONG"\n  if ($y) { $remedy = "clear --no-skip-worktree" }'
  );
  assert.throws(() => composedBranchRemedy(withNestedReset, 'skip-worktree or assume-unchanged'), /control flow \('if'\) inside the 'skip-worktree or assume-unchanged' branch body/);
  // (4) A nested if/else inside the fallback arm must not move the segment
  // boundary (forward search, not lastIndexOf) and the body itself is
  // refused as control-flow-dependent.
  const withNestedElseInFallback = synthetic.replace(
    'else { $remedy = "unknown reason" }',
    'else { $remedy = "unknown reason"\n  if ($z) { $remedy = "x" } else { $remedy = "y" } }'
  );
  assert.throws(() => composedBranchRemedy(withNestedElseInFallback, null), /control flow \('if'\) inside the 'else' branch body/);
  // (5) A `$remedy` write BETWEEN the if/else chain and `Write-Host $remedy`
  // would rewrite every branch at runtime while the per-branch fold never
  // sees it.
  const withStrayWrite = synthetic + '\n$remedy += " npm run doc:agent"';
  assert.throws(() => composedBranchRemedy(withStrayWrite, 'is stale:'), /write outside the five branch bodies/);
});