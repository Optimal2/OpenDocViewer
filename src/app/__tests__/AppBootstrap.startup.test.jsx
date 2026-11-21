// @vitest-environment jsdom
// File: src/app/__tests__/AppBootstrap.startup.test.jsx
/**
 * Startup selection: the pattern form of window.ODV.start opens the viewer, and a host payload
 * without openable files shows a message instead of the demo launcher.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import en from '../../../public/locales/en/common.json';
import sv from '../../../public/locales/sv/common.json';

const bootstrapDetect = vi.hoisted(() => vi.fn());
const viewerProps = vi.hoisted(() => ({ last: null }));

vi.mock('../../i18n.js', () => ({}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ ready: true, t: (key, options) => options?.defaultValue || key }),
}));
vi.mock('../OpenDocViewer.jsx', () => ({
  default: (props) => {
    viewerProps.last = props;
    return null;
  },
}));
vi.mock('../../integrations/bootstrapRuntime.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, bootstrapDetect };
});
vi.mock('../../integrations/integrationSettings.js', () => ({ applyIntegrationSettings: () => {} }));
vi.mock('../../components/DocumentLoader/sources/explicitListSource.js', () => ({
  makeExplicitSource: () => ({ items: [] }),
}));
vi.mock('../../utils/performanceOverlayFlag.js', () => ({ isPerformanceOverlayEnabled: () => false }));

const { default: AppBootstrap } = await import('../AppBootstrap.jsx');

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(createElement(AppBootstrap)); });
  await act(async () => { await Promise.resolve(); });
  return {
    container,
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe('AppBootstrap startup selection', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    bootstrapDetect.mockReset();
    viewerProps.last = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the viewer in pattern mode for window.ODV.start({ folder, extension, endNumber })', async () => {
    bootstrapDetect.mockResolvedValue({
      mode: 'js-api',
      urlConfig: { folder: '/docs', extension: 'png', endNumber: 3 },
    });
    const { container, cleanup } = await mount();
    expect(viewerProps.last).toMatchObject({ folder: '/docs', extension: 'png', endNumber: 3 });
    expect(container.querySelector('#endNumber')).toBeNull();
    await cleanup();
  });

  it('shows a message, not the demo launcher, when a host bundle has no openable files', async () => {
    bootstrapDetect.mockResolvedValue({
      mode: 'session-url',
      bundle: { session: { id: 's' }, documents: [{ documentId: 'd', files: [] }] },
    });
    const { container, cleanup } = await mount();
    expect(viewerProps.last).toBeNull();
    expect(container.querySelector('#endNumber')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(en.bootstrapError.noSources);
    await cleanup();
  });

  it('still shows the demo launcher in demo mode', async () => {
    bootstrapDetect.mockResolvedValue({ mode: 'demo' });
    const { container, cleanup } = await mount();
    expect(container.querySelector('#endNumber')).not.toBeNull();
    await cleanup();
  });

  it('has the message in English and Swedish', () => {
    expect(typeof en.bootstrapError.noSources).toBe('string');
    expect(typeof sv.bootstrapError.noSources).toBe('string');
    expect(sv.bootstrapError.noSources).not.toBe(en.bootstrapError.noSources);
  });
});
