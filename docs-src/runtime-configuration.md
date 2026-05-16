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
- user-facing document metadata visibility
- keyboard shortcut policy for browser-print interception
- deployment base path / base href
- optional integration-adapter mappings for host payload metadata

Poor runtime-config candidates:

- logic that should be compile-time code
- secrets that should not be visible to the browser
- values that need strong server-side enforcement

## Document Metadata UI

Document metadata can be preserved in the normalized bundle even when the site does not want users
to inspect it directly inside OpenDocViewer. The user-facing metadata overlays and context-menu
metadata actions are controlled by:

```js
metadata: {
  enabled: true
}
```

Set `metadata.enabled` to `false` for deployments where metadata may still be used internally for
print templates, sorting, or diagnostics, but should not be exposed as a document metadata dialog or
overview table.

## Viewer Problem Notice

Deployments can configure a viewer-level support notice for serious load failures, for example when
host-provided document links expire and many pages fail at once.

Configuration surface:

```js
viewer: {
  problemNotice: {
    enabled: true,
    showForLoaderError: true,
    showForFailedPages: true,
    minFailedPages: 1,
    failedPageRatio: 0.5,
    requireLoadComplete: false,
    dismissible: true,
    showReloadButton: true,
    showTechnicalDetails: false,
    title: {
      en: 'The documents could not be shown correctly',
      sv: 'Dokumenten kunde inte visas korrekt'
    },
    message: {
      en: 'The document session may have expired. Close this viewer and open the document again from the source system.',
      sv: 'Dokumentsessionen kan ha gått ut. Stäng visaren och öppna dokumentet på nytt från källsystemet.'
    }
  }
}
```

The notice is not tied to a single failed page. It is shown when the loader reports a fatal error, or
when the configured number and ratio of failed pages is reached. Site-specific text should explain
the local recovery path, such as reopening the document from the embedding application.

The loader can also stop early when an embedding host has issued unusable source tickets. Configure
the threshold under `documentLoading.fetch`:

```js
documentLoading: {
  fetch: {
    abortOnSourceUnavailableCount: 8
  }
}
```

When the first configured number of source URLs all fail as unavailable and no source has loaded
successfully, OpenDocViewer treats the whole source session as expired or invalid. This avoids
hundreds of identical failed requests and lets the viewer-level notice show the site-specific
recovery instruction.

## Document-Version Reload Cache

`documentLoading.sourceStore.reloadCacheTtlMs` and
`documentLoading.assetStore.reloadCacheTtlMs` enable an opt-in IndexedDB cache for original source
blobs and rendered page blobs. `0` disables this cache. A positive value keeps encrypted records for
that many milliseconds, up to 24 hours.

When a host provides stable document metadata, OpenDocViewer keys the cache by document identity
rather than by short-lived source URLs. For object-document payloads, the strongest built-in version
signal is:

- document id
- `modifiedTimestamp` metadata alias, or raw metadata field `502`
- optional page count metadata alias, or raw metadata field `504`
- file id / file order inside the document
- render settings for rendered page assets

This allows a document opened alone to be reused later when the same document is opened again or
included in a larger multi-document bundle. If no document version can be resolved, OpenDocViewer
falls back to URL-based cache keys to avoid serving stale content for a reused document id.

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
- the manual dialog has a reload button that bypasses browser/server caches with a unique cache-busting URL when a site-local manual has been replaced during an active support session
- relative links inside the loaded HTML are rewritten against the resolved file URL so images, PDFs, and other local help assets can live alongside the manual fragment
- the About dialog always exposes the support diagnostics JSON download; benchmark execution controls are separate opt-in runtime flags and default to disabled

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
The dialog can be cancelled with its cancel button or Escape; cancellation asks for confirmation
before aborting the current PDF generation run.

The legacy `print.preparationNoticeThresholdPages` key is ignored and remains only for backward
compatibility with existing site-local configuration files. Set it to `0` in new configuration files.

Configuration surface:

```js
print: {
  preparationNoticeThresholdPages: 0, // deprecated/no-op compatibility key
  actions: {
    downloadPdf: {
      enabled: true,
      label: { en: 'Save PDF', sv: 'Spara PDF' },
      tooltip: { en: 'Save the generated PDF.', sv: 'Spara den genererade PDF-filen.' }
    },
    printHtml: {
      enabled: true,
      label: { en: 'Print via HTML', sv: 'Skriv ut via HTML' },
      tooltip: {
        en: 'Use the browser print preview.',
        sv: 'Använd webbläsarens utskriftsförhandsgranskning.'
      }
    },
    printPdf: {
      enabled: true,
      label: { en: 'Print via PDF', sv: 'Skriv ut via PDF' },
      tooltip: {
        en: 'OpenDocViewer generates a PDF before printing.',
        sv: 'OpenDocViewer skapar en PDF innan utskrift.'
      }
    }
  },
  pdf: {
    enabled: true,
    defaultMode: 'direct',
    allowDownload: false,
    filename: 'opendocviewer-print.pdf',
    cacheLanguageMode: 'strict',
    marginPt: 8,
    headerReservePt: 18,
    footerReservePt: 14,
    textFontSize: 7,
    imageFallbackQuality: 0.9
  }
}
```

The older `print.prewarmIframe` optimization has been removed. HTML/browser print jobs now build
their print iframe on demand, while generated-PDF prebuild is handled by `print.pdf.prebuildAllPages`.

`print.pdf.enabled` controls whether the print dialog offers a separate **Print via PDF** action next to the normal **Print via HTML** action. `allowDownload: true` adds a separate **Save PDF** action to the print dialog. `print.actions.*.enabled` can hide individual footer buttons, while localized `label` and `tooltip` values override the button text without code changes.

The generated-PDF backend is intended for deployments where the browser is slow to build print preview from large HTML/IMG print documents. It reuses already rendered page image blobs for multi-page jobs. Active-page PDF output uses the current rendered surface to preserve transient image edits. `print.pdf.cacheLanguageMode` defaults to `strict`; set it to `ignore` only for deployments where generated PDF output is intentionally the same across UI languages for the same stable print option values.
