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
- runtime-configurable metadata promotion
- defaulting / compatibility shaping

It should not become a general-purpose transport layer or viewer state manager.

## Operational advice

- prefer adding new host formats by extending normalization rather than branching inside UI components
- keep integration-specific logging close to the integration layer
- do not let viewer components depend directly on transport-specific payload shapes


## Host-specific metadata promotion

`normalizePortableBundle.js` may promote selected metadata records into semantic document fields on
OpenDocViewer's neutral bundle model. That mapping is controlled by runtime config rather than by
hardcoded identifiers in source.

Use deployment-local runtime config when a particular embedding host needs to map one or more
metadata-record identifiers to semantic fields such as `created` or `modified`.

