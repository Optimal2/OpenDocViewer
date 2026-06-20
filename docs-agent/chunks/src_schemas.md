# OpenDocViewer / src/schemas

File count: 1. Line count: 363. JSDoc symbol count: 18.

## src/schemas/portableBundle.js

OpenDocViewer — Portable Document Bundle Schema &amp; Helpers \(ESM\) Define the canonical shape for a portable, serializable set of documents and provide minimal, dependency\-free helpers to validate and normalize input.

Exports: `PORTABLE_BUNDLE_SCHEMA_VERSION`, `normalizeDocumentFile`, `normalizeDocumentEntry`, `normalizePortableBundle`, `validatePortableBundle`, `freezePortableBundle`, `createPortableBundle`, `default`

Symbols:

- `PORTABLE_BUNDLE_SCHEMA_VERSION` (constant) - Schema version of this portable bundle definition.
- `PortableSession` (typedef) - Session context for a bundle.
- `PortableDocumentFile` (typedef) - A single file reference inside a document.
- `PortableDocumentEntry` (typedef) - A single document entry containing one or more files.
- `PortableDocumentBundle` (typedef) - A portable bundle groups a session and an array of document entries.
- `ValidateReport` (typedef) - Validation report for a bundle.
- `CreateBundleResult` (typedef) - Result object for createPortableBundle
- `toObject` (function) - Coerce unknown input to a plain object \(or return null\).
- `extFromString` (function) - Extract lowercase file extension from a string \(best\-effort\).
- `normalizeMetadataAliases` (function) - Normalize an alias\-based metadata object to a predictable string map.
- `normalizeMetadataAliasDetails` (function) - Preserve a richer semantic alias object map without trying to deeply validate every property.
- `normalizeMetadataIndex` (function) - Preserve a raw metadata lookup map without imposing a rigid record schema here.
