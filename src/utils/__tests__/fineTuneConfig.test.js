import { describe, expect, it } from 'vitest';
import {
  isFineTuneEnabled, isCompareOverlayEnabled, isCompareCurtainEnabled,
  isCompareOverlayPrintEnabled, isCompareCurtainPrintEnabled,
} from '../runtimeConfig.js';

describe('fineTune.enabled capability', () => {
  it.each([undefined, null, 'false', 0, {}, true])('defaults to enabled for %j', (enabled) => {
    expect(isFineTuneEnabled({ fineTune: { enabled } })).toBe(true);
  });
  it('defaults to enabled without configuration', () => expect(isFineTuneEnabled({})).toBe(true));
  it('blocks both advanced views and print surfaces despite child switches', () => {
    const config = { fineTune: { enabled: false }, compare: {
      overlay: { enabled: true, print: { enabled: true } },
      curtain: { enabled: true, print: { enabled: true } },
    } };
    for (const resolve of [isFineTuneEnabled, isCompareOverlayEnabled, isCompareCurtainEnabled,
      isCompareOverlayPrintEnabled, isCompareCurtainPrintEnabled]) expect(resolve(config)).toBe(false);
  });
  it('retains independent child restrictions', () => {
    expect(isCompareOverlayEnabled({ compare: { overlay: { enabled: false } } })).toBe(false);
    expect(isCompareCurtainPrintEnabled({ compare: { curtain: { print: { enabled: false } } } })).toBe(false);
  });
});
