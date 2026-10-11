// File: src/utils/compareTransform.js
/**
 * File: src/utils/compareTransform.js
 *
 * Free per-page transform for the compare view: stepless scale, free pan and 0.1 degree rotation,
 * one transform per compared page (`primary` = left pane, `compare` = right pane).
 *
 * The state is plain, serialisable data so a later view (overlay or curtain comparison) can read and
 * write it through the viewer context. The renderer applies it as a CSS transform on the page
 * stage, so fine steps never re-rasterise the page; only whole quarter turns are still drawn by
 * the canvas (see `splitTransformRotation`). Design note: docs-src/compare-transform.md.
 *
 * @module compareTransform
 */

/**
 * Per-page transform. `scale` multiplies the shared base zoom (1 = 100 %); `dx`/`dy` are CSS pixels
 * at transform scale 1 (the rendered offset is `dx × scale`); `rotation` is degrees clockwise in
 * [0, 360) with 0.1 degree resolution.
 *
 * @typedef {Object} CompareTransform
 * @property {number} scale
 * @property {number} dx
 * @property {number} dy
 * @property {number} rotation
 */

/** @typedef {'primary'|'compare'} CompareTransformTarget */

/**
 * @typedef {Object} CompareTransformState
 * @property {CompareTransform} primary
 * @property {CompareTransform} compare
 */

/**
 * Supported range. Scale 0.1–8 (10 %–800 % on top of the base zoom) keeps the transformed surface
 * inside what browsers composite without tiling artefacts; offsets beyond ±20 000 px only move the
 * page out of sight.
 */
export const COMPARE_TRANSFORM_LIMITS = Object.freeze({
  minScale: 0.1,
  maxScale: 8,
  maxOffsetPx: 20000,
});

/** @type {CompareTransform} */
export const IDENTITY_COMPARE_TRANSFORM = Object.freeze({ scale: 1, dx: 0, dy: 0, rotation: 0 });

/** @type {CompareTransformState} */
export const INITIAL_COMPARE_TRANSFORM_STATE = Object.freeze({
  primary: IDENTITY_COMPARE_TRANSFORM,
  compare: IDENTITY_COMPARE_TRANSFORM,
});

const TRANSFORM_FIELDS = ['scale', 'dx', 'dy', 'rotation'];

/**
 * @param {number} value
 * @param {number} factor
 * @returns {number}
 */
function roundTo(value, factor) {
  // `+ 0` turns a negative zero into 0 so the state serialises and compares cleanly.
  return Math.round(value * factor) / factor + 0;
}

/**
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function finiteOr(value, fallback) {
  const numeric = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(numeric) ? numeric : fallback;
}

/**
 * @param {*} value
 * @returns {number}
 */
function normalizeScale(value) {
  const { minScale, maxScale } = COMPARE_TRANSFORM_LIMITS;
  return roundTo(Math.max(minScale, Math.min(maxScale, finiteOr(value, 1))), 1000);
}

/**
 * @param {*} value
 * @returns {number}
 */
function normalizeOffset(value) {
  const max = COMPARE_TRANSFORM_LIMITS.maxOffsetPx;
  return roundTo(Math.max(-max, Math.min(max, finiteOr(value, 0))), 100);
}

/**
 * Normalize an angle to [0, 360) with 0.1 degree resolution.
 *
 * @param {*} value
 * @returns {number}
 */
export function normalizeTransformRotation(value) {
  const tenths = Math.round(finiteOr(value, 0) * 10);
  return (((tenths % 3600) + 3600) % 3600) / 10 + 0;
}

/**
 * @param {*} value
 * @returns {CompareTransform}
 */
export function normalizeCompareTransform(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    scale: normalizeScale(source.scale),
    dx: normalizeOffset(source.dx),
    dy: normalizeOffset(source.dy),
    rotation: normalizeTransformRotation(source.rotation),
  };
}

/**
 * @param {CompareTransform} transform
 * @returns {boolean}
 */
export function isIdentityCompareTransform(transform) {
  return !!transform
    && transform.scale === 1
    && transform.dx === 0
    && transform.dy === 0
    && transform.rotation === 0;
}

/**
 * @param {*} target
 * @returns {CompareTransformTarget}
 */
function normalizeTarget(target) {
  return target === 'compare' ? 'compare' : 'primary';
}

/**
 * Read one page's transform.
 *
 * @param {(CompareTransformState|null|undefined)} state
 * @param {*} target
 * @returns {CompareTransform}
 */
export function selectCompareTransform(state, target) {
  return state?.[normalizeTarget(target)] || IDENTITY_COMPARE_TRANSFORM;
}

/**
 * Split a free angle into the quarter turn drawn by the canvas and the residual applied as CSS.
 * The residual lies in [-45, 45), so a fine step only crosses into a new canvas quarter turn at
 * ±45 degrees.
 *
 * @param {*} rotation
 * @returns {{ quarterTurn: number, residual: number }}
 */
export function splitTransformRotation(rotation) {
  const tenths = Math.round(normalizeTransformRotation(rotation) * 10);
  const quarters = Math.round(tenths / 900);
  return {
    quarterTurn: ((quarters * 90) % 360) + 0,
    residual: (tenths - quarters * 900) / 10 + 0,
  };
}

/**
 * CSS transform the renderer applies to the page stage (transform-origin: page centre). The order
 * scale → translate → rotate keeps `dx`/`dy` in screen axes and in CSS pixels at scale 1.
 * Returns '' when nothing beyond a canvas quarter turn is needed.
 *
 * @param {CompareTransform} transform
 * @returns {string}
 */
export function buildCompareTransformCss(transform) {
  const normalized = normalizeCompareTransform(transform);
  const { residual } = splitTransformRotation(normalized.rotation);
  if (normalized.scale === 1 && normalized.dx === 0 && normalized.dy === 0 && residual === 0) return '';
  return `scale(${normalized.scale}) translate(${normalized.dx}px, ${normalized.dy}px) rotate(${residual}deg)`;
}

/**
 * @param {CompareTransform} a
 * @param {CompareTransform} b
 * @returns {boolean}
 */
function sameTransform(a, b) {
  return TRANSFORM_FIELDS.every((field) => a[field] === b[field]);
}

/**
 * @param {CompareTransformState} state
 * @param {CompareTransformTarget} target
 * @param {CompareTransform} next
 * @returns {CompareTransformState}
 */
function withTarget(state, target, next) {
  if (sameTransform(state[target], next)) return state;
  return { ...state, [target]: next };
}

/**
 * @param {CompareTransformState} state
 * @param {function(CompareTransform): CompareTransform} map
 * @returns {CompareTransformState}
 */
function mapBoth(state, map) {
  return withTarget(withTarget(state, 'primary', map(state.primary)), 'compare', map(state.compare));
}

/**
 * Reducer for the per-page transform state. Actions:
 * - `{ type: 'set', target, transform }` merge a partial transform (or `current => partial`).
 * - `{ type: 'nudge', target, field, delta }` add `delta` to `scale`, `dx`, `dy` or `rotation`.
 * - `{ type: 'zoomStep', target, sign }` the per-pane ±0.1 zoom preset; a calibrated fraction is kept.
 * - `{ type: 'restore', state }` replace both pages with a saved state (overlay "reset to compare").
 * - `{ type: 'rotate', target, delta }` the 90 degree preset (keeps the fine residual).
 * - `{ type: 'reset', target }`, `{ type: 'resetAll' }` back to identity.
 * - `{ type: 'resetScale' }` scale 1 on both pages (fit/actual-size presets).
 * - `{ type: 'resetAlignment' }` keep only the nearest quarter turn on both pages (compare toggle).
 *
 * @param {CompareTransformState} state
 * @param {Object} action
 * @returns {CompareTransformState}
 */
export function compareTransformReducer(state, action) {
  const current = state || INITIAL_COMPARE_TRANSFORM_STATE;
  if (!action || typeof action !== 'object') return current;
  const target = normalizeTarget(action.target);
  const page = current[target];

  switch (action.type) {
    case 'set': {
      const patch = typeof action.transform === 'function' ? action.transform(page) : action.transform;
      return withTarget(current, target, normalizeCompareTransform({ ...page, ...(patch || {}) }));
    }
    case 'nudge': {
      if (!TRANSFORM_FIELDS.includes(action.field)) return current;
      const delta = finiteOr(action.delta, 0);
      return withTarget(current, target, normalizeCompareTransform({ ...page, [action.field]: page[action.field] + delta }));
    }
    case 'zoomStep': {
      // A plain ±0.1 step: a calibrated fraction (e.g. 1.005) is kept, so + then − returns to it.
      const step = finiteOr(action.sign, 1) >= 0 ? 0.1 : -0.1;
      return withTarget(current, target, normalizeCompareTransform({ ...page, scale: page.scale + step }));
    }
    case 'restore': {
      const saved = action.state;
      if (!saved || typeof saved !== 'object') return current;
      return withTarget(
        withTarget(current, 'primary', normalizeCompareTransform(saved.primary)),
        'compare',
        normalizeCompareTransform(saved.compare)
      );
    }
    case 'rotate':
      return withTarget(current, target, normalizeCompareTransform({ ...page, rotation: page.rotation + finiteOr(action.delta, 0) }));
    case 'reset':
      return withTarget(current, target, IDENTITY_COMPARE_TRANSFORM);
    case 'resetAll':
      return mapBoth(current, () => IDENTITY_COMPARE_TRANSFORM);
    case 'resetScale':
      return mapBoth(current, (item) => ({ ...item, scale: 1 }));
    case 'resetAlignment':
      return mapBoth(current, (item) => ({
        ...IDENTITY_COMPARE_TRANSFORM,
        rotation: splitTransformRotation(item.rotation).quarterTurn,
      }));
    default:
      return current;
  }
}

/**
 * Parse a number typed by the user in either Swedish (`12,5`) or English (`12.5`) notation.
 * Accepts a leading sign (also U+2212), digit grouping with spaces, and a trailing `%`, `°`, `deg`
 * or `px` unit. When both `,` and `.` occur, the last one is the decimal separator.
 *
 * @param {*} input
 * @returns {number} NaN when the input is not a number.
 */
export function parseLocaleNumber(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : Number.NaN;
  if (typeof input !== 'string') return Number.NaN;

  // U+2212 is the minus sign Intl uses for Swedish negatives.
  let text = input.trim().replace(/−/g, '-').replace(/\s*(%|°|deg|px)$/i, '');
  // \s also matches no-break and narrow no-break spaces used as digit grouping.
  text = text.replace(/\s/g, '');
  const lastComma = text.lastIndexOf(',');
  const lastPoint = text.lastIndexOf('.');
  if (lastComma >= 0 && lastPoint >= 0) {
    text = lastComma > lastPoint
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '');
  } else if (lastComma >= 0) {
    text = text.replace(',', '.');
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) return Number.NaN;
  return Number(text) + 0;
}

/**
 * Format a number for a transform field in the UI language, without digit grouping.
 *
 * @param {number} value
 * @param {number} decimals
 * @param {string=} language
 * @returns {string}
 */
export function formatTransformNumber(value, decimals, language = 'en') {
  const factor = 10 ** decimals;
  const rounded = roundTo(finiteOr(value, 0), factor);
  try {
    return new Intl.NumberFormat(language || 'en', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: false,
    }).format(rounded);
  } catch {
    return rounded.toFixed(decimals);
  }
}

/** Arrow key → pan axis and direction. */
const ARROW_PAN = Object.freeze({
  ArrowLeft: ['dx', -1],
  ArrowRight: ['dx', 1],
  ArrowUp: ['dy', -1],
  ArrowDown: ['dy', 1],
});

/**
 * Map a key press on a pan control to a reducer action: arrows pan 1 px, Shift+arrows 10 px.
 *
 * @param {(KeyboardEvent|Object|null)} event A keydown event or `{ key, shiftKey, ctrlKey, altKey, metaKey }`.
 * @param {*} target
 * @returns {(Object|null)}
 */
export function resolveTransformKeyAction(event, target) {
  if (!event || event.ctrlKey || event.altKey || event.metaKey) return null;
  const pan = ARROW_PAN[event.key];
  if (!pan) return null;
  return {
    type: 'nudge',
    target: normalizeTarget(target),
    field: pan[0],
    delta: pan[1] * (event.shiftKey ? 10 : 1),
  };
}
