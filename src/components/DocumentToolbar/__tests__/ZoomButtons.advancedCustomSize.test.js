// @vitest-environment jsdom
/**
 * File: src/components/DocumentToolbar/__tests__/ZoomButtons.advancedCustomSize.test.js
 *
 * The custom-size menu shows only the window-width factor by default. The window-height and
 * actual-size factors sit behind an "Advanced" disclosure link and are rendered only while it is
 * expanded. The disclosure always starts collapsed, also when the user has stored values in the
 * advanced fields (operator decision 2026-09-10).
 */

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ZoomButtons from '../ZoomButtons.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => {};

function baseProps(overrides = {}) {
  return {
    zoomIn: noop,
    zoomOut: noop,
    fitToScreen: noop,
    fitToCustomWidth: noop,
    fitToWidth: noop,
    onActualSize: noop,
    zoomPercent: 100,
    onPercentApply: noop,
    ...overrides,
  };
}

describe('ZoomButtons custom-size advanced disclosure', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function mount(props) {
    act(() => {
      root.render(React.createElement(ZoomButtons, baseProps(props)));
    });
  }

  function openMenu() {
    const arrow = container.querySelector('button.toolbar-split-arrow');
    expect(arrow).not.toBeNull();
    act(() => {
      arrow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }

  function disclosure() {
    return container.querySelector('button.toolbar-split-menu-disclosure');
  }

  it('renders only the window-width field until the disclosure is expanded', () => {
    mount();
    openMenu();

    expect(container.querySelector('#odv-custom-fit-width-factor')).not.toBeNull();
    expect(container.querySelector('#odv-custom-fit-height-factor')).toBeNull();
    expect(container.querySelector('#odv-custom-fit-actual-size-factor')).toBeNull();

    const link = disclosure();
    expect(link).not.toBeNull();
    expect(link.getAttribute('aria-expanded')).toBe('false');
    expect(link.getAttribute('aria-controls')).toBe('odv-custom-fit-advanced-fields');
    expect(link.querySelector('.material-icons').textContent).toBe('expand_more');
  });

  it('expands and collapses the advanced fields on click', () => {
    mount();
    openMenu();

    act(() => {
      disclosure().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(disclosure().getAttribute('aria-expanded')).toBe('true');
    expect(disclosure().querySelector('.material-icons').textContent).toBe('expand_less');
    expect(container.querySelector('#odv-custom-fit-advanced-fields')).not.toBeNull();
    expect(container.querySelector('#odv-custom-fit-height-factor')).not.toBeNull();
    expect(container.querySelector('#odv-custom-fit-actual-size-factor')).not.toBeNull();
    // The menu itself must stay open: the disclosure is not a menu action.
    expect(container.querySelector('#odv-custom-fit-width-factor')).not.toBeNull();

    act(() => {
      disclosure().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('#odv-custom-fit-height-factor')).toBeNull();
    expect(container.querySelector('#odv-custom-fit-actual-size-factor')).toBeNull();
  });

  it('stays collapsed even when the user already has an advanced value, and shows it once expanded', () => {
    mount({
      userCustomFitSizeLimits: { widthFactorPercent: null, heightFactorPercent: 150, actualSizeFactorPercent: null },
    });
    openMenu();

    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('#odv-custom-fit-height-factor')).toBeNull();

    act(() => {
      disclosure().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const height = container.querySelector('#odv-custom-fit-height-factor');
    expect(height.value).toBe('150%');
    expect(height.closest('.toolbar-split-menu-form--advanced')).not.toBeNull();
    expect(container.querySelector('#odv-custom-fit-width-factor').closest('.toolbar-split-menu-form--advanced')).toBeNull();
  });

  it('is collapsed again after the menu is closed and reopened', () => {
    mount();
    openMenu();
    act(() => {
      disclosure().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(disclosure().getAttribute('aria-expanded')).toBe('true');

    openMenu(); // the split arrow toggles: this closes the menu
    expect(disclosure()).toBeNull();
    openMenu(); // ...and this reopens it
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('#odv-custom-fit-height-factor')).toBeNull();
  });

  it('stays collapsed when only the basic width value is set', () => {
    mount({
      userCustomFitSizeLimits: { widthFactorPercent: 50, heightFactorPercent: null, actualSizeFactorPercent: null },
    });
    openMenu();

    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('#odv-custom-fit-height-factor')).toBeNull();
  });
});
