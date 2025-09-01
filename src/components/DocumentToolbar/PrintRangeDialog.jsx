// File: src/components/DocumentToolbar/PrintRangeDialog.jsx
/**
 * Print dialog with Basic/Advanced modes and optional user-log fields.
 *
 * Basic:
 *   - Active page (default)
 *   - All pages
 *
 * Advanced:
 *   - Simple range (inclusive; supports descending by converting to sequence)
 *   - Custom pages (free-form parser)
 *
 * This component only COLLECTS the "reason" and "for whom" values and returns
 * them in the `onSubmit` detail. The consumer (toolbar) decides what to do
 * (e.g., call UserLogController.submitPrint) without blocking the print flow.
 *
 * NOTE:
 *   When printHeader.enabled === true in runtime config, this dialog shows a
 *   read-only informational note that a header overlay will be stamped on
 *   printed pages. There is NO toggle here; it is not optional for the user.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import styles from './PrintRangeDialog.module.css';
import { parsePrintSequence } from '../../utils/printUtils.js';

/**
 * @typedef {("active"|"all"|"range"|"advanced")} PrintMode
 */

/**
 * @typedef {Object} PrintSubmitDetail
 * @property {PrintMode} mode
 * @property {number} [from]
 * @property {number} [to]
 * @property {Array.<number>} [sequence]
 * @property {string|null} [reason]   // user-entered print reason (optional/required via config)
 * @property {string|null} [forWhom]  // who requested the print (optional/required via config)
 */

/**
 * Called when the dialog submits a choice.
 * @callback PrintSubmitHandler
 * @param {PrintSubmitDetail} detail
 * @returns {void}
 */

/** Injected once (scoped to print). */
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

/**
 * Safely read the global runtime config.
 * @returns {any}
 */
function getCfg() {
  const w = typeof window !== 'undefined' ? window : {};
  return (w.__ODV_GET_CONFIG__ ? w.__ODV_GET_CONFIG__() : (w.__ODV_CONFIG__ || {})) || {};
}

/**
 * Guarded RegExp builder (returns null on bad patterns/flags).
 * @param {string|undefined|null} pattern
 * @param {string|undefined|null} flags
 * @returns {RegExp|null}
 */
function safeRegex(pattern, flags) {
  if (!pattern) return null;
  try { return new RegExp(pattern, flags || ''); } catch { return null; }
}

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
  // ---- Runtime config (visibility & validation rules) ----
  const cfg = getCfg();
  const userLogCfg = cfg?.userLog || {};
  const headerCfg  = cfg?.printHeader || {};
  const uiCfg      = userLogCfg?.ui || {};
  const fld        = uiCfg?.fields || {};

  const showReasonWhen  = uiCfg?.showReasonWhen  || 'auto'; // "auto" | "always" | "never"
  const showForWhomWhen = uiCfg?.showForWhomWhen || 'auto'; // "auto" | "always" | "never"

  const showReason  = showReasonWhen  === 'always' || (showReasonWhen  === 'auto' && (userLogCfg.enabled || headerCfg.enabled));
  const showForWhom = showForWhomWhen === 'always' || (showForWhomWhen === 'auto' && (userLogCfg.enabled || headerCfg.enabled));
  const showUserSection = !!(showReason || showForWhom);

  // Reason rules & options (dropdown with optional extra, or plain textbox)
  const reasonCfg = fld?.reason || {};
  const forWhomCfg = fld?.forWhom || {};

  const reasonRegex = safeRegex(reasonCfg?.regex, reasonCfg?.regexFlags);
  const forWhomRegex = safeRegex(forWhomCfg?.regex, forWhomCfg?.regexFlags);

  const reasonMax = Number.isFinite(reasonCfg?.maxLen) ? reasonCfg.maxLen : 255;
  const forWhomMax = Number.isFinite(forWhomCfg?.maxLen) ? forWhomCfg.maxLen : 120;

  const reasonOptions = Array.isArray(reasonCfg?.source?.options) ? reasonCfg.source.options : null;
  const hasOptions    = Array.isArray(reasonOptions) && reasonOptions.length > 0;

  const defaultReason = reasonCfg?.default ?? (hasOptions ? (reasonOptions[0]?.value ?? '') : '');

  // ---- Local state ----
  /** @type {'basic'|'advanced'} */
  const [modeGroup, setModeGroup] = useState('basic');
  /** @type {'active'|'all'} */
  const [basicChoice, setBasicChoice] = useState('active');
  /** @type {'range'|'custom'} */
  const [advancedChoice, setAdvancedChoice] = useState('range');

  const [fromValue, setFromValue] = useState('1');
  const [toValue, setToValue] = useState(String(totalPages || 1));
  const [customText, setCustomText] = useState('');

  // Reason state
  const [selectedReason, setSelectedReason] = useState(defaultReason);
  const [freeReason, setFreeReason] = useState('');
  const selectedOption = useMemo(() => {
    if (!hasOptions) return null;
    return reasonOptions.find(o => (o?.value ?? '') === (selectedReason ?? '')) || null;
  }, [hasOptions, reasonOptions, selectedReason]);
  const needsExtra = !!(selectedOption && selectedOption.allowFreeText);
  const extraCfg = selectedOption?.input || {};
  const extraRegex = safeRegex(extraCfg?.regex, extraCfg?.regexFlags);
  const extraMax = Number.isFinite(extraCfg?.maxLen) ? extraCfg.maxLen : undefined;
  const [extraText, setExtraText] = useState('');

  // For whom
  const [forWhomText, setForWhomText] = useState('');

  // UI
  const [error, setError] = useState('');
  /** @type {React.RefObject<HTMLFormElement>} */
  const dialogRef = useRef(/** @type {HTMLFormElement|null} */(null));
  /** @type {React.RefObject<HTMLDivElement>} */
  const backdropRef = useRef(/** @type {HTMLDivElement|null} */(null));

  const pageOptions = useMemo(() => {
    const n = Math.max(1, Number(totalPages) || 1);
    return Array.from({ length: n }, (_, i) => String(i + 1));
  }, [totalPages]);

  useEffect(() => { ensureODVPrintCSS(); }, []);

  useEffect(() => {
    if (!isOpen) return;
    setModeGroup('basic');
    setBasicChoice('active');
    setAdvancedChoice('range');
    setFromValue('1');
    setToValue(String(totalPages || 1));
    setCustomText('');
    setSelectedReason(defaultReason);
    setFreeReason('');
    setExtraText('');
    setForWhomText('');
    setError('');
  }, [isOpen, totalPages, defaultReason]);

  // Prevent outside interactions from collapsing selects (anti-flicker)
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
    return { ok: true, from, to }; // may be descending
  }, [fromValue, toValue, totalPages]);

  const validateUserFields = useCallback(() => {
    if (!showUserSection) return { ok: true };

    // Reason
    if (showReason) {
      if (hasOptions) {
        if (reasonCfg?.required && !selectedReason) {
          return { ok: false, msg: 'Please select a reason.' };
        }
        if (needsExtra) {
          const txt = String(extraText || '');
          if (extraCfg?.required && !txt.trim()) return { ok: false, msg: 'Please enter additional details for the selected reason.' };
          if (extraMax && txt.length > extraMax) return { ok: false, msg: `Additional text too long (max ${extraMax}).` };
          if (extraRegex && !extraRegex.test(txt)) return { ok: false, msg: 'Additional text format is not allowed.' };
        }
      } else {
        const val = String(freeReason || '').trim();
        if (reasonCfg?.required && !val) return { ok: false, msg: 'Please enter a reason.' };
        if (reasonMax && val.length > reasonMax) return { ok: false, msg: `Reason is too long (max ${reasonMax}).` };
        if (reasonRegex && !reasonRegex.test(val)) return { ok: false, msg: 'Reason format is not allowed.' };
      }
    }

    // For whom
    if (showForWhom) {
      const f = String(forWhomText || '').trim();
      if (forWhomCfg?.required && !f) return { ok: false, msg: 'Please enter who requested this.' };
      if (forWhomMax && f.length > forWhomMax) return { ok: false, msg: `“For whom” is too long (max ${forWhomMax}).` };
      if (forWhomRegex && !forWhomRegex.test(f)) return { ok: false, msg: '“For whom” format is not allowed.' };
    }

    return { ok: true };
  }, [
    showUserSection, showReason, showForWhom,
    hasOptions, reasonCfg?.required, selectedReason, needsExtra, extraCfg?.required,
    extraText, extraMax, extraRegex, freeReason, reasonMax, reasonRegex,
    forWhomText, forWhomCfg?.required, forWhomMax, forWhomRegex
  ]);

  const composeReason = useCallback(() => {
    if (!showReason) return null;
    if (hasOptions) {
      const base = selectedReason || '';
      if (!needsExtra) return base;
      const pre = extraCfg?.prefix || '';
      const suf = extraCfg?.suffix || '';
      const txt = String(extraText || '');
      return base + (txt ? (pre + txt + suf) : '');
    }
    const r = String(freeReason || '');
    return r || null;
  }, [showReason, hasOptions, selectedReason, needsExtra, extraCfg?.prefix, extraCfg?.suffix, extraText, freeReason]);

  const extras = useCallback(() => {
    const reason = composeReason();
    const f = String(forWhomText || '').trim();
    return {
      reason: reason && reason.length ? reason : null,
      forWhom: showForWhom ? (f.length ? f : null) : null
    };
  }, [composeReason, showForWhom, forWhomText]);

  const submit = useCallback((e) => {
    e?.preventDefault?.();

    const vf = validateUserFields();
    if (!vf.ok) { setError(vf.msg || 'Please review the required fields.'); return; }

    if (modeGroup === 'basic') {
      setError('');
      onSubmit({ mode: (basicChoice === 'active' ? 'active' : 'all'), ...extras() });
      return;
    }

    if (advancedChoice === 'range') {
      const v = validateRange();
      if (!v.ok) { setError(v.msg || 'Invalid range.'); return; }
      setError('');
      if (v.from > v.to) {
        onSubmit({ mode: 'advanced', sequence: makeDescendingSequence(v.from, v.to), ...extras() });
      } else {
        onSubmit({ mode: 'range', from: v.from, to: v.to, ...extras() });
      }
      return;
    }

    const { ok, error: err, sequence } = parsePrintSequence(customText, totalPages);
    if (!ok || !sequence?.length) { setError(err || 'Invalid custom pages input.'); return; }
    setError('');
    onSubmit({ mode: 'advanced', sequence, ...extras() });
  }, [
    modeGroup, basicChoice, advancedChoice,
    customText, totalPages, onSubmit,
    extras, validateUserFields, validateRange, makeDescendingSequence
  ]);

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

        {/* Read-only note about non-optional header overlay when enabled in config */}
        {headerCfg?.enabled ? (
          <div className={styles.hint} role="note">
            A header will be stamped on printed pages. This is configured by your administrator and cannot be disabled here.
          </div>
        ) : null}

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

        {/* ===== SECTION: Pages to print ===== */}
        <h4 className={styles.sectionHeader}>Pages</h4>
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

        <hr className={styles.divider} />

        {/* ===== SECTION: Reason & For whom (optional, config-driven) ===== */}
        {showUserSection && (
          <>
            <h4 className={styles.sectionHeader}>Reason &amp; recipient</h4>
            <div className={styles.section} role="group" aria-label="User log">
              <div className={styles.fieldCol}>
                {showReason && (
                  <label className={styles.labelBlock}>
                    Reason {reasonCfg?.required ? <span aria-hidden="true">*</span> : null}
                    {hasOptions ? (
                      <>
                        <select
                          className={styles.select}
                          value={selectedReason}
                          onChange={(e) => setSelectedReason(e.target.value)}
                          aria-label="Reason"
                        >
                          {reasonOptions.map(opt => (
                            <option key={String(opt.value)} value={opt.value}>{opt.value}</option>
                          ))}
                        </select>

                        {needsExtra && (
                          <div className={styles.subField}>
                            <label className={styles.visuallyHidden}>Additional details</label>
                            <input
                              type="text"
                              className={styles.inputWide}
                              placeholder={extraCfg?.placeholder || 'Add details…'}
                              maxLength={extraMax || undefined}
                              value={extraText}
                              onChange={(e) => setExtraText(e.target.value)}
                              aria-label="Additional reason details"
                            />
                          </div>
                        )}
                      </>
                    ) : (
                      <input
                        type="text"
                        className={styles.inputWide}
                        placeholder={reasonCfg?.placeholder || 'Enter reason…'}
                        maxLength={reasonMax || undefined}
                        value={freeReason}
                        onChange={(e) => setFreeReason(e.target.value)}
                        aria-label="Print reason"
                      />
                    )}
                    <span className={styles.hint}>
                      {reasonCfg?.required ? 'Required. ' : 'Optional. '}
                      Max {hasOptions && needsExtra && extraMax ? extraMax : reasonMax} characters{hasOptions && needsExtra ? ' (additional text)' : ''}.
                    </span>
                  </label>
                )}

                {showForWhom && (
                  <label className={styles.labelBlock}>
                    For whom {forWhomCfg?.required ? <span aria-hidden="true">*</span> : null}
                    <input
                      type="text"
                      className={styles.inputWide}
                      placeholder={forWhomCfg?.placeholder || 'Who requested this?'}
                      maxLength={forWhomMax || undefined}
                      value={forWhomText}
                      onChange={(e) => setForWhomText(e.target.value)}
                      aria-label="For whom"
                    />
                    <span className={styles.hint}>
                      {forWhomCfg?.required ? 'Required. ' : 'Optional. '}
                      Max {forWhomMax} characters.
                    </span>
                  </label>
                )}
              </div>
              <span className={styles.hint}>
                These values are sent to the user-log endpoint (if enabled) and may be printed in the header (if enabled).
              </span>
            </div>
          </>
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
