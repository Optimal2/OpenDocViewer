# Integration notes

This document describes the startup and host-integration layer. The goal of the integration code is to normalize many possible host payload shapes into one viewer-facing input model.

## Modules

- `src/integrations/bootstrapRuntime.js`
  - main startup decision point
- `src/integrations/urlParams.js`
  - legacy query-string driven startup
- `src/integrations/parentBridge.js`
  - same-origin parent window bridge
- `src/integrations/sessionToken.js`
  - token-based startup retrieval
- `src/integrations/normalizePortableBundle.js`
  - converts different host bundle shapes into one neutral form

## Design intent

The rest of the app should not care whether the source data arrived from:

- URL parameters
- a same-origin embedding parent
- a session-token lookup
- a direct JavaScript bootstrap object
- demo mode

That knowledge should stop at the integration layer.

## Bootstrap modes in practice

### Pattern mode

Used when the app can derive source URLs from folder + extension + page count.

### Explicit list mode

Used when a host already knows the exact ordered source list.

### Parent bridge mode

Used when the viewer is embedded and can synchronously read host-provided same-origin data.

### Session-token mode

Used when the frontend needs to fetch or resolve a previously prepared payload identified by a token.

## Normalization boundary

`normalizePortableBundle.js` is the critical adapter. It should remain focused on:

- structural cleanup
- tolerant field mapping
- runtime-configurable metadata alias mapping
- metadata preservation for later UI/print logic
- defaulting / compatibility shaping

It should not become a general-purpose transport layer or viewer state manager.

## Operational advice

- prefer adding new host formats by extending normalization rather than branching inside UI components
- keep integration-specific logging close to the integration layer
- do not let viewer components depend directly on transport-specific payload shapes

## Metadata preservation model

The normalized bundle now keeps three parallel metadata surfaces per document:

- `document.meta`
  - ordered, rich raw records
  - keeps `id`, `value`, `lookupValue`, labels when known, and unknown record properties
- `document.metaById`
  - object lookup keyed by metadata field id
  - useful for direct access without rescanning the ordered array
- `document.metadata` and `document.metadataDetails`
  - optional semantic aliases derived from runtime config
  - `metadata` is the simple alias -> selected text map
  - `metadataDetails` keeps the richer alias resolution details

This means the app can stay generic:

- if no alias mapping is configured, no semantic aliases are produced
- raw metadata still remains available in the normalized bundle
- future UI or print features can consume either raw records or semantic aliases depending on need

## Media configuration preservation

When a host payload includes a document/media presentation object, the integration layer now keeps a
normalized copy at `bundle.integration.mediaConfiguration`.

That normalized structure preserves, when available:

- large metadata field definitions
- metadata sort field definitions
- description / short-description / print-reference field lists
- a merged `metadataFieldsById` catalog with known captions by source

The viewer does not blindly execute host formatter strings. The data is preserved so future features
can use the field ordering, captions, and format hints in a controlled way.

## Host-specific metadata alias mapping

`normalizePortableBundle.js` may resolve selected metadata records into a semantic alias map on the
neutral bundle model. That mapping is controlled by runtime config rather than by hardcoded identifiers
in source.

Supported runtime-config values per alias:

- string
  - one field id
- array
  - ordered fallback field ids
- object
  - `fieldId` / `fieldIds`
  - `prefer`: `value`, `lookupValue`, `valueThenLookup`, or `lookupThenValue`
  - optional `label`, `type`, and `contexts`

Example:

```js
integrations: {
  portableBundle: {
    metadataAliases: {
      patientId: 'patient-id',
      documentDate: ['primary-date', 'fallback-date'],
      unitName: {
        fieldId: 'unit',
        prefer: 'lookupValue',
        label: 'Unit',
        type: 'string',
        contexts: ['screen', 'print']
      }
    }
  }
}
```

Resolved aliases are stored on:

- `document.metadata`
- `document.metadataDetails`

while the normalized raw records remain available on:

- `document.meta`
- `document.metaById`

## Access inside the app

The full normalized bundle is now also exposed through `ViewerContext` as `bundle`.

That gives future components a stable access path for:

- document-level metadata panels
- metadata-based print headers
- document tooltips
- document-aware context menus
- document metadata overlay from page/thumbnail context menus when metadata is available
- diagnostics or support views

without forcing metadata copies onto every page entry.
