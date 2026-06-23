// File: src/components/DocumentViewer/hooks/useViewerEffects.js
/**
 * File: src/components/DocumentViewer/hooks/useViewerEffects.js
 *
 * Cross-cutting viewer effects.
 *
 * This module is a thin public wrapper. The actual effect implementations live in
 * `useViewerZoomEffects.js` and `useViewerKeyboardNavigation.js` so each file has
 * a single responsibility and consumers can depend on a narrower surface.
 *
 * @module useViewerEffects
 */

import { useViewerKeyboardNavigation } from './useViewerKeyboardNavigation.js';
import { useViewerZoomEffects } from './useViewerZoomEffects.js';

/**
 * Sticky zoom modes used by the viewer.
 * @typedef {'FIT_PAGE'|'FIT_WIDTH'|'FIT_CUSTOM'|'ACTUAL_SIZE'|'CUSTOM'} ZoomMode
 */

/** @typedef {'browser'|'disable'|'dialog'} KeyboardPrintShortcutBehavior */

/**
 * Arguments for useViewerEffects. (Simplified types for JSDoc compatibility.)
 * @typedef {Object} UseViewerEffectsArgs
 * @property {number} zoom
 * @property {Object} zoomState                 - { mode: ZoomMode, scale: number }
 * @property {Function} setZoomState
 * @property {Object} documentRenderRef         - Ref-like { current: any }
 * @property {Object} viewerContainerRef        - Ref-like { current: HTMLElement|null }
 * @property {string} imageRotationKey          - Primary/compare rotation dependency key.
 * @property {boolean} isComparing
 * @property {number} thumbnailWidth
 * @property {number} pageNumber
 * @property {number} totalPages
 * @property {Function} goToPreviousPage
 * @property {Function} goToNextPage
 * @property {Function} goToFirstPage
 * @property {Function} goToLastPage
 * @property {Function} goToPreviousDocument
 * @property {Function} goToNextDocument
 * @property {Function} goToFirstDocument
 * @property {Function} goToLastDocument
 * @property {boolean} documentNavigationEnabled
 * @property {boolean} compareNavigationEnabled
 * @property {'primary'|'compare'=} activePane
 * @property {Function=} activatePrimaryPane
 * @property {Function=} activateComparePane
 * @property {Function=} closeCompare
 * @property {Function=} hideCurrentPageFromSelection
 * @property {Function=} hideCurrentDocumentFromSelection
 * @property {Function} zoomIn
 * @property {Function} zoomOut
 * @property {Function} fitToCustomWidth
 * @property {Function} rotateLeft
 * @property {Function} rotateRight
 * @property {Function=} onOpenPrintDialog
 * @property {boolean=} printEnabled
 * @property {boolean=} interactionSuspended
 * @property {KeyboardPrintShortcutBehavior=} keyboardPrintShortcutBehavior
 */

/**
 * Determine whether the event target is an editable or form control where viewer shortcuts
 * must stay inactive.
 *
 * Buttons are intentionally NOT treated as blocking controls so toolbar buttons may keep focus
 * while the global viewer shortcuts remain available.
 *
 * @param {*} target
 * @returns {boolean}
 */
export function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.isContentEditable) return true;
  return !!target.closest(
    'input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [data-odv-shortcuts="off"]'
  );
}

/**
 * Determine whether a modal dialog is currently open.
 * While a modal is active, viewer shortcuts should be completely suspended so the dialog owns
 * keyboard interaction.
 *
 * @returns {boolean}
 */
export function hasActiveModalDialog() {
  if (typeof document === 'undefined') return false;
  return !!document.querySelector('[role="dialog"][aria-modal="true"], dialog[open][aria-modal="true"]');
}

/**
 * Decide whether a keyboard shortcut should be ignored for the viewer.
 *
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
export function shouldIgnoreViewerShortcut(event) {
  if (event.defaultPrevented) return true;
  if (event.isComposing) return true;
  if (hasActiveModalDialog()) return true;
  if (isEditableTarget(event.target)) return true;
  return isEditableTarget(document.activeElement);
}

/**
 * @param {UseViewerEffectsArgs} args
 * @returns {void}
 */
export function useViewerEffects(args) {
  useViewerZoomEffects({
    ...args,
    hasActiveModalDialog,
    isEditableTarget,
  });
  useViewerKeyboardNavigation({
    ...args,
    shouldIgnoreViewerShortcut,
  });
}
