# Runtime configuration notes

OpenDocViewer is designed so operational configuration can change without rebuilding the frontend bundle.

## Primary config files

- `public/odv.config.js`
  - required defaults
- `public/odv.site.config.sample.js`
  - sample site override file
- optional deployment-specific `odv.site.config.js`
  - loaded before the required default config

## Load order

`src/app/bootConfig.js` performs runtime config loading before React starts.

1. determine application base path
2. probe `odv.site.config.js` from the application base
3. probe `odv.config.js` from the application base
4. optionally fall back to site root for `odv.config.js` in development scenarios
5. import `src/index.jsx`

This keeps the viewer startup deterministic and avoids partial initialization with missing config.

## Why scripts are probed before injection

The boot loader uses a fetch probe before adding script tags so it can reject cases where the server returns:

- HTML instead of JavaScript
- a wrong MIME type
- an SPA fallback page for a missing config script

Without that probe, config failures are harder to diagnose in production.

## What belongs in runtime config

Good runtime-config candidates:

- logging endpoints and enable/disable flags
- i18n defaults and translation versioning / build-based cache busting
- print-dialog thresholds and print-header settings
- diagnostics toggles
- keyboard shortcut policy for browser-print interception
- deployment base path / base href
- optional integration-adapter mappings for host payload metadata

Poor runtime-config candidates:

- logic that should be compile-time code
- secrets that should not be visible to the browser
- values that need strong server-side enforcement

## Integration adapter mappings

Some embedding hosts send an object-document payload where document-level metadata records need to
be promoted into deployment-defined semantic aliases.

That mapping is runtime-configurable under:

```js
integrations: {
  portableBundle: {
    metadataAliases: {
      documentDate: ['primary-date', 'fallback-date'],
      patientId: 'patient-id',
      unitName: {
        fieldId: 'unit-name',
        prefer: 'lookupValue',
        label: 'Unit',
        type: 'string',
        contexts: ['screen', 'print']
      }
    }
  }
}
```

Notes:

- The shipped public repo keeps this object empty on purpose.
- A deployment that needs host-specific metadata mapping can define any number of semantic aliases.
- Each alias may point to one identifier, an ordered fallback list, or a richer selector object.
- If no metadata aliasing is needed, leave the object empty or omit it entirely.
- Raw metadata records are preserved regardless of alias configuration.
- Keep concrete deployment-specific identifiers out of the public repo and in deployment-local
  integration documentation/configuration instead.

### Alias selector object

Supported selector properties:

- `fieldId`
  - one metadata field id
- `fieldIds`
  - ordered fallback ids
- `prefer`
  - `value`
  - `lookupValue`
  - `valueThenLookup` (default)
  - `lookupThenValue`
- `label`
  - optional human-facing label for later UI/print use
- `type`
  - optional semantic hint such as `string`, `integer`, `date`, `datetime`
- `contexts`
  - optional list of intended usage targets such as `screen`, `print`, `sort`, `filter`, `debug`


## Help and About content

The runtime config now also exposes a lightweight help/about surface so deployments can replace the
manual content without rebuilding the React bundle.

Configuration surface:

```js
help: {
  manual: {
    sitePathTemplate: 'help/site/manual.{{lng}}.html',
    fallbackPathTemplate: 'help/default/manual.{{lng}}.html',
    fallbackLanguage: 'en'
  },
  about: {
    githubUrl: 'https://github.com/Optimal2/OpenDocViewer',
    contactEmail: 'dev@optimal2.se'
  }
}
```

Behavior:

- the manual dialog first tries the site-local HTML fragment under `help/site/`
- if no site-local file exists for the current language, it falls back to the bundled default under `help/default/`
- site-local manuals can therefore be upgraded independently of the app bundle as long as the deployment keeps `help/site/manual.<lng>.html` outside the tracked repo
- relative links inside the loaded HTML are rewritten against the resolved file URL so images, PDFs, and other local help assets can live alongside the manual fragment

Shipped public files:

- `public/help/default/manual.en.html`
- `public/help/default/manual.sv.html`
- `public/help/site/manual.en.sample.html`
- `public/help/site/manual.sv.sample.html`

## Print shortcut policy

The runtime config now supports a keyboard-only print policy surface under:

```js
shortcuts: {
  print: {
    ctrlOrCmdP: "browser" // "browser" | "disable" | "dialog"
  }
}
```

Behavior:

- `browser`: keep native browser handling for `Ctrl+P` / `Cmd+P`
- `disable`: cancel the keyboard shortcut without opening any print dialog
- `dialog`: cancel the keyboard shortcut and open OpenDocViewer's own print dialog instead

Important limitation:

- This applies to keyboard interception only.
- Browser menus, toolbar print buttons, and native context-menu print entries cannot be reliably overridden from normal page JavaScript.

## Print progress overlays

The older large-job HTML print notice has been removed from the runtime flow. HTML/browser printing
now goes directly to the browser print preview without an OpenDocViewer informational overlay.

OpenDocViewer shows progress only while generating a PDF for **Print via PDF** or **Save PDF**.
This progress dialog reports page generation progress and is the only print progress overlay.

The legacy `print.preparationNoticeThresholdPages` key is ignored and remains only for backward
compatibility with existing site-local configuration files. Set it to `0` in new configuration files.

Configuration surface:

```js
print: {
  preparationNoticeThresholdPages: 0, // deprecated/no-op compatibility key
  prewarmIframe: {
    enabled: 'auto', // 'auto', true, or false
    maxPages: 0     // 0 = reuse existing documentLoading thresholds
  },
  pdf: {
    enabled: true,
    defaultMode: 'direct',
    allowDownload: false,
    filename: 'opendocviewer-print.pdf',
    marginPt: 8,
    headerReservePt: 18,
    footerReservePt: 14,
    textFontSize: 7,
    imageFallbackQuality: 0.9
  }
}
```

`print.prewarmIframe.enabled` controls the optional hidden print iframe used to speed up compatible multi-page print jobs. `auto` follows the existing `documentLoading` and memory-pressure profile, `true` forces eligibility unless hard memory pressure is detected, and `false` disables the optimization. `maxPages: 0` means that OpenDocViewer reuses existing document-loading thresholds instead of adding a separate print-specific page limit.

`print.pdf.enabled` controls whether the print dialog offers a separate **Print via PDF** action next to the normal **Print via HTML** action. `allowDownload: true` adds a separate **Save PDF** action to the print dialog.

The generated-PDF backend is intended for deployments where the browser is slow to build print preview from large HTML/IMG print documents. It reuses already rendered page image blobs for multi-page jobs. Active-page PDF output uses the current rendered surface to preserve transient image edits.
