// File: src/components/DocumentLoader/sources/ExplicitListSource.js

/**
 * OpenDocViewer — Explicit Source List Normalizer
 *
 * PURPOSE
 *   Convert a PortableDocumentBundle into a flat, ordered list of file entries
 *   that the loader can process deterministically. The resulting list preserves
 *   document order and file order as provided by the host.
 *
 * OUTPUT SHAPE (Closure-style)
 *   @typedef {Object} ExplicitSourceItem
 *   @property {string} url
 *   @property {(string|undefined)} ext
 *   @property {number} fileIndex
 *
 *   @typedef {Object} ExplicitSourceList
 *   @property {number} total
 *   @property {Array.<ExplicitSourceItem>} items
 *
 * DESIGN NOTES
 *   - We deliberately do *not* try to deduplicate URLs; order is authoritative.
 *   - If an item lacks an `ext` hint, we infer it from the URL as a best-effort
 *     convenience (the loader still uses robust signature-based detection).
 *   - We overwrite any incoming fileIndex to guarantee a stable, continuous 0..N-1
 *     sequence — this avoids accidental gaps/duplicates from hosts.
 *
 * IMPORTANT PROJECT GOTCHA (for future reviewers)
 *   - Elsewhere in the project we import from the **root** 'file-type' package, NOT
 *     'file-type/browser'. With `file-type` v21 that subpath is not exported for
 *     bundlers and will break Vite builds. Keep this in mind when editing loaders.
 */

/**
 * A single file reference in a portable document.
 * @typedef {Object} PortableFile
 * @property {string} url
 * @property {(string|undefined)} ext
 */

/**
 * Portable document containing a list of files.
 * @typedef {Object} PortableDoc
 * @property {(Array.<PortableFile>|undefined)} files
 */

/**
 * Bundle containing multiple portable documents.
 * @typedef {Object} PortableDocumentBundle
 * @property {(Array.<PortableDoc>|undefined)} documents
 */

/**
 * Infer a lowercase extension from a URL if present.
 * Query strings and hashes are ignored.
 * @param {string} url
 * @returns {(string|undefined)}
 */
function inferExtFromUrl(url) {
  try {
    const path = String(url).split(/[?#]/)[0];
    const m = path.match(/\.([a-z0-9]+)$/i);
    return m ? m[1].toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Convert a PortableDocumentBundle into a flat, ordered list of file URLs.
 * We preserve the document order and file order given, and assign a stable,
 * continuous `fileIndex` across the entire bundle.
 *
 * @param {(PortableDocumentBundle|null|undefined)} bundle
 * @returns {ExplicitSourceList}
 */
export function makeExplicitSource(bundle) {
  const docs = Array.isArray(bundle?.documents) ? bundle.documents : [];
  if (docs.length === 0) return { total: 0, items: [] };

  /** @type {Array.<ExplicitSourceItem>} */
  const items = [];
  let idx = 0;

  for (const doc of docs) {
    const files = Array.isArray(doc?.files) ? doc.files : [];
    for (const f of files) {
      const url = typeof f?.url === 'string' && f.url.trim() ? f.url : '';
      if (!url) continue;

      // Prefer provided ext; otherwise infer from URL (loader will still sniff).
      const ext = (typeof f.ext === 'string' && f.ext.trim()) ? f.ext : inferExtFromUrl(url);

      items.push({ url, ext, fileIndex: idx++ });
    }
  }

  return { total: items.length, items };
}
