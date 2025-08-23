// File: src/components/DocumentLoader/sources/ExplicitListSource.js

/**
 * Convert a PortableDocumentBundle into a flat, ordered list of file URLs.
 * We preserve the document order and file order given.
 * Returns: { total, items: Array<{ url: string, ext?: string, fileIndex: number }> }
 */
export function makeExplicitSource(bundle) {
  if (!bundle?.documents?.length) return { total: 0, items: [] };

  const items = [];
  let idx = 0;
  for (const doc of bundle.documents) {
    for (const f of (doc.files || [])) {
      const url = f?.url;
      const ext = f?.ext;
      if (!url) continue;
      items.push({ url, ext, fileIndex: idx++ });
    }
  }
  return { total: items.length, items };
}
