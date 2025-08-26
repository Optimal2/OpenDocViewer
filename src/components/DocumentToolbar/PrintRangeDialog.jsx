// File: src/components/DocumentToolbar/PrintRangeDialog.jsx
/**
 * Print dialog with a subtle Basic/Advanced link switch and radio-based choices.
 * - Basic mode:
 *     • Active page (default)
 *     • All pages
 * - Advanced mode:
 *     • Simple range (default) — supports ascending (2→5) and descending (5→2)
 *     • Custom pages — free-form sequence (accepts 2-5 and 5-2, spaces/commas)
 *
 * NOTE: For descending "Simple range" (from > to), we convert to a sequence on submit,
 *       so downstream code doesn't need special handling.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import styles from './PrintRangeDialog.module.css';
import { parsePrintSequence } from '../../utils/printUtils.js';

/**
 * @typedef {'active'|'all'|'range'|'advanced'} PrintMode
 */

/**
 * @typedef {Object} PrintSubmitDetail
 * @property {PrintMode} mode
 * @property {number} [from]
 * @property {number} [to]
 * @property {Array.<number>} [sequence]
 */

/**
 * Called when the dialog submits a choice.
 * @callback PrintSubmitHandler
 * @param {PrintSubmitDetail} detail
 * @returns {void}
 */

/** Injected once (kept minimal and scoped to print only). */
const ODV_PRINT_CSS = `
@media print {
  @page { margin: 0; size: A4 portrait; }
  html, body { margin: 0 !important; padding: 0 !important; }

  #odv-print-root, [data-odv-print-root] { width: 100vw; height: 100vh; }

  .odv-print-page, [data-odv-print-page] {
    page-break-after: always; break-after: page; break-inside: avoid;
    display: grid; place-items: center;
    box-sizing: border-box; width: 100vw; height: 100vh; padding: 8mm; overflow: hidden;
  }

  .odv-print-page img, .odv-print-page canvas,
  [data-odv-print-page] img, [data-odv-print-page] canvas {
    display: block; max-width: 100%; max-height: 100%; object-fit: contain;
  }

  img[data-odv-print-page], canvas[data-odv-print-page] {
    page-break-after: always; break-inside: avoid; display: block; margin: 0 auto;
    max-width: calc(100% - 10mm); max-height: 95vh; object-fit: contain;
  }
}
`;

function ensureODVPrintCSS() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('odv-print-css')) return;
  const style = document.createElement('style');
  style.id = 'odv-print-css';
  style.type = 'text/css';
  style.appendChild(document.createTextNode(ODV_PRINT_CSS));
  document.head.appendChild(style);
}

/**
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {function(): void} props.onClose
 * @param {PrintSubmitHandler} props.onSubmit
 * @param {number} props.totalPages
 */
export default function PrintRangeDialog({ isOpen, onClose, onSubmit, totalPages }) {
  /** @type {'basic'|'advanced'} */
  const [modeGroup, setModeGroup] = useState('basic');

  /** @type {'active'|'all'} */
  const [basicChoice, setBasicChoice] = useState('active');

  /** @type {'range'|'custom'} */
  const [advancedChoice, setAdvancedChoice] = useState('range');

  const [fromValue, setFromValue] = useState('1');
  const [toValue, setToValue] = useState(String(totalPages || 1));
  const [customText, setCustomText] = useState('');
  const [error, setError] = useState('');

  const dialogRef = useRef(/** @type {HTMLFormElement|null} */(null));
  const backdropRef = useRef(/** @type {HTMLDivElement|null} */(null));

  const pageOptions = useMemo(() => {
    const n = Math.max(1, Number(totalPages) || 1);
    return Array.from({ length: n }, (_, i) => String(i + 1));
  }, [totalPages]);

  useEffect(() => { ensureODVPrintCSS(); }, []);

  useEffect(() => {
    if (!isOpen) return;
    setModeGroup('basic');
    setBasicChoice('active');      // default in Basic
    setAdvancedChoice('range');    // default in Advanced
    setFromValue('1');
    setToValue(String(totalPages || 1));
    setCustomText('');
    setError('');
  }, [isOpen, totalPages]);

  // Block pointer/keyboard events outside dialog only (prevents flicker of <select>)
  useEffect(() => {
    if (!isOpen) return;
    const isInside = (node) => dialogRef.current && (node === dialogRef.current || dialogRef.current.contains(node));
    const isBackdrop = (node) => backdropRef.current && node === backdropRef.current;
    const blockPointer = (ev) => { const t=ev.target; if (isInside(t) || isBackdrop(t)) return; ev.stopPropagation(); };
    const blockKeys = (ev) => { if (ev.key === 'Escape' || ev.key === 'Tab') return; const t=ev.target; if (isInside(t) || isInside(document.activeElement)) return; ev.stopPropagation(); };
    document.addEventListener('pointerdown', blockPointer, true);
    document.addEventListener('mousedown', blockPointer, true);
    document.addEventListener('click', blockPointer, true);
    window.addEventListener('keydown', blockKeys, true);
    return () => {
      document.removeEventListener('pointerdown', blockPointer, true);
      document.removeEventListener('mousedown', blockPointer, true);
      document.removeEventListener('click', blockPointer, true);
      window.removeEventListener('keydown', blockKeys, true);
    };
  }, [isOpen]);

  const makeDescendingSequence = useCallback((from, to) => {
    /** @type {Array.<number>} */
    const seq = [];
    for (let n = from; n >= to; n--) seq.push(n);
    return seq;
  }, []);

  const validateRange = useCallback(() => {
    const from = parseInt(fromValue, 10);
    const to = parseInt(toValue, 10);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return { ok: false, msg: 'Select valid pages.' };
    if (from < 1 || to < 1) return { ok: false, msg: 'Values must be positive.' };
    if (from > totalPages || to > totalPages) return { ok: false, msg: 'The highest allowed page is ' + totalPages + '.' };
    return { ok: true, from, to }; // from may be > to (descending)
  }, [fromValue, toValue, totalPages]);

  const submit = useCallback((e) => {
    e?.preventDefault?.();

    // BASIC
    if (modeGroup === 'basic') {
      setError('');
      onSubmit({ mode: basicChoice === 'active' ? 'active' : 'all' });
      return;
    }

    // ADVANCED
    if (advancedChoice === 'range') {
      const v = validateRange();
      if (!v.ok) { setError(v.msg || 'Invalid range.'); return; }
      setError('');
      if (v.from > v.to) {
        // Convert descending simple range into a sequence so no console error downstream.
        onSubmit({ mode: 'advanced', sequence: makeDescendingSequence(v.from, v.to) });
      } else {
        onSubmit({ mode: 'range', from: v.from, to: v.to });
      }
      return;
    }

    // advancedChoice === 'custom'
    const { ok, error: err, sequence } = parsePrintSequence(customText, totalPages);
    if (!ok || !sequence?.length) { setError(err || 'Invalid custom pages input.'); return; }
    setError('');
    onSubmit({ mode: 'advanced', sequence });
  }, [modeGroup, basicChoice, advancedChoice, validateRange, customText, totalPages, onSubmit, makeDescendingSequence]);

  if (!isOpen) return null;
  const onBackdropMouseDown = (e) => { if (e.target === e.currentTarget) { e.stopPropagation(); onClose(); } };

  const titleSuffix = modeGroup === 'basic' ? 'Basic mode' : 'Advanced mode';

  return (
    <div
      ref={backdropRef}
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="print-title"
      onMouseDown={onBackdropMouseDown}
    >
      <form ref={dialogRef} onSubmit={submit} className={styles.dialog} noValidate>
        <h3 id="print-title" className={styles.title}>Print – {titleSuffix}</h3>
        <p className={styles.desc}>Pick what to print. Default is <strong>Active page</strong>.</p>

        {/* Text-link mode switch */}
        {modeGroup === 'basic' ? (
          <p className={styles.modeSwitch}>
            Switch to{' '}
            <button type="button" className={styles.linkBtn} onClick={() => setModeGroup('advanced')}>
              advanced mode
            </button>
            .
          </p>
        ) : (
          <p className={styles.modeSwitch}>
            Switch back to{' '}
            <button type="button" className={styles.linkBtn} onClick={() => setModeGroup('basic')}>
              basic mode
            </button>
            .
          </p>
        )}

        {/* BASIC */}
        {modeGroup === 'basic' && (
          <div className={styles.section} role="group" aria-label="Basic choices">
            <div className={styles.radioList}>
              <label className={styles.radioRow}>
                <input
                  type="radio"
                  name="basicChoice"
                  value="active"
                  checked={basicChoice === 'active'}
                  onChange={() => setBasicChoice('active')}
                />
                <span>Active page</span>
              </label>
              <label className={styles.radioRow}>
                <input
                  type="radio"
                  name="basicChoice"
                  value="all"
                  checked={basicChoice === 'all'}
                  onChange={() => setBasicChoice('all')}
                />
                <span>All pages</span>
              </label>
            </div>
          </div>
        )}

        {/* ADVANCED */}
        {modeGroup === 'advanced' && (
          <div className={styles.section} role="group" aria-label="Advanced choices">
            <div className={styles.radioList}>
              <label className={styles.radioRow}>
                <input
                  type="radio"
                  name="advancedChoice"
                  value="range"
                  checked={advancedChoice === 'range'}
                  onChange={() => setAdvancedChoice('range')}
                />
                <span>Simple range</span>
              </label>
              <label className={styles.radioRow}>
                <input
                  type="radio"
                  name="advancedChoice"
                  value="custom"
                  checked={advancedChoice === 'custom'}
                  onChange={() => setAdvancedChoice('custom')}
                />
                <span>Custom pages</span>
              </label>
            </div>

            {/* Simple range controls — only visible when selected */}
            {advancedChoice === 'range' && (
              <div className={styles.rangeRow}>
                <label className={styles.label}>
                  From
                  <select
                    value={fromValue}
                    onChange={(e) => setFromValue(e.target.value)}
                    className={styles.select}
                    aria-label="From page"
                  >
                    {pageOptions.map((v) => <option key={'from-' + v} value={v}>{v}</option>)}
                  </select>
                </label>

                <label className={styles.label}>
                  To
                  <select
                    value={toValue}
                    onChange={(e) => setToValue(e.target.value)}
                    className={styles.select}
                    aria-label="To page"
                  >
                    {pageOptions.map((v) => <option key={'to-' + v} value={v}>{v}</option>)}
                  </select>
                </label>

                <span className={styles.hint}>
                  Allowed: 1–{totalPages}. Ascending (<code>2→5</code>) or descending (<code>5→2</code>).
                </span>
              </div>
            )}

            {/* Custom pages controls — only visible when selected */}
            {advancedChoice === 'custom' && (
              <div className={styles.advancedRow}>
                <label className={styles.label} style={{ width: '100%' }}>
                  <span className={styles.visuallyHidden}>Custom pages</span>
                  <input
                    type="text"
                    className={styles.inputWide}
                    placeholder="e.g. 7 6 5 4 2   or   1-3, 2, 2, 5-2"
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    aria-label="Custom pages input"
                    inputMode="numeric"
                  />
                </label>
                <span className={styles.hint}>Spaces or commas. Ranges can ascend (<code>2-5</code>) or descend (<code>5-2</code>).</span>
              </div>
            )}
          </div>
        )}

        {error ? <div role="alert" className={styles.error}>{error}</div> : null}

        <div className={styles.footer}>
          <button type="button" className="odv-btn" onClick={() => { setError(''); onClose(); }} aria-label="Cancel">Cancel</button>
          <button type="submit" className="odv-btn" aria-label="Continue to print">Continue</button>
        </div>
      </form>
    </div>
  );
}

PrintRangeDialog.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  totalPages: PropTypes.number.isRequired,
};
