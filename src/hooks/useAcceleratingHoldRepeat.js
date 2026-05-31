// File: src/hooks/useAcceleratingHoldRepeat.js
/**
 * Reusable press-and-hold behavior for toolbar buttons.
 *
 * A press performs one immediate action. If the pointer stays down past the initial delay, the same
 * action repeats with a gradually shorter delay. Pointer-origin clicks are suppressed because the
 * leading-edge action has already happened; keyboard clicks still execute one action.
 */

import { useCallback, useEffect, useRef } from 'react';
import logger from '../logging/systemLogger.js';

const DEFAULT_INITIAL_DELAY_MS = 450;
const DEFAULT_FIRST_REPEAT_DELAY_MS = 220;
const DEFAULT_MIN_REPEAT_DELAY_MS = 55;
const DEFAULT_ACCELERATION = 0.78;
const POINTER_COMPAT_SUPPRESS_MS = 700;
const CLICK_SUPPRESS_MS = 500;

function getNow() {
  try {
    return typeof performance !== 'undefined' && Number.isFinite(performance.now())
      ? performance.now()
      : Date.now();
  } catch {
    return Date.now();
  }
}

function createEventSnapshot(event) {
  return {
    shiftKey: !!event?.shiftKey,
    ctrlKey: !!event?.ctrlKey,
    altKey: !!event?.altKey,
    metaKey: !!event?.metaKey,
    preventDefault() {},
    stopPropagation() {},
  };
}

/**
 * @param {Object} options
 * @param {function(*=): void} options.action
 * @param {boolean=} options.disabled
 * @param {number=} options.initialDelayMs
 * @param {number=} options.firstRepeatDelayMs
 * @param {number=} options.minRepeatDelayMs
 * @param {number=} options.acceleration
 * @returns {{
 *   onPointerDown: function(*): void,
 *   onMouseDown: function(*): void,
 *   onTouchStart: function(*): void,
 *   onClick: function(*): void,
 *   stop: function(): void
 * }}
 */
export default function useAcceleratingHoldRepeat({
  action,
  disabled = false,
  initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
  firstRepeatDelayMs = DEFAULT_FIRST_REPEAT_DELAY_MS,
  minRepeatDelayMs = DEFAULT_MIN_REPEAT_DELAY_MS,
  acceleration = DEFAULT_ACCELERATION,
}) {
  const actionRef = useRef(action);
  const disabledRef = useRef(!!disabled);
  const timerRef = useRef(null);
  const activeRef = useRef(false);
  const tokenRef = useRef(0);
  const repeatDelayRef = useRef(DEFAULT_FIRST_REPEAT_DELAY_MS);
  const eventSnapshotRef = useRef(null);
  const pointerCompatSuppressUntilRef = useRef(0);
  const clickSuppressUntilRef = useRef(0);

  actionRef.current = action;
  disabledRef.current = !!disabled;

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      try { window.clearTimeout(timerRef.current); } catch {}
      timerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    if (activeRef.current) {
      clickSuppressUntilRef.current = getNow() + CLICK_SUPPRESS_MS;
    }
    activeRef.current = false;
    tokenRef.current += 1;
    clearTimer();
  }, [clearTimer]);

  const runAction = useCallback((snapshot) => {
    if (disabledRef.current) {
      stop();
      return;
    }
    try {
      actionRef.current?.(snapshot || eventSnapshotRef.current || createEventSnapshot(null));
    } catch (error) {
      logger.error('Hold-repeat action failed', { error: String(error?.message || error) });
      stop();
    }
  }, [stop]);

  const scheduleNext = useCallback((token, delayMs) => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (!activeRef.current || tokenRef.current !== token) return;
      runAction(eventSnapshotRef.current);
      if (!activeRef.current || tokenRef.current !== token) return;

      const currentDelay = Math.max(
        DEFAULT_MIN_REPEAT_DELAY_MS,
        Number(repeatDelayRef.current) || DEFAULT_FIRST_REPEAT_DELAY_MS
      );
      const nextDelay = Math.max(
        Math.max(1, Number(minRepeatDelayMs) || DEFAULT_MIN_REPEAT_DELAY_MS),
        Math.round(currentDelay * Math.max(0.1, Math.min(1, Number(acceleration) || DEFAULT_ACCELERATION)))
      );
      repeatDelayRef.current = nextDelay;
      scheduleNext(token, nextDelay);
    }, Math.max(0, Number(delayMs) || 0));
  }, [acceleration, clearTimer, minRepeatDelayMs, runAction]);

  const start = useCallback((event, source = 'pointer') => {
    if (disabledRef.current) return;
    if (typeof event?.button === 'number' && event.button !== 0) return;

    if (source !== 'pointer' && pointerCompatSuppressUntilRef.current > getNow()) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      return;
    }
    if (source === 'pointer') {
      pointerCompatSuppressUntilRef.current = getNow() + POINTER_COMPAT_SUPPRESS_MS;
    }

    event?.preventDefault?.();
    event?.stopPropagation?.();
    try {
      if (event?.pointerId != null && event?.currentTarget?.setPointerCapture) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    } catch {}

    stop();

    const token = tokenRef.current + 1;
    tokenRef.current = token;
    activeRef.current = true;
    repeatDelayRef.current = Math.max(1, Number(firstRepeatDelayMs) || DEFAULT_FIRST_REPEAT_DELAY_MS);
    eventSnapshotRef.current = createEventSnapshot(event);
    clickSuppressUntilRef.current = getNow() + CLICK_SUPPRESS_MS;

    runAction(eventSnapshotRef.current);
    if (activeRef.current && tokenRef.current === token) {
      scheduleNext(token, Math.max(0, Number(initialDelayMs) || DEFAULT_INITIAL_DELAY_MS));
    }
  }, [firstRepeatDelayMs, initialDelayMs, runAction, scheduleNext, stop]);

  const handleClick = useCallback((event) => {
    const now = getNow();
    if (clickSuppressUntilRef.current > now) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      return;
    }
    if (disabledRef.current) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    runAction(createEventSnapshot(event));
  }, [runAction]);

  useEffect(() => {
    if (!disabledRef.current) return undefined;
    stop();
    return undefined;
  }, [disabled, stop]);

  useEffect(() => {
    const release = () => stop();
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    window.addEventListener('mouseup', release, true);
    window.addEventListener('touchend', release, true);
    window.addEventListener('touchcancel', release, true);
    window.addEventListener('blur', release, true);
    return () => {
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
      window.removeEventListener('mouseup', release, true);
      window.removeEventListener('touchend', release, true);
      window.removeEventListener('touchcancel', release, true);
      window.removeEventListener('blur', release, true);
      stop();
    };
  }, [stop]);

  return {
    onPointerDown: (event) => start(event, 'pointer'),
    onMouseDown: (event) => start(event, 'mouse'),
    onTouchStart: (event) => start(event, 'touch'),
    onClick: handleClick,
    stop,
  };
}
