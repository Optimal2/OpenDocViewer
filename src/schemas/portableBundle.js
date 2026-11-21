// File: src/schemas/portableBundle.js
/**
 * File: src/schemas/portableBundle.js
 *
 * OpenDocViewer — Portable Document Bundle Schema (ESM)
 *
 * PURPOSE
 *   Define the canonical shape (JSDoc typedefs) and the schema version for a portable,
 *   serializable set of documents.
 *
 * DESIGN NOTES
 *   - This module holds the contract only. The run path normalizes every accepted payload in
 *     `src/integrations/normalizePortableBundle.js`, which is deliberately lenient: it does not
 *     reject a bundle, and it generates `session.id` and `documentId` when the host leaves them out.
 *   - The schema is intentionally permissive for `files`: each entry may be either
 *     a string (treated as a URL or path) or a small object with optional fields.
 *   - This module has no runtime side-effects and can be used in Node or the browser.
 *
 */

/**
 * Schema version of this portable bundle definition.
 *
 * Increment this only when the normalized bundle shape changes in a way that would break a reader
 * expecting the previous contract, for example if a required top-level key changes name, a field's
 * semantic type changes incompatibly, or a normalization rule stops producing data that callers may
 * already rely on. Additive optional fields normally do not require a version bump.
 */
export const PORTABLE_BUNDLE_SCHEMA_VERSION = 1;

/**
 * Session context for a bundle.
 * @typedef {Object} PortableSession
 * @property {string} id
 * @property {(string|undefined)} userId
 * @property {(string|undefined)} issuedAt
 */

/**
 * A single file reference inside a document.
 * When a string is provided in input, it is normalized to `{ url: string }`.
 *
 * @typedef {Object} PortableDocumentFile
 * @property {string} [id]    - Caller-defined identifier (optional).
 * @property {string} [ext]   - File extension without dot (e.g., "png", "tiff").
 * @property {string} [path]  - Local/relative path (for portable/embedded deployments).
 * @property {string} [url]   - Absolute/relative URL (for hosted deployments).
 * @property {string} [inlineBase64]    - Optional Base64 source bytes for small files.
 * @property {string} [inlineMimeType]  - Optional MIME type for inline source bytes.
 * @property {number} [inlineSizeBytes] - Optional decoded byte count for inline source bytes.
 */

/**
 * A single document entry containing one or more files.
 *
 * @typedef {Object} PortableDocumentEntry
 * @property {string} documentId                                   - Required stable ID for the document.
 * @property {*} [meta]                                            - Rich raw metadata records (client-defined).
 * @property {*} [metaById]                                        - Optional metadata lookup map by field id.
 * @property {(Object.<string, string>|undefined)} [metadata]      - Optional semantic metadata alias -> text map.
 * @property {*} [metadataDetails]                                 - Optional rich semantic metadata alias map.
 * @property {Array.<(string|PortableDocumentFile)>} files         - Required list of file refs.
 */

/**
 * A portable bundle groups a session and an array of document entries.
 *
 * @typedef {Object} PortableDocumentBundle
 * @property {PortableSession} session
 * @property {Array.<PortableDocumentEntry>} documents
 * @property {Object=} integration
 */
