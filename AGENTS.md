# AGENTS.md

## Project Workflow

This repository is developed on Windows with VS Code, PowerShell, Node.js, Vite, React, IIS static hosting, and optional Node-based log servers.

Read `docs-agent/AGENT_CONTEXT.md` first for a generated AI-oriented map, then
read `docs-src/CODEX_DEVELOPMENT.md` for the repository workflow, validation
ladder, and local runtime notes before doing broad changes.

Before making changes:
- Inspect actual files and repository structure first.
- Do not assume file paths, runtime config keys, bootstrap payload shapes, or deployment behavior.
- Prefer direct file edits over generated shell scripts.
- Keep changes small and reviewable.
- Show a concise summary, validation results, and git diff after changes.
- Keep OpenDocViewer generic. Do not bake host-application-specific behavior into viewer code unless the integration contract explicitly supports it as optional metadata.
- Keep code, comments, scripts, and development documentation in English. Swedish belongs only in application localization/help resources.
- If a change must be visible in a local hosted runtime, run the matching build/publish/deployment step after the code change.
- After any committed source/runtime-config/package change that touches indexed
  areas such as `src/`, `server/`, `public/odv*.config*.js`, JSDoc/exported
  APIs, dependencies, or module responsibilities, regenerate `docs-agent/` with
  `npm run doc:agent` before committing. Include the generated `docs-agent/`
  diff when it changes; if it stays clean, mention that the command was run.
  CI validates this with `node scripts/verify-agent-docs-fresh.mjs` (modified,
  deleted, staged and untracked files under `docs-agent/` all fail; see
  `docs-src/agent-documentation.md`), and so does `scripts/local-ci.ps1`.
- When a task produces repository changes, validate them, commit with a focused message, and push unless the user asks not to or the worktree contains unrelated user changes.

## Release workflow — do not change the trigger

Official OpenDocViewer releases go through `release.ps1` only. `release.ps1 -Publish` validates, runs `npm version` (creating the release commit and `vX.Y.Z` tag), and pushes; the GitHub Actions **Release** workflow then AUTO-runs on that tag push and publishes the GitHub release (body from `release-notes/<tag>.md`, which must have **no** top `#` heading — GitHub adds the title). **The single approval gate is a maintainer running `release.ps1 -Publish`** — never hand-bump `package.json`/`package-lock.json`, and never push a release tag or publish unasked.

Do NOT change `.github/workflows/release.yml` back to a `workflow_dispatch`-only / `approve_release` gate: an unintended AI change on 2026-06-28 (commit 964fa3f) did that and broke the "release.ps1 does everything" flow; it was reverted 2026-07-24. Update `SECURITY.md` before releasing (the script does not touch it). The OMP-component version (`omp-components.json`) is versioned separately from `package.json` and is never forced to match it; `release.ps1` bumps it inside the release commit (together with the regenerated `docs-agent/`), because the pre-push gate's lockstep and documentation-freshness checks require both to travel with a `package.json` change. The OMP artifact delivered after a release is therefore built from the release commit itself.

## Security / Antivirus Compatibility

This environment uses Bitdefender on Windows. PowerShell-heavy or suspicious command lines may be blocked.

Follow these rules strictly:
- Do not use encoded PowerShell commands.
- Do not use `-ExecutionPolicy Bypass`.
- Do not run nested PowerShell, for example `pwsh.exe` launching `powershell.exe`.
- Do not generate long inline `-Command` scripts.
- Do not chain many shell commands together.
- Do not use obfuscated scripts or suspicious automation patterns.
- Prefer direct file edits over shell-based search/replace.
- Prefer normal file I/O over shell piping or generated scripts.
- Prefer standard `npm`, `node`, `git`, `robocopy`, and short explicit commands when command execution is needed.
- If PowerShell is needed, prefer existing `.ps1` files in the repository.
- If a new script is needed, create a readable `.ps1` file in the repository instead of passing a large inline command.
- Run normal inspection, build, test, git, and repository scripts when they are needed for the task. Ask before destructive actions, registry/security changes, broad service/runtime resets, or deleting deployed files.
- Do not touch registry, startup settings, scheduled tasks, antivirus settings, Windows security settings, or Bitdefender settings.
- If a command is blocked or likely to trigger antivirus heuristics, stop and propose the smallest safe manual alternative.

When running the vitest suite on the hub (`linus_hemma`): use Node 22.23.3
(the CI-pinned version via fnm at
`%APPDATA%\fnm\node-versions\v22.23.3\installation\`),
not the shell default Node 25.6.0, which is outside vitest 5.0.4's and
jsdom's own engines ranges. Leave `maxWorkers` unset in `vite.config.js`:
default parallelism is both the fastest and the only fault-free level
measured on the hub, and `--maxWorkers=1` has been the only
configuration to produce worker-start deaths. Read the process EXIT CODE,
not the `Tests` line, because `Errors` is counted separately and a
worker-start death can leave the suite reporting tests complete while the
exit code is non-zero. See
`docs-src/vitest-5-migration.md` § Hub-machine worker-start
investigation (2026-10-13/14) for the measurement, the exclusion list
and the decision.

## Local Paths

Default local development paths:

- OpenDocViewer repo: `<workspace>\OpenDocViewer`
- Optional platform/host repos: `<workspace>\OpenModulePlatform`, `<workspace>\<host-app-repo>`
- Runtime root: `<runtime-root>`
- Portal URL: `http://localhost:<portal-port>/`
- Host app URL: `http://localhost:<portal-port>/<host-app>/`

These paths are local development defaults. Do not hardcode user-specific paths into reusable scripts unless explicitly requested.

## Run everything headless — no visible windows

Agents work on the operator's own workstation. A console window that pops up in the middle of
their work steals focus and can swallow keystrokes meant for something else, so everything an
agent starts runs hidden and never waits for input.

- Never start a visible console window. Scripts, builds, tests and helper processes run hidden —
  both what you start directly and what your scripts start in turn.
- Python: background and scheduled scripts use `pythonw.exe`, or
  `subprocess.Popen(..., creationflags=subprocess.CREATE_NO_WINDOW)` when a process without its
  own console starts children. Never use `os.startfile` or the `start` command to run a script.
- PowerShell: `pwsh -NoProfile -NonInteractive -WindowStyle Hidden -File …`. Never use
  `Start-Process` without `-WindowStyle Hidden` or `-NoNewWindow`, and never `cmd /c start …`.
- Scheduled tasks start through `conhost.exe --headless <program> …` or through `wscript.exe`
  with a `.vbs` that runs hidden. Never register a task without one of those patterns.
- Node: `child_process.spawn/exec` with `windowsHide: true`.
- Never wait for input: no `Read-Host`, `pause`, `input()` or interactive flags (`-i`). Set
  `GIT_TERMINAL_PROMPT=0` and run non-interactively (`--yes`, `-NonInteractive`, `--no-input`
  where the tool has it). Never run a command that can prompt without someone watching it.
- Browsers and GUI programs start only when the task needs them, never as a side effect of a
  script.
- If a window you caused appears, fix how it is started in the same piece of work and say so in
  your report. If it comes from a tool we do not control, report it so the operator can raise it
  with the vendor.
