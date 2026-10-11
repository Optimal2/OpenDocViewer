// File: src/utils/compareCurtain.js
/**
 * File: src/utils/compareCurtain.js
 *
 * Curtain view of the compare mode: the two calibrated pages in one coordinate space, page A
 * (left/primary) below and page B (right/compare) above, with page B clipped to one side of a
 * draggable border. Horizontal mode: the border is a horizontal line, page B shows below it.
 * Vertical mode: the border is a vertical line, page B shows to the right of it. The clip is a CSS
 * `clip-path: inset(...)` on the top layer, so moving the border never re-renders the pages.
 *
 * The state (mode and one position per mode) is local to the open view; the calibration itself
 * is the per-page transforms in the viewer context (utils/compareTransform.js).
 * Design note: docs-src/compare-transform.md (section "Curtain view").
 *
 * @module compareCurtain
 */

/** @typedef {('horizontal'|'vertical')} CurtainMode */

/**
 * @typedef {Object} CompareCurtainState
 * @property {CurtainMode} mode Orientation of the border.
 * @property {Record<CurtainMode, number>} positions Border position per mode, percent of the stage.
 */

/** Border position range and keyboard steps (percent of the stage). */
export const COMPARE_CURTAIN_POSITION = Object.freeze({
  min: 0,
  max: 100,
  defaultValue: 50,
  step: 1,
  largeStep: 10,
});

/** @type {ReadonlyArray<CurtainMode>} */
export const COMPARE_CURTAIN_MODES = Object.freeze(['horizontal', 'vertical']);

/** @type {CompareCurtainState} */
export const INITIAL_COMPARE_CURTAIN_STATE = Object.freeze({
  mode: 'vertical',
  positions: Object.freeze({
    horizontal: COMPARE_CURTAIN_POSITION.defaultValue,
    vertical: COMPARE_CURTAIN_POSITION.defaultValue,
  }),
});

/**
 * @param {*} mode
 * @returns {CurtainMode}
 */
function normalizeMode(mode) {
  return mode === 'horizontal' ? 'horizontal' : 'vertical';
}

/**
 * Clamp a border position to [0, 100] with two decimals; non-numbers fall back to 50.
 *
 * @param {*} value
 * @returns {number}
 */
export function clampCurtainPosition(value) {
  const numeric = typeof value === 'number' && Number.isFinite(value)
    ? value
    : COMPARE_CURTAIN_POSITION.defaultValue;
  const { min, max } = COMPARE_CURTAIN_POSITION;
  return Math.round(Math.max(min, Math.min(max, numeric)) * 100) / 100 + 0;
}

/**
 * The border position of the current mode.
 *
 * @param {(CompareCurtainState|null|undefined)} state
 * @returns {number}
 */
export function selectCurtainPosition(state) {
  const current = state || INITIAL_COMPARE_CURTAIN_STATE;
  return clampCurtainPosition(current.positions?.[normalizeMode(current.mode)]);
}

/**
 * CSS clip of the top page (page B): everything on the A side of the border is cut away.
 * 0 % shows page B on the whole stage, 100 % hides it.
 *
 * @param {CurtainMode} mode
 * @param {number} position Percent of the stage.
 * @returns {string} A `clip-path` value.
 */
export function buildCurtainClipPath(mode, position) {
  const p = clampCurtainPosition(position);
  return normalizeMode(mode) === 'horizontal'
    ? `inset(${p}% 0% 0% 0%)`
    : `inset(0% 0% 0% ${p}%)`;
}

/**
 * Position of the grab bar on the border.
 *
 * @param {CurtainMode} mode
 * @param {number} position Percent of the stage.
 * @returns {({ top:string }|{ left:string })}
 */
export function buildCurtainHandleStyle(mode, position) {
  const p = `${clampCurtainPosition(position)}%`;
  return normalizeMode(mode) === 'horizontal' ? { top: p } : { left: p };
}

/**
 * Border position under a pointer: the share of the stage along the moving axis (y for the
 * horizontal border, x for the vertical one). An empty rectangle gives the default.
 *
 * @param {CurtainMode} mode
 * @param {{ left:number, top:number, width:number, height:number }} rect Stage bounds.
 * @param {number} clientX
 * @param {number} clientY
 * @returns {number}
 */
export function curtainPositionFromPointer(mode, rect, clientX, clientY) {
  const horizontal = normalizeMode(mode) === 'horizontal';
  const size = Number(horizontal ? rect?.height : rect?.width) || 0;
  if (size <= 0) return COMPARE_CURTAIN_POSITION.defaultValue;
  const start = Number(horizontal ? rect.top : rect.left) || 0;
  const offset = (Number(horizontal ? clientY : clientX) || 0) - start;
  return clampCurtainPosition((offset / size) * 100);
}

/**
 * Map a key press on the border to a reducer action: Left/Up −1 %, Right/Down +1 %, Shift ×10.
 * Returns null for any other key (and with Ctrl/Alt/Meta).
 *
 * @param {(KeyboardEvent|Object|null)} event A keydown event or `{ key, shiftKey, ... }`.
 * @returns {(Object|null)}
 */
export function resolveCurtainKeyAction(event) {
  if (!event || event.ctrlKey || event.altKey || event.metaKey) return null;
  const step = event.shiftKey ? COMPARE_CURTAIN_POSITION.largeStep : COMPARE_CURTAIN_POSITION.step;
  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      return { type: 'stepPosition', delta: -step };
    case 'ArrowRight':
    case 'ArrowDown':
      return { type: 'stepPosition', delta: step };
    default:
      return null;
  }
}

/**
 * @param {CompareCurtainState} state
 * @param {number} value
 * @returns {CompareCurtainState}
 */
function withPosition(state, value) {
  const mode = normalizeMode(state.mode);
  const position = clampCurtainPosition(value);
  if (position === state.positions[mode]) return state;
  return { ...state, positions: { ...state.positions, [mode]: position } };
}

/**
 * Reducer for the curtain view. Actions:
 * - `{ type: 'setMode', mode }` switch orientation; each mode keeps its own position.
 * - `{ type: 'setPosition', value }` absolute border position (percent) of the current mode.
 * - `{ type: 'stepPosition', delta }` relative change (percent) of the current mode.
 *
 * @param {CompareCurtainState} state
 * @param {Object} action
 * @returns {CompareCurtainState}
 */
export function compareCurtainReducer(state, action) {
  const current = state || INITIAL_COMPARE_CURTAIN_STATE;
  if (!action || typeof action !== 'object') return current;
  switch (action.type) {
    case 'setMode':
      if (!COMPARE_CURTAIN_MODES.includes(action.mode) || action.mode === current.mode) return current;
      return { ...current, mode: action.mode };
    case 'setPosition':
      return withPosition(current, action.value);
    case 'stepPosition': {
      const delta = typeof action.delta === 'number' && Number.isFinite(action.delta) ? action.delta : 0;
      return withPosition(current, selectCurtainPosition(current) + delta);
    }
    default:
      return current;
  }
}
