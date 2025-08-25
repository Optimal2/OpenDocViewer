// File: src/components/DocumentToolbar/PrintRangeDialog.jsx
/**
 * Safe, shielded print dialog for OpenDocViewer.
 * - Modes: Active | All | Range (dropdowns 1..N)
 * - Validate only on submit.
 * - Modal shield blocks only OUTSIDE events; nothing is blocked inside the form.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import styles from './PrintRangeDialog.module.css';

const DEBUG_BLOCKERS = false;

/**
 * Mode for printing.
 * @typedef {'active'|'all'|'range'} PrintMode
 */

/**
 * Payload delivered on submit.
 * @typedef {Object} PrintSubmitDetail
 * @property {PrintMode} mode
 * @property {(number|undefined)} from
 * @property {(number|undefined)} to
 */

/** Print CSS injected once per document. */
const ODV_PRINT_CSS = `
@media print {
  @page { margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; }
  #odv-print-root, [data-odv-print-root] { margin: 0 !important; padding: 0 !important; }
  .odv-print-page, [data-odv-print-page] {
    page-break-after: always;
    break-after: page;
    break-inside: avoid;
    display: grid;
    place-items: center;
    overflow: hidden;
    box-sizing: border-box;
    padding: 8mm;
  }
  .odv-print-page img, .odv-print-page canvas,
  [data-odv-print-page] img, [data-odv-print-page] canvas {
    display: block; max-width: 100%; max-height: calc(100% - 0mm); object-fit: contain;
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
 * Print dialog component.
 *
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {function(): void} props.onClose
 * @param {function(PrintSubmitDetail): void} props.onSubmit
 * @param {number} props.totalPages
 * @returns {React.ReactElement|null}
 */
export default function PrintRangeDialog({ isOpen, onClose, onSubmit, totalPages }) {
  const [mode, setMode] = useState('active');
  const [fromValue, setFromValue] = useState('1');
  const [toValue, setToValue] = useState(String(totalPages || 1));
  const [error, setError] = useState('');
  const dialogRef = useRef(/** @type {HTMLFormElement|null} */ (null));
  const backdropRef = useRef(/** @type {HTMLDivElement|null} */ (null));

  const options = useMemo(() => {
    const n = Math.max(1, Number(totalPages) || 1);
    return Array.from({ length: n }, (_, i) => String(i + 1));
  }, [totalPages]);

  useEffect(() => { ensureODVPrintCSS(); }, []);

  useEffect(() => {
    if (!isOpen) return;
    setMode('active');
    setFromValue('1');
    setToValue(String(totalPages || 1));
    setError('');
  }, [isOpen, totalPages]);

  // -------- Modal shield (block ONLY outside events) -------------------------
  useEffect(() => {
    if (!isOpen) return;

    const dialogEl = dialogRef.current;
    const backdropEl = backdropRef.current;
    const isInsideDialog = (node) => {
      if (!node || !dialogEl) return false;
      try { return node === dialogEl || (node instanceof Node && dialogEl.contains(node)); }
      catch { return false; }
    };
    const isBackdrop = (node) => (backdropEl && node === backdropEl);

    const blockPointer = (ev) => {
      if (isInsideDialog(ev.target) || isBackdrop(ev.target)) return; // allow inside + backdrop
      if (DEBUG_BLOCKERS) console.debug('[PrintRangeDialog] blocked pointer:', ev.type, ev.target);
      ev.stopPropagation();
    };
    const blockKeys = (ev) => {
      if (ev.key === 'Escape' || ev.key === 'Tab') return;
      const active = document.activeElement;
      if (isInsideDialog(active) || isInsideDialog(ev.target)) return; // allow keys inside
      if (DEBUG_BLOCKERS) console.debug('[PrintRangeDialog] blocked key:', ev.key);
      ev.stopPropagation();
    };

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

  const resetAndClose = useCallback(() => { setError(''); onClose(); }, [onClose]);

  const validateRange = useCallback(() => {
    const from = parseInt(fromValue, 10);
    const to = parseInt(toValue, 10);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return { ok: false, msg: 'Select valid pages.' };
    if (from < 1 || to < 1) return { ok: false, msg: 'Values must be positive.' };
    if (from > to) return { ok: false, msg: '"From" must be ≤ "To".' };
    if (to > totalPages) return { ok: false, msg: 'The highest allowed page is ' + totalPages + '.' };
    return { ok: true, from, to };
  }, [fromValue, toValue, totalPages]);

  const submit = useCallback((e) => {
    if (e?.preventDefault) e.preventDefault();
    if (mode === 'active') { setError(''); onSubmit({ mode: 'active' }); return; }
    if (mode === 'all')    { setError(''); onSubmit({ mode: 'all' });    return; }
    const v = validateRange();
    if (!v.ok) { setError(v.msg || 'Invalid range.'); return; }
    setError('');
    onSubmit({ mode: 'range', from: v.from, to: v.to });
  }, [mode, onSubmit, validateRange]);

  if (!isOpen) return null;

  const onBackdropMouseDown = (e) => {
    if (e.target === e.currentTarget) { e.stopPropagation(); onClose(); }
  };

  return (
    <div
      ref={backdropRef}
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="print-range-title"
      onMouseDown={onBackdropMouseDown}
    >
      <form
        ref={dialogRef}
        onSubmit={submit}
        className={styles.dialog}
        noValidate
        /* IMPORTANT: no on*Capture here — let events reach radios/selects */
      >
        <h3 id="print-range-title" className={styles.title}>Print</h3>
        <p className={styles.desc}>Choose what to print. Default is <strong>Active page</strong>.</p>

        <div className={styles.section}>
          <label className={styles.radioRow}>
            <input type="radio" name="mode" checked={mode === 'active'} onChange={() => setMode('active')} />
            <span>Active page</span>
          </label>

          <label className={styles.radioRow}>
            <input type="radio" name="mode" checked={mode === 'all'} onChange={() => setMode('all')} />
            <span>All pages</span>
          </label>

          <label className={styles.radioRow}>
            <input type="radio" name="mode" checked={mode === 'range'} onChange={() => setMode('range')} />
            <span>Page range</span>
          </label>

          <div className={styles.rangeRow + ' ' + (mode === 'range' ? '' : styles.disabled)}>
            <label className={styles.label}>
              From
              <select
                value={fromValue}
                onChange={(e) => setFromValue(e.target.value)}
                disabled={mode !== 'range'}
                className={styles.select}
                aria-label="From page"
              >
                {options.map((v) => <option key={'from-' + v} value={v}>{v}</option>)}
              </select>
            </label>

            <label className={styles.label}>
              To
              <select
                value={toValue}
                onChange={(e) => setToValue(e.target.value)}
                disabled={mode !== 'range'}
                className={styles.select}
                aria-label="To page"
              >
                {options.map((v) => <option key={'to-' + v} value={v}>{v}</option>)}
              </select>
            </label>

            <span className={styles.hint}>1–{totalPages}</span>
          </div>

          {error ? <div role="alert" className={styles.error}>{error}</div> : null}
        </div>

        <div className={styles.footer}>
          <button type="button" className="odv-btn" onClick={resetAndClose} aria-label="Cancel">Cancel</button>
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
