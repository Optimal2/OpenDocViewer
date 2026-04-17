// File: src/components/DocumentLoader/sources/explicitListSource.js

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
 *   @property {(string|undefined)} documentId
 *   @property {(number|undefined)} documentNumber
 *   @property {(number|undefined)} totalDocuments
 *   @property {(number|undefined)} documentFileNumber
 *   @property {(number|undefined)} documentFileCount
 *
 *   @typedef {Object} ExplicitSourceList
 *   @property {number} total
 *   @property {Array.<ExplicitSourceItem>} items
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
 * @property {(string|undefined)} documentId
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
 * The source list also keeps just enough document context for the loader to rebuild document-aware
 * page numbering after multi-page TIFF/PDF analysis has completed.
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
  const totalDocuments = docs.length;

  for (let docIndex = 0; docIndex < docs.length; docIndex += 1) {
    const doc = docs[docIndex];
    const files = Array.isArray(doc?.files) ? doc.files : [];
    const documentNumber = docIndex + 1;

    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const file = files[fileIndex];
      const url = typeof file?.url === 'string' && file.url.trim() ? file.url : '';
      if (!url) continue;

      const ext = (typeof file.ext === 'string' && file.ext.trim()) ? file.ext : inferExtFromUrl(url);
      items.push({
        url,
        ext,
        fileIndex: idx++,
        documentId: typeof doc?.documentId === 'string' && doc.documentId ? doc.documentId : undefined,
        documentNumber,
        totalDocuments,
        documentFileNumber: fileIndex + 1,
        documentFileCount: files.length,
      });
    }
  }

  return { total: items.length, items };
}
