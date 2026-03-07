// File: src/ViewerContextValue.js
import { createContext } from 'react';

/**
 * @typedef {Object} ViewerContextValue
 * @property {Array.<*>} allPages
 * @property {function(*, number): void} insertPageAtIndex
 * @property {(string|null)} error
 * @property {function((string|null)): void} setError
 * @property {number} workerCount
 * @property {function(number): void} setWorkerCount
 * @property {Array.<string>} messageQueue
 * @property {function(string): void} addMessage
 */

/** Create the Viewer context (default value is narrowed at runtime by the Provider). */
const ViewerContext = createContext(/** @type {ViewerContextValue} */ ({}));

export default ViewerContext;
