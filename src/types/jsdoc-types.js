/**
 * Centralized JSDoc-only type and callback definitions.
 * This file exports no runtime code; it just helps JSDoc parse types consistently.
 */

/**
 * Generic React-like state setter for numbers:
 * accepts either a number or an updater function (number)->number.
 * @callback SetNumberState
 * @param {number | function(number): number} next
 * @returns {void}
 */

/**
 * Setter for string-or-null values.
 * @callback SetStringNullable
 * @param {(string|null)} value
 * @returns {void}
 */

/**
 * Simple number setter (no updater function).
 * @callback SetNumber
 * @param {number} value
 * @returns {void}
 */

/**
 * Simple string setter.
 * @callback SetString
 * @param {string} value
 * @returns {void}
 */

/**
 * React-like state setter for booleans:
 * accepts a boolean or an updater (boolean)->boolean.
 * @callback SetBooleanState
 * @param {boolean | function(boolean): boolean} next
 * @returns {void}
 */

/**
 * React-like state setter for page number:
 * accepts a number or an updater (number)->number.
 * @callback SetPageNumber
 * @param {number | function(number): number} next
 * @returns {void}
 */

/**
 * Direction token used by page timers / navigation.
 * (Keep as a string-literal union; JSDoc's parser accepts this form.)
 * @typedef {'prev'|'next'} PageDirection
 */

/**
 * Render function signature for ErrorBoundary fallbacks.
 * @callback FallbackRenderer
 * @param {*} error
 * @param {(React.ErrorInfo|null)} info
 * @param {function(): void} reset
 * @returns {React.ReactNode}
 */

/**
 * Minimal imperative handle exposed by the page renderer for printing.
 * @typedef {Object} DocumentRenderHandle
 * @property {function(): (HTMLCanvasElement|HTMLImageElement|null)} getActiveCanvas
 */

/**
 * Generic "ref-like" object (for places where React.MutableRefObject is too specific).
 * @typedef {Object} RefLike
 * @property {*} current
 */
