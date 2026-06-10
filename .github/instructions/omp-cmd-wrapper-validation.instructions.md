---
applyTo: "scripts/omp/test-cmd-wrappers.ps1"
---

# OMP command wrapper validation review guidance

This file is a shared Windows PowerShell 5.1 validation utility copied verbatim across OMP-compatible repositories.
Its purpose is to run `scripts/omp/build-universal-package.cmd`, enforce bounded timeouts, write diagnostics, clean up hung `cmd.exe` process trees, and verify that the expected universal package was created.

When reviewing this file, comment only on actionable issues that can change behavior or operational safety:

- command execution, timeout handling, process tree cleanup, or redirected stream handling bugs
- path traversal, package identity, manifest parsing, or filesystem safety issues
- compatibility problems with Windows PowerShell 5.1, `cmd.exe`, `taskkill.exe`, or Windows filesystems
- divergence between repository copies of this shared script

Do not request stylistic-only changes such as converting loops to another style, removing backtick continuations, extracting helpers only for testability, adding copyright headers, micro-optimizing tiny diagnostics, replacing explicit casts that suppress output, or reorganizing comments unless the suggestion fixes a concrete bug.

Accepted patterns in this file:

- The literal `2147483` in `ValidateRange` is intentional because Windows PowerShell 5.1 attributes cannot reference variables; startup assertions keep it synchronized with `$ValidateRangeLiteralForMaximumSafeSeconds`.
- Timeout handling intentionally repeats `Refresh()` and process-state checks around `WaitForExit`, `taskkill.exe`, and `Process.Kill()` because Windows process exit and PID reuse checks are inherently race-prone.
- `Task.Wait(...)`, parameterless `WaitForExit()`, backtick continuations, and explicit `[void]` casts are acceptable here when documented locally.
- Do not ask for file-size prechecks, temp-folder warnings, helper extraction, hashtable state objects, or tiny wording/precision changes unless they prevent a real failure.

Repo-local copies are intentional for now so each repository can validate its own wrapper offline. Any future centralization into OpenModulePlatform or a private tooling repository should be handled as a separate design change, not as a pull request nit.
