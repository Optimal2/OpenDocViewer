# AGENTS.md

## Project Workflow

This repository is developed on Windows with VS Code, PowerShell, Node.js, Vite, React, IIS static hosting, and optional Node-based log servers.

Read `docs-src/CODEX_DEVELOPMENT.md` for the repository map, validation ladder, and local runtime workflow before doing broad changes.

Before making changes:
- Inspect actual files and repository structure first.
- Do not assume file paths, runtime config keys, bootstrap payload shapes, or deployment behavior.
- Prefer direct file edits over generated shell scripts.
- Keep changes small and reviewable.
- Show a concise summary, validation results, and git diff after changes.
- Keep OpenDocViewer generic. Do not bake IbsPackager-specific behavior into viewer code unless the integration contract explicitly supports it as optional metadata.
- Keep code, comments, scripts, and development documentation in English. Swedish belongs only in application localization/help resources.
- If a change must be visible in a local hosted runtime, run the matching build/publish/deployment step after the code change.
- When a task produces repository changes, validate them, commit with a focused message, and push unless the user asks not to or the worktree contains unrelated user changes.

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
- Optional platform/host repos: `<workspace>\OpenModulePlatform`, `<workspace>\IbsPackager`
- Runtime root: `E:\OMP`
- Portal URL: `http://localhost:8088/`
- IbsPackager URL: `http://localhost:8088/ibspackager/`

These paths are local development defaults. Do not hardcode user-specific paths into reusable scripts unless explicitly requested.
