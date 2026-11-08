// File: src/components/__tests__/cssValueSerialization.js
/**
 * Canonical form of a CSS value, read back through the DOM under test.
 *
 * Browsers canonicalise CSS shorthands when they STORE a value: Chromium turns
 * `inset(50% 0% 0% 0%)` into `inset(50% 0% 0%)` (the last three sides are equal,
 * so the shorthand collapses), `inset(0% 0% 0% 0%)` into `inset(0%)` and
 * `transform-origin: top left` into `left top` (the x keyword comes first).
 * jsdom 31 adopted the same rules, so asserting the raw stored string would pin
 * a test to one engine's spelling instead of to the value.
 *
 * Setting the expected value on a probe element and reading it back compares the
 * VALUE (the same clip, the same origin) in whatever spelling the engine keeps
 * it in. The application writes the values in its own spelling
 * (`buildCurtainClipPath`, the React style objects), and that is what these
 * helpers take.
 */

/**
 * @param {string} value a `clip-path` value, e.g. `inset(50% 0% 0% 0%)`
 * @returns {string} the value as the DOM stores it
 */
export function canonicalClipPath(value) {
  const probe = document.createElement('div');
  probe.style.clipPath = value;
  return probe.style.clipPath;
}

/**
 * @param {string} value a `transform-origin` value, e.g. `top left`
 * @returns {string} the value as the DOM stores it
 */
export function canonicalTransformOrigin(value) {
  const probe = document.createElement('div');
  probe.style.transformOrigin = value;
  return probe.style.transformOrigin;
}
