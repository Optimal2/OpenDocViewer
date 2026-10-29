// @vitest-environment jsdom
// File: src/hooks/__tests__/useOcrModule.test.jsx
/**
 * useOcrModule is the viewer's only contact with the OCR module: with the switch off it returns
 * null and never calls the loader; with the switch on it loads the module once, hands it over
 * when it arrives, ignores a result that lands after unmount, and logs (not throws) a failed load.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const mocks = vi.hoisted(() => ({
  loadOcrModule: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../utils/ocrLoader.js', () => ({ loadOcrModule: mocks.loadOcrModule }));
vi.mock('../../logging/systemLogger.js', () => ({
  default: { warn: mocks.warn, error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

const { default: useOcrModule } = await import('../useOcrModule.js');

/** Latest hook result, written on every render. */
const probe = { value: undefined, renders: 0 };

function Probe() {
  probe.value = useOcrModule();
  probe.renders += 1;
  return null;
}

let container;
let root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  probe.value = undefined;
  probe.renders = 0;
  mocks.loadOcrModule.mockReset();
  mocks.warn.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.__ODV_CONFIG__;
});

async function mount() {
  await act(async () => root.render(createElement(Probe)));
}

describe('useOcrModule', () => {
  it('returns null and never touches the loader while ocr.enabled is off', async () => {
    window.__ODV_CONFIG__ = { ocr: { enabled: false } };
    await mount();
    expect(probe.value).toBeNull();
    expect(mocks.loadOcrModule).not.toHaveBeenCalled();

    delete window.__ODV_CONFIG__;
    await act(async () => root.render(createElement(Probe, { key: 'again' })));
    expect(probe.value).toBeNull();
    expect(mocks.loadOcrModule).not.toHaveBeenCalled();
  });

  it('treats anything but the literal true as off', async () => {
    window.__ODV_CONFIG__ = { ocr: { enabled: 'true' } };
    await mount();
    expect(probe.value).toBeNull();
    expect(mocks.loadOcrModule).not.toHaveBeenCalled();
  });

  it('loads the module once with the switch on and returns it when it arrives', async () => {
    const module = { marker: 'ocr module' };
    let resolveLoad;
    mocks.loadOcrModule.mockImplementation(() => new Promise((resolve) => { resolveLoad = resolve; }));
    window.__ODV_CONFIG__ = { ocr: { enabled: true } };

    await mount();
    expect(probe.value).toBeNull();
    expect(mocks.loadOcrModule).toHaveBeenCalledTimes(1);

    await act(async () => { resolveLoad(module); });
    expect(probe.value).toBe(module);
    expect(mocks.loadOcrModule).toHaveBeenCalledTimes(1);

    await act(async () => root.render(createElement(Probe)));
    expect(probe.value).toBe(module);
    expect(mocks.loadOcrModule).toHaveBeenCalledTimes(1);
  });

  it('ignores a module that arrives after unmount', async () => {
    let resolveLoad;
    mocks.loadOcrModule.mockImplementation(() => new Promise((resolve) => { resolveLoad = resolve; }));
    window.__ODV_CONFIG__ = { ocr: { enabled: true } };
    await mount();
    const rendersBefore = probe.renders;
    await act(async () => root.unmount());
    await act(async () => { resolveLoad({ marker: 'late' }); });
    expect(probe.renders).toBe(rendersBefore);
    root = createRoot(container);
  });

  it('logs a failed load and stays null', async () => {
    mocks.loadOcrModule.mockRejectedValue(new Error('chunk download failed'));
    window.__ODV_CONFIG__ = { ocr: { enabled: true } };
    await mount();
    await act(async () => {});
    expect(probe.value).toBeNull();
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn.mock.calls[0][0]).toMatch(/OCR module could not be loaded/);
    expect(mocks.warn.mock.calls[0][1]).toEqual({ error: 'chunk download failed' });
  });
});
