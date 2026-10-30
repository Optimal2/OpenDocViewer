# Site configuration generator

`site-config-generator.mjs` builds a site configuration file (`odv.site.config.js`) from the
shipped sample `public/odv.site.config.sample.js` plus a small JSON **site profile**, and checks an
existing site configuration against the sample again after an upgrade.

The header comment of [`site-config-generator.mjs`](site-config-generator.mjs) is the authoritative
short reference. This README explains the workflow and shows real runs.

## Purpose

`public/odv.site.config.sample.js` documents every site setting, with comments, defaults and
commented-out examples. A site usually changes only a handful of values. Copying the sample by hand
and editing it works for the first deployment, but on every upgrade someone has to find out what the
new sample added or changed and merge that into the site file.

The generator splits the site file into two parts:

- the **sample** from the release you deploy, which supplies the comments, layout and every value the
  site does not change, and
- the **site profile**, a short JSON file that lists only the values the site changes, removes or
  adds.

`generate` combines them into a commented, ready-to-deploy site configuration. `check` regenerates
it in memory and reports whether an existing site configuration still matches.

The tool is a convenience for developers and operators. It lives in its own folder, has no
dependencies besides Node.js, and is **not** part of the build output (`dist/`), the published
artifact, the OMP package or the release zip. Run it from a repository checkout. It can use the
current files or read the sample and loader from any release tag already present in that checkout.

## Commands

Run all commands from the repository root.

```text
node tools/site-config-generator/site-config-generator.mjs generate --profile <file> --out <file> [--force] [--version <x.y.z>] [--sample <file>] [--loader <file>]
node tools/site-config-generator/site-config-generator.mjs check --profile <file> --config <file> [--version <x.y.z>] [--sample <file>] [--loader <file>]
node tools/site-config-generator/site-config-generator.mjs generate-all --profile <file> --versions <a,b,...> --out-dir <dir> [--name <file>] [--force]
node tools/site-config-generator/site-config-generator.mjs new-profile --out <file> [--force]
```

| Option | Meaning |
| --- | --- |
| `--profile <file>` | The site profile (JSON). |
| `--out <file>` | File to write. Required for `generate` and `new-profile`; the tool never picks a destination itself. Its file name follows the `--name` rule below (no device name, trailing dot or space, or colon). |
| `--config <file>` | Existing site configuration to compare (`check` only). |
| `--version <x.y.z>` | Read the sample, loader and header version from existing tag `v<x.y.z>` (`generate` and `check`). |
| `--versions <a,b,...>` | Comma-separated release versions (`generate-all` only). Empty, malformed and duplicate versions are usage errors. |
| `--out-dir <dir>` | Parent output directory (`generate-all` only). Any directory you choose, absolute or relative; it is not restricted. |
| `--name <file>` | Plain file name for each version folder. Default: `odv.site.config.js`. Rejected: an empty name, `.`/`..`, path separators, a colon anywhere (drive letter or NTFS stream), characters Windows forbids (`<>"\|?*`, control characters), a trailing space or dot, and Windows device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`, and the superscript forms `COM¹`-`COM³`, `LPT¹`-`LPT³`, with or without an extension, any case). |
| `--sample <file>` | Sample to build from. Default: `public/odv.site.config.sample.js`; cannot be combined with `--version`. |
| `--loader <file>` | `odv.config.js` used for merge verification. Overrides both the current default and the loader selected by `--version`. |
| `--force` | `generate`/`generate-all`: replace an output file that this tool did not produce. `new-profile`: replace an existing file. No command allows `--force` to replace the shipped sample or loader. |

Exit codes:

| Command | 0 | 1 | 2 |
| --- | --- | --- | --- |
| `generate` | File written and verified. | Error (bad profile, unknown path or tag, parse error, failed verification, refused overwrite). Nothing is written. | Usage error (unknown command or option, missing required option, malformed version, `--version` with `--sample`). |
| `check` | The configuration matches the selected sample plus the profile. | Drift (`DRIFT:` on standard output) or an error (`ERROR:` on standard error). | Usage error. |
| `generate-all` | Every requested file written and verified. | First generation error; the message names the failed version and no later version is attempted. Earlier files remain. | Usage error (missing options, malformed/duplicate versions, unsafe `--name`). |
| `new-profile` | Example profile written. | Refused overwrite, protected destination, dangling link or failed write. Nothing is written. | Usage error. |

## Several releases

One profile can produce configurations for sites that run different releases. `generate-all` reads
each release's own sample and loader through `git show v<x.y.z>:<path>` in the current checkout; no
separate old checkout and no new dependency is needed. Each output is verified before it is written,
and the command stops at the first failed version.

For example, this fictional profile changes a setting present in both samples and opts in to
`toolbar.largeButtons` only from 2.11.0, where that setting first appears:

```json
{
  "name": "Example Hospital",
  "description": "Fictional EXAMPLE-TEST profile for several releases.",
  "set": {
    "i18n.default": "en",
    "toolbar.largeButtons": false
  },
  "since": {
    "toolbar.largeButtons": "2.11.0"
  }
}
```

This is a real run over the repository's v2.10.0 and v2.11.0 tags. `<work>` stands for the absolute
work folder used for the profile and outputs:

```text
> node tools/site-config-generator/site-config-generator.mjs generate-all --profile <work>\several-releases.profile.json --versions 2.10.0,2.11.0 --out-dir <work>\releases
2.10.0: wrote <work>\releases\2.10.0\odv.site.config.js; verified 3 assertion(s); 1 skipped gated entry.
2.10.0:   skipped (since 2.11.0)  toolbar.largeButtons
2.11.0: wrote <work>\releases\2.11.0\odv.site.config.js; verified 5 assertion(s); 0 skipped gated entries.
```

The result is one complete file per release:

```text
<work>\releases\2.10.0\odv.site.config.js
<work>\releases\2.11.0\odv.site.config.js
```

Verify either file against the release it was built from:

```text
node tools/site-config-generator/site-config-generator.mjs check --profile <work>\several-releases.profile.json --version 2.10.0 --config <work>\releases\2.10.0\odv.site.config.js
node tools/site-config-generator/site-config-generator.mjs check --profile <work>\several-releases.profile.json --version 2.11.0 --config <work>\releases\2.11.0\odv.site.config.js
```

### Version input precedence

- `--version <x.y.z>` uses tag `v<x.y.z>` for the sample, the default loader and the header. The
  **tag name** supplies the header version. A missing/unreadable tag, sample or loader is an error
  naming the tag and missing input.
- An explicit `--loader <file>` wins over the tag for merge verification. This combination is
  allowed: the explicit loader affects verification only, while the sample and header still come
  from the tag.
- `--version` with `--sample` is a usage error (exit 2). Otherwise the header could claim that a
  custom sample came from a release that did not supply it. Use one input mechanism or the other.
- Without `--version`, existing behaviour is unchanged: `--sample` and `--loader` select local files,
  the current shipped sample gets its header version from `package.json` (also when `--sample`
  names `public/odv.site.config.sample.js` explicitly), and a custom sample has no inferred version.
  `generate` and `check` apply the same rule. A version that cannot be determined is written as
  `no version inferred`, never as `undefined`.

## Workflow on a new release

1. Keep the site profile under site control, for example next to the deployment scripts of the
   site. The profile, not the generated file, is the source you edit.
2. Check out the new OpenDocViewer release. Its `public/odv.site.config.sample.js` is the new sample,
   and its `package.json` supplies the version written into the header for that shipped sample. A
   custom `--sample` is named without an inferred version.
3. Run `check` against the site configuration that is deployed today:

   ```text
   node tools/site-config-generator/site-config-generator.mjs check --profile <profile> --config <deployed odv.site.config.js>
   ```

   - Exit 0: the deployed file already equals the new sample plus the profile. Nothing to do.
   - Exit 1 with `DRIFT:`: the regenerated file differs. Read the report. `Keys that differ` lists
     configuration values that the new sample changed, added (`missing`) or removed (`extra`), and
     values that were edited by hand in the deployed file. The line diff shows every other
     difference, such as new comments. After an upgrade, `check` reports drift at least for the
     `Built from:` header line, because the header names the release version.
   - Exit 1 with `ERROR:`: the profile no longer fits the new sample, for example because a key it
     sets was renamed or removed. Update the profile and run `check` again.
4. Decide about each reported value. If the new default is fine, do nothing. If the site needs a
   different value, add it to the profile. If a hand edit in the deployed file must be kept, move it
   into the profile; the next `generate` drops every hand edit.
5. Run `generate` to write the new site configuration, then deploy that file together with the new
   release:

   ```text
   node tools/site-config-generator/site-config-generator.mjs generate --profile <profile> --out <new odv.site.config.js>
   ```

6. Optionally run `check` against the new file. It exits 0.

## Profile format

A profile is a JSON object with these top-level keys:

| Key | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Non-empty string, written into the header (`// Site profile: ...`). |
| `description` | no | String, written into the header (`// Description: ...`). |
| `set` | no | Object that maps a dotted path to a new value. |
| `unset` | no | Array of dotted paths to comment out. |
| `since` | no | Object that maps a `set`/`unset` path to the first version where it applies, inclusive. |
| `until` | no | Object that maps a `set`/`unset` path to the last version where it applies, inclusive. |

Any other top-level key is an error, except comment keys. JSON has no comments, so a key that starts
with `//` (or `$`, top level only) is ignored. Inside `set`, `since` and `until`, keys that start
with `//` are ignored too, which lets you disable an entry by prefixing it with `// `.

### Version gates

```json
{
  "name": "Example Hospital",
  "set": { "toolbar.largeButtons": false },
  "unset": ["showPerfOverlay"],
  "since": { "toolbar.largeButtons": "2.11.0" },
  "until": { "showPerfOverlay": "2.9.0" }
}
```

`since` and `until` can gate paths in both `set` and `unset`. A gate key is the actual dotted path,
without the `+` addition marker used in `set`. The boundaries are inclusive: `since: "2.11.0"`
applies at 2.11.0 and later, while `until: "2.9.0"` applies at 2.9.0 and earlier. Versions are
compared as three numeric components, not as strings, so 2.9.0 is older than 2.10.0. The
comparison is exact for components of any length (it uses `BigInt`), so even components above
JavaScript's safe-integer range never compare as equal when they differ.

An excluded entry is never ignored silently. `generate` and `generate-all` print its path as
`skipped (since 2.11.0)` or `skipped (until 2.9.0)`, and `check` applies the same filter so the
generated file checks out. A gate that names no path in `set` or `unset` is an error, because it is
almost always a typo. An ungated path missing from the selected sample remains an error; gating is
opt-in per path.

Gates need a known target version. `--version` supplies it explicitly; otherwise the tool uses the
version it infers from `package.json` for the current shipped sample. A custom `--sample` has no
inferred version, so using gates with one fails with a readable error rather than guessing.

### Values

A `set` value may be any JSON value: string, number, boolean, `null`, array or object. The tool
writes it as a JavaScript literal in the style of the sample (single-quoted strings, two-space
indentation, short arrays and objects on one line). Numbers must be finite; negative zero (`-0`) is
preserved. Lone UTF-16 surrogates in strings are escaped so UTF-8 output cannot replace them with
U+FFFD. An object key named `__proto__` is rejected at any nesting depth with a clear error, because
the configuration loader cannot merge that key safely.

The value replaces the sample's value as a whole. Array elements cannot be addressed one by one; set
the whole array. Setting an object replaces the entire block of the sample, including the comments
inside it, so prefer the paths of the individual values you change.

### Dotted paths

A dotted path addresses the configuration object level by level through its nested blocks. It is
resolved by its full path, never by searching for a key name. The sample has a `print` block at the
top level and another `print` block inside `shortcuts`:

- `print.defaultPageMode` is the `defaultPageMode` key of the top-level `print` block.
- `shortcuts.print.ctrlOrCmdP` is the `ctrlOrCmdP` key of the `print` block inside `shortcuts`.
- `print.ctrlOrCmdP` does not exist, and is an error. It does not find the key inside `shortcuts`.

Every segment except the last must be a plain object literal in the sample.

### Changing, adding and removing keys

- A plain `set` key changes a value that exists in the sample. If the path does not exist in the
  sample, `generate` fails, and the message suggests the `+` form. Nothing is ignored silently.
- A `set` key with a `+` prefix, such as `"+theme.bridge"`, adds a key that the sample does not have.
  The parent block (`theme`) must exist in the sample, and the key itself must not. The key is
  appended as the last entry of its parent block, after the comment
  `// Added by the site profile: not present in the shipped sample.`
  Keys that the sample shows only as comments, such as `theme.bridge`, do not exist for the tool and
  need the `+` form.
- An `unset` path comments the property out (`// key: value`), the way the sample marks
  intentionally inactive keys. The built-in default from `odv.config.js` then applies, and the
  documentation comment stays in place. A property that shares its line with other code is removed
  from that line instead.

Two entries on the same path, or on a path and one of its descendants, are an error.

## Examples

These are real runs with Node.js on Windows. In the output, `<repo>` stands for the absolute path of
the repository checkout and `<work>` for the absolute path of a work folder outside it. The sample
was the one of OpenDocViewer 2.11.0.

### Example 1: start from scratch

Create an example profile:

```text
> node tools/site-config-generator/site-config-generator.mjs new-profile --out <work>\example-hospital.profile.json
Wrote example profile <work>\example-hospital.profile.json
```

Exit code 0. Running the same command again exits 1, because the file exists:

```text
ERROR: "<work>\example-hospital.profile.json" already exists. Re-run with --force to replace it.
```

The example profile contains:

```json
{
  "//": [
    "OpenDocViewer site profile for tools/site-config-generator.",
    "set:   dotted path -> new value. The path must exist in public/odv.site.config.sample.js.",
    "       Prefix a path with '+' to deliberately add a key that the sample does not have;",
    "       its parent block must exist in the sample.",
    "unset: dotted paths to comment out, so the built-in default from odv.config.js applies.",
    "Keys starting with '//' are comments and are ignored.",
    "Values may be strings, numbers, booleans, null, arrays or objects.",
    "Arrays always replace the whole default array."
  ],
  "name": "Example Hospital",
  "description": "Fictional example site profile. Replace every value with the real site's settings.",
  "set": {
    "i18n.default": "en",
    "print.defaultPageMode": "all",
    "shortcuts.print.ctrlOrCmdP": "dialog",
    "help.about.contactEmail": "viewer-support@example.org",
    "// +viewer.exampleSetting": "an addition would look like this; remove the '// ' to use it"
  },
  "unset": []
}
```

Edit the values, then generate the site configuration:

```text
> node tools/site-config-generator/site-config-generator.mjs generate --profile <work>\example-hospital.profile.json --out <work>\odv.site.config.js
Profile: Example Hospital
Sample:  <repo>\public\odv.site.config.sample.js (OpenDocViewer 2.11.0)
Changes (old -> new):
  set   i18n.default                'sv' -> 'en'
  set   print.defaultPageMode       'active' -> 'all'
  set   shortcuts.print.ctrlOrCmdP  'dialog' -> 'dialog'
  set   help.about.contactEmail     'dev@optimal2.se' -> 'viewer-support@example.org'
Verified 9 assertion(s) through node:vm (site object and odv.config.js merge).
Wrote <work>\odv.site.config.js
```

Exit code 0. The generated file starts with this header, followed by the complete sample text with
the four values changed:

```js
// Generated by OpenDocViewer tools/site-config-generator.
// Site profile: Example Hospital
// Description:  Fictional example site profile. Replace every value with the real site's settings.
// Built from:   public/odv.site.config.sample.js of OpenDocViewer 2.11.0 (version from repository package.json)
// Do not edit this file by hand. Change the site profile and regenerate:
//   node tools/site-config-generator/site-config-generator.mjs generate --profile <profile.json> --out <this file>
// After an upgrade, verify it against the new sample:
//   node tools/site-config-generator/site-config-generator.mjs check --profile <profile.json> --config <this file>
```

### Example 2: verify after an upgrade

When the site configuration still matches:

```text
> node tools/site-config-generator/site-config-generator.mjs check --profile <work>\example-hospital.profile.json --config <work>\odv.site.config.js
Profile: Example Hospital
Sample:  <repo>\public\odv.site.config.sample.js (OpenDocViewer 2.11.0)
Config:  <work>\odv.site.config.js
OK: the site configuration matches the sample plus the profile.
```

Exit code 0.

To show a drift report, this run uses `--sample` with a copy of the sample in which a new release
would have changed the default of `toolbar.largeButtons` from `true` to `false` and added a comment
line:

```text
> node tools/site-config-generator/site-config-generator.mjs check --profile <work>\example-hospital.profile.json --config <work>\odv.site.config.js --sample <work>\next-release.sample.js
Profile: Example Hospital
Sample:  <work>\next-release.sample.js (custom --sample; no version inferred)
Config:  <work>\odv.site.config.js
Keys that differ:
  changed   toolbar.largeButtons  regenerated: false  existing: true
Line diff (- regenerated, + existing):
  -   77 |     // New in this release: an example comment line added to the sample.
  -  100 |       largeButtons: false
  +   99 |       largeButtons: true
DRIFT: the site configuration differs from the sample plus the profile.
Regenerate it with "generate", or update the profile if the difference is intended.
```

Exit code 1. Lines marked `-` are what `generate` would write now; lines marked `+` are in the
existing file. Here the new default is acceptable, so `generate` with the same `--sample` writes the
new file, and the next `check` exits 0. If the site must keep `true`, add
`"toolbar.largeButtons": true` to the profile instead.

When only the release version in the header differs, for example a file generated from 2.10.0 and
checked with 2.11.0, the report says so:

```text
> node tools/site-config-generator/site-config-generator.mjs check --profile <work>\example-hospital.profile.json --config <work>\older.site.config.js
Profile: Example Hospital
Sample:  <repo>\public\odv.site.config.sample.js (OpenDocViewer 2.11.0)
Config:  <work>\older.site.config.js
No configuration value differs; the difference is in comments, layout or the header.
Line diff (- regenerated, + existing):
  -    4 | // Built from:   public/odv.site.config.sample.js of OpenDocViewer 2.11.0 (version from repository package.json)
  +    4 | // Built from:   public/odv.site.config.sample.js of OpenDocViewer 2.10.0 (version from repository package.json)
DRIFT: the site configuration differs from the sample plus the profile.
Regenerate it with "generate", or update the profile if the difference is intended.
```

Exit code 1.

### Example 3: one focused profile edit

This profile changes one value, adds a key that the sample shows only as a comment, and comments one
key out:

```json
{
  "//": "Fictional EXAMPLE-TEST profile of Example Hospital.",
  "name": "Example Hospital",
  "description": "EXAMPLE-TEST environment (https://viewer.example.org)",
  "set": {
    "viewer.defaultZoomMode": "fit-page",
    "+theme.bridge": { "allowedOrigins": ["https://viewer.example.org"] }
  },
  "unset": ["showPerfOverlay"]
}
```

```text
> node tools/site-config-generator/site-config-generator.mjs generate --profile <work>\focused.profile.json --out <work>\focused.site.config.js
Profile: Example Hospital
Sample:  <repo>\public\odv.site.config.sample.js (OpenDocViewer 2.11.0)
Changes (old -> new):
  set   viewer.defaultZoomMode  'fit-width' -> 'fit-page'
  add   theme.bridge            (absent) -> { allowedOrigins: ['https://viewer.example.org'] }
  unset showPerfOverlay         false -> (commented out; built-in default applies)
Verified 6 assertion(s) through node:vm (site object and odv.config.js merge).
Wrote <work>\focused.site.config.js
```

Exit code 0. The affected part of the generated file:

```js
    exposeStackTraces: false,
    // showPerfOverlay: false,
    theme: {
      // Theme used while the browser has no stored theme choice: "system" (default, follows the
      // OS), "light", "dark" or "normal". A user's own choice always outranks this default.
      // defaultMode: 'light',
      // Opt-in cross-origin theme bridge (postMessage). Leave empty to keep it disabled.
      // bridge: { allowedOrigins: ['https://portal.example'] },
      // Added by the site profile: not present in the shipped sample.
      bridge: { allowedOrigins: ['https://viewer.example.org'] }
    },
```

With the `+` marker on the wrong entries (`"theme.bridge"` without it and
`"+viewer.defaultZoomMode"` with it), `generate` writes nothing and exits 1:

```text
ERROR: The profile does not match the sample:
  - Path "theme.bridge" does not exist in the sample (missing "theme.bridge"). Mark it as a deliberate addition with "+theme.bridge".
  - Path "viewer.defaultZoomMode" is marked as an addition ("+viewer.defaultZoomMode") but already exists in the sample; use "viewer.defaultZoomMode" to change it.
```

## Limitations and failure modes

- **Sample syntax.** The tool edits the sample as text with a small scanner, not a full JavaScript
  parser. It looks for the first executable `__ODV_SITE_CONFIG__ = {` assignment, ignoring
  occurrences in comments, strings and template literals. That object
  literal, and every nested block you address, may contain only plain `key: value` properties with
  identifier, number or quoted keys. A spread (`...x`), a shorthand property, a method or a computed
  key in the top-level object makes `generate` and `check` fail with a parse error, for example:

  ```text
  ERROR: Sample parse error at line 68, column 5: unsupported property syntax starting with '.' (only "key: value" is supported)
  ```

  The same applies to unterminated strings, template literals, regular expressions, block comments
  and unbalanced brackets. A nested block that does not parse as a plain literal is not an error by
  itself, but its keys cannot be addressed. Values themselves may be expressions, including
  functions; they are replaced as a whole.
- **Regular expressions versus division.** The scanner decides whether a `/` starts a regular
  expression from the previous significant token, ignoring whitespace and comments, the way a
  JavaScript lexer does: after an identifier, a number, a string, a template, a regex, `)`, `]`,
  `++` or `--` it is division; after `return`, `typeof`, `instanceof`, `in`, `of`, `delete`,
  `void`, `new`, `do`, `else`, `case`, `yield`, `await` or `throw` (not as a property name after
  `.`), after `}`, and after any other operator or punctuator it starts a regex. The residual
  limit is the context a real parser would need: a regex directly after a `)` that closes a
  statement head (`if (x) /re/.test(s)`), and a division directly after an object literal
  (`{} / 2`), are both misread. Both are rare in a configuration file, and when they occur, the
  sample usually fails with a parse error such as `unterminated regular expression literal`.
  A misread that does not cause a parse error typically shows up as an addressed key reported as
  missing although the sample has it, or as a failed verification. The tool never writes a file
  whose values it has not verified through `node:vm`; that verification compares data values, not
  the bodies of functions or regular expressions (see below).
- **`--out` is required.** `generate` and `new-profile` without `--out` are usage errors (exit 2).
  The tool never writes `public/odv.site.config.js` or any other file unless you name it.
- **Overwrite protection.** For `generate`, an existing `--out` file is replaced only when its first
  line is the generated header (`// Generated by OpenDocViewer tools/site-config-generator.`). Any
  other file is refused unless you pass `--force`:

  ```text
  ERROR: "<work>\handmade.js" exists and was not produced by this tool. Re-run with --force to replace it.
  ```

  `new-profile` instead refuses every existing file without `--force`; the generated-header rule
  does not apply to its profile template.
- **The shipped sample and loader are protected.** `generate`, `generate-all` and `new-profile`
  refuse, with exit 1 and also with `--force`, an output that is the shipped sample
  (`public/odv.site.config.sample.js`) or the loader (`public/odv.config.js`), or leads there
  through a symbolic link; `generate` also refuses its own `--sample` and `--loader` files.
  `generate-all` stops at that version, and nothing more is written after it. How "is" is decided:
  - When both the output and the protected file yield an available, exact and comparable **file
    identity** (the device and file id that `stat` reports), another spelling of the same file is
    refused too: a mapped or `subst` drive, a `\\?\` prefix, or a hard link.
  - Every output is also compared by its normalised path (case-insensitive on Windows), both as
    named and as resolved through a link. Only that comparison applies when the output does not
    exist, `stat` fails, the device or file id is missing, the file id is 0, or either identity
    component is not exactly comparable (for example an unsafe numeric value).
  - Not covered: a different spelling of the sample or loader when either side lacks an available,
    exact and comparable identity and the normalised paths do not match.

  ```text
  ERROR: --out must not be the sample file itself.
  ERROR: --out must not be the loader (odv.config.js) itself (it is a link to "<repo>\public\odv.config.js").
  ERROR: --out must not be the sample file itself (it is the same file as "<repo>\public\odv.site.config.sample.js").
  ERROR: Generation for version 2.10.0 failed: "<out-dir>\2.10.0\odv.site.config.js" must not be the sample file itself (it is a link to "<repo>\public\odv.site.config.sample.js").
  ```

- **The output file name must be a plain file name.** The last segment of every output path
  (`--out` for `generate` and `new-profile`, `--name` for `generate-all`) follows the `--name`
  rule above: a Windows device name (`NUL`, `com1.js`, ...), a trailing dot or space (which Windows
  strips silently, so the file would land somewhere else or be hard to delete), and a colon (an
  NTFS alternate data stream such as `odv.config.js:x`) are refused with exit 1 (`--name`: exit 2)
  before anything is resolved or created, so such a destination never leaves a temporary file
  behind:

  ```text
  ERROR: "<work>\odv.site.config.js." is not a usable output file: its file name ends with a space or a dot, which Windows strips silently.
  ```

- **No half-written files.** `generate`, `generate-all` and `new-profile` write each output to a
  temporary file in the destination folder and rename it into place only after the write succeeded.
  If writing fails, the temporary file is removed, the command exits 1, and an existing file keeps
  its previous content. The overwrite protection above runs first, so the rename never replaces a
  file that the tool would otherwise refuse.
  - **Permissions.** When the destination already exists, its permission bits (the POSIX mode,
    such as a deliberately tightened `0600`; on Windows only the read-only attribute, and Windows
    refuses to replace a read-only file in any case) are copied
    onto the new file before the rename. Owner, group and ACLs are not copied. If the mode cannot
    be read or applied, the command fails with exit 1 and the previous file stays as it was, rather
    than silently loosening its permissions. Delete the file first if you want default permissions.
  - **Symbolic links.** A symlinked `--out` (or `<out-dir>/<version>/<name>`) is written through:
    the tool resolves the link and renames the new file onto the link's target, with the temporary
    file in the target's folder, so the link keeps pointing where it did. The overwrite protection
    and `--force` judge the target's content, and a link to the sample or the loader is refused
    like those files themselves. The link is resolved exactly **once** per output file: the
    overwrite protection, `--force`, the sample/loader refusal and the rename all use that one
    resolved target, so the tool never checks one file and writes another. If something else
    re-points the link while the tool runs, the new file still lands on the target that was
    checked (the link is not followed a second time). A failed write names both paths
    (`"<link>" (link target "<target>")`). A dangling link (whose target does not exist) is
    refused with exit 1:

    ```text
    ERROR: "<work>\odv.site.config.js" is a symbolic link whose target does not exist. Point it at an existing file or remove it, then re-run.
    ```

  - **Cleanup.** The temporary file is removed after a failure only when this run created it (a
    name that already existed is left alone). If the removal itself fails, the error still names
    the original cause and adds the temporary file's path so you can delete it.
- **Hand edits are lost.** `generate` rebuilds the file from the sample and the profile. Move every
  intended change into the profile.
- **Line endings.** LF and CRLF are both supported. The output keeps the line endings of the existing
  `--out` file (or, for `check`, of `--config`); otherwise it uses those of the sample. A file with
  mixed line endings is written with its majority style only. A byte-order mark at the start of the
  sample is kept. `check` treats files that differ only in line endings or the byte-order mark as
  identical (exit 0) and says so.
- **Header.** The header names the profile and the sample actually used. For the current shipped
  `public/odv.site.config.sample.js`, it names the version from the repository's `package.json`,
  whether or not you pass that path with `--sample`.
  For `--version`, it names the version from the tag name. For a custom `--sample`, it names that
  file and omits the version rather than implying that the custom file came from that release.
- **What the `node:vm` verification asserts.** After building the text, and before writing anything,
  the tool runs it in a `node:vm` context with a stub `window` and `document`, and reads
  `window.__ODV_SITE_CONFIG__`. It asserts that:
  - every active `set` and added value is present with exactly the profile value,
  - every active `unset` key is absent,
  - every other value equals the sample's value, so the text edit changed nothing else.

  It then runs the selected `odv.config.js` (current, tagged or explicit `--loader`) in the same
  context and asserts that every active `set` and added value is present in the merged
  `window.__ODV_CONFIG__`.
- **What the verification does not assert.** It does not check that a value is valid for the
  setting (for example that a zoom mode exists), it does not check the merged value of an `unset`
  key, and it does not load the viewer in a browser. Values are compared as JSON-compatible data
  (with negative zero preserved), so functions, regular expressions and `undefined` values in the
  sample are not compared. Comments are not verified.
