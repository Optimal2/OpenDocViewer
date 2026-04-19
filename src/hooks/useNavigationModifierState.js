// File: src/hooks/useNavigationModifierState.js
/**
 * Shared modifier-key state for navigation and compare-aware viewer actions.
 *
 * The viewer uses Shift as a temporary target switch for the right compare pane and Ctrl as a
 * temporary scope switch for whole-document navigation. This hook centralizes that state so the
 * toolbar and the thumbnail pane stay in sync.
 *
 * Keyboard interaction inside modal dialogs (for example the print dialog or help overlay) should
 * not mutate the main viewer modifier state. The hook therefore clears and suspends modifier state
 * while an active modal dialog owns keyboard focus.
 */

import { useEffect, useRef, useState } from 'react';

/**
 * @typedef {Object} NavigationModifierState
 * @property {boolean} shift
 * @property {boolean} ctrl
 */

/**
 * @returns {boolean}
 */
function hasActiveModalDialog() {
  if (typeof document === 'undefined') return false;
  return !!document.querySelector('[role="dialog"][aria-modal="true"], dialog[open][aria-modal="true"]');
}

/**
 * @param {*} event
 * @returns {NavigationModifierState}
 */
function resolveModifierState(event) {
  return {
    shift: !!event?.getModifierState?.('Shift') || !!event?.shiftKey,
    ctrl: (!!event?.getModifierState?.('Control') || !!event?.ctrlKey) && !event?.metaKey && !event?.altKey,
  };
}

/**
 * @returns {NavigationModifierState}
 */
export function useNavigationModifierState() {
  const [state, setState] = useState(/** @type {NavigationModifierState} */ ({ shift: false, ctrl: false }));
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    /**
     * @param {NavigationModifierState} next
     * @returns {void}
     */
    const applyState = (next) => {
      const normalized = {
        shift: !!next?.shift,
        ctrl: !!next?.ctrl,
      };
      const current = stateRef.current || { shift: false, ctrl: false };
      if (current.shift === normalized.shift && current.ctrl === normalized.ctrl) return;
      stateRef.current = normalized;
      setState(normalized);
    };

    /** @returns {void} */
    const clearState = () => {
      applyState({ shift: false, ctrl: false });
    };

    /**
     * @param {KeyboardEvent} event
     * @returns {void}
     */
    const syncModifierState = (event) => {
      if (hasActiveModalDialog()) {
        clearState();
        return;
      }
      applyState(resolveModifierState(event));
    };

    /** @returns {void} */
    const handleVisibilityChange = () => {
      if (document.hidden) clearState();
    };

    window.addEventListener('keydown', syncModifierState, true);
    window.addEventListener('keyup', syncModifierState, true);
    window.addEventListener('blur', clearState, true);
    document.addEventListener('visibilitychange', handleVisibilityChange, true);

    return () => {
      window.removeEventListener('keydown', syncModifierState, true);
      window.removeEventListener('keyup', syncModifierState, true);
      window.removeEventListener('blur', clearState, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange, true);
    };
  }, []);

  return state;
}

export default useNavigationModifierState;
