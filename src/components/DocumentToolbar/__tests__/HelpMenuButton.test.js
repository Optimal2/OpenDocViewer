// @vitest-environment jsdom
// File: src/components/DocumentToolbar/__tests__/HelpMenuButton.test.js
//
// The help menu hides its Manual entry when the runtime config sets `help.manual.enabled` to
// `false`. A missing key or any other value keeps the default behaviour: both the Manual and the
// About entries are shown, and choosing Manual still calls back with the toolbar button (which gets
// focus back when the manual overlay closes). Plain createElement: the repo's ESLint setup does not
// parse JSX in tests.
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockTranslate } = vi.hoisted(() => ({
  mockTranslate: (key, options) => options?.defaultValue ?? key,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));

import HelpMenuButton from '../HelpMenuButton.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = React.createElement;

describe('HelpMenuButton manual entry', () => {
  let container;
  let root;
  let onOpenManual;
  let onOpenAbout;
  let runtimeConfig;

  beforeEach(() => {
    onOpenManual = vi.fn();
    onOpenAbout = vi.fn();
    runtimeConfig = {};
    window.__ODV_GET_CONFIG__ = () => runtimeConfig;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    delete window.__ODV_GET_CONFIG__;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  function openMenu() {
    act(() => {
      root.render(h(HelpMenuButton, { onOpenManual, onOpenAbout }));
    });
    const opener = container.querySelector('button[aria-label="Open help menu"]');
    expect(opener).not.toBeNull();
    act(() => {
      opener.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  }

  const menuItems = () => Array.from(container.querySelectorAll('[role="menuitem"]'));
  const manualItem = () => menuItems().find((item) => item.getAttribute('title') === 'Manual');
  const aboutItem = () => menuItems().find((item) => item.getAttribute('title') === 'About OpenDocViewer');

  it('shows Manual next to About by default', () => {
    openMenu();
    expect(manualItem()).not.toBeUndefined();
    expect(aboutItem()).not.toBeUndefined();
  });

  it.each([[true], ['disabled'], [0]])('shows Manual when help.manual.enabled is %p', (enabled) => {
    runtimeConfig = { help: { manual: { enabled } } };
    openMenu();
    expect(manualItem()).not.toBeUndefined();
  });

  it('keeps Manual (and does not crash) when reading help.manual throws', () => {
    runtimeConfig = {
      get help() { throw new Error('host config getter failed'); },
    };
    openMenu();
    expect(manualItem()).not.toBeUndefined();
    expect(aboutItem()).not.toBeUndefined();
  });

  it('hides only the Manual entry when help.manual.enabled is false', () => {
    runtimeConfig = { help: { manual: { enabled: false } } };
    openMenu();
    expect(manualItem()).toBeUndefined();
    expect(aboutItem()).not.toBeUndefined();
  });

  it('still opens the manual from the menu entry by default', () => {
    openMenu();
    const opener = container.querySelector('button[aria-label="Open help menu"]');
    act(() => {
      manualItem().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onOpenManual).toHaveBeenCalledTimes(1);
    expect(onOpenManual.mock.calls[0][0]).toBe(opener);
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });
});
