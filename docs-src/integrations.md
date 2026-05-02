# Integration Guide

This document defines how host applications should provide OpenDocViewer with files and document metadata. It is both the human integration guide and the Codex-facing contract for future host work, including IbsPackager manual review.

## Goals

OpenDocViewer should stay a generic viewer:

- Host applications own authentication, authorization, workflow state, review decisions, and audit rules.
- OpenDocViewer owns file loading, rendering, navigation, metadata display, printing, and viewer diagnostics.
- Host-specific data must cross the boundary as a documented payload, not as hardcoded viewer behavior.

## Main Modules

- `src/integrations/bootstrapRuntime.js`
  - chooses the startup source and exposes `window.ODV.start(...)`
- `src/integrations/parentBridge.js`
  - reads same-origin parent-window bootstrap data from `window.parent.ODV_BOOTSTRAP`
- `src/integrations/sessionToken.js`
  - decodes `?sessiondata=<base64-json>` payloads
- `src/integrations/urlParams.js`
  - supports legacy pattern mode from URL query parameters
- `src/integrations/normalizePortableBundle.js`
  - normalizes host payloads into the Portable Document Bundle shape
- `src/schemas/portableBundle.js`
  - documents the schema version and lightweight validation helpers
- `src/components/DocumentLoader/sources/explicitListSource.js`
  - converts a normalized bundle into the ordered file URL list consumed by the loader
- `src/utils/documentMetadata.js`
  - builds UI-friendly metadata views from the normalized bundle

## Recommended Contract

Use Portable Document Bundle v1 for new integrations.

The bundle is JSON-serializable and should contain:

- `session`
  - `id`: stable viewer-session identifier
  - `userId`: optional display/audit context
  - `issuedAt`: optional ISO timestamp
- `documents`
  - ordered list of logical documents
  - each document has a stable `documentId`
  - each document has an ordered `files` list
  - each document may include raw and semantic metadata
- `integration`
  - optional transport and host context
  - optional `mediaConfiguration` describing metadata captions, ordering, and presentation hints

Minimal example:

```js
window.ODV.start({
  bundle: {
    session: {
      id: 'manual-review:review-item-123',
      userId: 'DOMAIN\\user',
      issuedAt: new Date().toISOString()
    },
    documents: [
      {
        documentId: 'review-item-123',
        files: [
          {
            id: 'file-1',
            url: '/ibspackager/manual-review/files/file-1',
            ext: 'pdf',
            displayName: 'Invoice 4711.pdf'
          }
        ],
        meta: [
          { id: 'jobId', key: 'jobId', value: 'job-456', label: 'Job ID' },
          { id: 'reviewItemId', key: 'reviewItemId', value: 'review-item-123', label: 'Review item ID' },
          { id: 'channelKey', key: 'channelKey', value: 'local_file_drop_test', label: 'Channel' }
        ],
        metadata: {
          jobId: 'job-456',
          reviewItemId: 'review-item-123',
          channelKey: 'local_file_drop_test'
        }
      }
    ],
    integration: {
      source: 'IbsPackager.ManualReview'
    }
  }
});
```

## File References

For hosted browser integrations, each file entry should provide a browser-reachable `url`.

```js
{
  id: 'file-1',
  url: '/ibspackager/manual-review/files/file-1',
  ext: 'pdf',
  displayName: 'Invoice 4711.pdf'
}
```

File reference rules:

- `url` should be an absolute URL or a same-origin relative URL.
- `ext` should be supplied when known: `pdf`, `tif`, `tiff`, `png`, `jpg`, or `jpeg`.
- `id` should be stable for the physical file or file ticket.
- File order must be deterministic because the loader preserves document order and file order.
- Avoid raw Windows file paths in browser payloads.
- Use a controller, proxy, or file-ticket endpoint when the source file lives outside the web root.
- Short-lived URLs must remain valid long enough for lazy loading, thumbnails, printing, reloads, and retries.
- Prefer same-origin file URLs to avoid CORS and cookie/authentication issues.

`path` is preserved by normalization, but the explicit-list loader currently needs `url` for actual browser loading. Treat `path` as diagnostic or host-context data unless a deployment explicitly maps it to a URL before startup.

## Metadata Contract

OpenDocViewer preserves metadata in parallel forms so hosts can keep their raw data while the viewer can display useful rows.

Preferred per-document metadata:

- `meta`
  - ordered rich raw records
  - best source for metadata dialogs and future print/header features
- `metaById`
  - optional lookup keyed by metadata field id
  - useful when host code already has a keyed dictionary
- `metadata`
  - optional semantic alias to selected display text
  - useful for common tokens such as `jobId`, `documentDate`, or `channelKey`
- `metadataDetails`
  - optional richer semantic alias map
  - useful when alias text needs source, field id, label, type, or context details

Raw metadata record example:

```js
{
  id: 'sourceFileName',
  key: 'sourceFileName',
  value: 'invoice-4711.pdf',
  lookupValue: undefined,
  label: 'Source file'
}
```

Metadata rules:

- Keep raw metadata in `meta` whenever possible.
- Use stable field ids; avoid UI captions as primary identifiers.
- Use `label` for display captions.
- Use `value` for stored/raw values and `lookupValue` for human-friendly lookup captions.
- Do not put secrets, connection strings, raw access tokens, or hidden authorization decisions in metadata.
- Treat metadata as display and audit context only. Authorization must be enforced by the host endpoints.

## Media Configuration

When a host has metadata presentation rules, pass them under `bundle.integration.mediaConfiguration`.

The normalizer preserves:

- large metadata field definitions
- metadata sort field definitions
- document description field lists
- short-description field lists
- print-reference field lists
- `metadataFieldsById` catalogs with known captions

OpenDocViewer does not blindly execute host formatter strings. The data is preserved so viewer features can use ordering, captions, and hints in controlled code paths.

## Metadata Alias Mapping

`normalizePortableBundle.js` can resolve selected metadata records into semantic aliases through runtime config. This keeps host field ids out of source code.

Supported runtime config forms per alias:

- string: one field id
- array: ordered fallback field ids
- object:
  - `fieldId` or `fieldIds`
  - `prefer`: `value`, `lookupValue`, `valueThenLookup`, or `lookupThenValue`
  - optional `label`, `type`, and `contexts`

Example:

```js
integrations: {
  portableBundle: {
    metadataAliases: {
      jobId: 'job-id',
      documentDate: ['document-date', 'created-at'],
      channelName: {
        fieldId: 'channel',
        prefer: 'lookupValue',
        label: 'Channel',
        type: 'string',
        contexts: ['screen', 'print']
      }
    }
  }
}
```

Resolved aliases are stored on `document.metadata` and `document.metadataDetails`. Raw records remain available on `document.meta` and `document.metaById`.

## Bootstrap Modes

`bootstrapRuntime.js` probes startup sources in this order:

1. Parent page bridge (`parent-page`)
2. Session token (`session-token`)
3. URL parameters (`url-params`)
4. JavaScript API (`js-api`)
5. Demo mode (`demo`)

Use this decision table for new integrations:

| Mode | Use When | Payload Location | Notes |
| --- | --- | --- | --- |
| JS API | ODV is mounted by host script on the same page | `window.ODV.start({ bundle })` | Easiest for controlled same-page integrations. |
| Parent bridge | ODV is embedded in a same-origin iframe | `window.parent.ODV_BOOTSTRAP` | Works only when iframe and parent are same-origin. |
| Session token | Payload is large, sensitive, or prepared server-side | `?sessiondata=<base64-json>` | Current implementation decodes the token locally; do not place secrets in it. |
| URL params | Host can derive a simple numbered source pattern | `?folder=...&ext=...&pages=...` | Legacy/simple mode; not recommended for manual review metadata. |
| Demo | No host data exists | bundled public sample assets | Development fallback. |

## IbsPackager Manual Review Guidance

For the upcoming IbsPackager manual-review integration, prefer this boundary:

- IbsPackager supplies one Portable Document Bundle for the active review item or review batch.
- IbsPackager exposes file URLs through authenticated same-origin endpoints.
- IbsPackager owns review commands such as approve, reject, retry, route, or save comment.
- OpenDocViewer displays files and metadata and may emit generic viewer events only if such a bridge is explicitly added later.

Recommended metadata for manual review:

- job id
- review item id
- package id or package name, when available
- channel key/name
- source file name/path as display context
- detected document type, when available
- validation or failure reason
- attempt count
- created/received timestamp
- last updated timestamp
- current manual-review status

Do not let ODV infer business meaning from IbsPackager-specific field ids. Either display raw metadata generically or use runtime-configured aliases.

## Versioning

Portable Document Bundle schema version is currently `1` in `src/schemas/portableBundle.js`.

Versioning rules:

- Add optional fields without changing the version.
- Preserve existing field names and semantic types whenever possible.
- Increment the schema version only for breaking changes that a v1 reader could misinterpret.
- Keep `docs-src/integrations.md`, `src/schemas/portableBundle.js`, and `src/integrations/normalizePortableBundle.js` aligned.

## Validation Checklist For Hosts

Before wiring a host to OpenDocViewer, verify:

- The startup mode is intentional and documented.
- Every visible file has a browser-reachable `url`.
- File URLs work after reload and during lazy rendering/printing.
- File endpoint authorization is enforced server-side.
- CORS and cookies work for the chosen iframe/same-page deployment.
- `documentId` and file `id` values are stable across reloads.
- Metadata contains no secrets or raw bearer/session tokens.
- Raw metadata is available in `meta` when the host has it.
- Runtime-configured aliases are used instead of hardcoded viewer field ids.
- Large batches stay within the configured loading and cache profile.

## Normalization Boundary

`normalizePortableBundle.js` should remain focused on:

- structural cleanup
- tolerant field mapping
- runtime-configurable metadata alias mapping
- metadata preservation for later UI/print logic
- defaulting and compatibility shaping

It should not become a transport layer, permission system, workflow engine, or viewer state manager.

When adding a new host shape, prefer extending normalization rather than branching inside UI components. Viewer components should consume the normalized bundle model.

## Access Inside The App

The full normalized bundle is exposed through `ViewerContext` as `bundle`.

This gives components a stable access path for:

- document-level metadata panels
- metadata-based print headers
- document tooltips
- document-aware context menus
- document metadata overlay from page/thumbnail context menus
- diagnostics or support views

Avoid copying host-specific metadata onto every page entry unless the rendering pipeline genuinely needs page-level data.
