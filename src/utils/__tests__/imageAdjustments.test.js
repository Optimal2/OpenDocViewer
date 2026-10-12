// File: src/utils/__tests__/imageAdjustments.test.js
import { describe, expect, it } from 'vitest';
import {
  NEUTRAL_IMAGE_FILTER,
  buildImageFilter,
  hasImageAdjustment,
  needsCanvas,
  normalizeGrayscale,
  normalizeInvert,
} from '../imageAdjustments.js';

const NEUTRAL = Object.freeze({ rotation: 0, brightness: 100, contrast: 100, grayscale: 0, invert: false });

describe('needsCanvas (the plain <img> fast path)', () => {
  it('keeps the fast path for all-neutral properties', () => {
    expect(needsCanvas(NEUTRAL)).toBe(false);
  });

  it.each([
    ['rotation', { rotation: 90 }],
    ['brightness', { brightness: 101 }],
    ['contrast', { contrast: 99 }],
    ['grayscale', { grayscale: 50 }],
    ['invert', { invert: true }],
  ])('needs the canvas when only %s is adjusted', (_field, change) => {
    expect(needsCanvas({ ...NEUTRAL, ...change })).toBe(true);
  });

  it('treats missing, undefined and null properties as neutral', () => {
    expect(needsCanvas(undefined)).toBe(false);
    expect(needsCanvas(null)).toBe(false);
    expect(needsCanvas({})).toBe(false);
    // The pre-campaign shape without grayscale/invert stays on the fast path.
    expect(needsCanvas({ rotation: 0, brightness: 100, contrast: 100 })).toBe(false);
    expect(needsCanvas({ ...NEUTRAL, grayscale: undefined, invert: undefined })).toBe(false);
    expect(needsCanvas({ ...NEUTRAL, grayscale: null, invert: null })).toBe(false);
  });

  it('separates grayscale 0 from the smallest positive amount', () => {
    expect(needsCanvas({ ...NEUTRAL, grayscale: 0 })).toBe(false);
    expect(needsCanvas({ ...NEUTRAL, grayscale: 0.0 })).toBe(false);
    expect(needsCanvas({ ...NEUTRAL, grayscale: 0.0001 })).toBe(true);
  });

  it('does not read the string "false" as an inverted page', () => {
    expect(needsCanvas({ ...NEUTRAL, invert: false })).toBe(false);
    expect(needsCanvas({ ...NEUTRAL, invert: 'false' })).toBe(false);
    expect(needsCanvas({ ...NEUTRAL, invert: 'true' })).toBe(true);
  });

  it('treats non-finite numbers as neutral, as the canvas renderer does', () => {
    expect(needsCanvas({ ...NEUTRAL, brightness: Number.NaN, contrast: 'abc', grayscale: Infinity })).toBe(false);
  });
});

describe('hasImageAdjustment (the compare panel badge and "Reset image")', () => {
  it('is false for neutral values and ignores rotation, which belongs to the layout', () => {
    expect(hasImageAdjustment(NEUTRAL)).toBe(false);
    expect(hasImageAdjustment({ ...NEUTRAL, rotation: 90 })).toBe(false);
    expect(hasImageAdjustment(null)).toBe(false);
    expect(hasImageAdjustment({ ...NEUTRAL, invert: 'false' })).toBe(false);
  });

  it('is true as soon as one colour value is off neutral', () => {
    expect(hasImageAdjustment({ ...NEUTRAL, brightness: 101 })).toBe(true);
    expect(hasImageAdjustment({ ...NEUTRAL, contrast: 0 })).toBe(true);
    expect(hasImageAdjustment({ ...NEUTRAL, grayscale: 1 })).toBe(true);
    expect(hasImageAdjustment({ ...NEUTRAL, invert: true })).toBe(true);
  });

  it('needsCanvas is exactly rotation or an image adjustment', () => {
    for (const properties of [NEUTRAL, { ...NEUTRAL, rotation: 90 }, { ...NEUTRAL, grayscale: 5 }, { ...NEUTRAL, invert: true }]) {
      expect(needsCanvas(properties)).toBe(properties.rotation !== 0 || hasImageAdjustment(properties));
    }
  });
});

describe('normalizeGrayscale', () => {
  it.each([
    [undefined, 0],
    [null, 0],
    ['', 0],
    [Number.NaN, 0],
    [Infinity, 0],
    [-5, 0],
    [0, 0],
    [42.5, 42.5],
    ['60', 60],
    [100, 100],
    [250, 100],
  ])('normalizes %p to %p', (input, expected) => {
    expect(normalizeGrayscale(input)).toBe(expected);
  });
});

describe('normalizeInvert', () => {
  it.each([
    [true, true],
    ['true', true],
    [1, true],
    [false, false],
    ['false', false],
    [0, false],
    ['', false],
    ['yes', false],
    [undefined, false],
    [null, false],
    [{}, false],
  ])('normalizes %p to %p', (input, expected) => {
    expect(normalizeInvert(input)).toBe(expected);
  });
});

describe('buildImageFilter', () => {
  // Neutrality proof, string level: the neutral filter is byte-identical to the filter the canvas
  // received before grayscale/invert existed, so the neutral canvas path cannot render different
  // pixels. jsdom has no canvas 2d implementation (getContext returns null without the native
  // `canvas` package), so the pixel-level proof runs in Chromium instead:
  // tests/ui/image-filter-neutrality.spec.mjs.
  it('gives the pre-campaign filter string for neutral values', () => {
    expect(NEUTRAL_IMAGE_FILTER).toBe('brightness(100%) contrast(100%)');
    expect(buildImageFilter(NEUTRAL)).toBe('brightness(100%) contrast(100%)');
    expect(buildImageFilter({ rotation: 0, brightness: 100, contrast: 100 })).toBe('brightness(100%) contrast(100%)');
    expect(buildImageFilter(undefined)).toBe('brightness(100%) contrast(100%)');
  });

  it('keeps the existing brightness/contrast composition unchanged', () => {
    expect(buildImageFilter({ ...NEUTRAL, brightness: 140, contrast: 60 })).toBe('brightness(140%) contrast(60%)');
  });

  it('composes brightness, contrast, grayscale and invert in that order', () => {
    expect(buildImageFilter({ rotation: 90, brightness: 120, contrast: 80, grayscale: 35, invert: true }))
      .toBe('brightness(120%) contrast(80%) grayscale(35%) invert(100%)');
    expect(buildImageFilter({ ...NEUTRAL, grayscale: 100 })).toBe('brightness(100%) contrast(100%) grayscale(100%)');
    expect(buildImageFilter({ ...NEUTRAL, invert: true })).toBe('brightness(100%) contrast(100%) invert(100%)');
  });

  it('normalizes the new fields before composing', () => {
    expect(buildImageFilter({ ...NEUTRAL, grayscale: 300, invert: 'false' })).toBe('brightness(100%) contrast(100%) grayscale(100%)');
    expect(buildImageFilter({ ...NEUTRAL, grayscale: -1, invert: 'true' })).toBe('brightness(100%) contrast(100%) invert(100%)');
  });
});
