// File: src/hooks/useKeyTipsHeld.js
/**
 * Whether the key tips key (`?`) is held: the one piece of the key tips (components/KeyTips.jsx)
 * that lives while the viewer runs. One keydown and one keyup listener on the window, plus
 * blur and visibilitychange, which end the hold when the window stops receiving the keys; a
 * boolean in state and nothing else. The key is honoured only outside editable fields and
 * modal dialogs (the viewer's own shortcut gate) and without Ctrl, Alt or Meta (Cmd+? is the
 * browser's help menu on macOS), its repeat events are ignored, and the hold ends on the
 * release of the physical key that started it (whatever `key` it reports then), of `?` itself,
 * or of Shift, which makes `?` on every layout; also on a pointer press anywhere, so the labels
 * are out of the way of what is clicked and cannot stay up after a keyup the page never saw
 * (a native dialog that swallowed it).
 */
import { useEffect, useState } from 'react';
import { shouldIgnoreViewerShortcut } from '../components/DocumentViewer/hooks/useViewerEffects.js';

/** The key that shows the tips while held. */
export const KEY_TIPS_KEY = '?';

/**
 * @returns {boolean}
 */
export function useKeyTipsHeld() {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    /** The physical key that was pressed, so its release ends the hold whatever `key` it reports then. */
    let heldCode = null;
    const release = () => {
      if (heldCode === null) return;
      heldCode = null;
      setHeld(false);
    };
    const onKeyDown = (event) => {
      if (event.repeat || event.key !== KEY_TIPS_KEY) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (shouldIgnoreViewerShortcut(event)) return;
      event.preventDefault();
      if (heldCode !== null) return;
      heldCode = event.code || KEY_TIPS_KEY;
      setHeld(true);
    };
    const onKeyUp = (event) => {
      if (heldCode === null) return;
      if (event.code === heldCode || event.key === KEY_TIPS_KEY || event.key === 'Shift') release();
    };
    const onVisibility = () => {
      if (document.hidden) release();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('pointerdown', release, true);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('pointerdown', release, true);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  return held;
}

export default useKeyTipsHeld;
