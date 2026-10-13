// @vitest-environment node
// File: src/components/__tests__/toolbarAttributeBlock.test.js
/**
 * Proof tests for the generalised elementAttributeBlock helper.
 * Each test corresponds to a measured hole from the previous review.
 */
import { describe, it, expect } from 'vitest';
import { elementAttributeBlock, toolbarAttributeBlock } from './toolbarAttributeBlock.js';

const toolbarSource = `import x from 'y';
export function DocumentViewer() {
  return (
    <div>
      <DocumentViewerToolbar
        printPipeline={printPipeline}
        compareTransforms={compareTransforms}
        onFoo={bar}
      />
    </div>
  );
}
`;

describe('elementAttributeBlock', () => {
  it('returns the toolbar element with all of its props (regression for the three hardened call sites)', () => {
    const block = toolbarAttributeBlock(toolbarSource);
    expect(block).toMatch(/printPipeline=\{printPipeline\}/);
    expect(block).toMatch(/compareTransforms=\{compareTransforms\}/);
    expect(block).toMatch(/onFoo=\{bar\}/);
  });

  it('matches non-toolbar elements by name', () => {
    const source = `export function V() {
  return (
    <CompareOverlayView
      onPrint={p}
      printDialogs={d}
    />
  );
}
`;
    const block = elementAttributeBlock(source, 'CompareOverlayView');
    expect(block).toMatch(/onPrint=\{p\}/);
    expect(block).toMatch(/printDialogs=\{d\}/);
  });

  it('HOLE 1: a commented-out prop is invisible to the assertion (this is the big one)', () => {
    const mutated = `export function V() {
  return (
    <DocumentViewerToolbar
      // compareTransforms={compareTransforms}
      onFoo={bar}
    />
  );
}
`;
    const block = toolbarAttributeBlock(mutated);
    expect(block).not.toMatch(/compareTransforms=\{compareTransforms\}/);
  });

  it('HOLE 1: JSX block comment also strips the prop', () => {
    const mutated = `export function V() {
  return (
    <DocumentViewerToolbar
      {/* compareTransforms={compareTransforms} */}
      onFoo={bar}
    />
  );
}
`;
    const block = toolbarAttributeBlock(mutated);
    expect(block).not.toMatch(/compareTransforms=\{compareTransforms\}/);
  });

  it('HOLE 2: < inside an attribute value does NOT break the helper (legitimate comparison stays GREEN)', () => {
    const mutated = `export function V() {
  return (
    <DocumentViewerToolbar
      printPipeline={printPipeline}
      tinyZoom={zoom < 0.5}
    />
  );
}
`;
    const block = toolbarAttributeBlock(mutated);
    expect(block).toMatch(/printPipeline=\{printPipeline\}/);
    expect(block).toMatch(/tinyZoom=\{zoom < 0\.5\}/);
  });

  it('HOLE 3: the element name must end at a word boundary (V2 must not match Toolbar)', () => {
    const source = `export function V() {
  return (
    <DocumentViewerToolbarV2
      printPipeline={printPipeline}
    />
  );
}
`;
    expect(() => toolbarAttributeBlock(source)).toThrow(/expected exactly one.*DocumentViewerToolbar/);
  });

  it('HOLE 4: more than one uncommented match FAILS LOUDLY (no silent first-match-wins)', () => {
    const source = `export function V() {
  return (
    <div>
      <DocumentViewerToolbar printPipeline={p} />
      <DocumentViewerToolbar onFoo={f} />
    </div>
  );
}
`;
    expect(() => toolbarAttributeBlock(source)).toThrow(/expected exactly one.*DocumentViewerToolbar.*found 2/);
  });

  it('HOLE 4: a commented-out element does NOT anchor the match (was the false-negative risk)', () => {
    const source = `export function V() {
  return (
    <div>
      {/* <DocumentViewerToolbar printPipeline={p} /> */}
      <DocumentViewerToolbar onFoo={f} />
    </div>
  );
}
`;
    const block = toolbarAttributeBlock(source);
    expect(block).toMatch(/onFoo=\{f\}/);
    expect(block).not.toMatch(/printPipeline=\{p\}/);
  });

  it('two-prop lock: a SPLIT mutation (same prop on two elements) FAILS LOUDLY', () => {
    const source = `export function V() {
  return (
    <div>
      <CompareOverlayView
        onPrint={p}
      />
      <CompareOverlayView
        printDialogs={d}
      />
    </div>
  );
}
`;
    // The split mutation is exactly the case the new helper must catch: a
    // real-world two-prop lock (e.g. onPrint + printDialogs) where a developer
    // leaves both props in the file but on two different elements. The old
    // <Element[\s\S]*?prop1[\s\S]*?prop2 idiom stayed green because prop1 was
    // found on the first element and prop2 on the second.
    expect(() => elementAttributeBlock(source, 'CompareOverlayView'))
      .toThrow(/expected exactly one.*CompareOverlayView.*found 2/);
  });

  it('pair-tag form (non-self-closing) is supported when selfClosing: false', () => {
    const source = `export function V() {
  return (
    <Container attr1={a} attr2={b}>
      <Child />
    </Container>
  );
}
`;
    const block = elementAttributeBlock(source, 'Container', { selfClosing: false });
    expect(block).toMatch(/attr1=\{a\}/);
    expect(block).toMatch(/attr2=\{b\}/);
    expect(block).toMatch(/<Child \/>/);
  });
});
