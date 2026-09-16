// @vitest-environment jsdom
// File: src/components/__tests__/DocumentThumbnailList.compactView.test.js
//
// DocumentConsumerWrapper renders the thumbnail-only ("mobile", window narrower than
// 600 px) gallery WITHOUT navigationModifierState. The list must survive that: a
// narrow viewport or a print-triggered relayout must never take down the whole viewer
// with "Cannot read properties of undefined (reading 'shift')". Reproduced against the
// ODVGateway rig 2026-09-15/16 (ODV 2.4.86) and pinned here. Plain createElement:
// the repo's ESLint setup does not parse JSX in test files.
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key, i18n: { language: 'sv' } }) }));

import ViewerContext from '../../contexts/viewerContext.js';
import DocumentThumbnailList from '../DocumentThumbnailList.jsx';

const h = React.createElement;

function renderCompactGallery(extraProps = {}) {
  const contextValue = {
    bundle: null,
    ensurePageAsset: () => {},
    touchPageAsset: () => {},
    documentLoadingConfig: null,
    memoryPressureStage: 'normal',
    loadingRunActive: false,
  };
  const props = {
    allPages: [],
    pageNumber: 1,
    setPageNumber: () => {},
    thumbnailsContainerRef: { current: null },
    width: 320,
    ...extraProps,
  };
  return renderToString(h(ViewerContext.Provider, { value: contextValue }, h(DocumentThumbnailList, props)));
}

describe('DocumentThumbnailList in the compact (thumbnail-only) view', () => {
  it('renders without navigationModifierState, exactly as DocumentConsumerWrapper mounts it', () => {
    expect(() => renderCompactGallery()).not.toThrow();
  });

  it('treats a missing modifier state as "no modifier pressed" (same as DocumentToolbar)', () => {
    const withoutState = renderCompactGallery();
    const withReleasedKeys = renderCompactGallery({ navigationModifierState: { shift: false, ctrl: false } });
    expect(withoutState).toBe(withReleasedKeys);
  });
});
