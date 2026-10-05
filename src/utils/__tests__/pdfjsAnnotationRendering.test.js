/**
 * Regression lock for the pdfjs-dist 6.4 annotation contract (campaign
 * opendocviewer-pdfjs-6-4-renderingsregression).
 *
 * The viewer renders PDF pages with `page.render({ canvasContext, viewport })`
 * and never passes an explicit `annotationMode`, so pdfjs' default
 * (AnnotationMode.ENABLE) decides whether signature appearances and other
 * widget annotations are painted into the page raster. pdfjs 6.4 touched
 * annotation rendering, which is the same surface the Level-1/Level-2
 * signature display relies on. These tests pin, against the REAL pdfjs build
 * and real signed fixtures:
 *
 *   1. the pdfjs version under test (the lock is meaningless on another line);
 *   2. the annotation contract for a signature widget WITH an appearance
 *      stream (visible signature) — it must be exposed with hasAppearance
 *      true so the renderer paints it;
 *   3. the contract for a signature widget WITHOUT an appearance stream
 *      (invisible signature) — hasAppearance false, so nothing is painted;
 *   4. the zero-rect + hidden-flag invisible signature shape.
 *
 * Pixel-level proof that the painted raster actually contains (or omits) the
 * appearance lives in tests/ui/signature-appearance.spec.mjs (Playwright,
 * real browser canvas).
 *
 * @vitest-environment node
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { createSignatureFixtures, SIGNATURE_APPEARANCE_RECT } from '../../../scripts/generate-signature-fixtures.mjs';

let pdfjs;
let fixtures;

beforeAll(async () => {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  fixtures = await createSignatureFixtures();
}, 120000);

/** @param {Uint8Array} bytes @returns {Promise<Array<*>>} */
async function getDisplayAnnotations(bytes) {
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    return await page.getAnnotations({ intent: 'display' });
  } finally {
    await task.destroy();
  }
}

describe('pdfjs 6.4 annotation contract', () => {
  it('runs against the pdfjs 6.4 line the campaign locks (package.json ^6.4.299)', () => {
    expect(pdfjs.version).toMatch(/^6\.4\./);
  });

  it('exposes AnnotationMode with ENABLE as the render default the viewer relies on', () => {
    expect(pdfjs.AnnotationMode).toMatchObject({ DISABLE: 0, ENABLE: 1 });
  });

  it('marks the visible signature widget as having a paintable appearance', async () => {
    const annotations = await getDisplayAnnotations(fixtures['visible-appearance.pdf']);
    const widget = annotations.find((annotation) => annotation.subtype === 'Widget');
    expect(widget).toBeTruthy();
    expect(widget.fieldType).toBe('Sig');
    expect(widget.rect).toEqual(SIGNATURE_APPEARANCE_RECT);
    expect(widget.hasAppearance).toBe(true);
    expect(widget.hidden).toBe(false);
    expect(widget.annotationFlags & 128).toBe(0); // not the hidden flag
  });

  it('marks the appearance-less signature widget as having nothing to paint', async () => {
    const annotations = await getDisplayAnnotations(fixtures['invisible-appearance.pdf']);
    const widget = annotations.find((annotation) => annotation.subtype === 'Widget');
    expect(widget).toBeTruthy();
    expect(widget.fieldType).toBe('Sig');
    expect(widget.rect).toEqual(SIGNATURE_APPEARANCE_RECT);
    expect(widget.hasAppearance).toBe(false);
  });

  it('keeps the zero-rect hidden-flag invisible signature shape stable', async () => {
    const annotations = await getDisplayAnnotations(fixtures['cades-ecdsa-invisible.pdf']);
    const widget = annotations.find((annotation) => annotation.subtype === 'Widget');
    expect(widget).toBeTruthy();
    expect(widget.fieldType).toBe('Sig');
    expect(widget.rect).toEqual([0, 0, 0, 0]);
    expect(widget.hasAppearance).toBe(false);
    expect(widget.annotationFlags & 128).toBe(128); // hidden flag survives parsing
  });
});
