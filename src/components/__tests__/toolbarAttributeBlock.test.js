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

  it('HOLE 2b: > inside an attribute value does NOT break the helper (mirror comparison stays GREEN)', () => {
    // The phase-1 regex used [^>]*? for the attribute scan, so `zoom > 0.5`
    // terminated the match before `/>` was reached. The new scanner walks
    // expression containers so the element's own `/>` is the only stop.
    const mutated = `export function V() {
  return (
    <DocumentViewerToolbar
      printPipeline={printPipeline}
      tinyZoom={zoom > 0.5}
    />
  );
}
`;
    const block = toolbarAttributeBlock(mutated);
    expect(block).toMatch(/printPipeline=\{printPipeline\}/);
    expect(block).toMatch(/tinyZoom=\{zoom > 0\.5\}/);
  });

  it('HOLE 2c: BOTH < and > inside one expression still anchor the block at the element\'s own `/>`', () => {
    const mutated = `export function V() {
  return (
    <DocumentViewerToolbar
      printPipeline={printPipeline}
      tinyRange={zoom > 0.2 && zoom < 0.8}
    />
  );
}
`;
    const block = toolbarAttributeBlock(mutated);
    expect(block).toMatch(/printPipeline=\{printPipeline\}/);
    expect(block).toMatch(/tinyRange=\{zoom > 0\.2 && zoom < 0\.8\}/);
  });

  it('HOLE 2d: a string literal containing "/>" inside an attribute value is data, not the element close', () => {
    // Inside `{zoom > 0.5 ? 'x/>' : 'y'}` the string `'x/>'` holds a `/>`
    // token. A naive scan would close the element there; the new scanner
    // walks the JSX expression's `{...}` as a single balanced region and
    // only the element's OWN `/>` ends the match.
    const mutated = `export function V() {
  return (
    <DocumentViewerToolbar
      printPipeline={printPipeline}
      label={zoom > 0.5 ? 'x/>' : 'y'}
    />
  );
}
`;
    const block = toolbarAttributeBlock(mutated);
    expect(block).toMatch(/printPipeline=\{printPipeline\}/);
    expect(block).toMatch(/label=\{zoom > 0\.5 \? 'x\/>' : 'y'\}/);
  });

  it('HOLE 2e: a bare `>` inside a JSX expression child does not terminate the attribute scan', () => {
    // `<Foo>{a > b ? c : d}</Foo>` — the `>` is inside the `{}` and must be
    // skipped. `Foo` here is pair-tag form.
    const mutated = `export function V() {
  return (
    <DocumentViewerToolbar
      printPipeline={printPipeline}
    >
      {zoom > 0.5 ? 'on' : 'off'}
      <Child />
    </DocumentViewerToolbar>
  );
}
`;
    // Use pair-tag form to cover the body scan too. The block must contain
    // BOTH the opening-tag attributes AND the child elements / expressions.
    const block = elementAttributeBlock(mutated, 'DocumentViewerToolbar', { selfClosing: false });
    expect(block).toMatch(/printPipeline=\{printPipeline\}/);
    expect(block).toMatch(/\{zoom > 0\.5 \? 'on' : 'off'\}/);
    expect(block).toMatch(/<Child \/>/);
  });

  it('HOLE 2g: a JSX expression container with nested braces still anchors at the element\'s OWN `/>`', () => {
    // Nested braces inside an attribute value: `{cond ? {x: 1} : {y: 2}}` is
    // not valid JSX but `{cond ? <Inner /> : <Other />}` is, and the inner
    // `{` and `}` must balance correctly. We use a JS expression that
    // contains a nested object literal so the scanner sees balanced braces.
    const mutated = `export function V() {
  return (
    <DocumentViewerToolbar
      printPipeline={printPipeline}
      cfg={cond ? { x: 1, y: 2 } : null}
    />
  );
}
`;
    const block = toolbarAttributeBlock(mutated);
    expect(block).toMatch(/printPipeline=\{printPipeline\}/);
    expect(block).toMatch(/cfg=\{cond \? \{ x: 1, y: 2 \} : null\}/);
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

  // === Hole-by-hole regression coverage for the parser rewrite ===============
  // Each test below corresponds to one of the six measured parsing holes:
  // FP1 string-unaware comment stripping, FP2 apostrophe-in-JSX-text parity,
  // FP3/FN1 backslash escape handling, FN2 silent discard, FN3 same-name
  // self-closing child. New tests cover each one with a tiny mutation; the
  // matching real-source mutation transcripts are in the campaign report.

  it('FP1: a URL containing "//" in an attribute value does NOT remove the <Token> from the scan', () => {
    // The previous stripJsComments implementation deleted everything from "//"
    // to end-of-line BEFORE scanning, so `helpHref="https://example.com/..."`
    // turned the element into junk and the lock went RED on the three toolbar
    // call sites. The unified tokenizer treats the "//" as inside a string.
    const source = `export function V() {
  return (
    <DocumentViewerToolbar
      printPipeline={printPipeline}
      helpHref="https://example.com/odv/help"
    />
  );
}
`;
    const block = toolbarAttributeBlock(source);
    expect(block).toMatch(/printPipeline=\{printPipeline\}/);
    expect(block).toMatch(/helpHref="https:\/\/example\.com\/odv\/help"/);
  });

  it('FP1: a regex literal containing "//" in the same file does NOT confuse the scan', () => {
    // A regex literal like `/^https:\\/\\//` is tokenised as a single template
    // (slash is not a delimiter outside a literal context) so the helper walks
    // past it without dropping the toolbar element.
    const source = `const RE = /^https:\\/\\/odv\\b/;
export function V() {
  return (
    <DocumentViewerToolbar
      printPipeline={printPipeline}
      re={RE}
    />
  );
}
`;
    const block = toolbarAttributeBlock(source);
    expect(block).toMatch(/printPipeline=\{printPipeline\}/);
  });

  it('FP1: a string containing "//" before the element does NOT consume it', () => {
    // Old helper stripped the comment up to and including the `<`. New helper
    // recognises the "//" lives inside a string and never starts a comment.
    const source = `const label = "see // docs";
export function V() {
  return (
    <DocumentViewerToolbar
      printPipeline={printPipeline}
    />
  );
}
`;
    const block = toolbarAttributeBlock(source);
    expect(block).toMatch(/printPipeline=\{printPipeline\}/);
  });

  it('FP2: an apostrophe as the first char of JSX text is plain text, not a string delimiter', () => {
    // The apostrophe immediately after the `>` of `<span>` is JSX text,
    // not a string delimiter. The full JSX-text cache must classify
    // the position as JSX_TEXT so the apostrophe is NOT treated as
    // opening a string (which would walk to EOF without closing and
    // corrupt the helper's state for the rest of the source — the
    // helper would fail to find `<DocumentViewerToolbar`).
    //
    // The previous narrow check recognised only the OPENING apostrophe
    // of the JSX text, not a CLOSING one in mid-text. The full cache
    // walks the body of the opening tag and records the JSX text run
    // starts, so the apostrophe inside `<span>...<\/span>` is treated
    // as text and never opens a string.
    const source = `export function V() {
  return (
    <div>
      <span>'foo</span>
      <DocumentViewerToolbar
        printPipeline={printPipeline}
      />
    </div>
  );
}
`;
    const block = toolbarAttributeBlock(source);
    expect(block).toMatch(/printPipeline=\{printPipeline\}/);
  });

  it('FP3/FN1: backslash escape inside an attribute string does NOT terminate early', () => {
    // Old scanStringLiteral did `if (ch === '\\') continue;` without skipping
    // the character after the backslash. `title={'it\\'s'}` would cancel the
    // string at the apostrophe after `\\` and either find 0 matches (single
    // element) or silently anchor to a later element (two of the same name).
    const source = `export function V() {
  return (
    <DocumentViewerToolbar
      printPipeline={printPipeline}
      title={'it\\'s'}
    />
  );
}
`;
    const block = toolbarAttributeBlock(source);
    expect(block).toMatch(/printPipeline=\{printPipeline\}/);
    expect(block).toMatch(/title=\{'it\\'s'\}/);
  });

  it('FN2: a discarded candidate is reported in the assertion message (fail loudly)', () => {
    // Old collectElements fell through with no trace on three different
    // failure modes. We require the new helper to surface the OFFSET and the
    // REASON in the failure message. The malformed element here has an
    // unterminated string literal in its attribute value, so the attribute
    // scan can never reach a `>` or `/>` and the candidate must be reported
    // as discarded (not silently skipped or silently returned).
    const source = `export function V() {
  return (
    <div>
      <DocumentViewerToolbar label="open quote never closed
      <DocumentViewerToolbar
        onFoo={f}
      />
    </div>
  );
}
`;
    expect(() => toolbarAttributeBlock(source))
      .toThrow(/candidate\(s\) discarded/);
  });

  it('FN2: two elements of the same name with a pair-tag in the way fails LOUDLY (not silently wrong)', () => {
    // Old collectElements would silently return the SECOND element's block
    // because the FIRST candidate was discarded. The new helper throws.
    const source = `export function V() {
  return (
    <div>
      <DocumentViewerToolbar
        printPipeline={first}
      />
      <DocumentViewerToolbar
        printPipeline={second}
      />
    </div>
  );
}
`;
    expect(() => toolbarAttributeBlock(source))
      .toThrow(/expected exactly one.*DocumentViewerToolbar.*found 2/);
  });

  it('FN3: a nested same-name SELF-CLOSING child does not derail the parent body scan', () => {
    // Old scanElementBody assumed a nested same-name element was a pair tag
    // and required `</Name>`. `<T a><T b/></T>` then failed to find a body,
    // so the outer `<T>` was either discarded (found 0) or, with selfClosing
    // requested, the helper silently returned the CHILD's block. The fix:
    // the body scan now tries self-closing first for nested same-name
    // elements, so the outer block is found AND properly closed.
    const source = `export function V() {
  return (
    <T a={1}>
      <T leaf={2} />
    </T>
  );
}
`;
    const block = elementAttributeBlock(source, 'T', { selfClosing: false });
    expect(block).toMatch(/a=\{1\}/);
    expect(block).toMatch(/<T a=\{1\}>[\s\S]*<\/T>/);
    // The inner element IS part of the outer's body. The key FN3 guarantee
    // is that the parent block is FOUND and its </T> is reached — not that
    // the inner element is excluded.
  });

  it('FN3: a nested same-name pair-tag child is traversed so the parent body closes correctly', () => {
    // Mirror of FN3 for the pair-tag child pair form. The body scan must
    // recurse into the nested same-name pair-tag child to find ITS </T>
    // before the outer's </T> is reached.
    const source = `export function V() {
  return (
    <T a={1}>
      <T b={2}></T>
    </T>
  );
}
`;
    const block = elementAttributeBlock(source, 'T', { selfClosing: false });
    expect(block).toMatch(/a=\{1\}/);
    // The outer block is the WHOLE thing including the inner pair-tag
    // (because the inner is a child of the outer). The guarantee is that
    // we found the OUTER element (with `a={1}`) and not silently returned
    // the inner one or discarded the outer.
    expect(block).toMatch(/<T a=\{1\}>[\s\S]*<\/T>$/);
  });

  it('a closing tag with whitespace/newline is consumed in full', () => {
    // Old scanElementBody used `nextClose + name.length + 3` which truncated
    // `</T >` and `</T\\n>` to the next character past the `T`. The new
    // helper advances past the actual closing tag's `>`.
    const source = `export function V() {
  return (
    <Container a={1}>
      <Child />
    </Container >
  );
}
`;
    const block = elementAttributeBlock(source, 'Container', { selfClosing: false });
    expect(block).toMatch(/a=\{1\}/);
    expect(block).toMatch(/<Child \/>/);
  });

  it('member expression: <Foo.Bar/> does NOT match <Foo/>', () => {
    // `\b` after a name is not enough for a member expression: `<Foo.Bar/>`
    // would match `<Foo\\b`. Three such elements exist in src/ today:
    // ThemeProvider.jsx, ViewerProvider.jsx, index.jsx.
    const source = `export function V() {
  return (
    <Foo.Bar prop={1} />
  );
}
`;
    expect(() => elementAttributeBlock(source, 'Foo'))
      .toThrow(/expected exactly one.*Foo.*found 0/);
  });

  it('pair-tag requested when only a self-closing exists reports the form mismatch', () => {
    // The failure must say "exists but in self-closing form" — not just "found 0".
    const source = `export function V() {
  return (
    <Container attr1={a} />
  );
}
`;
    expect(() => elementAttributeBlock(source, 'Container', { selfClosing: false }))
      .toThrow(/candidate\(s\) exist but in self-closing form/);
  });

  it('self-closing requested when only a pair-tag exists reports the form mismatch', () => {
    const source = `export function V() {
  return (
    <Container attr1={a}>
      <Child />
    </Container>
  );
}
`;
    expect(() => elementAttributeBlock(source, 'Container'))
      .toThrow(/candidate\(s\) exist but in pair-tag form/);
  });

  it('deeply nested elements do not raise RangeError', () => {
    // 5000 levels of pair-tag nesting would trip the old recursive scan with
    // `RangeError: Maximum call stack size exceeded`. The iterative scan
    // reports the depth bound instead. We use a depth comfortably under the
    // cap so the test asserts that legitimate deep nesting still resolves.
    const depth = 500;
    const open = Array.from({ length: depth }, () => '<Container>').join('');
    const close = Array.from({ length: depth }, () => '</Container>').join('');
    const source = `export function V() {
  return (
    <Container a={1}>${open}<Child />${close}</Container>
  );
}
`;
    const block = elementAttributeBlock(source, 'Container', { selfClosing: false });
    expect(block).toMatch(/a=\{1\}/);
  });
});
