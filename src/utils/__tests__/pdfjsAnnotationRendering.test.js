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
 *   4. the zero-rect + Locked-flag invisible signature shape;
 *   5. text/checkbox widgets, ordinary annotations and Hidden/NoView filtering.
 *
 * Pixel-level proof that the painted raster actually contains (or omits) the
 * appearance lives in tests/ui/signature-appearance.spec.mjs (Playwright,
 * real browser canvas).
 *
 * @vitest-environment node
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { createSignatureFixtures, SIGNATURE_APPEARANCE_RECT } from '../../../scripts/generate-signature-fixtures.mjs';
import { createAnnotationFixture } from '../../../scripts/generate-annotation-fixtures.mjs';

let pdfjs;
let fixtures;

beforeAll(async () => {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  fixtures = await createSignatureFixtures();
}, 120000);

/** @param {Uint8Array} bytes @returns {Promise<Array<*>>} */
async function getDisplayAnnotations(bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    return await page.getAnnotations({ intent: 'display' });
  } finally {
    await task.destroy();
  }
}

describe('pdfjs 6.4 annotation contract', () => {
  it('runs against the locked pdfjs 6.4.299 build', () => {
    expect(pdfjs.version).toBe('6.4.299');
  });

  it('exposes the annotation modes used by the rendering contract', () => {
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
    expect(widget.annotationFlags & 2).toBe(0); // Hidden
  });

  it('marks the appearance-less signature widget as having nothing to paint', async () => {
    const annotations = await getDisplayAnnotations(fixtures['invisible-appearance.pdf']);
    const widget = annotations.find((annotation) => annotation.subtype === 'Widget');
    expect(widget).toBeTruthy();
    expect(widget.fieldType).toBe('Sig');
    expect(widget.rect).toEqual(SIGNATURE_APPEARANCE_RECT);
    expect(widget.hasAppearance).toBe(false);
  });

  it('keeps the zero-rect locked invisible signature shape stable', async () => {
    const annotations = await getDisplayAnnotations(fixtures['cades-ecdsa-invisible.pdf']);
    const widget = annotations.find((annotation) => annotation.subtype === 'Widget');
    expect(widget).toBeTruthy();
    expect(widget.fieldType).toBe('Sig');
    expect(widget.rect).toEqual([0, 0, 0, 0]);
    expect(widget.hasAppearance).toBe(false);
    expect(widget.annotationFlags & 128).toBe(128); // Locked, not Hidden
    expect(widget.annotationFlags & 2).toBe(0);
  });

  it.each([
    ['visible-appearance.pdf', 1],
    ['invisible-appearance.pdf', 0],
    ['cades-ecdsa-invisible.pdf', 0],
  ])('%s emits the expected signature appearance operators (%i)', async (name, expectedCount) => {
    const task = pdfjs.getDocument({ data: fixtures[name].slice(), isEvalSupported: false });
    try {
      const doc = await task.promise;
      const page = await doc.getPage(1);
      const ops = await page.getOperatorList();
      expect(ops.fnArray.filter((fn) => fn === pdfjs.OPS.beginAnnotation)).toHaveLength(expectedCount);
    } finally {
      await task.destroy();
    }
  });

  it('parses text, checkbox state and ordinary annotation appearances', async () => {
    const annotations = await getDisplayAnnotations(createAnnotationFixture());
    expect(annotations).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldName: 'text', fieldType: 'Tx', hasAppearance: true }),
      expect.objectContaining({ fieldName: 'checkbox', fieldType: 'Btn', checkBox: true, fieldValue: 'Yes', hasAppearance: true }),
      expect.objectContaining({ subtype: 'Square', hasAppearance: true }),
    ]));
  });

  it('emits only visible appearances by default and removes them when annotations are disabled', async () => {
    const task = pdfjs.getDocument({ data: createAnnotationFixture(), isEvalSupported: false });
    try {
      const doc = await task.promise;
      const page = await doc.getPage(1);
      const annotationIds = (ops) => ops.fnArray.flatMap((fn, index) => (
        fn === pdfjs.OPS.beginAnnotation ? [ops.argsArray[index][0]] : []
      ));
      expect(annotationIds(await page.getOperatorList()).sort()).toEqual(['10R', '11R', '14R']);
      expect(annotationIds(await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE }))).toEqual([]);
    } finally {
      await task.destroy();
    }
  });
});
