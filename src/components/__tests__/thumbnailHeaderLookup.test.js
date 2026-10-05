// @vitest-environment jsdom
// File: src/components/__tests__/thumbnailHeaderLookup.test.js
//
// The sticky document header measures the inline boundary header of the first visible row.
// Since 3d3a8ec the option (#thumbnail-N) sits inside .thumbnail-option-frame, so a lookup
// that starts from the option itself finds no header and leaves headerBottom at its 24px
// default (review finding 2026-10-05). This pins the frame-aware lookup for both DOM shapes.
import { describe, expect, it } from 'vitest';
import { resolveRowHeaderAndShell } from '../DocumentThumbnailList.jsx';

function build(withFrame, withHeader = true) {
  const list = document.createElement('div');
  const shell = document.createElement('div');
  shell.className = 'thumbnail-row-shell';
  if (withHeader) {
    const header = document.createElement('div');
    header.className = 'thumbnail-document-boundary start';
    shell.appendChild(header);
  }
  const option = document.createElement('div');
  option.id = 'thumbnail-3';
  option.setAttribute('role', 'option');
  if (withFrame) {
    const frame = document.createElement('div');
    frame.className = 'thumbnail-option-frame';
    frame.appendChild(option);
    const badge = document.createElement('button');
    badge.className = 'odv-signature-badge';
    frame.appendChild(badge);
    shell.appendChild(frame);
  } else {
    shell.appendChild(option);
  }
  list.appendChild(shell);
  return { list, shell };
}

describe('resolveRowHeaderAndShell', () => {
  it('finds the boundary header and the shell through the option frame (current DOM)', () => {
    const { list, shell } = build(true);
    const found = resolveRowHeaderAndShell(list, 2);
    expect(found.shell).toBe(shell);
    expect(found.header?.classList.contains('thumbnail-document-boundary')).toBe(true);
  });

  it('still resolves the legacy DOM where the option is a direct child of the shell', () => {
    const { list, shell } = build(false);
    const found = resolveRowHeaderAndShell(list, 2);
    expect(found.shell).toBe(shell);
    expect(found.header?.classList.contains('thumbnail-document-boundary')).toBe(true);
  });

  it('returns nulls when the row has no boundary header or the option is missing', () => {
    expect(resolveRowHeaderAndShell(build(true, false).list, 2)).toEqual({ header: null, shell: null });
    expect(resolveRowHeaderAndShell(build(true).list, 7)).toEqual({ header: null, shell: null });
    expect(resolveRowHeaderAndShell(null, 2)).toEqual({ header: null, shell: null });
  });
});
