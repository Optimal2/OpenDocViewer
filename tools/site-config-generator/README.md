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
artifact, the OMP package or the release zip. To use it, run it from a checkout of the
OpenDocViewer repository at the release you deploy.

## Commands

Run all commands from the repository root.

```text
node tools/site-config-generator/site-config-generator.mjs generate --profile <file> --out <file> [--force] [--sample <file>] [--loader <file>]
node tools/site-config-generator/site-config-generator.mjs check --profile <file> --config <file> [--sample <file>] [--loader <file>]
node tools/site-config-generator/site-config-generator.mjs new-profile --out <file> [--force]
```

| Option | Meaning |
| --- | --- |
| `--profile <file>` | The site profile (JSON). |
| `--out <file>` | File to write. Required; the tool never picks a destination itself. |
| `--config <file>` | Existing site configuration to compare (`check` only). |
| `--sample <file>` | Sample to build from. Default: `public/odv.site.config.sample.js`. |
| `--loader <file>` | `odv.config.js` used for the merge verification. Default: `public/odv.config.js`. |
| `--force` | `generate`: replace an `--out` file that this tool did not produce. `new-profile`: replace an existing file. |

Exit codes:

| Command | 0 | 1 | 2 |
| --- | --- | --- | --- |
| `generate` | File written and verified. | Error (bad profile, unknown path, parse error, failed verification, refused overwrite). Nothing is written. | Usage error (unknown command or option, missing required option). |
| `check` | The configuration matches the sample plus the profile. | Drift (`DRIFT:` on standard output) or an error (`ERROR:` on standard error). | Usage error. |
| `new-profile` | Example profile written. | The file already exists and `--force` was not given. | Usage error. |

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

Any other top-level key is an error, except comment keys. JSON has no comments, so a key that starts
with `//` (or `$`, top level only) is ignored. Inside `set`, keys that start with `//` are ignored
too, which lets you disable an entry by prefixing it with `// `.

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
Sample:  <work>\next-release.sample.js (OpenDocViewer 2.11.0)
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
  itself, but its keys cannot be addressed. Values themselves may be any expression; they are
  replaced as a whole.
- **`--out` is required.** `generate` without `--out` is a usage error (exit 2). The tool never writes
  `public/odv.site.config.js` or any other file unless you name it.
- **Overwrite protection.** An existing `--out` file is replaced only when its first line is the
  generated header (`// Generated by OpenDocViewer tools/site-config-generator.`). Any other file is
  refused unless you pass `--force`:

  ```text
  ERROR: "<work>\handmade.js" exists and was not produced by this tool. Re-run with --force to replace it.
  ```

  `--out` can never be the sample file itself, even with `--force`:

  ```text
  ERROR: --out must not be the sample file itself.
  ```

- **Hand edits are lost.** `generate` rebuilds the file from the sample and the profile. Move every
  intended change into the profile.
- **Line endings.** LF and CRLF are both supported. The output keeps the line endings of the existing
  `--out` file (or, for `check`, of `--config`); otherwise it uses those of the sample. A file with
  mixed line endings is written with its majority style only. A byte-order mark at the start of the
  sample is kept. `check` treats files that differ only in line endings or the byte-order mark as
  identical (exit 0) and says so.
- **Header.** The header names the profile and the sample actually used. For the shipped
  `public/odv.site.config.sample.js`, it also names the OpenDocViewer version and identifies the
  repository's `package.json` as its source. For a custom `--sample`, it names that file and omits
  the version rather than implying that the custom file came from that release.
- **What the `node:vm` verification asserts.** After building the text, and before writing anything,
  the tool runs it in a `node:vm` context with a stub `window` and `document`, and reads
  `window.__ODV_SITE_CONFIG__`. It asserts that:
  - every `set` and added value is present with exactly the profile value,
  - every `unset` key is absent,
  - every other value equals the sample's value, so the text edit changed nothing else.

  It then runs `odv.config.js` (`--loader`) in the same context and asserts that every `set` and
  added value is present in the merged `window.__ODV_CONFIG__`.
- **What the verification does not assert.** It does not check that a value is valid for the
  setting (for example that a zoom mode exists), it does not check the merged value of an `unset`
  key, and it does not load the viewer in a browser. Values are compared as JSON-compatible data
  (with negative zero preserved), so functions, regular expressions and `undefined` values in the
  sample are not compared. Comments are not verified.
