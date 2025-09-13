// File: src/components/DocumentToolbar/PrintRangeDialog.controller.js
/**
 * File: src/components/DocumentToolbar/PrintRangeDialog.controller.js
 *
 * Controller hook + helpers for PrintRangeDialog.
 * All heavy logic and effects live here to keep the main component lean.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parsePrintSequence } from '../../utils/printUtils.js';
import { resolveLocalizedValue, resolveOptionLabel } from '../../utils/localizedValue.js';

/**
 * Allowed print modes (string-literal union for JSDoc).
 * @typedef {("active"|"all"|"range"|"advanced")} PrintMode
 */

/**
 * Structured payload returned to the caller on submit.
 * @typedef {Object} PrintSubmitDetail
 * @property {PrintMode} mode
 * @property {number} [from]
 * @property {number} [to]
 * @property {Array.<number>} [sequence]
 * @property {string|null} [reason]
 * @property {string|null} [forWhom]
 */

/**
 * Read the runtime configuration (merged defaults + site overrides).
 * @returns {Object}
 */
export function getCfg() {
  const w = typeof window !== 'undefined' ? window : {};
  return (w.__ODV_GET_CONFIG__ ? w.__ODV_GET_CONFIG__() : (w.__ODV_CONFIG__ || {})) || {};
}

/**
 * Build a safe RegExp from optional pattern/flags.
 * @param {string|null|undefined} pattern
 * @param {string|null|undefined} flags
 * @returns {(RegExp|null)}
 */
export function safeRegex(pattern, flags) {
  if (!pattern) return null;
  try { return new RegExp(pattern, flags || ''); } catch { return null; }
}

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
 * Ensure base print CSS is injected once per document.
 * @returns {void}
 */
export function ensureODVPrintCSS() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('odv-print-css')) return;
  const style = document.createElement('style');
  style.id = 'odv-print-css';
  style.type = 'text/css';
  style.appendChild(document.createTextNode(ODV_PRINT_CSS));
  document.head.appendChild(style);
}

/**
 * Hook that encapsulates state, derived values, effects and handlers
 * for the PrintRangeDialog component.
 *
 * @param {Object} params
 * @param {boolean} params.isOpen
 * @param {function():void} params.onClose
 * @param {function(PrintSubmitDetail):void} params.onSubmit
 * @param {number} params.totalPages
 * @param {function(string, Object=): string} params.t
 * @param {Object} params.styles
 * @param {any} params.i18n
 */
export function usePrintRangeController({ isOpen, onClose, onSubmit, totalPages, t, styles, i18n }) {
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

  // Options + default (default is by stable id)
  const reasonOptions = Array.isArray(reasonCfg?.source?.options) ? reasonCfg.source.options : null;
  const hasOptions    = Array.isArray(reasonOptions) && reasonOptions.length > 0;
  const defaultReason = reasonCfg?.default ?? (hasOptions ? (reasonOptions[0]?.value ?? '') : '');

  /** @type {'basic'|'advanced'} */
  const [modeGroup, setModeGroup] = useState('basic');
  /** @type {'active'|'all'} */
  const [basicChoice, setBasicChoice] = useState('active');
  /** @type {'range'|'custom'} */
  const [advancedChoice, setAdvancedChoice] = useState('range');

  const [fromValue, setFromValue] = useState('1');
  const [toValue, setToValue] = useState(String(totalPages || 1));
  const [customText, setCustomText] = useState('');

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

  const [forWhomText, setForWhomText] = useState('');

  const [error, setError] = useState('');
  /** @type {{ current: (HTMLFormElement|null) }} */
  const dialogRef = useRef(null);
  /** @type {{ current: (HTMLDivElement|null) }} */
  const backdropRef = useRef(null);

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

  /**
   * Build a descending sequence [from..to].
   * @param {number} from
   * @param {number} to
   * @returns {number[]}
   */
  const makeDescendingSequence = useCallback((from, to) => {
    /** @type {Array.<number>} */
    const seq = [];
    for (let n = from; n >= to; n--) seq.push(n);
    return seq;
  }, []);

  /**
   * Validate the "range" inputs.
   * @returns {{ok:true, from:number, to:number} | {ok:false, msg:string}}
   */
  const validateRange = useCallback(() => {
    const from = parseInt(fromValue, 10);
    const to = parseInt(toValue, 10);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return { ok: false, msg: t('printDialog.errors.selectValidPages') };
    if (from < 1 || to < 1) return { ok: false, msg: t('printDialog.errors.valuesPositive') };
    if (from > totalPages || to > totalPages) return { ok: false, msg: t('printDialog.errors.highestAllowed', { total: totalPages }) };
    return { ok: true, from, to }; // may be descending
  }, [fromValue, toValue, totalPages, t]);

  /**
   * Validate optional "reason" and "for whom" fields based on config.
   * @returns {{ok:true} | {ok:false, msg:string}}
   */
  const validateUserFields = useCallback(() => {
    if (!showUserSection) return { ok: true };

    if (showReason) {
      if (hasOptions) {
        if (reasonCfg?.required && !selectedReason) {
          return { ok: false, msg: t('printDialog.errors.selectReason') };
        }
        if (needsExtra) {
          const txt = String(extraText || '');
          if (extraCfg?.required && !txt.trim()) return { ok: false, msg: t('printDialog.errors.enterExtra') };
          if (extraMax && txt.length > extraMax) return { ok: false, msg: t('printDialog.errors.extraTooLong', { max: extraMax }) };
          if (extraRegex && !extraRegex.test(txt)) return { ok: false, msg: t('printDialog.errors.extraFormat') };
        }
      } else {
        const val = String(freeReason || '').trim();
        if (reasonCfg?.required && !val) return { ok: false, msg: t('printDialog.errors.enterReason') };
        if (reasonMax && val.length > reasonMax) return { ok: false, msg: t('printDialog.errors.reasonTooLong', { max: reasonMax }) };
        if (reasonRegex && !reasonRegex.test(val)) return { ok: false, msg: t('printDialog.errors.reasonFormat') };
      }
    }

    if (showForWhom) {
      const f = String(forWhomText || '').trim();
      if (forWhomCfg?.required && !f) return { ok: false, msg: t('printDialog.errors.enterForWhom') };
      if (forWhomMax && f.length > forWhomMax) return { ok: false, msg: t('printDialog.errors.forWhomTooLong', { max: forWhomMax }) };
      if (forWhomRegex && !forWhomRegex.test(f)) return { ok: false, msg: t('printDialog.errors.forWhomFormat') };
    }

    return { ok: true };
  }, [
    showUserSection, showReason, showForWhom,
    hasOptions, reasonCfg?.required, selectedReason, needsExtra, extraCfg?.required,
    extraText, extraMax, extraRegex, freeReason, reasonMax, reasonRegex,
    forWhomText, forWhomCfg?.required, forWhomMax, forWhomRegex, t
  ]);

  // ---- Localized admin strings (resolved once per render) --------------------
  const reasonPlaceholder   = resolveLocalizedValue(reasonCfg?.placeholder, i18n);
  const forWhomPlaceholder  = resolveLocalizedValue(forWhomCfg?.placeholder, i18n);
  const extraPlaceholder    = resolveLocalizedValue(extraCfg?.placeholder, i18n);
  const extraPrefixResolved = resolveLocalizedValue(extraCfg?.prefix, i18n);
  const extraSuffixResolved = resolveLocalizedValue(extraCfg?.suffix, i18n);

  const optionLabel = useCallback((opt) => resolveOptionLabel(opt, i18n), [i18n]);

  /**
   * Compose the Reason string from option + (optional) extra text.
   * @returns {(string|null)}
   */
  const composeReason = useCallback(() => {
    if (!showReason) return null;
    if (hasOptions) {
      const base = selectedReason || '';
      if (!needsExtra) return base;
      const txt = String(extraText || '');
      return base + (txt ? (extraPrefixResolved + txt + extraSuffixResolved) : '');
    }
    const r = String(freeReason || '');
    return r || null;
  }, [showReason, hasOptions, selectedReason, needsExtra, extraPrefixResolved, extraSuffixResolved, extraText, freeReason]);

  /**
   * Compute the additional user-log properties to attach to the submit payload.
   * @returns {{reason:(string|null), forWhom:(string|null)}}
   */
  const extras = useCallback(() => {
    const reason = composeReason();
    const f = String(forWhomText || '').trim();
    return {
      reason: reason && reason.length ? reason : null,
      forWhom: showForWhom ? (f.length ? f : null) : null
    };
  }, [composeReason, showForWhom, forWhomText]);

  /**
   * Handle form submit; validates and forwards a PrintSubmitDetail.
   * @param {Event} [e]
   * @returns {void}
   */
  const submit = useCallback((e) => {
    e?.preventDefault?.();

    const vf = validateUserFields();
    if (!vf.ok) { setError(vf.msg || t('printDialog.errors.review')); return; }

    if (modeGroup === 'basic') {
      setError('');
      onSubmit({ mode: (basicChoice === 'active' ? 'active' : 'all'), ...extras() });
      return;
    }

    if (advancedChoice === 'range') {
      const v = validateRange();
      if (!v.ok) { setError(v.msg || t('printDialog.errors.selectValidPages')); return; }
      setError('');
      if (v.from > v.to) {
        onSubmit({ mode: 'advanced', sequence: makeDescendingSequence(v.from, v.to), ...extras() });
      } else {
        onSubmit({ mode: 'range', from: v.from, to: v.to, ...extras() });
      }
      return;
    }

    const { ok, error: err, sequence } = parsePrintSequence(customText, totalPages);
    if (!ok || !sequence?.length) { setError(err || t('printDialog.errors.invalidCustom')); return; }
    setError('');
    onSubmit({ mode: 'advanced', sequence, ...extras() });
  }, [
    modeGroup, basicChoice, advancedChoice,
    customText, totalPages, onSubmit,
    extras, validateUserFields, validateRange, makeDescendingSequence, t
  ]);

  const onBackdropMouseDown = (e) => {
    if (e.target === e.currentTarget) { e.stopPropagation(); onClose(); }
  };

  const titleSuffix = modeGroup === 'basic' ? t('printDialog.mode.basic') : t('printDialog.mode.advanced');
  const switchTo = t('printDialog.modeSwitch.to', { mode: t('printDialog.mode.advanced') });
  const switchBack = t('printDialog.modeSwitch.back', { mode: t('printDialog.mode.basic') });
  // This is a TRANSLATION hint line (not the config suffix):
  const extraSuffix = (hasOptions && needsExtra) ? t('printDialog.reason.extra.suffix') : '';

  return {
    // cfg
    headerCfg,
    // refs
    dialogRef, backdropRef,
    // state
    modeGroup, setModeGroup,
    basicChoice, setBasicChoice,
    advancedChoice, setAdvancedChoice,
    fromValue, setFromValue,
    toValue, setToValue,
    customText, setCustomText,
    selectedReason, setSelectedReason,
    freeReason, setFreeReason,
    extraText, setExtraText,
    forWhomText, setForWhomText,
    error, setError,
    // derived/config-driven
    showUserSection, showReason, showForWhom,
    reasonCfg, forWhomCfg,
    reasonOptions: reasonOptions || [],
    hasOptions: !!hasOptions,
    needsExtra,
    extraCfg, extraMax,
    reasonMax, forWhomMax,
    pageOptions,
    // localized admin strings
    reasonPlaceholder,
    forWhomPlaceholder,
    extraPlaceholder,
    optionLabel,
    // ui strings
    titleSuffix, switchTo, switchBack, extraSuffix,
    // handlers
    submit, onBackdropMouseDown
  };
}
