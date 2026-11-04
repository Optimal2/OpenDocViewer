// File: src/components/KeyTips.jsx
/**
 * Key tips: hold `?` and every toolbar button shows its name in a small label under it, so the
 * icons can be learnt without hovering them one by one; release the key and the labels go.
 *
 * Built to cost nothing while idle: hooks/useKeyTipsHeld.js keeps one listener set and a
 * boolean, and nothing is measured, created or rendered until `?` is held. While held, the
 * layer measures the visible toolbar buttons once (`getBoundingClientRect` on each, their
 * accessible name from `aria-label` or `title`), lays the labels out in rows
 * (utils/keyTipLayout.js) and renders them into a fixed, pointer-transparent overlay on
 * `document.body`; it measures again only on a window resize. On release the overlay is
 * unmounted. The overlay is decoration for sighted users (`aria-hidden`): assistive technology
 * already has the names. Hidden in print.
 *
 * To remove the feature: delete this file, hooks/useKeyTipsHeld.js, utils/keyTipLayout.js,
 * styles/keytips.css, their tests, the stylesheet import in styles.css and the one mount in
 * DocumentViewerRender.jsx.
 */
import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useKeyTipsHeld } from '../hooks/useKeyTipsHeld.js';
import { packKeyTips } from '../utils/keyTipLayout.js';

/** Buttons the tips name: every button in a toolbar. */
const BUTTON_SELECTOR = '.toolbar button';

/**
 * The accessible name of a button, as the tip shows it.
 * @param {Element} button
 * @returns {string}
 */
function buttonName(button) {
  return String(button.getAttribute('aria-label') || button.getAttribute('title') || '').trim();
}

/**
 * Measure the visible toolbar buttons and lay their tips out.
 * @param {HTMLElement} probe  An offscreen label used to measure the label widths.
 * @returns {Array<Object>}  KeyTipPlacement entries of utils/keyTipLayout.js.
 */
function measureKeyTips(probe) {
  const tips = [];
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  for (const button of document.querySelectorAll(BUTTON_SELECTOR)) {
    const label = buttonName(button);
    if (!label || button.closest('[aria-hidden="true"]')) continue;
    const rect = button.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) continue;
    // A button laid out beyond the viewport (the toolbar does not wrap; its container clips)
    // is not on screen and gets no label.
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= viewportWidth || rect.top >= viewportHeight) continue;
    probe.textContent = label;
    const size = probe.getBoundingClientRect();
    tips.push({
      label,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      // jsdom and a label that is not laid out yet measure 0: estimate from the length then.
      width: size.width > 0 ? size.width : label.length * 6 + 12,
      height: size.height > 0 ? size.height : 18,
    });
  }
  return packKeyTips(tips, viewportWidth);
}

/**
 * The overlay with one label per toolbar button; mounted only while the key is held.
 * @returns {React.ReactElement}
 */
function KeyTipLayer() {
  const [tips, setTips] = useState(/** @type {Array<Object>} */ ([]));
  useLayoutEffect(() => {
    const probe = document.createElement('span');
    probe.className = 'odv-keytip odv-keytip--probe';
    document.body.appendChild(probe);
    const place = () => setTips(measureKeyTips(probe));
    place();
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('resize', place);
      probe.remove();
    };
  }, []);
  return createPortal(
    <div className="odv-keytips" data-odv-keytips="layer" aria-hidden="true">
      {tips.map((tip, index) => (
        <span key={`${index}:${tip.label}`} className="odv-keytip" style={{ left: `${tip.left}px`, top: `${tip.top}px` }}>
          {tip.label}
        </span>
      ))}
    </div>,
    document.body
  );
}

/**
 * @returns {(React.ReactElement|null)}
 */
export default function KeyTips() {
  const held = useKeyTipsHeld();
  return held ? <KeyTipLayer /> : null;
}
