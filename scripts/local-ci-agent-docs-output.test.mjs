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
// Phase 8 (this round) binds the three channels phase 7 left open:
//   INPUT: in the whole step-4 block, $agentDocsOutput and $agentDocsExit
//   may each be written in exactly ONE place -- the gate-output capture
//   (`$agentDocsOutput = & node scripts/verify-agent-docs-fresh.mjs 2>&1`
//   and `$agentDocsExit = $global:LASTEXITCODE`). Every additional write
//   in any form (assignment or compound assignment, Set-/New-Variable,
//   -OutVariable and the other common *Variable parameters, Tee-Object
//   -Variable, Set-Item/Set-Content against a variable: path, [ref],
//   scope-qualified or braced spelling, or a name supplied through a
//   variable that cannot be statically evaluated) is RED, so the value
//   the branch `-match` conditions read is the gate's own output.
//   INDIRECT WRITES / OUTPUT: every VariableExpressionAst in the whole
//   file that resolves to `remedy` (scope/provider qualifiers and braces
//   stripped, case-insensitive) must lie inside the anchored region, and
//   every CommandAst in the whole file is judged by an allowlist over
//   what it may do with the remedy NAME: it is proven clean only when no
//   element mentions the remedy name statically and it reaches no
//   variable-name sink (the common *Variable parameters, the -Name
//   parameter of the *-Variable cmdlets, Tee-Object -Variable, the
//   item/content cmdlets against a variable: path, a [ref] argument, or
//   Invoke-Expression / a non-constant command) with an argument that
//   cannot be statically evaluated. Anything not proven clean and not
//   the single allowlisted `Write-Host $remedy` inside the region is
//   RED. This binds reads and writes together: a second print of
//   $remedy, or a Set-Variable that overwrites it after the region, is
//   RED even though neither is an AssignmentStatementAst.
//   BRANCH ORDER is bound: clause i must carry BRANCH_PATTERNS[i].
//   The four cause patterns are disjoint today, so order is harmless
//   while the input channel holds; binding it costs one comparison and
//   keeps it safe if a future pattern ever overlaps another.
// Phase 9 (this round) closes the five reproduced input-channel bypasses
// and the assessed splat/dynamic-path forms:
//   F1 CAPTURE STRUCTURE: the $agentDocsOutput capture must be exactly
//   `& node scripts/verify-agent-docs-fresh.mjs 2>&1` as an AST shape
//   (PipelineAst -> CommandAst `node`, Ampersand, the two string
//   constants and the 2>&1 merging redirection), not a right-hand side
//   whose text merely mentions the gate filename.
//   F4 CAPTURE ORDER/SOURCE: $agentDocsExit must be the statement
//   immediately after $agentDocsOutput in the same block, must read
//   $global:LASTEXITCODE, and no $global:LASTEXITCODE write may sit
//   between the two captures. Inserting `$global:LASTEXITCODE = 0`
//   there is RED (measured: it captures 0 and skips the gate).
//   F2 DYNAMIC COMMANDS: a non-constant command (`& $cmd`, dot-sourced
//   or call-operator invocation whose command name is not a constant)
//   that reaches a variable-name sink (-Name, a *Variable common
//   parameter, Tee-Object -Variable, a variable: item path) with an
//   argument that is not statically proven to be a different name is
//   RED; a dynamic command's positional argument is judged the same
//   way. Variable arguments are resolved through plain static
//   assignments in the file ($dn = 'agentDocsOutput'), so indirect
//   names cannot hide behind a variable either.
//   F3 PARAMETER BINDING: parameter names are judged by actual
//   PowerShell binding -- exact names, documented aliases (ov/ev/...),
//   and unambiguous prefixes (-OutV -> -OutVariable, Tee-Object -Var
//   -> -Variable). A prefix that could bind to a sink or to another
//   parameter (ambiguous, e.g. -Ou -> -OutVariable/-OutBuffer) is not
//   proven clean and is RED.
//   F5 IN-PLACE MUTATION: any InvokeMemberExpressionAst inside step 4
//   whose target or arguments touch $agentDocsOutput/$agentDocsExit
//   (e.g. $agentDocsOutput.SetValue('cone sparse-checkout',0)) counts
//   as a write to that input and is RED; member invocation cannot be
//   proven non-mutating from the AST alone.
//   F7 SPLATS / RESOLVED PATHS: a splatted argument bundle (@s) is
//   resolved through its plain hashtable assignment; a sink key
//   (OutVariable, -Name, Path, ...) with the guarded name, a provider
//   path, or a non-static value is RED, and an unresolvable splat on a
//   command is not proven clean. Item/cmdlet path arguments that
//   resolve statically ($p = 'variable:remedy'; Set-Item $p ...) are
//   judged by their resolved value; an unresolvable dynamic file path
//   (Remove-Item -LiteralPath $report) stays clean, matching phase 8.
//   Independent review of phase 9 added, on the same channels: unary
//   ++/-- and foreach loop variables on the inputs count as writes;
//   member invocations that name a guarded variable in a string
//   (PSVariable.Set('agentDocsOutput', ...)) or build code from one
//   ([scriptblock]::Create('... agentDocsOutput ...')) count as writes;
//   a splat bundle mutated after its hashtable assignment is
//   unresolvable; abbreviated switch parameters (-For -> -Force) consume
//   no argument when the positional elements are collected. Static name
//   resolution through assignments is scope- and order-blind: several
//   differing static values for one name fail closed rather than guess.
// Phase 10 (this round) closes the literal output channel INSIDE step 4
// with a structural allowlist, not a wording denylist: inside step 4
// the only console outputs are the banner, the gate-output echo
// (Write-Host $line in the foreach over $agentDocsOutput) and
// 'Write-Host $remedy'. Any other Write-Host/Warning/Output/Error/
// Information/Verbose/Debug, Out-Host or echo command, or any
// [Console]::Write/WriteLine invocation, inside step 4 -- literal,
// expandable or via another variable such as $msg -- is RED whatever
// words it uses, because it can put a wrong remedy in front of the
// operator on the step-4 failure path while every $remedy check stays
// green. Output OUTSIDE step 4 (steps 1-3 banners/results, catch
// handlers, the summary) is legitimate operator output, is not the
// step-4 remedy channel, and is not judged by this lock. Known gap
// (named, not closed): dynamic execution of an
// external script (`& $Validator`, dot-sourcing the telemetry helper)
// is judged only by its in-file arguments -- code inside those external
// files is out of scope. Since phase 13 such an invocation INSIDE step 4
// is RED outright (no dynamic or unrecognized command is on the step-4
// allowlist, captured or not); the gap covers only invocations outside
// step 4. Statements elsewhere that touch neither the
// step-4 input variables, the remedy variable/name, nor a name sink
// above remain out of scope by construction.
// Phase 11 closes the six bypasses the independent review of
// phases 9-10 measured GREEN while the real verbatim step-4 chain printed
// a wrong remedy. The output/input channels are now a POSITIVE STRUCTURAL
// BOUNDARY over the protected step-4 language, not name or wording
// denylists:
//   F1 STATEMENT SHAPES: every statement inside step 4 must be an
//      assignment, an if/foreach/try container, throw/continue/break, or
//      a single command judged by the command boundary below. A bare
//      expression statement ("...", @("..."), $("...") or a bare $msg)
//      parses as a CommandExpressionAst pipeline, writes its value to the
//      console and is RED, as is any multi-element pipeline statement.
//   F2 INPUT READS: $agentDocsOutput/$agentDocsExit may be READ only in
//      the capture's own left side, the gate-exit test and the echo
//      loop's enumerator. Taking an alias ('$x = $agentDocsOutput') is
//      RED (fail-closed instead of interpreting aliasing), so a later
//      '$x[0] = ...' or '$x.SetValue(...)' in-place mutation through the
//      alias cannot rewrite what the cause branches match.
//   F3 COMMAND NAMES: the invoked name is reduced to its bare cmdlet
//      (module qualifier stripped, so 'Microsoft.PowerShell.Utility\
//      Write-Host' is judged as Write-Host) and must be on the step-4
//      allowlist -- the banner/echo Write-Host, Push-/Pop-Location, or
//      the exact bound '& npm run doc:agent' and gate-capture node
//      invocation. Any other command is RED, captured or not: phase 11
//      originally accepted an unrecognized command when its pipeline
//      (success-stream) output was captured or discarded ('$x = ...',
//      '$null = ...', piped to Out-Null), but the phase-12 review
//      measured that escape hatch green with attacker text (captured
//      Set-Item/New-Item/Import-Alias creating an alias, captured
//      Invoke-Expression/iex, captured Clear-Host, and a captured
//      Get-Item whose terminating error routes attacker text to the
//      step-4 catch handler), so phase 13 removed it. Capture binds
//      only the success stream -- '$null = Write-Host "x"' still
//      prints -- which is why output cmdlets are rejected outright and
//      why capture never proves an unrecognized command harmless.
//      Alias creation needs either an alias:-drive assignment (RED, the
//      sweep below) or a command (no alias-creating command is on the
//      allowlist, and unrecognized commands are RED captured or not),
//      so no alias-creating spelling remains inside step 4. The
//      host-only channels Write-Progress (F6) and Read-Host are RED in
//      every form, captured or not; the phase-11 review measured no
//      redirected-console harm for Write-Progress, so no
//      interactive-only channel is claimed closed beyond that.
//   F4 MEMBER INVOCATIONS: the only InvokeMemberExpressionAst allowed
//      inside step 4 is the echo loop's $line.ToString(). A console
//      write through [Console]::WriteLine, $Host.UI.WriteLine or the same
//      through an aliased variable/type ('$c = [Console]; $c::WriteLine
//      (...)') cannot be told apart from a safe call statically, so every
//      other member invocation inside step 4 is RED.
//   F5 ECHO BINDING: exactly one foreach over exactly @($agentDocsOutput)
//      with the plain loop variable $line is the echo loop; nothing else
//      may write $line (assignment, ++/--, [ref], a name sink or another
//      foreach loop variable), and the echo Write-Host calls take exactly
//      one argument -- $line or $line.ToString() -- so the printed lines
//      are the gate's own output, never a rewritten $line.
// Phase 12 (this round) closes the five follow-up findings of the phase-11
// independent review (VERDICT: hold), each measured GREEN with attacker
// text on the console before this round:
//   F7 ALIAS SPELLINGS: nal/sal (the built-in New-Alias/Set-Alias
//      aliases), '$alias:zz = "Write-Host"' drive assignments and
//      'Set-Item alias:zz ...' provider writes all create an alias without
//      tripping the literal command-name check; those literal spellings
//      are RED (command names nal/sal, alias: drive assignment left
//      sides, alias: provider string-literal arguments), wherever in
//      step 4 they sit (a nested finally included). This paragraph
//      over-claimed when written ("every alias-creating spelling"): the
//      alias: provider sweep only inspected string literals, so a
//      variable or constructed provider path ('$p = "alias:zz"; $null =
//      Set-Item $p Write-Host') stayed green until phase 13 removed the
//      capture escape hatch that let those commands run at all.
//   F8 ECHO REACHABILITY: the echo loop body is bound, not just the loop
//      shape: every body statement must be an echo Write-Host, the exact
//      'if ($null -eq $line) { continue }' guard, or the exact ErrorRecord
//      dispatch. Wrapping the body in 'if ($false) { ... }' or filtering
//      it with 'if ($line -match ...) { continue }' suppresses the gate
//      output the remedy points at and is now RED.
//   F9 HOST-ONLY CHANNELS: Write-Progress and Read-Host are RED inside
//      step 4 in every form, captured or not (capture does not suppress
//      them; step 4 never reports progress and never prompts).
//   F10 THROW BINDING: the only throw allowed inside step 4 is the exact
//      npm-regeneration failure ('throw "npm run doc:agent exited with
//      code $LASTEXITCODE"'); the step-4 catch handler prints a thrown
//      message with its own prefix, so an attacker-text throw replaced
//      the operator-facing exception text while the lock stayed green.
//   F11 HEADER TRUTHFULNESS: the phase-11 header claimed the F7 alias
//      closure and overstated the capture rule; both are corrected above
//      and by this paragraph.
// Phase 13 (this round) closes the five follow-up findings of the phase-12
// independent review (VERDICT: hold), each measured GREEN on the full
// suite with attacker text on the verbatim step-4 chain:
//   O-1 ALIAS PROVIDER PATHS: the alias: sweep only inspected string
//      literals, so '$p = "alias:zz"; $null = Set-Item $p Write-Host'
//      (also New-Item -Path $p, New-Item -Path ('ali'+'as:zz') and
//      Import-Alias) created the alias while the lock stayed green.
//      Those commands are not on the step-4 allowlist anymore at all --
//      see the capture-hatch removal below.
//   O-2 THE CATCH CHANNEL: local-ci.ps1 sets $ErrorActionPreference =
//      'Stop', so any terminating cmdlet error ('$null = Get-Item
//      -LiteralPath "<text>"') makes the step-4 catch handler print the
//      attacker message with its own prefix, replacing the gate output
//      AND the remedy. Binding throw (F10) did not close this. Phase 13
//      bound every allowlisted command to an exact shape, restricted
//      assignment right sides to stored values, and bound the if/foreach
//      containers -- and over-claimed the result when written ("closed
//      for every statement shape"): the SHAPES were bound but the
//      VARIABLES they read were not, so a plain store ('$RepoRoot =
//      "<text>"' feeding Push-Location, '$LASTEXITCODE = "<text>"'
//      feeding the bound throw's interpolation) re-armed the same
//      channel until phase 14 bound stores on both sides (below).
//   O-3 CAPTURED CODE EXECUTION: '$null = Invoke-Expression ...' / iex
//      ran attacker code; capture binds only the success stream, so
//      capture never proves a command harmless.
//   O-4 CAPTURED HOST EFFECTS: '$null = Clear-Host' and captured
//      dot-sourcing were accepted; step 4 has no legitimate use for
//      either.
//   O-5 MECHANISM: constant propagation fed the name-sink analysis but
//      not the alias: sweep, hiding the blind spot. The fix is not more
//      propagation but removing the escape hatch: the step-4 command
//      boundary is now a strict positive allowlist with no captured-or-
//      discarded exemption.
// Phase 14 (this round) closes the three accepted holes of the phase-13
// independent review (VERDICT: fail), each measured GREEN on the full
// suite with console harm on the verbatim step-4 chain:
//   F1/F2 STORE TARGETS: '$RepoRoot = "<text>"' feeds the bound
//      'Push-Location $RepoRoot' (terminates; the catch handler prints
//      the attacker text) and '$LASTEXITCODE = "<text>"' feeds the bound
//      throw's interpolation. Inside step 4 the only stores now
//      recognized are the two bound gate captures, the exact
//      '$global:LASTEXITCODE = 0' reset and '$agentDocsPassed = $true';
//      any other store is RED whatever it assigns. This also closes the
//      review's F4 note: '$ErrorActionPreference = "SilentlyContinue"'
//      no longer passes the lock, so the catch channel cannot be
//      silenced from inside step 4 either.
//   F3 REDIRECTIONS: the command boundary filtered RedirectionAst out of
//      the shape checks, so 'Write-Host $line 6>$null' counted as the
//      bound echo while stream 6 (the information stream Write-Host
//      writes to) was discarded -- the gate output never reached the
//      console. The only redirection allowed inside step 4 is now the
//      gate capture's bound 2>&1. Not every redirection is harmful
//      (2>$null was measured harmless); the rule is fail-closed because
//      no step-4 command needs one.
// If pwsh (or Windows PowerShell) is unavailable the test
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
      // Explicit maxBuffer: Node's 1 MiB default bursts on the AST JSON
      // (545 kB for a 16.6 kB source today, growing with the source), and
      // ENOBUFS must not be misreported as a missing interpreter.
      const res = spawnSync(exe, ['-NoProfile', '-File', parserScriptPath, '-Path', snippet], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      if (res.error) {
        if (res.error.code === 'ENOBUFS') violate(`PowerShell AST output exceeded the 64 MiB maxBuffer (ENOBUFS) for ${exe}: ${res.error.message}; raise maxBuffer in parsePowerShell -- this is not a missing interpreter`);
        if (res.error.code === 'ENOENT') { lastError = res.error; continue; }
        violate(`PowerShell AST parser failed to launch ${exe} (${res.error.code ?? 'unknown'}): ${res.error.message}; refusing to skip`);
      }
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

// --- Phase 8 helpers: name normalisation and the CommandAst allowlist. ---

// Strip $, braces and any scope/provider qualifier (`script:`, `global:`,
// `variable:`, `Variable::`) and lower-case, so every spelling of a name
// compares equal: remedy, $remedy, ${remedy}, $script:remedy,
// ${variable:remedy}, variable:remedy all normalise to `remedy`.
function normalizedName(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim().toLowerCase();
  s = s.replace(/^\$\{/, '').replace(/^\$/, '').replace(/\}$/, '');
  s = s.replace(/^variable::/, 'variable:');
  const segments = s.split(':');
  return segments[segments.length - 1].replace(/[{}]/g, '');
}

function isVarNamed(node, name) {
  return node.type === 'VariableExpressionAst' && node.userPath !== null && normalizedName(node.userPath) === normalizedName(name);
}

function descendantsOf(node, tree) {
  return [...tree.byId.values()].filter((n) => tree.isWithin(n, node));
}

// Statically evaluate a string node; null when it is not a constant
// (a variable, an expandable string embedding a variable, a subexpression).
function staticString(node, tree) {
  if (!node) return null;
  const inner = unwrap(node, tree);
  if (inner.type === 'StringConstantExpressionAst') return inner.value;
  if (inner.type === 'ExpandableStringExpressionAst') {
    return tree.kids(inner).length === 0 ? inner.value : null;
  }
  return null;
}

// Resolve a node to a static string through plain assignments in the
// file: `$dn = 'agentDocsOutput'` makes `$dn` statically that string.
// Returns null when there is not exactly one static value (zero, several
// differing, or a non-static right-hand side), so callers fail closed.
function staticValue(node, tree, seen = new Set()) {
  if (!node) return null;
  const direct = staticString(node, tree);
  if (direct !== null) return direct;
  const inner = unwrap(node, tree);
  if (inner.type === 'PipelineAst' || inner.type === 'ParenPipelineAst') {
    const kids = tree.kids(inner);
    return kids.length === 1 ? staticValue(kids[0], tree, seen) : null;
  }
  if (inner.type !== 'VariableExpressionAst' || inner.splatted || inner.userPath === null || inner.userPath.includes(':')) return null;
  const key = inner.userPath.toLowerCase();
  if (seen.has(key)) return null;
  seen.add(key);
  const values = new Set();
  for (const n of tree.byId.values()) {
    if (n.type !== 'AssignmentStatementAst' || n.operator !== 'Equals') continue;
    const [left, right] = tree.kids(n);
    if (!left || !isPlainVariable(left, inner.userPath)) continue;
    const v = staticValue(right, tree, new Set(seen));
    if (v === null) return null;
    values.add(v);
  }
  return values.size === 1 ? [...values][0] : null;
}

function paramArgument(param, cmd, tree) {
  const own = tree.kids(param);
  if (own.length > 0) return own[0];
  const parts = tree.kids(cmd);
  const at = parts.indexOf(param);
  return at >= 0 ? (parts[at + 1] ?? null) : null;
}

// The closed variable-NAME sink surface. Each entry is a way a command can
// write (or alias) a variable given only its NAME, so a statically known
// remedy/input name there -- or a name that cannot be statically evaluated
// at all -- means the command is not proven clean.
const COMMON_VAR_PARAMS = new Set(['outvariable', 'ov', 'errorvariable', 'ev', 'warningvariable', 'wv', 'informationvariable', 'iv', 'pipelinevariable', 'pv']); // common *Variable parameters and their aliases
const VAR_COMMANDS = new Set(['set-variable', 'sv', 'new-variable', 'nv', 'get-variable', 'gv', 'clear-variable', 'clv', 'remove-variable', 'rv']); // *-Variable cmdlets take the name via -Name or positionally
const ITEM_COMMANDS = new Set(['set-item', 'set-content', 'add-content', 'clear-item', 'clear-content', 'new-item', 'remove-item', 'rename-item', 'set-itemproperty']); // item/content cmdlets write through a provider path such as variable:remedy
const PARAM_ALIASES = { ov: 'outvariable', ev: 'errorvariable', wv: 'warningvariable', iv: 'informationvariable', pv: 'pipelinevariable', ea: 'erroraction', wa: 'warningaction', ia: 'informationaction', vb: 'verbose', db: 'debug' };
const COMMON_PARAMS = ['verbose', 'debug', 'erroraction', 'warningaction', 'informationaction', 'errorvariable', 'warningvariable', 'informationvariable', 'outvariable', 'outbuffer', 'pipelinevariable', 'progressaction'];
const VAR_CMD_PARAMS = ['name', 'value', 'description', 'option', 'scope', 'visibility', 'force', 'passthru', 'valueonly', 'include', 'exclude', 'whatif', 'confirm', ...COMMON_PARAMS];
const TEE_PARAMS = ['inputobject', 'filepath', 'literalpath', 'variable', 'append', 'encoding', ...COMMON_PARAMS];
const ITEM_PARAMS = ['path', 'literalpath', 'value', 'newvalue', 'filter', 'include', 'exclude', 'recurse', 'force', 'credential', 'passthru', 'encoding', 'append', 'nonewline', 'whatif', 'confirm', ...COMMON_PARAMS];
// Judge a written parameter name by actual binding: exact, alias, or
// unambiguous prefix of a parameter in `universe`. Returns 'sink' when it
// binds to a sink parameter, 'ambiguous' when a prefix could bind to a
// sink or a competing parameter (not proven clean), else 'none'.
function paramBinding(pname, sinkNames, universe) {
  const p = (pname ?? '').toLowerCase();
  if (sinkNames.includes(p)) return 'sink';
  if (PARAM_ALIASES[p] && sinkNames.includes(PARAM_ALIASES[p])) return 'sink';
  if (PARAM_ALIASES[p]) return 'none';
  if (!p) return 'none';
  const candidates = universe.filter((u) => u.startsWith(p) && u !== p);
  if (candidates.length === 0) return 'none';
  if (candidates.length === 1) return sinkNames.includes(candidates[0]) ? 'sink' : 'none';
  return candidates.some((c) => sinkNames.includes(c)) ? 'ambiguous' : 'none';
}
function sinkKindForParam(param, cmdName) {
  const pname = param.parameterName ?? '';
  const kinds = [];
  const common = paramBinding(pname, ['outvariable', 'errorvariable', 'warningvariable', 'informationvariable', 'pipelinevariable'], COMMON_PARAMS);
  if (common !== 'none') kinds.push(common);
  if (VAR_COMMANDS.has(cmdName)) { const k = paramBinding(pname, ['name'], VAR_CMD_PARAMS); if (k !== 'none') kinds.push(k); }
  if (cmdName === 'tee-object') { const k = paramBinding(pname, ['variable'], TEE_PARAMS); if (k !== 'none') kinds.push(k); }
  if (ITEM_COMMANDS.has(cmdName)) { const k = paramBinding(pname, ['path', 'literalpath'], ITEM_PARAMS); if (k !== 'none') kinds.push(k); }
  if (kinds.includes('sink')) return 'sink';
  if (kinds.includes('ambiguous')) return 'ambiguous';
  return 'none';
}
// Resolve a splatted variable (@s) to its hashtable entries [[keyNode,
// valueNode], ...] through exactly one plain hashtable assignment, else null.
function splatEntries(splatNode, tree) {
  const name = splatNode.userPath;
  if (!name || name.includes(':')) return null;
  const tables = [];
  for (const n of tree.byId.values()) {
    if (n.type !== 'AssignmentStatementAst' || n.operator !== 'Equals') continue;
    const [left, right] = tree.kids(n);
    if (!left || !isPlainVariable(left, name)) continue;
    let rhs = right ? unwrap(right, tree) : null;
    if (rhs && rhs.type === 'ConvertExpressionAst') { const inner = tree.kids(rhs).find((k) => k.type === 'HashtableAst'); if (inner) rhs = inner; }
    if (rhs && rhs.type === 'HashtableAst') tables.push(rhs);
  }
  if (tables.length !== 1) return null;
  const table = tables[0];
  // The assignment statement that defines the bundle (an ancestor of the
  // hashtable). Any other write or mutation of the bundle variable
  // ($s.Add(...), $s['k'] = v, $s.k = v) makes the static entries
  // unreliable: fail closed.
  let definition = table;
  while (definition && definition.type !== 'AssignmentStatementAst') definition = tree.parent(definition);
  for (const n of tree.byId.values()) {
    if (n.type === 'AssignmentStatementAst' && n !== definition) {
      const left = tree.kids(n)[0];
      if (left && descendantsOf(left, tree).some((d) => isVarNamed(d, name))) return null;
    }
    if ((n.type === 'InvokeMemberExpressionAst' || n.type === 'UnaryExpressionAst') && descendantsOf(n, tree).some((d) => isVarNamed(d, name))) return null;
  }
  const kids = tree.kids(table);
  const pairs = [];
  for (let i = 0; i + 1 < kids.length; i += 2) pairs.push([kids[i], kids[i + 1]]);
  return pairs;
}

function isVariableProviderPath(value, name) {
  if (value === null) return false;
  const s = value.trim().toLowerCase();
  return (s.startsWith('variable:') || s.startsWith('variable::')) && normalizedName(s) === normalizedName(name);
}

// Return a named reason when `cmd` touches the variable `name`, else null.
// Proven clean = no element mentions the name statically AND no name sink
// above is reached with a non-statically-evaluable argument. Dynamic
// execution of an external command is judged by its in-file arguments
// only (named gap (b) in the header).
function commandTouchesName(cmd, tree, name) {
  const cmdName = (cmd.commandName ?? '').toLowerCase();
  const isDynamic = !cmd.commandName;
  const desc = descendantsOf(cmd, tree);
  for (const param of desc.filter((n) => n.type === 'CommandParameterAst')) {
    const pname = (param.parameterName ?? '').toLowerCase();
    let kind = sinkKindForParam(param, cmdName);
    // A dynamic command has no known parameter set, so -Name and the
    // other sink spellings are judged as sinks on sight (F2).
    if (isDynamic && kind === 'none' && ['name', 'variable', 'path', 'literalpath'].includes(pname)) kind = 'sink';
    if (isDynamic && kind === 'none') { const c = paramBinding(pname, ['outvariable', 'errorvariable', 'warningvariable', 'informationvariable', 'pipelinevariable'], COMMON_PARAMS); if (c !== 'none') kind = c; }
    if (kind === 'none') continue;
    const arg = paramArgument(param, cmd, tree);
    const value = staticValue(arg, tree);
    if (kind === 'ambiguous') {
      return `command '${cmd.text.replace(/\s+/g, ' ').trim()}' uses ambiguous parameter -${param.parameterName}, which could bind to a variable-name sink for '${name}' or to another parameter, so it cannot be proven clean (actual binding is ambiguous)`;
    }
    if (value !== null) {
      if (normalizedName(value) === normalizedName(name) || isVariableProviderPath(value, name)) {
        return `command '${cmd.text.replace(/\s+/g, ' ').trim()}' reaches variable-name sink -${param.parameterName} with the name '${name}'`;
      }
    } else if (arg) {
      // A path sink is only a variable sink through the variable: provider;
      // a dynamic file path (e.g. Remove-Item -LiteralPath $report) is clean,
      // unless the path argument itself mentions the variable: provider.
      const isPathSink = ITEM_COMMANDS.has(cmdName) && paramBinding(pname, ['path', 'literalpath'], ITEM_PARAMS) === 'sink';
      if (isPathSink && !/variable:/i.test(arg.text)) continue;
      return `command '${cmd.text.replace(/\s+/g, ' ').trim()}' reaches variable-name sink -${param.parameterName} with an argument that cannot be statically evaluated (${describe(arg)}), so it cannot be proven not to write '${name}'`;
    }
  }
  // Positional name/path arguments of the sink cmdlets. A node that
  // immediately follows a non-switch CommandParameterAst (with no argument
  // of its own) is that parameter's argument, not a positional element.
  const SWITCH_PARAMS = ['force', 'passthru', 'recurse', 'append', 'nonewline', 'whatif', 'confirm', 'valueonly', 'verbose', 'debug', 'noenumerate'];
  const switchUniverse = VAR_COMMANDS.has(cmdName) ? VAR_CMD_PARAMS : (cmdName === 'tee-object' ? TEE_PARAMS : (ITEM_COMMANDS.has(cmdName) ? ITEM_PARAMS : [...COMMON_PARAMS, ...VAR_CMD_PARAMS, ...TEE_PARAMS, ...ITEM_PARAMS]));
  const isSwitch = (el) => paramBinding(el.parameterName ?? '', SWITCH_PARAMS, [...new Set(switchUniverse)]) === 'sink';
  const positional = [];
  {
    let expectArg = false;
    for (const el of tree.kids(cmd).slice(1)) {
      if (el.type === 'CommandParameterAst') { expectArg = tree.kids(el).length === 0 && !isSwitch(el); continue; }
      if (expectArg) { expectArg = false; continue; }
      if (el.type === 'VariableExpressionAst' && el.splatted) continue; // judged by the splat loop below
      positional.push(el);
    }
  }
  if (VAR_COMMANDS.has(cmdName) || cmdName === 'tee-object' || ITEM_COMMANDS.has(cmdName) || isDynamic) {
    for (const arg of positional) {
      if (tree.kids(arg).some((k) => k.type === 'CommandParameterAst')) continue;
      const value = staticValue(arg, tree);
      if (value !== null && (normalizedName(value) === normalizedName(name) || isVariableProviderPath(value, name))) {
        return `command '${cmd.text.replace(/\s+/g, ' ').trim()}' passes the name '${name}' positionally to a variable/item sink cmdlet`;
      }
      if (value === null && arg.type !== 'CommandExpressionAst') {
        // Only the first positional slot of a *-Variable / item cmdlet (or
        // of a dynamic command, which may be one) is its name/path.
        if (arg === positional[0] && (VAR_COMMANDS.has(cmdName) || ITEM_COMMANDS.has(cmdName) || isDynamic)) return `command '${cmd.text.replace(/\s+/g, ' ').trim()}' passes a non-statically-evaluable positional name to a *-Variable/item or dynamic cmdlet, so it cannot be proven not to write '${name}'`;
      }
    }
  }
  // Splatted argument bundles (@s): resolve the hashtable assignment and
  // judge its sink keys; an unresolvable splat is not proven clean (F7).
  for (const splat of desc.filter((n) => n.type === 'VariableExpressionAst' && n.splatted)) {
    if (isVarNamed(splat, name)) continue; // the remedy reference itself is judged by the output channel
    const entries = splatEntries(splat, tree);
    if (entries === null) {
      return `command '${cmd.text.replace(/\s+/g, ' ').trim()}' uses splatted argument bundle '${splat.text}', which cannot be statically evaluated, so it cannot be proven not to reach a variable-name sink for '${name}'`;
    }
    for (const [keyNode, valueNode] of entries) {
      const key = staticValue(keyNode, tree);
      if (key === null) return `command '${cmd.text.replace(/\s+/g, ' ').trim()}' uses splatted bundle '${splat.text}' with a non-statically-evaluable key, so it cannot be proven not to reach a variable-name sink for '${name}'`;
      const kind = (() => {
        const fake = { parameterName: key };
        const ks = [sinkKindForParam(fake, cmdName)];
        if (isDynamic && ['name', 'variable', 'path', 'literalpath'].includes(key.toLowerCase())) ks.push('sink');
        return ks.includes('sink') ? 'sink' : (ks.includes('ambiguous') ? 'ambiguous' : 'none');
      })();
      if (kind === 'none') continue;
      const value = staticValue(valueNode, tree);
      if (kind === 'ambiguous') return `command '${cmd.text.replace(/\s+/g, ' ').trim()}' uses splatted bundle '${splat.text}' with ambiguous key '${key}', which could bind to a variable-name sink for '${name}', so it cannot be proven clean`;
      if (value === null) return `command '${cmd.text.replace(/\s+/g, ' ').trim()}' uses splatted bundle '${splat.text}' reaching variable-name sink '${key}' with a value that cannot be statically evaluated, so it cannot be proven not to write '${name}'`;
      if (normalizedName(value) === normalizedName(name) || isVariableProviderPath(value, name)) {
        return `command '${cmd.text.replace(/\s+/g, ' ').trim()}' uses splatted bundle '${splat.text}' reaching variable-name sink '${key}' with the name '${name}'`;
      }
    }
  }
  // A [ref] argument aliases whatever variable it wraps.
  for (const conv of desc.filter((n) => n.type === 'ConvertExpressionAst' && /^\[ref\]/i.test(n.text.trim()))) {
    if (descendantsOf(conv, tree).some((n) => isVarNamed(n, name))) {
      return `command '${cmd.text.replace(/\s+/g, ' ').trim()}' passes [ref]$${name}, aliasing the variable`;
    }
    return `command '${cmd.text.replace(/\s+/g, ' ').trim()}' passes a [ref] argument (${describe(conv)}), which cannot be proven not to alias '${name}'`;
  }
  // Invoke-Expression executes its argument as code.
  if (cmdName === 'invoke-expression' || cmdName === 'iex') {
    const arg = positional[0] ?? null;
    const value = staticValue(arg, tree);
    if (value === null) return `Invoke-Expression with a non-statically-evaluable argument cannot be proven not to write '${name}'`;
    if (normalizedName(value) === normalizedName(name) || new RegExp(`\\b${name}\\b`, 'i').test(value)) return `Invoke-Expression argument mentions '${name}'`;
  }
  // Any remaining static mention of the exact name in a command element.
  for (const el of desc) {
    if (el.type !== 'StringConstantExpressionAst' && el.type !== 'ExpandableStringExpressionAst') continue;
    if (el === tree.kids(cmd)[0]) continue; // the command name itself
    const value = staticValue(el, tree);
    if (value !== null && (normalizedName(value) === normalizedName(name) || isVariableProviderPath(value, name))) {
      return `command '${cmd.text.replace(/\s+/g, ' ').trim()}' mentions the name '${name}' in ${describe(el)}, so it cannot be proven not to touch that variable`;
    }
  }
  return null;
}

// True when a member invocation touches `name`: a static name string in
// its target/arguments (e.g. $ExecutionContext.SessionState.PSVariable
// .Set('agentDocsOutput', ...)), or a Set/SetValue call whose name
// argument cannot be statically proven to be a different name.
function invokeMemberTouches(node, tree, name) {
  const desc = descendantsOf(node, tree);
  for (const el of desc) {
    if (el.type !== 'StringConstantExpressionAst' && el.type !== 'ExpandableStringExpressionAst') continue;
    const value = staticValue(el, tree);
    if (value !== null && (normalizedName(value) === normalizedName(name) || isVariableProviderPath(value, name))) return true;
  }
  const kids = tree.kids(node);
  const member = kids.length > 1 ? staticValue(kids[1], tree) : null;
  if (member !== null && ['set', 'setvalue'].includes(member.toLowerCase()) && kids.length > 2) {
    return staticValue(kids[2], tree) === null;
  }
  // [scriptblock]::Create('<code naming the guarded variable>') builds
  // executable code from an in-file string: judged by its content.
  if (member !== null && member.toLowerCase() === 'create') {
    for (const el of desc) {
      if (el.type !== 'StringConstantExpressionAst' && el.type !== 'ExpandableStringExpressionAst') continue;
      const value = staticValue(el, tree);
      if (value !== null && new RegExp(`\\b${name}\\b`, 'i').test(value)) return true;
    }
  }
  return false;
}

// True when an assignment's left side targets `name` in any spelling,
// including a member left side such as (Get-Variable remedy).Value.
function assignmentTargetsName(assignNode, tree, name) {
  const left = tree.kids(assignNode)[0];
  if (!left) return false;
  return descendantsOf(left, tree).some((n) =>
    isVarNamed(n, name) || ((n.type === 'StringConstantExpressionAst' || n.type === 'ExpandableStringExpressionAst') && staticString(n, tree) !== null && (normalizedName(staticString(n, tree)) === normalizedName(name) || isVariableProviderPath(staticString(n, tree), name))));
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

  // --- Phase 8 output channel: no $remedy reference outside the region. ---
  for (const n of all) {
    if (isVarNamed(n, 'remedy') && !tree.isWithin(n, regionBlock)) {
      violate(`output channel: remedy variable '${n.text}' is referenced outside the anchored step-4 remedy region (${describe(n)}); $remedy may be read or written only inside that region, so a second print or an indirect overwrite after the region is RED`);
    }
  }

  // --- Phase 8 indirect writes: CommandAst allowlist over the remedy name. ---
  for (const n of all) {
    if (n.type !== 'CommandAst') continue;
    const reason = commandTouchesName(n, tree, 'remedy');
    if (reason) violate(`indirect remedy write via command outside the allowlist: ${reason}; only the single 'Write-Host $remedy' inside the anchored step-4 remedy region may touch the remedy name`);
  }

  // --- Phase 9: member invocations naming $remedy outside the region. ---
  for (const n of all) {
    if (n.type === 'InvokeMemberExpressionAst' && !tree.isWithin(n, regionBlock) && invokeMemberTouches(n, tree, 'remedy')) {
      violate(`indirect remedy write via member invocation outside the allowlist: ${describe(n)} names 'remedy' in a member invocation (for example PSVariable.Set), which can overwrite $remedy after the region`);
    }
  }

  // --- Phase 8/9 input channel: the gate capture is the only write. ---
  const captures = {};
  for (const name of ['agentDocsOutput', 'agentDocsExit']) {
    const writes = [];
    for (const n of all) {
      if (!tree.isWithin(n, step4Block)) continue;
      if (n.type === 'AssignmentStatementAst' && assignmentTargetsName(n, tree, name)) writes.push(n);
      else if (n.type === 'CommandAst' && commandTouchesName(n, tree, name)) writes.push(n);
      else if (n.type === 'ConvertExpressionAst' && /^\[ref\]/i.test(n.text.trim()) && descendantsOf(n, tree).some((d) => isVarNamed(d, name))) writes.push(n);
      else if (n.type === 'InvokeMemberExpressionAst' && (descendantsOf(n, tree).some((d) => isVarNamed(d, name)) || invokeMemberTouches(n, tree, name))) writes.push(n);
      else if (n.type === 'UnaryExpressionAst' && descendantsOf(n, tree).some((d) => isVarNamed(d, name))) writes.push(n);
      else if (n.type === 'ForEachStatementAst' && tree.kids(n).length > 0 && isVarNamed(tree.kids(n)[0], name)) writes.push(n);
    }
    if (writes.length !== 1) {
      violate(`input channel: $${name} must be written exactly once in step 4 (the gate-output capture), found ${writes.length} write(s)${writes.length ? `: ${writes.map((w) => describe(w)).join('; ')}` : ''}; an extra write to $${name} in any form (assignment, +=, Set-/New-Variable, -OutVariable, Tee-Object -Variable, variable: path, [ref], scoped or braced spelling) can make a branch print the wrong remedy and is RED`);
    }
    const capture = writes[0];
    if (capture.type !== 'AssignmentStatementAst' || capture.operator !== 'Equals' || !isPlainVariable(tree.kids(capture)[0], name)) {
      violate(`input channel: the single write to $${name} in step 4 must be the plain gate-output capture assignment '$${name} = ...', got ${describe(capture)}`);
    }
    captures[name] = capture;
    const rhs = tree.kids(capture)[1];
    if (name === 'agentDocsOutput') {
      // F1: bind the actual invocation structure, not a substring.
      const pipe = rhs ? unwrap(rhs, tree) : null;
      const cmd = pipe && pipe.type === 'PipelineAst' && tree.kids(pipe).length === 1 ? tree.kids(pipe)[0] : null;
      const parts = cmd && cmd.type === 'CommandAst' ? tree.kids(cmd) : [];
      const ok = cmd && cmd.invocationOperator === 'Ampersand' && (cmd.commandName ?? '').toLowerCase() === 'node'
        && parts.length === 3 && parts[0].type === 'StringConstantExpressionAst' && parts[0].value === 'node'
        && parts[1].type === 'StringConstantExpressionAst' && parts[1].value === 'scripts/verify-agent-docs-fresh.mjs'
        && parts[2].type === 'MergingRedirectionAst' && parts[2].text.trim() === '2>&1';
      if (!ok) violate(`input channel: the single write to $agentDocsOutput must capture the gate output as the exact invocation '& node scripts/verify-agent-docs-fresh.mjs 2>&1' (Ampersand CommandAst 'node' with those two constant arguments and the 2>&1 redirection), got ${describe(capture)}; a literal or command that merely mentions the gate filename is RED`);
    }
    if (name === 'agentDocsExit' && !(rhs && unwrap(rhs, tree).type === 'VariableExpressionAst' && unwrap(rhs, tree).text === '$global:LASTEXITCODE')) {
      violate(`input channel: the single write to $agentDocsExit must capture the gate exit code ('$agentDocsExit = $global:LASTEXITCODE'), got ${describe(capture)}`);
    }
  }
  // F4: capture ordering and source -- the exit capture immediately
  // follows the output capture in the same block, with no intervening
  // $global:LASTEXITCODE write.
  {
    const outCap = captures.agentDocsOutput;
    const exitCap = captures.agentDocsExit;
    const block = tree.parent(outCap);
    if (!block || tree.parent(exitCap) !== block) violate(`input channel: capture ordering -- $agentDocsExit must be captured in the same statement block as $agentDocsOutput, immediately after it`);
    const siblings = tree.kids(block);
    if (siblings.indexOf(exitCap) !== siblings.indexOf(outCap) + 1) violate(`input channel: capture ordering -- $agentDocsExit = $global:LASTEXITCODE must immediately follow $agentDocsOutput = & node scripts/verify-agent-docs-fresh.mjs 2>&1 with no statement in between, so a '$global:LASTEXITCODE = 0' inserted between the gate execution and its capture cannot disable the guard`);
    for (const n of all) {
      if (n.type !== 'AssignmentStatementAst' || n.start <= outCap.start || n.start >= exitCap.start) continue;
      const left = tree.kids(n)[0];
      if (left && descendantsOf(left, tree).some((d) => d.type === 'VariableExpressionAst' && normalizedName(d.userPath) === 'lastexitcode')) violate(`input channel: capture ordering -- a $global:LASTEXITCODE write sits between the gate execution and $agentDocsExit capture: ${describe(n)}`);
    }
  }

  // --- Phase 11: positive structural boundary for step 4. ---
  // Replaces the phase-10 name/regex-based literal-output check, which the
  // independent review bypassed six ways (F1-F6, see the header). Inside
  // step 4 (outside the already-bound remedy region) the only permitted
  // console outputs are the banner, the gate-output echo (Write-Host $line
  // / Write-Host $line.ToString() inside the one bound echo loop) and, in
  // the region, 'Write-Host $remedy'. Every statement, command, member
  // invocation and read of a captured gate variable is judged against that
  // contract; anything unrecognized is RED with a named reason.
  {
    const OUTPUT_COMMANDS = new Set(['write-host', 'write-warning', 'write-output', 'write-error', 'write-information', 'write-verbose', 'write-debug', 'out-host', 'echo', 'oh']);
    const STEP4_COMMANDS = new Set(['write-host', 'push-location', 'pop-location', 'npm', 'node']);

    // (F5) Bind the echo loop: exactly one foreach inside step 4 may touch
    // the gate capture, and it must be exactly
    // `foreach ($line in @($agentDocsOutput))`, so the echoed lines are the
    // gate's own output and nothing else.
    const echoLoops = all.filter((n) => n.type === 'ForEachStatementAst' && tree.isWithin(n, step4Block) && !tree.isWithin(n, regionBlock) && descendantsOf(n, tree).some((d) => isVarNamed(d, 'agentDocsOutput')));
    if (echoLoops.length !== 1) violate(`literal output channel: expected exactly one gate-output echo loop ('foreach ($line in @($agentDocsOutput))') inside step 4, found ${echoLoops.length}; the echo loop is the only permitted consumer of the captured gate output, so a second loop over it (or none) is RED`);
    const echoLoop = echoLoops[0];
    const loopParts = tree.kids(echoLoop);
    if (loopParts.length !== 3 || !loopParts[0] || !isPlainVariable(loopParts[0], 'line')) violate(`literal output channel: the gate-output echo loop must iterate the plain variable $line ('foreach ($line in @($agentDocsOutput))'), got ${describe(echoLoop)}; a renamed loop variable breaks the binding between the echoed lines and the gate output`);
    const echoEnumerator = loopParts[1];
    {
      let e = echoEnumerator;
      const bad = () => violate(`literal output channel: the gate-output echo loop must enumerate exactly @($agentDocsOutput), got ${describe(echoEnumerator)}; any other enumerator (an extra element, a filtered copy, a different source) can put attacker text where the gate output belongs and is RED`);
      if (!e || e.type !== 'PipelineAst' || tree.kids(e).length !== 1) bad();
      e = unwrap(tree.kids(e)[0], tree);
      if (e.type !== 'ArrayExpressionAst') bad();
      const innerBlock = tree.kids(e);
      if (innerBlock.length !== 1 || innerBlock[0].type !== 'StatementBlockAst') bad();
      const innerStmts = tree.kids(innerBlock[0]);
      if (innerStmts.length !== 1 || innerStmts[0].type !== 'PipelineAst' || tree.kids(innerStmts[0]).length !== 1) bad();
      const enumVar = unwrap(tree.kids(innerStmts[0])[0], tree);
      if (!isPlainVariable(enumVar, 'agentDocsOutput')) bad();
    }

    // (F8) Bind the echo loop BODY, not just its shape: every statement in
    // it must be an echo Write-Host (arguments bound by the command
    // boundary below), the exact null-guard `if ($null -eq $line) {
    // continue }`, or the exact ErrorRecord dispatch `if ($line -is
    // [...ErrorRecord]) { Write-Host $line.ToString() } else { Write-Host
    // $line }`. Wrapping the body in `if ($false) { ... }` or filtering it
    // (`if ($line -match '...') { continue }`) keeps every other check
    // green while the gate output never reaches the console, so any other
    // body statement is RED.
    {
      const echoBody = loopParts[2];
      if (!echoBody || echoBody.type !== 'StatementBlockAst') violate(`literal output channel: the gate-output echo loop has no statement-block body, got ${describe(echoLoop)}`);
      const singleEchoCommand = (stmt) => stmt.type === 'PipelineAst' && tree.kids(stmt).length === 1 && tree.kids(stmt)[0].type === 'CommandAst';
      const echoBodyBad = (stmt) => violate(`literal output channel: echo loop body statement ${describe(stmt)} is not on the echo-body allowlist (an echo Write-Host, the exact 'if ($null -eq $line) { continue }' guard, or the exact ErrorRecord Write-Host dispatch); guarding or filtering the echo (for example 'if ($false) { ... }' or 'if ($line -match ...) { continue }') suppresses the gate output the remedy points at and is RED`);
      for (const stmt of tree.kids(echoBody)) {
        if (singleEchoCommand(stmt)) continue; // echo Write-Host, judged by the command boundary below
        if (stmt.type !== 'IfStatementAst' || stmt.clauseCount !== 1) echoBodyBad(stmt);
        const parts = tree.kids(stmt);
        const condEls = tree.kids(parts[0]);
        if (condEls.length !== 1) echoBodyBad(stmt);
        const cond = unwrap(condEls[0], tree);
        if (cond.type !== 'BinaryExpressionAst') echoBodyBad(stmt);
        const [cl, cr] = tree.kids(cond);
        const isNullGuard = cond.operator === 'Ieq' && !stmt.hasElse && cl && cr
          && ((isPlainVariable(cl, 'null') && isPlainVariable(cr, 'line')) || (isPlainVariable(cr, 'null') && isPlainVariable(cl, 'line')));
        if (isNullGuard) {
          const guardStmts = tree.kids(parts[1]);
          if (guardStmts.length !== 1 || guardStmts[0].type !== 'ContinueStatementAst') echoBodyBad(stmt);
          continue;
        }
        const isDispatch = cond.operator === 'Is' && stmt.hasElse && parts.length === 3 && cl && isPlainVariable(cl, 'line')
          && cr && cr.type === 'TypeExpressionAst' && /^\[(system\.management\.automation\.)?errorrecord\]$/i.test(cr.text.trim());
        if (isDispatch) {
          for (const body of [parts[1], parts[2]]) {
            const stmts = tree.kids(body);
            if (stmts.length !== 1 || !singleEchoCommand(stmts[0])) echoBodyBad(stmt);
          }
          continue;
        }
        echoBodyBad(stmt);
      }
    }

    // (F5) Nothing else may write $line: the echo loop variable is the only
    // writer, so a '$line = "..."' at the top of the loop (or another
    // foreach reusing $line) cannot replace the gate output being printed.
    for (const n of all) {
      if (!tree.isWithin(n, step4Block) || tree.isWithin(n, regionBlock)) continue;
      if (n.type === 'AssignmentStatementAst' && assignmentTargetsName(n, tree, 'line')) {
        violate(`literal output channel: ${describe(n)} writes $line inside step 4; the echo loop variable is the only permitted writer of $line, so a '$line = ...' rewrite inside the echo loop would replace the gate output with attacker text and is RED`);
      } else if (n.type === 'ForEachStatementAst' && n.id !== echoLoop.id && tree.kids(n)[0] && isVarNamed(tree.kids(n)[0], 'line')) {
        violate(`literal output channel: ${describe(n)} reuses $line as a loop variable inside step 4; the bound echo loop is the only permitted writer of $line, so this is RED`);
      } else if (n.type === 'UnaryExpressionAst' && descendantsOf(n, tree).some((d) => isVarNamed(d, 'line'))) {
        violate(`literal output channel: ${describe(n)} mutates $line inside step 4; the echo loop variable is the only permitted writer of $line`);
      } else if (n.type === 'ConvertExpressionAst' && /^\[ref\]/i.test(n.text.trim()) && descendantsOf(n, tree).some((d) => isVarNamed(d, 'line'))) {
        violate(`literal output channel: ${describe(n)} aliases $line through [ref] inside step 4; the echo loop variable is the only permitted writer of $line`);
      } else if (n.type === 'CommandAst' && commandTouchesName(n, tree, 'line')) {
        violate(`literal output channel: ${describe(n)} writes $line through a variable-name sink inside step 4; the echo loop variable is the only permitted writer of $line`);
      }
    }

    // (F2) Bind the reads of the captured gate variables: the only
    // permitted read positions are the capture's own left side, the
    // gate-exit test condition and the echo loop's enumerator. Any other
    // read -- in particular '$x = $agentDocsOutput', which takes a mutable
    // alias to the captured array -- is RED fail-closed, because an
    // in-place mutation through that alias ($x[0] = ..., $x.SetValue(...))
    // rewrites what the cause branches match while every write check on
    // $agentDocsOutput itself stays green.
    const gateCondition = tree.kids(gateTests[0])[0];
    for (const n of all) {
      if (n.type !== 'VariableExpressionAst') continue;
      if (!tree.isWithin(n, step4Block) || tree.isWithin(n, regionBlock)) continue;
      const which = isVarNamed(n, 'agentDocsOutput') ? 'agentDocsOutput' : (isVarNamed(n, 'agentDocsExit') ? 'agentDocsExit' : null);
      if (!which) continue;
      if (tree.isWithin(n, tree.kids(captures[which])[0])) continue; // the capture's own left side
      if (tree.isWithin(n, gateCondition)) continue; // if ($agentDocsExit -eq 0)
      if (tree.isWithin(n, echoEnumerator)) continue; // foreach ($line in @($agentDocsOutput))
      violate(`input channel: ${describe(n)} reads $${which} outside the three bound positions (the capture's own left side, the gate-exit test, the echo loop's enumerator); taking an alias to the captured gate output ('$x = $${which}') lets a later in-place mutation through the alias rewrite what the cause branches match, so any read outside those positions is RED`);
    }

    // (F7) Alias creation through the alias: DRIVE needs no command at all
    // ('$alias:zz = "Write-Host"'), so the command-name check cannot see
    // it: any assignment whose left side is an alias: provider path inside
    // step 4 is RED. Step 4 defines no aliases; an alias lets a later
    // 'zz ...' invocation smuggle an output command past the name check.
    for (const n of all) {
      if (n.type !== 'AssignmentStatementAst') continue;
      if (!tree.isWithin(n, step4Block) || tree.isWithin(n, regionBlock)) continue;
      const left = tree.kids(n)[0];
      if (left && left.type === 'VariableExpressionAst' && /^alias:/i.test(left.userPath ?? '')) {
        violate(`literal output channel: ${describe(n)} writes the alias: drive inside step 4; creating an alias ('$alias:zz = ...', Set-Alias/New-Alias/nal/sal, Set-Item alias:) redefines command resolution, so a later invocation cannot be proven not to be an output command in disguise -- RED`);
      }
    }

    // (F10) throw: the only throw allowed inside step 4 is the bound
    // npm-regeneration failure ('throw "npm run doc:agent exited with code
    // $LASTEXITCODE"'). The step-4 catch handler prints a thrown message
    // with its own prefix, so a throw carrying attacker text replaces the
    // operator-facing exception text (and skips the gate output and remedy
    // entirely) while every shape check stays green -- RED.
    for (const n of all) {
      if (n.type !== 'ThrowStatementAst') continue;
      if (!tree.isWithin(n, step4Block) || tree.isWithin(n, regionBlock)) continue;
      let ok = false;
      const tk = tree.kids(n);
      if (tk.length === 1 && tk[0].type === 'PipelineAst' && tree.kids(tk[0]).length === 1) {
        const expr = unwrap(tree.kids(tk[0])[0], tree);
        if (expr.type === 'ExpandableStringExpressionAst' && expr.value === 'npm run doc:agent exited with code $LASTEXITCODE') {
          const embedded = tree.kids(expr);
          ok = embedded.length === 1 && embedded[0].type === 'VariableExpressionAst' && (embedded[0].userPath ?? '').toLowerCase() === 'lastexitcode' && !embedded[0].splatted;
        }
      }
      if (!ok) violate(`literal output channel: ${describe(n)} inside step 4 is not the bound npm-regeneration failure throw ('throw "npm run doc:agent exited with code $LASTEXITCODE"'); the step-4 catch handler prints a thrown message with its own prefix, so a throw carrying attacker text replaces the operator-facing exception text and is RED`);
    }

    // (F1) Statement shapes: every statement inside step 4 is an
    // assignment, an if/foreach/try container, throw/continue/break, or a
    // single command judged by the command boundary below. A bare
    // expression statement (a string/array/subexpression literal or a bare
    // variable such as $msg) parses as a CommandExpressionAst pipeline and
    // writes its value to the console, so it is RED whatever words it
    // uses; so is a multi-element pipeline statement.
    const STEP4_BLOCKS = new Set(['StatementBlockAst', 'NamedBlockAst', 'ScriptBlockAst']);
    const STEP4_CONTAINERS = new Set(['IfStatementAst', 'ForEachStatementAst', 'TryStatementAst']);
    const STEP4_CONTROL = new Set(['ThrowStatementAst', 'ContinueStatementAst', 'BreakStatementAst']);
    // Only blocks that are actual control-flow bodies carry step-4
    // statements. A block inside an EXPRESSION (the @(...) array literal of
    // the echo enumerator, $(...)/(...) internals, a hashtable value) holds
    // expression elements, not executed statements; the enclosing statement
    // is what the allowlist judges, and the echo enumerator itself is bound
    // exactly by the echo-loop check above.
    const STEP4_BODY_PARENTS = new Set(['IfStatementAst', 'ForEachStatementAst', 'TryStatementAst', 'CatchClauseAst', 'NamedBlockAst', 'ScriptBlockAst']);
    for (const b of all) {
      if (!STEP4_BLOCKS.has(b.type)) continue;
      if (!tree.isWithin(b, step4Block) || tree.isWithin(b, regionBlock)) continue;
      const bp = tree.parent(b);
      if (b.id !== step4Block.id && !(bp && STEP4_BODY_PARENTS.has(bp.type))) continue;
      for (const stmt of tree.kids(b)) {
        if (tree.isWithin(stmt, regionBlock)) continue;
        if (stmt.type === 'AssignmentStatementAst' || STEP4_CONTAINERS.has(stmt.type) || STEP4_CONTROL.has(stmt.type)) continue;
        if (stmt.type === 'PipelineAst') {
          const els = tree.kids(stmt);
          if (els.length === 1 && els[0].type === 'CommandAst') continue; // judged by the command boundary below
          violate(`literal output channel: statement ${describe(stmt)} inside step 4 is a bare expression or a multi-element pipeline, whose value would be written to the console; the only statements on the step-4 allowlist are assignments, if/foreach/try containers, throw/continue/break and single allowlisted commands, so a bare literal, @(...), $(...) or a bare variable such as $msg inside step 4 is RED whatever words it uses`);
        }
        violate(`literal output channel: statement ${describe(stmt)} inside step 4 is not on the step-4 statement allowlist (assignments, if/foreach/try containers, throw/continue/break, or a single allowlisted command), so it is RED`);
      }
    }

    // (F4) Member invocations: the only InvokeMemberExpressionAst allowed
    // inside step 4 is the echo loop's $line.ToString(). A console write
    // through [Console]::WriteLine, $Host.UI.WriteLine or the same through
    // an aliased variable/type ('$c = [Console]; $c::WriteLine(...)') is
    // statically indistinguishable from a safe call, so fail closed.
    const isEchoToString = (n) => {
      const k = tree.kids(n);
      if (k.length !== 2 || !k[0] || !isPlainVariable(k[0], 'line')) return false;
      const member = staticValue(k[1], tree);
      return member !== null && member.toLowerCase() === 'tostring' && tree.isWithin(n, echoLoop);
    };
    for (const n of all) {
      if (n.type !== 'InvokeMemberExpressionAst') continue;
      if (!tree.isWithin(n, step4Block) || tree.isWithin(n, regionBlock)) continue;
      if (!isEchoToString(n)) {
        violate(`literal output channel: member invocation ${describe(n)} inside step 4 is not the echo loop's $line.ToString(); a console write through [Console]::WriteLine, $Host.UI.WriteLine or an aliased variable/type cannot be told apart from a safe call without running the code, so it is RED`);
      }
    }

    // (F3/F6/O-1..O-4) Command boundary: the invoked name (module qualifier
    // stripped, dynamic heads resolved statically) must be on the step-4
    // allowlist and carry its bound shape; output cmdlets are only the
    // banner and the exact echo; alias redefinition is RED. A command not on
    // the allowlist is RED whether or not its pipeline output is captured or
    // discarded: capture binds only the success stream, so a captured
    // Invoke-Expression/iex still executes attacker code, a captured
    // Set-Item/New-Item/Import-Alias can still create an alias: provider
    // entry, a captured Clear-Host still wipes the console, and a
    // terminating error from any unrecognized command routes its
    // attacker-chosen message to the step-4 catch handler (phase-12 review
    // findings O-1..O-4). There is no captured-or-discarded exemption.
    const captureRhs = tree.kids(captures.agentDocsOutput)[1];
    const capturePipe = captureRhs ? unwrap(captureRhs, tree) : null;
    const captureCmd = capturePipe && capturePipe.type === 'PipelineAst' && tree.kids(capturePipe).length === 1 ? tree.kids(capturePipe)[0] : null;
    for (const n of all) {
      if (n.type !== 'CommandAst') continue;
      if (!tree.isWithin(n, step4Block) || tree.isWithin(n, regionBlock)) continue;
      const cmdText = n.text.replace(/\s+/g, ' ').trim();
      const parts = tree.kids(n).filter((k) => !/RedirectionAst$/.test(k.type));
      let cn = (n.commandName ?? '').toLowerCase();
      if (!cn) {
        const resolved = parts.length > 0 ? staticValue(parts[0], tree) : null;
        if (resolved === null) violate(`literal output channel: dynamic command '${cmdText}' inside step 4 has no statically resolvable name, so it cannot be proven not to be an output command in disguise; every command invoked inside step 4 must resolve statically to the step-4 allowlist (the banner/echo Write-Host, Push-/Pop-Location, or the bound npm/node gate invocations)`);
        cn = resolved.toLowerCase();
      }
      // A module-qualified name is the same cmdlet: judge the bare name.
      if (cn.includes('\\')) cn = cn.slice(cn.lastIndexOf('\\') + 1);
      // Alias creation, in every command spelling (the built-in aliases
      // nal/sal included; the alias: drive and alias: provider paths are
      // covered by the sweeps above).
      if (['set-alias', 'new-alias', 'sal', 'nal'].includes(cn)) {
        violate(`literal output channel: '${cmdText}' redefines command resolution inside step 4, so a later invocation of the new alias cannot be proven not to be an output command in disguise; step 4 defines no aliases and any Set-Alias/New-Alias (or the nal/sal built-in aliases) inside it is RED`);
      }
      // Host-only channels that capture cannot suppress and step 4 never
      // legitimately uses: RED in every form, captured or not.
      if (['write-progress', 'read-host'].includes(cn)) {
        violate(`literal output channel: '${cmdText}' writes to a host-only channel inside step 4 (a progress record or an interactive prompt) that assigning to $null does not suppress, and step 4 never reports progress and never prompts, so this is RED in every form`);
      }
      for (const el of descendantsOf(n, tree)) {
        if (el.type !== 'StringConstantExpressionAst' && el.type !== 'ExpandableStringExpressionAst') continue;
        if (el === tree.kids(n)[0]) continue;
        const value = staticValue(el, tree);
        if (value !== null && /^alias::?/i.test(value.trim())) {
          violate(`literal output channel: command '${cmdText}' writes the alias: provider inside step 4 ('${value.trim()}'), which can redefine a later invocation as an output command, so it is RED`);
        }
      }
      // Capture binds the PIPELINE (success) stream only: '$null =
      // Write-Host "x"' still prints, which is why output cmdlets are
      // judged above. For the same reason capture never excuses an
      // unrecognized command: there is no captured-or-discarded
      // exemption (phase-12 review findings O-1..O-4).
      if (OUTPUT_COMMANDS.has(cn) && cn !== 'write-host') {
        violate(`literal output channel: output command '${cmdText}' writes to a host/output stream inside step 4 and is neither the step-4 banner nor the gate-output echo; inside step 4 the only console outputs on the allowlist are the banner, the echo (Write-Host $line) and 'Write-Host $remedy', so a literal or aliased output command inside step 4 is RED whatever words it uses`);
      }
      if (!STEP4_COMMANDS.has(cn)) {
        violate(`literal output channel: command '${cmdText}' is not on the step-4 command allowlist (the banner/echo Write-Host, 'Push-Location $RepoRoot', Pop-Location, the bound npm/node gate invocations); inside step 4 an unrecognized command is RED whether or not its pipeline output is captured or discarded, because capture binds only the success stream -- a captured Invoke-Expression/iex still executes attacker code, a captured Set-Item/New-Item/Import-Alias can still create an alias that redefines a later invocation as an output command, a captured Clear-Host still wipes the console, and a terminating error from the command routes its attacker-chosen message to the step-4 catch handler, replacing the gate output and the remedy; move the command out of step 4 or bind its exact shape on the allowlist`);
      }
      if (cn === 'write-host') {
        if (descendantsOf(n, tree).some((d) => d.id === banners[0].id)) {
          // The banner: the banner string plus an optional
          // -ForegroundColor <constant>, nothing else.
          if (parts.length < 2 || parts[1].type !== 'StringConstantExpressionAst' || parts[1].value !== '[4/4] Verifying generated agent documentation is fresh') {
            violate(`literal output channel: the step-4 banner Write-Host must print exactly the banner string constant, got '${cmdText}'`);
          }
          let i = 2;
          if (i < parts.length) {
            const param = parts[i];
            if (param.type !== 'CommandParameterAst' || (param.parameterName ?? '').toLowerCase() !== 'foregroundcolor') violate(`literal output channel: step-4 banner Write-Host parameter '${param.text}' is not on the allowlist; only -ForegroundColor may follow the banner string`);
            const arg = paramArgument(param, n, tree);
            if (!arg || (arg.type !== 'StringConstantExpressionAst' && arg.type !== 'ConstantExpressionAst')) violate(`literal output channel: the banner's -ForegroundColor must take a constant argument`);
            i += tree.kids(param).length > 0 ? 1 : 2;
          }
          if (i !== parts.length) violate(`literal output channel: the step-4 banner Write-Host has extra elements beyond '<banner string> [-ForegroundColor <constant>]', got '${cmdText}'`);
          continue;
        }
        if (tree.isWithin(n, echoLoop) && parts.length === 2) {
          const arg = parts[1];
          if (isPlainVariable(arg, 'line') || (arg.type === 'InvokeMemberExpressionAst' && isEchoToString(arg))) continue;
        }
        violate(`literal output channel: Write-Host '${cmdText}' inside step 4 is neither the step-4 banner nor the gate-output echo ('Write-Host $line' / 'Write-Host $line.ToString()' inside the bound echo loop); any other Write-Host inside step 4 -- literal, expandable or via another variable such as $msg -- can put a wrong remedy in front of the operator and is RED whatever words it uses`);
      }
      if (cn === 'npm') {
        const ok = n.invocationOperator === 'Ampersand' && parts.length === 3
          && parts[0].type === 'StringConstantExpressionAst' && parts[0].value === 'npm'
          && parts[1].type === 'StringConstantExpressionAst' && parts[1].value === 'run'
          && parts[2].type === 'StringConstantExpressionAst' && parts[2].value === 'doc:agent';
        if (!ok) violate(`literal output channel: the only npm invocation on the step-4 allowlist is the exact gate regeneration '& npm run doc:agent', got '${cmdText}'; any other npm command inside step 4 can print arbitrary text to the operator and is RED`);
        continue;
      }
      if (cn === 'node') {
        if (!captureCmd || n.id !== captureCmd.id) violate(`literal output channel: the only node invocation on the step-4 allowlist is the bound gate capture '& node scripts/verify-agent-docs-fresh.mjs 2>&1', got '${cmdText}'; a second node call (for example 'node -e ...') can print arbitrary text and is RED`);
        continue;
      }
      // Push-/Pop-Location: location scaffolding with exact bound shapes.
      // Unbound arguments are RED even here: Push-Location "<text>"
      // terminates (ErrorActionPreference = 'Stop') and the step-4 catch
      // handler prints the attacker-chosen path in its message, replacing
      // the gate output and the remedy (the O-2 channel through an
      // allowlisted command).
      if (cn === 'push-location') {
        if (parts.length !== 2 || !isPlainVariable(parts[1], 'RepoRoot')) violate(`literal output channel: the only Push-Location on the step-4 allowlist is exactly 'Push-Location $RepoRoot', got '${cmdText}'; any other argument can carry attacker text into a terminating error that the step-4 catch handler prints with its own prefix, replacing the gate output and the remedy -- RED`);
        continue;
      }
      if (cn === 'pop-location') {
        if (parts.length !== 1) violate(`literal output channel: the only Pop-Location on the step-4 allowlist takes no arguments, got '${cmdText}'`);
        continue;
      }
    }

    // (O-2 class; phase-13 review F1/F2/F4) Stores: inside step 4 an
    // assignment is bound on BOTH sides, not just its right side. The only
    // stores recognized are the two gate captures (bound exactly above),
    // '$global:LASTEXITCODE = 0' ahead of the capture and
    // '$agentDocsPassed = $true' in the gate-exit then branch. Binding only
    // the right side left the TARGET free: '$RepoRoot = "<text>"' feeds the
    // bound Push-Location, '$LASTEXITCODE = "<text>"' feeds the bound
    // throw's interpolation and '$ErrorActionPreference = ...' silences the
    // catch channel -- each re-arms the catch channel or rewrites bound
    // control flow with a plain store while every shape check stayed green
    // (measured, phase-13 review), so any other store is RED whatever it
    // assigns.
    for (const n of all) {
      if (n.type !== 'AssignmentStatementAst') continue;
      if (!tree.isWithin(n, step4Block) || tree.isWithin(n, regionBlock)) continue;
      if (n.id === captures.agentDocsOutput.id || n.id === captures.agentDocsExit.id) continue;
      const left = tree.kids(n)[0];
      const rhs = tree.kids(n)[1] ? unwrap(tree.kids(n)[1], tree) : null;
      const isExitReset = n.operator === 'Equals' && left && left.type === 'VariableExpressionAst' && !left.splatted && left.text === '$global:LASTEXITCODE'
        && rhs && rhs.type === 'ConstantExpressionAst' && rhs.value === '0';
      const isPassedFlag = n.operator === 'Equals' && left && isPlainVariable(left, 'agentDocsPassed')
        && rhs && rhs.type === 'VariableExpressionAst' && !rhs.splatted && (rhs.userPath ?? '') === 'true' && rhs.text === '$true';
      if (isExitReset || isPassedFlag) continue;
      violate(`literal output channel: store ${describe(n)} inside step 4 is not on the store allowlist (the two bound gate captures, '$global:LASTEXITCODE = 0', '$agentDocsPassed = $true'); a plain store to a variable a bound structure reads ('$RepoRoot = "<text>"' feeding Push-Location, '$LASTEXITCODE = "<text>"' feeding the bound throw's interpolation, $ErrorActionPreference silencing the catch channel) re-arms the catch channel with attacker text or rewrites bound control flow, so it is RED`);
    }

    // (Phase-13 review F3) Redirections: the command boundary judges exact
    // shapes, so a redirection must not be invisible to it. The only
    // redirection allowed inside step 4 is the gate capture's bound 2>&1;
    // any other is RED -- 'Write-Host $line 6>$null' suppresses the gate
    // output the remedy points at while every shape check stays green
    // (stream 6 carries Write-Host; measured, phase-13 review). Not every
    // redirection is harmful (2>$null was measured harmless) -- the rule is
    // fail-closed because no step-4 command needs one.
    for (const n of all) {
      if (!/RedirectionAst$/.test(n.type)) continue;
      if (!tree.isWithin(n, step4Block) || tree.isWithin(n, regionBlock)) continue;
      if (tree.isWithin(n, captures.agentDocsOutput)) continue; // the bound 2>&1
      violate(`literal output channel: redirection '${n.text.trim()}' inside step 4 is not the gate capture's bound 2>&1; a redirection on an allowlisted command (for example 'Write-Host $line 6>$null') can suppress the gate output the remedy points at while every shape check stays green, so it is RED`);
    }

    // (O-2 class) Containers: the only if/foreach structures recognized
    // inside step 4 are the bound npm-exit throw guard ('if
    // ($LASTEXITCODE -ne 0) { throw "npm run doc:agent exited with code
    // $LASTEXITCODE" }'), the anchored gate-exit test, the bound echo loop
    // and the echo-body guards (bound above). Any other if or foreach
    // evaluates an unbound condition or enumerator, which can execute an
    // arbitrary command ('foreach ($x in Get-Item "<text>") {}') or
    // terminate with an attacker-chosen message ('if ([datetime]"<text>")
    // {}') for the step-4 catch handler -- RED. try/catch/finally
    // scaffolding stays allowed: its blocks are judged recursively above.
    const isNpmGuard = (n) => {
      if (n.clauseCount !== 1 || n.hasElse) return false;
      const parts = tree.kids(n);
      if (parts.length !== 2) return false;
      const condEls = tree.kids(parts[0]);
      if (condEls.length !== 1) return false;
      const cond = unwrap(condEls[0], tree);
      if (cond.type !== 'BinaryExpressionAst' || cond.operator !== 'Ine') return false;
      const [cl, cr] = tree.kids(cond);
      if (!cl || !isPlainVariable(cl, 'LASTEXITCODE')) return false;
      const rv = cr ? unwrap(cr, tree) : null;
      if (!rv || rv.type !== 'ConstantExpressionAst' || rv.value !== '0') return false;
      const bodyStmts = tree.kids(parts[1]);
      return bodyStmts.length === 1 && bodyStmts[0].type === 'ThrowStatementAst';
    };
    for (const n of all) {
      if (!tree.isWithin(n, step4Block) || tree.isWithin(n, regionBlock)) continue;
      if (n.type === 'ForEachStatementAst' && n.id !== echoLoop.id) {
        violate(`literal output channel: ${describe(n)} is a foreach loop inside step 4 other than the bound gate-output echo loop; its enumerator is unbound and can execute a command or terminate with an attacker-chosen message for the step-4 catch handler, so it is RED`);
      }
      if (n.type !== 'IfStatementAst') continue;
      if (n.id === gateTests[0].id) continue; // the anchored gate-exit test
      if (tree.isWithin(n, echoLoop)) continue; // echo-body guards, bound above
      if (isNpmGuard(n)) continue;
      violate(`literal output channel: ${describe(n)} is an if statement inside step 4 that is none of the bound structures (the npm-exit throw guard, the anchored gate-exit test, the echo-body guards); its unbound condition can execute or terminate with an attacker-chosen message for the step-4 catch handler, so it is RED`);
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
    if (pattern !== BRANCH_PATTERNS[c][0]) violate(`branch order: clause ${c} must carry the '${BRANCH_PATTERNS[c][1]}' pattern ('${BRANCH_PATTERNS[c][0]}'), got '${pattern}' for '${exact[0][1]}'; branch order is bound so a future overlapping pattern cannot silently change which remedy a cause prints`);
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

// The echo loop in its real two-guard form (mirrors scripts/local-ci.ps1);
// phase 12 binds exactly these body shapes.
const ECHO_LOOP = [
  `foreach ($line in @($agentDocsOutput)) {`,
  `    if ($null -eq $line) { continue }`,
  `    if ($line -is [System.Management.Automation.ErrorRecord]) { Write-Host $line.ToString() }`,
  `    else { Write-Host $line }`,
  `}`,
].join('\n');

const SYNTHETIC = [
  `Write-Host "[4/4] Verifying generated agent documentation is fresh"`,
  `$agentDocsOutput = & node scripts/verify-agent-docs-fresh.mjs 2>&1`,
  `$agentDocsExit = $global:LASTEXITCODE`,
  ECHO_LOOP,
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

test('step-4 lock binds input, indirect/output channels and branch order (phase 8)', () => {
  const afterCapture = '$agentDocsExit = $global:LASTEXITCODE';
  const input = /input channel: \$agentDocs(?:Output|Exit) must be written exactly once/;
  const cases = [
    // (1) The measured input construction: append the cone needle after capture.
    ['input: += appends cone needle after capture', SYNTHETIC.replace(afterCapture, `${afterCapture}\nif ($agentDocsExit -ne 0) { $agentDocsOutput += " cone sparse-checkout" }`), input],
    ['input: plain reassignment of $agentDocsOutput', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$agentDocsOutput = "cone sparse-checkout"`), input],
    ['input: Set-Variable -Name agentDocsOutput', SYNTHETIC.replace(afterCapture, `${afterCapture}\nSet-Variable -Name agentDocsOutput -Value "cone sparse-checkout"`), input],
    ['input: -OutVariable agentDocsExit', SYNTHETIC.replace(afterCapture, `${afterCapture}\nWrite-Output "x" -OutVariable agentDocsExit`), input],
    ['input: braced ${agentDocsExit} reassignment', SYNTHETIC.replace(afterCapture, `${afterCapture}\n\${agentDocsExit} = 1`), input],
    ['input: scoped $script:agentDocsOutput reassignment', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$script:agentDocsOutput = "x"`), input],
    ['input: Tee-Object -Variable agentDocsOutput', SYNTHETIC.replace(afterCapture, `${afterCapture}\n"x" | Tee-Object -Variable agentDocsOutput`), input],
    ['input: Set-Content variable:agentDocsExit', SYNTHETIC.replace(afterCapture, `${afterCapture}\nSet-Content -Path variable:agentDocsExit -Value 1`), input],
    ['input: capture replaced by a literal', SYNTHETIC.replace('$agentDocsOutput = & node scripts/verify-agent-docs-fresh.mjs 2>&1', '$agentDocsOutput = "cone sparse-checkout"'), /input channel: the single write to \$agentDocsOutput must capture the gate output/],
    // (2) The measured output construction and its indirect-write family.
    ['output: Set-Variable remedy after region, then print', `${SYNTHETIC}\nSet-Variable -Name remedy -Value "clear --no-skip-worktree"\nWrite-Host $remedy`, /output channel:|indirect remedy write/],
    ['indirect: quoted Set-Variable -Name "remedy"', `${SYNTHETIC}\nSet-Variable -Name "remedy" -Value "x"`, /indirect remedy write/],
    ['indirect: dynamic Set-Variable -Name $n', `${SYNTHETIC}\n$n = "remedy"\nSet-Variable -Name $n -Value "x"`, /indirect remedy write/],
    ['indirect: New-Variable -Name remedy', `${SYNTHETIC}\nNew-Variable -Name remedy -Value "x" -Force`, /indirect remedy write/],
    ['indirect: -OutVariable remedy', `${SYNTHETIC}\nWrite-Output "x" -OutVariable remedy`, /indirect remedy write/],
    ['indirect: Tee-Object -Variable remedy', `${SYNTHETIC}\n"x" | Tee-Object -Variable remedy`, /indirect remedy write/],
    ['indirect: Set-Content variable:remedy', `${SYNTHETIC}\nSet-Content -Path variable:remedy -Value "x"`, /indirect remedy write/],
    ['indirect: alias clv remedy', `${SYNTHETIC}\nclv remedy -Force`, /indirect remedy write/],
    ['indirect: Invoke-Expression with dynamic argument', `${SYNTHETIC}\nInvoke-Expression $code`, /indirect remedy write/],
    ['output: second Write-Host $remedy after region', `${SYNTHETIC}\nWrite-Host $remedy`, /output channel:/],
    ['output: [ref]$remedy after region', `${SYNTHETIC}\n$rf = [ref]$remedy`, /output channel:/],
    ['output: Get-Variable remedy printed after region', `${SYNTHETIC}\nWrite-Host (Get-Variable remedy).Value`, /indirect remedy write/],
    // (4) Branch order is bound.
    ['order: cone and index-bit clauses swapped', SYNTHETIC.replace(`'(?s)cone sparse-checkout'`, `'@@INDEX@@'`).replace(`'(?s)skip-worktree or assume-unchanged'`, `'(?s)cone sparse-checkout'`).replace(`'@@INDEX@@'`, `'(?s)skip-worktree or assume-unchanged'`), /branch order:/],
  ];
  for (const [name, snippet, reason] of cases) {
    assert.throws(() => step4Remedies(snippet), reason, `case must be RED with its named reason: ${name}`);
  }
});

test('step-4 lock binds capture structure/order, dynamic commands, parameter binding, in-place mutation and splats (phase 9)', () => {
  const afterCapture = '$agentDocsExit = $global:LASTEXITCODE';
  const captureLine = '$agentDocsOutput = & node scripts/verify-agent-docs-fresh.mjs 2>&1';
  const input = /input channel: \$agentDocs(?:Output|Exit) must be written exactly once/;
  const cases = [
    // F1: a literal / other command that merely mentions the gate file.
    ['F1 literal mentioning gate filename', SYNTHETIC.replace(captureLine, '$agentDocsOutput = "verify-agent-docs-fresh.mjs cone sparse-checkout"'), /exact invocation '& node scripts\/verify-agent-docs-fresh\.mjs 2>&1'/],
    ['F1 wrong script argument mentioning gate filename in a comment-like string', SYNTHETIC.replace(captureLine, '$agentDocsOutput = & node scripts/other.mjs 2>&1'), /exact invocation/],
    ['F1 gate invocation without call operator', SYNTHETIC.replace(captureLine, '$agentDocsOutput = node scripts/verify-agent-docs-fresh.mjs 2>&1'), /exact invocation/],
    // F4: LASTEXITCODE reset between gate execution and exit capture.
    ['F4 $global:LASTEXITCODE=0 between captures', SYNTHETIC.replace(afterCapture, `$global:LASTEXITCODE = 0\n${afterCapture}`), /capture ordering/],
    ['F4 harmless statement between captures', SYNTHETIC.replace(afterCapture, `Write-Host "captured"\n${afterCapture}`), /capture ordering/],
    // F2: dynamic command invocation reaching a name sink.
    ['F2 & $cmd -Name $dn (Set-Variable via variables)', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$cmd = 'Set-Variable'; $dn = 'agentDocsOutput'; & $cmd -Name $dn -Value 'cone sparse-checkout'`), input],
    ['F2 & $cmd -Name $dn for remedy', `${SYNTHETIC}\n$cmd = 'Set-Variable'; $dn = 'remedy'; & $cmd -Name $dn -Value 'x'`, /indirect remedy write/],
    // F3: abbreviated parameters with indirect (variable) arguments.
    ['F3 -OutV $dn', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$dn = 'agentDocsOutput'; Write-Output 'cone sparse-checkout' -OutV $dn`), input],
    ['F3 Tee-Object -Var $dn', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$dn = 'agentDocsOutput'; 'cone sparse-checkout' | Tee-Object -Var $dn`), input],
    ['F3 ambiguous -Ou $dn', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$dn = 'agentDocsOutput'; Write-Output 'x' -Ou $dn`), /ambiguous parameter -Ou/],
    ['F3 abbreviated -OutV remedy via $dn', `${SYNTHETIC}\n$dn = 'remedy'; Write-Output 'x' -OutV $dn`, /indirect remedy write/],
    // F5: in-place mutation through InvokeMemberExpressionAst.
    ['F5 $agentDocsOutput.SetValue(...)', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$agentDocsOutput.SetValue('cone sparse-checkout',0)`), input],
    ['F5 $agentDocsExit member call', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$agentDocsOutput.ToString()`), /input channel: \$agentDocsOutput must be written exactly once/],
    // F7: splatted sink and statically resolved variable: path.
    ['F7 splat @{OutVariable=agentDocsOutput}', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$s = @{ OutVariable = 'agentDocsOutput' }; Write-Output 'cone sparse-checkout' @s`), input],
    ['F7 splat @{OutVariable=remedy}', `${SYNTHETIC}\n$s = @{ OutVariable = 'remedy' }; Write-Output 'x' @s`, /indirect remedy write/],
    ['F7 unresolvable splat', SYNTHETIC.replace(afterCapture, `${afterCapture}\nWrite-Output 'x' @unknownSplat`), /indirect remedy write|input channel/],
    ['F7 Set-Item $p where $p is variable:agentDocsOutput', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$p = 'variable:agentDocsOutput'; Set-Item $p 'cone sparse-checkout'`), input],
    ['F7 Set-Item $p where $p is variable:remedy', `${SYNTHETIC}\n$p = 'variable:remedy'; Set-Item $p 'x'`, /indirect remedy write/],
    // Independent-review additions (same channels, other AST shapes).
    ['review: --$agentDocsExit unary write', SYNTHETIC.replace(afterCapture, `${afterCapture}\n--$agentDocsExit`), input],
    ['review: foreach loop variable overwrites $agentDocsOutput', SYNTHETIC.replace(afterCapture, `${afterCapture}\nforeach ($agentDocsOutput in @('cone sparse-checkout')) {}`), input],
    ['review: PSVariable.Set with string name (input)', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$ExecutionContext.SessionState.PSVariable.Set('agentDocsOutput', 'cone sparse-checkout')`), input],
    ['review: PSVariable.Set with string name (remedy)', `${SYNTHETIC}\n$ExecutionContext.SessionState.PSVariable.Set('remedy', 'x')`, /indirect remedy write via member invocation/],
    ['review: splat bundle mutated after assignment', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$s = @{}; $s.Add('OutVariable', 'agentDocsOutput'); Write-Output 'cone sparse-checkout' @s`), /indirect remedy write|input channel/],
    ['review: abbreviated switch -For consumes no argument (Set-Variable)', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$dn = 'agentDocsOutput'; Set-Variable -For $dn 'cone sparse-checkout'`), input],
    ['review: [scriptblock]::Create naming the input', SYNTHETIC.replace(afterCapture, `${afterCapture}\n& ([scriptblock]::Create('$agentDocsOutput = "cone sparse-checkout"'))`), input],
    ['review: [scriptblock]::Create naming the remedy', `${SYNTHETIC}\nInvoke-Command -ScriptBlock ([scriptblock]::Create('Set-Variable remedy x'))`, /indirect remedy write via member invocation/],
  ];
  for (const [name, snippet, reason] of cases) {
    assert.throws(() => step4Remedies(snippet), reason, `case must be RED with its named reason: ${name}`);
  }
});

test('step-4 lock binds the literal output channel inside step 4 (phase 10)', () => {
  const afterCapture = '$agentDocsExit = $global:LASTEXITCODE';
  const literal = /literal output channel/;
  const cases = [
    ['literal Write-Host wrong remedy after capture', SYNTHETIC.replace(afterCapture, `${afterCapture}\nWrite-Host "docs-agent is stale: run npm run doc:agent"`), literal],
    ['literal Write-Warning wrong remedy after capture', SYNTHETIC.replace(afterCapture, `${afterCapture}\nWrite-Warning "docs-agent is stale: run npm run doc:agent"`), literal],
    ['[Console]::WriteLine wrong remedy after capture', SYNTHETIC.replace(afterCapture, `${afterCapture}\n[Console]::WriteLine("docs-agent is stale: run npm run doc:agent")`), literal],
    ['[System.Console]::WriteLine wrong remedy after capture', SYNTHETIC.replace(afterCapture, `${afterCapture}\n[System.Console]::WriteLine("docs-agent is stale")`), literal],
    ['indirect literal via $msg printed in step 4', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$msg = "docs-agent is stale: run npm run doc:agent"\nWrite-Host $msg`), literal],
    ['literal Write-Host before the remedy region', SYNTHETIC.replace('if ($agentDocsExit -eq 0)', 'Write-Host "docs-agent is stale: run npm run doc:agent"\nif ($agentDocsExit -eq 0)'), literal],
    ['alias oh (Out-Host) wrong remedy after capture', SYNTHETIC.replace(afterCapture, `${afterCapture}\noh "docs-agent is stale: run npm run doc:agent"`), literal],
    ['$Host.UI.WriteLine wrong remedy after capture', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$Host.UI.WriteLine("docs-agent is stale: run npm run doc:agent")`), literal],
    ['dynamic & $cmd resolving to Write-Host', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$cmd = 'Write-Host'; & $cmd "docs-agent is stale: run npm run doc:agent"`), literal],
    ['dynamic & $cmd with unresolved name and literal argument', SYNTHETIC.replace(afterCapture, `${afterCapture}\n& $unknownCmd "docs-agent is stale: run npm run doc:agent"`), literal],
  ];
  for (const [name, snippet, reason] of cases) {
    assert.throws(() => step4Remedies(snippet), reason, `case must be RED with its named reason: ${name}`);
  }
  // Green controls: the same literal OUTSIDE step 4 (after the try block
  // that step4Block anchors to, or in its catch) is legitimate operator
  // output for other steps and stays green; step 4's own banner, gate-
  // output echo and remedy print are the only outputs inside step 4.
  const trySynthetic = `try {\n${SYNTHETIC}\n} catch { Write-Host "step 4 failed" }`;
  assert.equal(step4Remedies(trySynthetic).cone, 'sparse-checkout reapply');
  const outsideLiteral = `${trySynthetic}\nWrite-Host 'docs-agent gate failed; re-read the gate output before re-running'`;
  assert.equal(step4Remedies(outsideLiteral).cone, 'sparse-checkout reapply');
});

test('step-4 lock stays green on harmless control probes (phase 8)', () => {
  // Reworded remedy text: only the real file's texts are pinned, by the
  // signature test above; a synthetic rewording must still parse clean.
  const reworded = SYNTHETIC.replace('$remedy = "sparse-checkout reapply"', '$remedy = "reapply the sparse checkout, then re-run"');
  assert.equal(step4Remedies(reworded).cone, 'reapply the sparse checkout, then re-run');
  // A new comment inside a branch body, mentioning another branch's needle.
  const commented = SYNTHETIC.replace('$remedy = "sparse-checkout reapply"', '# not the skip-worktree or assume-unchanged branch\n$remedy = "sparse-checkout reapply"');
  assert.equal(step4Remedies(commented).cone, 'sparse-checkout reapply');
  // A comment mentioning a needle outside any branch.
  assert.equal(step4Remedies(`# cone sparse-checkout\n${SYNTHETIC}`).cone, 'sparse-checkout reapply');
  // Phase 9 harmless controls: a known clean splat (no sink key), a
  // dynamic command with only non-sink named arguments, and a literal
  // operator message that touches neither $remedy nor its name. The
  // literal case documents the measured, explicitly rejected gap (a):
  // remedy-looking TEXT without the remedy variable is not judged.
  // Phase 13 note: the strict positive command allowlist judges every
  // command INSIDE step 4, captured or not, so `$null = Get-Date @style`
  // inside step 4 is now RED (see the phase-13 test). The benign-splat
  // controls therefore live OUTSIDE step 4 (after the try/catch that
  // step4Block anchors to), where the file-wide remedy-name sink sweep
  // still exercises the same splat-resolution path as before.
  const cleanSplat = `try {\n${SYNTHETIC}\n} catch {}\n$style = @{ ForegroundColor = 'Green' }; $null = Get-Date @style`;
  assert.equal(step4Remedies(cleanSplat).cone, 'sparse-checkout reapply');
  // A literal operator message INSIDE step 4 is now RED (literal output
  // channel below); the same literal outside step 4 stays green -- see
  // the phase-10 test. This replaces the phase-9 measured gap (a), which
  // accepted the inside-step-4 literal as an explicitly rejected gap.
  // A clean splat on a dynamic command and an [ordered] clean splat are
  // resolved, not rejected (independent-review controls).
  const dynamicSplat = `try {\n${SYNTHETIC}\n} catch {}\n$validatorArgs = @{ BaseCommit = 'main' }; & $Validator @validatorArgs`;
  assert.equal(step4Remedies(dynamicSplat).cone, 'sparse-checkout reapply');
  const orderedSplat = `try {\n${SYNTHETIC}\n} catch {}\n$style = [ordered]@{ ForegroundColor = 'Green' }; $null = Get-Date @style`;
  assert.equal(step4Remedies(orderedSplat).cone, 'sparse-checkout reapply');
});

test('step-4 lock closes the phase-10 bypasses with a positive structural boundary (phase 11)', () => {
  const afterCapture = '$agentDocsExit = $global:LASTEXITCODE';
  const echoLoop = ECHO_LOOP;
  const literal = /literal output channel/;
  const input = /input channel/;
  // Every case below was measured GREEN by the independent review of
  // phases 9-10 while the real verbatim step-4 chain printed a wrong
  // remedy (review of 41e30a09..cb84b80e, verdict fail). Each must now be
  // RED with its named reason.
  const cases = [
    // F1: bare expression statements are not CommandAst, yet write to the
    // console.
    ['F1 bare string literal statement', SYNTHETIC.replace(afterCapture, `${afterCapture}\n"docs-agent is stale: run npm run doc:agent"`), literal],
    ['F1 bare array literal statement', SYNTHETIC.replace(afterCapture, `${afterCapture}\n@("docs-agent is stale: run npm run doc:agent")`), literal],
    ['F1 bare subexpression statement', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$("docs-agent is stale: run npm run doc:agent")`), literal],
    ['F1 bare variable statement via $msg', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$msg = "docs-agent is stale: run npm run doc:agent"\n$msg`), literal],
    // F2: an alias to the captured gate output makes the in-place mutation
    // bypass possible; taking the alias is RED, fail-closed.
    ['F2 aliased index write through $x', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$x = $agentDocsOutput\n$x[0] = "cone sparse-checkout"`), input],
    ['F2 aliased SetValue through $x', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$x = $agentDocsOutput\n$x.SetValue("cone sparse-checkout", 0)`), input],
    ['F2 aliased read of $agentDocsExit', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$e = $agentDocsExit`), input],
    // F3: command-name allowlist evasions.
    ['F3 module-qualified Write-Host', SYNTHETIC.replace(afterCapture, `${afterCapture}\nMicrosoft.PowerShell.Utility\\Write-Host "docs-agent is stale: run npm run doc:agent"`), literal],
    ['F3 Set-Alias zz Write-Host, then invoke alias', SYNTHETIC.replace(afterCapture, `${afterCapture}\nSet-Alias zz Write-Host\nzz "docs-agent is stale: run npm run doc:agent"`), literal],
    ['F3 New-Alias zz Write-Host, then invoke alias', SYNTHETIC.replace(afterCapture, `${afterCapture}\nNew-Alias zz Write-Host\nzz "docs-agent is stale: run npm run doc:agent"`), literal],
    ['F3 alias: provider write', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$null = Set-Item alias:zz Write-Host`), literal],
    // F4: console writes through a type/object alias.
    ['F4 [Console] via type-literal alias', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$c = [Console]\n$c::WriteLine("docs-agent is stale: run npm run doc:agent")`), literal],
    ['F4 $Host via variable alias', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$h = $Host\n$h.UI.WriteLine("docs-agent is stale: run npm run doc:agent")`), literal],
    // F5: the echo must print the gate's own lines, bound to the capture.
    ['F5 echo-loop body rewrite ($line = ...)', SYNTHETIC.replace(echoLoop, `foreach ($line in @($agentDocsOutput)) { $line = "docs-agent is stale: run npm run doc:agent"\n  Write-Host $line }`), literal],
    ['F5 echo with attacker text around $line', SYNTHETIC.replace(echoLoop, `foreach ($line in @($agentDocsOutput)) { Write-Host "docs-agent is stale: $line" }`), literal],
    ['F5 second foreach over the gate output', `${SYNTHETIC}\nforeach ($row in @($agentDocsOutput)) { Write-Host $row }`, literal],
    ['F5 echo enumerator widened with an extra element', SYNTHETIC.replace(echoLoop, `foreach ($line in @($agentDocsOutput) + @("docs-agent is stale: run npm run doc:agent")) { Write-Host $line }`), literal],
    ['F5 echo loop variable renamed', SYNTHETIC.replace(echoLoop, `foreach ($row in @($agentDocsOutput)) { Write-Host $row }`), literal],
    ['F5 $line written by a second loop', SYNTHETIC.replace(afterCapture, `${afterCapture}\nforeach ($line in @("docs-agent is stale: run npm run doc:agent")) { }`), literal],
    // F6: not-listed console cmdlets are closed for free by the positive
    // boundary (uncaptured, not on the step-4 allowlist).
    ['F6 Write-Progress inside step 4', SYNTHETIC.replace(afterCapture, `${afterCapture}\nWrite-Progress -Status "docs-agent is stale: run npm run doc:agent"`), literal],
    // Same positive boundary: uncaptured output of an innocent-looking
    // cmdlet is console output too.
    ['boundary: uncaptured Get-Date -Format wrong advice', SYNTHETIC.replace(afterCapture, `${afterCapture}\nGet-Date -Format "docs-agent is stale: run npm run doc:agent"`), literal],
    ['boundary: banner Write-Host carrying an extra payload line', SYNTHETIC.replace('Write-Host "[4/4] Verifying generated agent documentation is fresh"', `Write-Host "[4/4] Verifying generated agent documentation is fresh" "docs-agent is stale: run npm run doc:agent"`), literal],
    ['boundary: second node invocation', SYNTHETIC.replace(afterCapture, `${afterCapture}\n& node "scripts/print-wrong-remedy.mjs"`), literal],
  ];
  for (const [name, snippet, reason] of cases) {
    assert.throws(() => step4Remedies(snippet), reason, `case must be RED with its named reason: ${name}`);
  }
  // Green controls: the same constructions OUTSIDE step 4 are legitimate
  // operator output and stay green (the documented boundary). A
  // captured/discarded unknown command stays green only OUTSIDE step 4:
  // inside step 4 the strict positive allowlist rejects it captured or
  // not (phase 13 -- the phase-12 review measured the capture exemption
  // green with attacker text, findings O-1..O-4).
  const outsideBareLiteral = `try {\n${SYNTHETIC}\n} catch {}\n"docs-agent is stale: run npm run doc:agent"`;
  assert.equal(step4Remedies(outsideBareLiteral).cone, 'sparse-checkout reapply');
  const capturedUnknown = `try {\n${SYNTHETIC}\n} catch {}\n$null = Get-Date -Format "docs-agent is stale: run npm run doc:agent"`;
  assert.equal(step4Remedies(capturedUnknown).cone, 'sparse-checkout reapply');
  // The real file's fuller echo loop (ErrorRecord branch with
  // $line.ToString(), null-guard with continue) stays green -- covered by
  // the signature test over the real source above.
});

test('step-4 lock closes the phase-11 review follow-up findings (phase 12)', () => {
  const afterCapture = '$agentDocsExit = $global:LASTEXITCODE';
  const literal = /literal output channel/;
  // The phase-11 independent review (VERDICT: hold) measured each of these
  // GREEN on the real mutated file with attacker text on the console; each
  // must now be RED with a named reason.
  const cases = [
    // F7: alias creation in its remaining spellings (the command-name check
    // only saw the literal 'set-alias'/'new-alias').
    ['F7 built-in alias nal (New-Alias)', SYNTHETIC.replace(afterCapture, `${afterCapture}\nnal zz Write-Host\nzz "docs-agent is stale: run npm run doc:agent"`), literal],
    ['F7 built-in alias sal (Set-Alias)', SYNTHETIC.replace(afterCapture, `${afterCapture}\nsal zz Write-Host\nzz "docs-agent is stale: run npm run doc:agent"`), literal],
    ['F7 alias: drive assignment', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$alias:zz = 'Write-Host'\nzz "docs-agent is stale: run npm run doc:agent"`), literal],
    ['F7 Set-Item alias: provider path', SYNTHETIC.replace(afterCapture, `${afterCapture}\nSet-Item alias:zz Write-Host\nzz "docs-agent is stale: run npm run doc:agent"`), literal],
    ['F7 captured Set-Item alias: provider path', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$null = Set-Item alias:zz Write-Host\n$null = zz "docs-agent is stale: run npm run doc:agent"`), literal],
    ['F7 alias detour in a nested finally', `${SYNTHETIC}\ntry { }\nfinally { sal qq Write-Host\nqq "docs-agent is stale: run npm run doc:agent" }`, literal],
    // F8: echo reachability -- the gate output must actually be printed.
    ['F8 echo body wrapped in if ($false)', SYNTHETIC.replace(ECHO_LOOP, `foreach ($line in @($agentDocsOutput)) {\n    if ($false) { Write-Host $line }\n}`), literal],
    ['F8 echo filtered by a match-continue guard', SYNTHETIC.replace(ECHO_LOOP, `foreach ($line in @($agentDocsOutput)) {\n    if ($line -match 'stale') { continue }\n    Write-Host $line\n}`), literal],
    ['F8 null-guard with an added else', SYNTHETIC.replace('if ($null -eq $line) { continue }', 'if ($null -eq $line) { continue } else { continue }'), literal],
    ['F8 ErrorRecord dispatch without the else echo', SYNTHETIC.replace(`    else { Write-Host $line }\n`, ''), literal],
    // F9: host-only channels are RED in every form, captured or not.
    ['F9 captured Write-Progress', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$null = Write-Progress -Status "docs-agent is stale: run npm run doc:agent"`), literal],
    ['F9 captured Read-Host prompt', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$null = Read-Host -Prompt "docs-agent is stale: run npm run doc:agent"`), literal],
    // F10: an attacker-text throw is printed by the step-4 catch handler
    // with its own prefix, replacing the operator-facing exception text.
    ['F10 throw with attacker text', SYNTHETIC.replace(afterCapture, `${afterCapture}\nthrow "docs-agent is stale: run npm run doc:agent"`), literal],
    ['F10 throw a different constant', SYNTHETIC.replace(afterCapture, `${afterCapture}\nthrow 'docs-agent is stale'`), literal],
  ];
  for (const [name, snippet, reason] of cases) {
    assert.throws(() => step4Remedies(snippet), reason, `case must be RED with its named reason: ${name}`);
  }
  // Green controls: the real throw (bound npm-regeneration failure) and the
  // real two-guard echo body stay green. SYNTHETIC does not run npm, so add
  // the real throw shape explicitly.
  const withRealThrow = SYNTHETIC.replace(afterCapture, `${afterCapture}\n& npm run doc:agent\nif ($LASTEXITCODE -ne 0) { throw "npm run doc:agent exited with code $LASTEXITCODE" }`);
  assert.equal(step4Remedies(withRealThrow).cone, 'sparse-checkout reapply');
});

test('step-4 lock closes the phase-12 review follow-up findings (phase 13)', () => {
  const afterCapture = '$agentDocsExit = $global:LASTEXITCODE';
  const literal = /literal output channel/;
  // The phase-12 independent review (VERDICT: hold) measured each O-1..O-4
  // construction GREEN on the real mutated file with attacker text on the
  // verbatim step-4 chain; each must now be RED with a named reason. The
  // root fix is structural: no captured-or-discarded exemption, exact bound
  // shapes for every allowlisted command, store-only assignment right
  // sides, and bound if/foreach containers.
  const cases = [
    // O-1: alias creation through a variable or constructed provider path
    // (the alias: sweep only saw string literals) and through Import-Alias.
    ['O-1 Set-Item via variable alias: path', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$p = 'alias:zz'\n$null = Set-Item $p Write-Host\n$null = zz "docs-agent is stale: run npm run doc:agent"`), literal],
    ['O-1 Set-Item -Path via variable alias: path', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$p = 'alias:zz'\n$null = Set-Item -Path $p -Value Write-Host`), literal],
    ['O-1 New-Item -Path via variable alias: path', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$p = 'alias:zz'\n$null = New-Item -Path $p -Value Write-Host`), literal],
    ['O-1 New-Item -Path via constructed alias: path', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$null = New-Item -Path ('ali' + 'as:zz') -Value Write-Host`), literal],
    ['O-1 Import-Alias from a CSV', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$null = Import-Alias -Path 'aliases.csv' -Force`), literal],
    // O-2: the catch channel via a terminating cmdlet error (throw binding
    // alone did not close it).
    ['O-2 captured Get-Item terminating error', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$null = Get-Item -LiteralPath "docs-agent is stale, run npm run doc:agent"`), literal],
    // O-3: captured code execution.
    ['O-3 captured Invoke-Expression', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$null = Invoke-Expression 'Write-Host "docs-agent is stale: run npm run doc:agent"'`), literal],
    ['O-3 captured iex', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$null = iex 'Write-Host "docs-agent is stale: run npm run doc:agent"'`), literal],
    // O-4: captured host effects.
    ['O-4 captured Clear-Host', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$null = Clear-Host`), literal],
    ['O-4 captured dot-source', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$null = . './zz.ps1'`), literal],
    // Same harm class (catch channel), closed by the new bindings rather
    // than left for the next review round: a converting assignment right
    // side, a captured-command right side, an unbound if condition, an
    // unbound foreach, and attacker text through an allowlisted command
    // whose shape was not previously bound.
    ['O-2 class: converting assignment RHS', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$x = [datetime]"docs-agent is stale, run npm run doc:agent"`), literal],
    ['O-2 class: captured command assignment RHS', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$x = Get-Date`), literal],
    ['O-2 class: unbound if condition', SYNTHETIC.replace(afterCapture, `${afterCapture}\nif ([datetime]'docs-agent is stale') { }`), literal],
    ['O-2 class: unbound foreach enumerator', SYNTHETIC.replace(afterCapture, `${afterCapture}\nforeach ($x in 1..2) { }`), literal],
    ['O-2 class: Push-Location with attacker path', SYNTHETIC.replace(afterCapture, `${afterCapture}\nPush-Location "docs-agent is stale, run npm run doc:agent"`), literal],
    ['O-2 class: Pop-Location with arguments', SYNTHETIC.replace(afterCapture, `${afterCapture}\nPop-Location -StackName zz`), literal],
    // The capture exemption is gone for benign-looking commands too.
    ['boundary: captured Get-Date -Format inside step 4', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$null = Get-Date -Format "docs-agent is stale: run npm run doc:agent"`), literal],
    ['boundary: captured benign splat inside step 4', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$style = @{ ForegroundColor = 'Green' }\n$null = Get-Date @style`), literal],
  ];
  for (const [name, snippet, reason] of cases) {
    assert.throws(() => step4Remedies(snippet), reason, `case must be RED with its named reason: ${name}`);
  }
  // Green control: the real file's full step-4 structure -- banner with
  // -ForegroundColor, Push-Location $RepoRoot, the nested try/finally with
  // Pop-Location, the npm-exit throw guard, the $global:LASTEXITCODE reset,
  // the bound captures and echo loop -- stays green.
  const realShapes = `${SYNTHETIC.replace('Write-Host "[4/4] Verifying generated agent documentation is fresh"',
    'Write-Host "[4/4] Verifying generated agent documentation is fresh" -ForegroundColor Cyan\nPush-Location $RepoRoot\ntry {\n& npm run doc:agent\nif ($LASTEXITCODE -ne 0) { throw "npm run doc:agent exited with code $LASTEXITCODE" }\n$global:LASTEXITCODE = 0')}\n} finally {\nPop-Location\n}`;
  assert.equal(step4Remedies(realShapes).cone, 'sparse-checkout reapply');
});

test('step-4 lock closes the phase-13 review follow-up findings (phase 14)', () => {
  const afterCapture = '$agentDocsExit = $global:LASTEXITCODE';
  const literal = /literal output channel/;
  // The phase-13 independent review (VERDICT: fail) measured each of these
  // GREEN on the full suite with console harm on the verbatim step-4 chain;
  // each must now be RED with a named reason.
  const cases = [
    // F1/F2: the store target was unbound, so a plain store re-armed the
    // catch channel through a bound structure's variable.
    ['F1 store to $RepoRoot feeds bound Push-Location', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$RepoRoot = "docs-agent is stale: run npm run doc:agent"`), literal],
    ['F2 store to $LASTEXITCODE feeds the bound throw', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$LASTEXITCODE = "docs-agent is stale: run npm run doc:agent"`), literal],
    ['F2b $global:LASTEXITCODE store with a non-zero value', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$global:LASTEXITCODE = "docs-agent is stale"`), literal],
    // F4: a preference-variable store silences the catch channel.
    ['F4 $ErrorActionPreference store inside step 4', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$ErrorActionPreference = 'SilentlyContinue'`), literal],
    // Any other store target, however benign the right side.
    ['store to an ordinary variable', SYNTHETIC.replace(afterCapture, `${afterCapture}\n$x = 'alias:zz'`), literal],
    // F3: redirections were invisible to the shape checks; stream 6 carries
    // Write-Host, so the echo could be discarded while staying "bound".
    ['F3 echo Write-Host $line 6>$null', SYNTHETIC.replace('else { Write-Host $line }', 'else { Write-Host $line 6>$null }'), literal],
    ['F3 echo Write-Host $line.ToString() 6>$null', SYNTHETIC.replace('Write-Host $line.ToString()', 'Write-Host $line.ToString() 6>$null'), literal],
    ['F3 banner with 6>$null', SYNTHETIC.replace('Write-Host "[4/4] Verifying generated agent documentation is fresh"', 'Write-Host "[4/4] Verifying generated agent documentation is fresh" 6>$null'), literal],
    ['F3 fail-closed: measured-harmless 2>$null is still RED', SYNTHETIC.replace('else { Write-Host $line }', 'else { Write-Host $line 2>$null }'), literal],
  ];
  for (const [name, snippet, reason] of cases) {
    assert.throws(() => step4Remedies(snippet), reason, `case must be RED with its named reason: ${name}`);
  }
  // Green controls: the two bound non-capture stores are accepted in their
  // exact forms, and the gate capture's 2>&1 stays the one allowed
  // redirection (the real-file signature tests cover the full chain).
  const boundStores = SYNTHETIC.replace('$agentDocsOutput = & node scripts/verify-agent-docs-fresh.mjs 2>&1', `$global:LASTEXITCODE = 0\n$agentDocsOutput = & node scripts/verify-agent-docs-fresh.mjs 2>&1`);
  assert.equal(step4Remedies(boundStores).cone, 'sparse-checkout reapply');
});
