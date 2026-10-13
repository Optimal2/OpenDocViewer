// File: src/components/__tests__/toolbarAttributeBlock.js
/**
 * Extract the `<DocumentViewerToolbar ... />` element's OWN attribute block from the
 * DocumentViewer.jsx source text.
 *
 * The match runs from the opening tag to its closing `/>` with NO other `<` in between,
 * so a prop that is deleted from the toolbar element — or moved to a LATER element in the
 * same file — is NOT found inside the returned substring. An unbounded
 * `<DocumentViewerToolbar[\s\S]*?prop` idiom cannot see such a relocation; this can.
 */
import { expect } from 'vitest';

const TOOLBAR_ELEMENT_PATTERN = /<DocumentViewerToolbar[^<]*\/>/;

/** @param {string} viewerSource the DocumentViewer.jsx source text @returns {string} */
export function toolbarAttributeBlock(viewerSource) {
  const match = viewerSource.match(TOOLBAR_ELEMENT_PATTERN);
  expect(match, 'expected one self-closing <DocumentViewerToolbar ... /> element in DocumentViewer.jsx').not.toBeNull();
  return match[0];
}
