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
  CI validates this with `git diff --exit-code -- docs-agent`.
- When a task produces repository changes, validate them, commit with a focused message, and push unless the user asks not to or the worktree contains unrelated user changes.

## Release workflow — do not change the trigger

Official OpenDocViewer releases go through `release.ps1` only. `release.ps1 -Publish` validates, runs `npm version` (creating the release commit and `vX.Y.Z` tag), and pushes; the GitHub Actions **Release** workflow then AUTO-runs on that tag push and publishes the GitHub release (body from `release-notes/<tag>.md`, which must have **no** top `#` heading — GitHub adds the title). **The single approval gate is a maintainer running `release.ps1 -Publish`** — never hand-bump `package.json`/`package-lock.json`, and never push a release tag or publish unasked.

Do NOT change `.github/workflows/release.yml` back to a `workflow_dispatch`-only / `approve_release` gate: an unintended AI change on 2026-06-28 (commit 964fa3f) did that and broke the "release.ps1 does everything" flow; it was reverted 2026-07-24. Update `SECURITY.md` before releasing (the script does not touch it). The OMP-component version (`omp-components.json`) is versioned separately and is bumped AFTER the release, from the post-release commit — never force it to match `package.json`.

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

## Local Paths

Default local development paths:

- OpenDocViewer repo: `<workspace>\OpenDocViewer`
- Optional platform/host repos: `<workspace>\OpenModulePlatform`, `<workspace>\<host-app-repo>`
- Runtime root: `<runtime-root>`
- Portal URL: `http://localhost:<portal-port>/`
- Host app URL: `http://localhost:<portal-port>/<host-app>/`

These paths are local development defaults. Do not hardcode user-specific paths into reusable scripts unless explicitly requested.
