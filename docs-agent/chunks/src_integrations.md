# OpenDocViewer / src/integrations

File count: 7. Line count: 2073. JSDoc symbol count: 52.

## src/integrations/bootstrapRuntime.js

Startup mode detection and host-integration entry point.

Exports: ODV_BOOTSTRAP_MODES, bootstrapDetect

Local imports: src/integrations/parentBridge.js, src/integrations/sessionToken.js, src/integrations/sessionUrl.js, src/integrations/urlParams.js, src/integrations/normalizePortableBundle.js

Symbols:

- `ODV_BOOTSTRAP_MODES` (constant) - Canonical bootstrap modes.
- `BootstrapDebugInfo` (typedef) - Opaque information about how startup data reached the viewer.
- `BootstrapAny` (typedef) - No description.
- `ODVHostApi` (typedef) - Host API shape exposed on window.ODV.
- `BootstrapDetectOptions` (typedef) - Options controlling bootstrap diagnostics collection.
- `<anonymous>~api.start` (function) - Queue a start payload to be consumed by bootstrapDetect().
- `tryNormalizeBundle` (function) - Try to normalize a candidate payload into a bundle with documents.
- `makeDebugInfo` (function) - Build the debug envelope returned to the app shell.
- `bootstrapDetect` (function) - Detect the best available bootstrap mode.
- `bootstrapDetect~probeParent` (function) - No description.
- `bootstrapDetect~probeSessionUrl` (function) - No description.
- `bootstrapDetect~probeSessionToken` (function) - No description.

## src/integrations/normalizePortableBundle.js

Normalizes multiple host payload shapes into the project's neutral portable bundle shape.

Exports: normalizeToPortableBundle, default

Local imports: src/utils/runtimeConfig.js, src/utils/idUtils.js

Symbols:

- `PortableSession` (typedef) - Session info stored on a bundle.
- `PortableDocumentFile` (typedef) - A single file reference inside a document.
- `PortableMetadataRecord` (typedef) - A normalized raw metadata record attached to a document.
- `PortableMetadataAliasDetail` (typedef) - One resolved semantic alias derived from raw metadata records.
- `PortableDocumentEntry` (typedef) - A single document entry containing one or more files.
- `PortableDocumentBundle` (typedef) - A portable bundle groups a session and an array of document entries.
- `PortableBundleMetadataAliasMap` (typedef) - Runtime-configurable mapping between semantic metadata aliases and metadata record identifiers used by a host-specific object-document payload.
- `normalizeToPortableBundle` (function) - Normalize many incoming shapes to a neutral PortableDocumentBundle v1.
- `spreadUnknown` (function) - Preserve unknown own enumerable properties from host input while excluding keys that were already normalized explicitly.

## src/integrations/parentBridge.js

Same-origin parent-window bootstrap adapter.

Exports: readFromParent, readFromOpener, readFromRelatedWindow, default

Symbols:

- `ParentBootstrapResult` (typedef) - Result object when data is obtained from a same-origin parent.
- `getSameOriginParent` (function) - Try to obtain a same-origin parent window reference.
- `getSameOriginOpener` (function) - Try to obtain a same-origin opener window reference.
- `safeClone` (function) - Perform a safe, structured clone of serializable data.
- `b64DecodeUnicode` (function) - Decode a base64-encoded Unicode string into text (handles UTF-8).
- `readFromWindow` (function) - Attempt to read a bootstrap object from a same-origin related window.
- `readFromParent` (function) - Attempt to read a bootstrap object from a same-origin parent.
- `readFromOpener` (function) - Attempt to read a bootstrap object from a same-origin opener.
- `readFromRelatedWindow` (function) - Attempt to read a bootstrap object from a same-origin parent or opener.

## src/integrations/sessionToken.js

OpenDocViewer — Session Token Reader (Browser-only) Decode an optional Base64/URL-safe Base64 JSON payload provided via the query string: ?sessiondata=<base64> This enables hosts to pass a compact, self-contained “portab

Exports: b64DecodeUnicode, readFromSessionToken, default

Symbols:

- `MAX_B64_LEN` (constant) - Upper bound for the Base64 token length (~200 KB base64 ≈ 150 KB raw).
- `MAX_RAW_LEN` (constant) - Upper bound for the decoded raw string length.
- `SessionTokenResult` (typedef) - Session token read result.
- `normalizeBase64` (function) - Normalize a Base64 string to a decodable form: Trim whitespace Convert URL-safe chars '-' → '+', '_' → '/' Add '=' padding to reach a length divisible by 4
- `b64DecodeUnicode` (function) - Decode a Base64 string into a UTF-8 JavaScript string.
- `readFromSessionToken` (function) - Read and decode a session payload from the URL query string.

## src/integrations/sessionUrl.js

Fetch a host-prepared Portable Document Bundle from a short URL query value.

Exports: hasSessionUrlParameter, readFromSessionUrl, default

Symbols:

- `MAX_RESPONSE_TEXT_LEN` (constant) - Fetch a host-prepared Portable Document Bundle from a short URL query value.
- `SessionUrlResult` (typedef) - No description.
- `readFromSessionUrl` (function) - Read and fetch a session payload URL from the viewer query string.

## src/integrations/urlParams.js

OpenDocViewer — URL Parameter Reader (Browser-only) Read a minimal set of query parameters to bootstrap the viewer in “pattern mode”, i.e.

Exports: readFromUrlParams, default

Local imports: src/logging/systemLogger.js

Symbols:

- `UrlParamsData` (typedef) - No description.
- `UrlParamsResult` (typedef) - No description.
- `pick` (function) - Pick the first non-empty value among a list of candidate query keys.
- `parsePositiveInt` (function) - Parse a positive integer from a string.
- `readFromUrlParams` (function) - Reads common query params used by the demo and other hosts.

## src/integrations/viewerEvents.js

OpenDocViewer — Tiny Event Emitter/Listener Utilities (Browser-only) Lightweight helpers for broadcasting and listening to app-level DOM events.

Exports: emitODVEvent, onODVEvent, onceODVEvent, default

Local imports: src/logging/systemLogger.js

Symbols:

- `ODVEventHandler` (typedef) - Listener signature for ODV events.
- `OnceOptions` (typedef) - Options for onceODVEvent.
- `OnceEventResult` (typedef) - Result returned by onceODVEvent when the event fires.
- `createCustomEvent` (function) - Create a CustomEvent with best-effort fallback for older browsers.
- `emitODVEvent` (function) - Emit a namespaced OpenDocViewer event with an optional detail payload.
- `onODVEvent` (function) - Attach a listener for a given OpenDocViewer event.
- `onceODVEvent` (function) - Wait for a single occurrence of an event and resolve with { event, detail } .
- `clearTimeoutSafe` (function) - Clear a timer if it exists (tiny helper).
