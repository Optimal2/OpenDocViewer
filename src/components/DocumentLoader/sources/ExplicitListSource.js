// File: src/components/DocumentLoader/sources/ExplicitListSource.js

/**
 * OpenDocViewer — Explicit Source List Normalizer
 *
 * PURPOSE
 *   Convert a PortableDocumentBundle into a flat, ordered list of file entries
 *   that the loader can process deterministically. The resulting list preserves
 *   document order and file order as provided by the host.
 *
 * OUTPUT SHAPE
 *   {
 *     total: number,
 *     items: Array<{
 *       url: string,
 *       ext?: string,     // optional extension hint; loader will still sniff bytes
 *       fileIndex: number // 0-based, stable order index across the whole bundle
 *     }>
 *   }
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
 *
 * Provenance / baseline reference for earlier version of this module:
 * :contentReference[oaicite:0]{index=0}
 */

/**
 * @typedef {{ url: string, ext?: string }} PortableFile
 * @typedef {{ files?: PortableFile[] }} PortableDoc
 * @typedef {{ documents?: PortableDoc[] }} PortableDocumentBundle
 */

/**
 * Infer a lowercase extension from a URL if present.
 * Query strings and hashes are ignored.
 * @param {string} url
 * @returns {string|undefined}
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
 * @param {PortableDocumentBundle|null|undefined} bundle
 * @returns {{ total: number, items: Array<{ url: string, ext?: string, fileIndex: number }> }}
 */
export function makeExplicitSource(bundle) {
  const docs = Array.isArray(bundle?.documents) ? bundle.documents : [];
  if (docs.length === 0) return { total: 0, items: [] };

  /** @type {Array<{ url: string, ext?: string, fileIndex: number }>} */
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
