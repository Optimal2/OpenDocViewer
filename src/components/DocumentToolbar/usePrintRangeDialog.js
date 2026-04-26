// File: src/components/DocumentToolbar/usePrintRangeDialog.js
/**
 * File: src/components/DocumentToolbar/usePrintRangeDialog.js
 *
 * Hook + helpers for PrintRangeDialog.
 * All heavy logic and effects live here to keep the main component lean.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parsePrintSequence } from '../../utils/printUtils.js';
import { resolveLocalizedValue, resolveOptionLabel } from '../../utils/localizedValue.js';

/**
 * Structured payload returned to the caller on submit.
 * @typedef {Object} PrintSubmitDetail
 * @property {('active'|'all'|'range'|'advanced')} mode
 * @property {number} [from]
 * @property {number} [to]
 * @property {Array.<number>} [sequence]
 * @property {'selection'|'session'} [allScope]
 * @property {'primary'|'compare-both'} [activeScope]
 * @property {string|null} [reason]
 * @property {string|null} [forWhom]
 * @property {string|null} [printFormat]
 * @property {string|null} [printFormatValue]
 * @property {'html'|'pdf'} [printBackend]
 * @property {'print'|'download'} [printAction]
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

/**
 * @param {*} value
 * @returns {boolean}
 */
function hasTextValue(value) {
  if (value === undefined || value === null) return false;
  const text = String(value).trim();
  if (!text) return false;
  const lowered = text.toLowerCase();
  return lowered !== 'null' && lowered !== 'undefined';
}

/**
 * Resolve the string that should be used on physical print/log output for an option.
 * `printValue` may be localized and is preferred over legacy value/label behavior.
 * @param {*} option
 * @param {*} i18n
 * @param {boolean} useValueForOutput
 * @returns {string}
 */
function resolveOptionPrintText(option, i18n, useValueForOutput) {
  if (!option) return '';
  if (option.printValue !== undefined) {
    return resolveLocalizedValue(option.printValue, i18n) || String(option.value ?? '');
  }
  if (option.output !== undefined) {
    return resolveLocalizedValue(option.output, i18n) || String(option.value ?? '');
  }
  if (option.printLabel !== undefined) {
    return resolveLocalizedValue(option.printLabel, i18n) || String(option.value ?? '');
  }
  if (useValueForOutput) return String(option.value ?? '');
  return resolveOptionLabel(option, i18n) || String(option.value ?? '');
}

/**
 * Build token-friendly details for the selected option without forcing templates to use list indexes.
 * @param {*} option
 * @param {*} i18n
 * @param {string} output
 * @param {Object=} extra
 * @returns {Object}
 */
function buildSelectedOptionDetails(option, i18n, output, extra = {}) {
  const value = option?.value == null ? '' : String(option.value);
  return {
    value,
    label: option?.label ?? value,
    uiLabel: resolveOptionLabel(option || { value }, i18n) || value,
    printValue: option?.printValue ?? option?.output ?? option?.printLabel ?? value,
    output: output || '',
    selectedText: output || '',
    option: option || null,
    ...extra,
  };
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
 * Hook that encapsulates state, derived values, effects and handlers for PrintRangeDialog.
 *
 * @param {Object} params
 * @param {boolean} params.isOpen
 * @param {function():void} params.onClose
 * @param {function(PrintSubmitDetail):void} params.onSubmit
 * @param {number} params.totalPages
 * @param {boolean=} params.isDocumentLoading
 * @param {number=} params.activePageNumber
 * @param {boolean=} params.isComparing
 * @param {boolean=} params.hasActiveSelection
 * @param {number=} params.selectionIncludedCount
 * @param {number=} params.sessionTotalPages
 * @param {function(string, Object=): string} params.t
 * @param {any} params.i18n
 */
export function usePrintRangeController({
  isOpen,
  onClose,
  onSubmit,
  totalPages,
  isDocumentLoading = false,
  activePageNumber = 1,
  isComparing = false,
  hasActiveSelection = false,
  selectionIncludedCount = 0,
  sessionTotalPages = totalPages,
  t,
  i18n,
}) {
  const cfg = getCfg();
  const userLogCfg = cfg?.userLog || {};
  const headerCfg = cfg?.printHeader || {};
  const uiCfg = userLogCfg?.ui || {};
  const fld = uiCfg?.fields || {};

  const showReasonWhen = uiCfg?.showReasonWhen || 'auto';
  const showForWhomWhen = uiCfg?.showForWhomWhen || 'auto';
  const reasonCfg = fld?.reason || {};
  const forWhomCfg = fld?.forWhom || {};
  const printFormatCfg = cfg?.print?.format || {};
  const pdfPrintCfg = cfg?.print?.pdf || {};
  const pdfPrintEnabled = pdfPrintCfg?.enabled === true;
  const pdfDownloadEnabled = pdfPrintEnabled && pdfPrintCfg?.allowDownload === true;
  const defaultPrintBackend = pdfPrintEnabled && String(pdfPrintCfg?.defaultMode || 'direct').toLowerCase() === 'safe' ? 'pdf' : 'html';
  const printFormatOptions = Array.isArray(printFormatCfg?.options) ? printFormatCfg.options : [];
  const hasPrintFormatOptions = !!printFormatCfg?.enabled && printFormatOptions.length > 0;
  const nonEmptyPrintFormatOptions = printFormatOptions.filter((option) => hasTextValue(option?.value));
  const checkboxPrintFormatOption = nonEmptyPrintFormatOptions[0] || null;
  const watermarkCfg = printFormatCfg?.watermark || {};
  const watermarkEnabled = watermarkCfg?.enabled !== false;
  const showPrintFormatCheckbox = !!hasPrintFormatOptions && !!checkboxPrintFormatOption && watermarkEnabled && watermarkCfg?.showOption !== false;
  const forcePrintFormatActive = !!hasPrintFormatOptions && !!checkboxPrintFormatOption && watermarkEnabled && watermarkCfg?.showOption === false && watermarkCfg?.defaultChecked === true;
  const defaultPrintFormatChecked = !!checkboxPrintFormatOption && watermarkEnabled && (forcePrintFormatActive || watermarkCfg?.defaultChecked === true);
  const showReason = showReasonWhen === 'always' || (showReasonWhen === 'auto' && (userLogCfg.enabled || headerCfg.enabled));
  const showForWhom = showForWhomWhen === 'always' || (showForWhomWhen === 'auto' && (userLogCfg.enabled || headerCfg.enabled));
  const showUserSection = !!(showReason || showForWhom || showPrintFormatCheckbox);
  const restrictToActivePage = !!isDocumentLoading;
  const canPrintSelectionScope = !!hasActiveSelection && Math.max(0, Number(selectionIncludedCount) || 0) > 0;
  const reasonRegex = safeRegex(reasonCfg?.regex, reasonCfg?.regexFlags);
  const forWhomRegex = safeRegex(forWhomCfg?.regex, forWhomCfg?.regexFlags);
  const reasonMax = Number.isFinite(reasonCfg?.maxLen) ? reasonCfg.maxLen : 255;
  const forWhomMax = Number.isFinite(forWhomCfg?.maxLen) ? forWhomCfg.maxLen : 120;

  const reasonOptions = Array.isArray(reasonCfg?.source?.options) ? reasonCfg.source.options : null;
  const hasOptions = Array.isArray(reasonOptions) && reasonOptions.length > 0;
  const defaultReason = reasonCfg?.default ?? (hasOptions ? (reasonOptions[0]?.value ?? '') : '');

  const [printMode, setPrintMode] = useState(/** @type {'active'|'all'|'range'|'custom'} */ ('active'));
  const [activeScope, setActiveScope] = useState(/** @type {'primary'|'compare-both'} */ ('primary'));
  const [allScope, setAllScope] = useState(/** @type {'selection'|'session'} */ (canPrintSelectionScope ? 'selection' : 'session'));
  const [fromValue, setFromValue] = useState('1');
  const [toValue, setToValue] = useState(String(totalPages || 1));
  const [customText, setCustomText] = useState('');

  const [selectedReason, setSelectedReason] = useState(defaultReason);
  const [freeReason, setFreeReason] = useState('');
  const selectedOption = useMemo(() => {
    if (!hasOptions) return null;
    return reasonOptions.find((option) => (option?.value ?? '') === (selectedReason ?? '')) || null;
  }, [hasOptions, reasonOptions, selectedReason]);
  const needsExtra = !!(selectedOption && selectedOption.allowFreeText);
  const extraCfg = selectedOption?.input || {};
  const extraRegex = safeRegex(extraCfg?.regex, extraCfg?.regexFlags);
  const extraMax = Number.isFinite(extraCfg?.maxLen) ? extraCfg.maxLen : undefined;
  const [extraText, setExtraText] = useState('');
  const [forWhomText, setForWhomText] = useState('');
  const [printFormatChecked, setPrintFormatChecked] = useState(defaultPrintFormatChecked);
  const [printBackend, setPrintBackend] = useState(/** @type {'html'|'pdf'} */ (defaultPrintBackend));

  const [error, setError] = useState('');
  const dialogRef = useRef(/** @type {(HTMLFormElement|null)} */ (null));
  const backdropRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));

  const pageOptions = useMemo(() => {
    const n = Math.max(1, Number(totalPages) || 1);
    return Array.from({ length: n }, (_, index) => String(index + 1));
  }, [totalPages]);

  useEffect(() => { ensureODVPrintCSS(); }, []);

  const previousDefaultReasonRef = useRef(defaultReason);
  const previousDefaultPrintFormatCheckedRef = useRef(defaultPrintFormatChecked);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      previousDefaultReasonRef.current = defaultReason;
      previousDefaultPrintFormatCheckedRef.current = defaultPrintFormatChecked;
      return;
    }

    const openedNow = !wasOpenRef.current;
    const defaultReasonChanged = previousDefaultReasonRef.current !== defaultReason;
    const defaultPrintFormatChanged = previousDefaultPrintFormatCheckedRef.current !== defaultPrintFormatChecked;
    wasOpenRef.current = true;
    previousDefaultReasonRef.current = defaultReason;
    previousDefaultPrintFormatCheckedRef.current = defaultPrintFormatChecked;

    if (!openedNow && !defaultReasonChanged && !defaultPrintFormatChanged) return;

    setPrintMode('active');
    setActiveScope('primary');
    setAllScope(canPrintSelectionScope ? 'selection' : 'session');
    setFromValue('1');
    setToValue(String(totalPages || 1));
    setCustomText('');
    setSelectedReason(defaultReason);
    setFreeReason('');
    setExtraText('');
    setForWhomText('');
    setPrintFormatChecked(defaultPrintFormatChecked);
    setPrintBackend(defaultPrintBackend);
    setError('');
  }, [canPrintSelectionScope, defaultPrintBackend, defaultPrintFormatChecked, defaultReason, isOpen, totalPages]);

  useEffect(() => {
    if (!isOpen || !restrictToActivePage) return;
    setPrintMode('active');
    setActiveScope('primary');
    setError('');
  }, [isOpen, restrictToActivePage]);

  useEffect(() => {
    if (!isComparing) setActiveScope('primary');
  }, [isComparing]);

  useEffect(() => {
    if (canPrintSelectionScope) return;
    setAllScope('session');
  }, [canPrintSelectionScope]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const isInside = (node) => dialogRef.current && (node === dialogRef.current || dialogRef.current.contains(node));
    const isBackdrop = (node) => backdropRef.current && node === backdropRef.current;
    const blockPointer = (event) => { const target = event.target; if (isInside(target) || isBackdrop(target)) return; event.stopPropagation(); };

    document.addEventListener('pointerdown', blockPointer, true);
    document.addEventListener('mousedown', blockPointer, true);
    document.addEventListener('click', blockPointer, true);
    return () => {
      document.removeEventListener('pointerdown', blockPointer, true);
      document.removeEventListener('mousedown', blockPointer, true);
      document.removeEventListener('click', blockPointer, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;

    dialogRef.current?.focus?.();

    const handleEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
    };

    window.addEventListener('keydown', handleEscape, true);
    return () => {
      window.removeEventListener('keydown', handleEscape, true);
    };
  }, [isOpen, onClose]);

  /**
   * @param {KeyboardEvent|React.KeyboardEvent} event
   * @returns {void}
   */
  const onDialogKeyDown = useCallback((event) => {
    if (String(event?.key || '') !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose?.();
  }, [onClose]);

  /**
   * @param {number} from
   * @param {number} to
   * @returns {number[]}
   */
  const makeDescendingSequence = useCallback((from, to) => {
    const seq = [];
    for (let number = from; number >= to; number -= 1) seq.push(number);
    return seq;
  }, []);

  /**
   * @returns {{ok:true, from:number, to:number} | {ok:false, msg:string}}
   */
  const validateRange = useCallback(() => {
    const from = parseInt(fromValue, 10);
    const to = parseInt(toValue, 10);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return { ok: false, msg: t('printDialog.errors.selectValidPages') };
    if (from < 1 || to < 1) return { ok: false, msg: t('printDialog.errors.valuesPositive') };
    if (from > totalPages || to > totalPages) return { ok: false, msg: t('printDialog.errors.highestAllowed', { total: totalPages }) };
    return { ok: true, from, to };
  }, [fromValue, toValue, totalPages, t]);

  /**
   * @returns {{ok:true} | {ok:false, msg:string}}
   */
  const validateUserFields = useCallback(() => {
    if (!showUserSection) return { ok: true };

    if (showReason) {
      if (hasOptions) {
        if (reasonCfg?.required && !selectedReason) return { ok: false, msg: t('printDialog.errors.selectReason') };
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
      const val = String(forWhomText || '').trim();
      if (forWhomCfg?.required && !val) return { ok: false, msg: t('printDialog.errors.enterForWhom') };
      if (forWhomMax && val.length > forWhomMax) return { ok: false, msg: t('printDialog.errors.forWhomTooLong', { max: forWhomMax }) };
      if (forWhomRegex && !forWhomRegex.test(val)) return { ok: false, msg: t('printDialog.errors.forWhomFormat') };
    }

    return { ok: true };
  }, [
    extraCfg?.required,
    extraMax,
    extraRegex,
    extraText,
    forWhomCfg?.required,
    forWhomMax,
    forWhomRegex,
    forWhomText,
    freeReason,
    hasOptions,
    needsExtra,
    reasonCfg?.required,
    reasonMax,
    reasonRegex,
    selectedReason,
    showForWhom,
    showReason,
    showUserSection,
    t,
  ]);

  const reasonPlaceholder = resolveLocalizedValue(reasonCfg?.placeholder, i18n);
  const forWhomPlaceholder = resolveLocalizedValue(forWhomCfg?.placeholder, i18n);
  const extraPlaceholder = resolveLocalizedValue(extraCfg?.placeholder, i18n);
  const extraPrefixResolved = resolveLocalizedValue(extraCfg?.prefix, i18n);
  const extraSuffixResolved = resolveLocalizedValue(extraCfg?.suffix, i18n);
  const optionLabel = useCallback((opt) => resolveOptionLabel(opt, i18n), [i18n]);
  const selectedPrintFormatOption = useMemo(() => {
    if (!hasPrintFormatOptions || !checkboxPrintFormatOption) return null;
    if (!printFormatChecked && !forcePrintFormatActive) return null;
    return checkboxPrintFormatOption;
  }, [checkboxPrintFormatOption, forcePrintFormatActive, hasPrintFormatOptions, printFormatChecked]);

  /**
   * @returns {{printFormat:(string|null), printFormatValue:(string|null), printFormatSelection:Object}}
   */
  const composePrintFormat = useCallback(() => {
    if (!hasPrintFormatOptions || !selectedPrintFormatOption) {
      return { printFormat: null, printFormatValue: null, printFormatSelection: buildSelectedOptionDetails(null, i18n, '') };
    }

    const rawValue = selectedPrintFormatOption?.value == null ? '' : String(selectedPrintFormatOption.value);
    const useValue = printFormatCfg?.useValueForOutput !== false;
    const text = String(resolveOptionPrintText(selectedPrintFormatOption, i18n, useValue)).trim();

    return {
      printFormat: text || null,
      printFormatValue: rawValue || null,
      printFormatSelection: buildSelectedOptionDetails(selectedPrintFormatOption, i18n, text),
    };
  }, [hasPrintFormatOptions, i18n, printFormatCfg?.useValueForOutput, selectedPrintFormatOption]);

  /**
   * @returns {{reason:(string|null), reasonSelection:Object}}
   */
  const composeReason = useCallback(() => {
    if (!showReason) return { reason: null, reasonSelection: buildSelectedOptionDetails(null, i18n, '') };
    if (hasOptions) {
      const rawValue = selectedReason || '';
      const outputUsesValue = reasonCfg?.useValueForOutput !== false;
      const base = resolveOptionPrintText(selectedOption || { value: rawValue }, i18n, outputUsesValue) || rawValue;
      const txt = String(extraText || '');
      const output = base + (needsExtra && txt ? (extraPrefixResolved + txt + extraSuffixResolved) : '');
      return {
        reason: output || null,
        reasonSelection: buildSelectedOptionDetails(selectedOption || { value: rawValue }, i18n, output, { freeText: txt }),
      };
    }
    const reason = String(freeReason || '').trim();
    return {
      reason: reason || null,
      reasonSelection: buildSelectedOptionDetails({ value: reason, label: reason, printValue: reason }, i18n, reason),
    };
  }, [extraPrefixResolved, extraSuffixResolved, extraText, freeReason, hasOptions, i18n, needsExtra, reasonCfg?.useValueForOutput, selectedOption, selectedReason, showReason]);

  /**
   * @returns {{reason:(string|null), forWhom:(string|null), printFormat:(string|null), printFormatValue:(string|null)}}
   */
  const extras = useCallback(() => {
    const reason = composeReason();
    const forWhom = String(forWhomText || '').trim();
    const printFormat = composePrintFormat();
    return {
      ...reason,
      forWhom: showForWhom ? (forWhom.length ? forWhom : null) : null,
      ...printFormat,
    };
  }, [composePrintFormat, composeReason, forWhomText, showForWhom]);

  /**
   * Compose and validate the print payload for the current dialog state.
   * @param {'print'|'download'} action
   * @returns {(PrintSubmitDetail|null)}
   */
  const composeSubmitDetail = useCallback((action = 'print') => {
    const userValidation = validateUserFields();
    if (!userValidation.ok) {
      setError(userValidation.msg || t('printDialog.errors.review'));
      return null;
    }

    const backend = action === 'download' ? 'pdf' : (pdfPrintEnabled && printBackend === 'pdf' ? 'pdf' : 'html');
    const common = { ...extras(), printBackend: backend, printAction: action };

    if (restrictToActivePage) return { mode: 'active', activeScope: 'primary', ...common };
    if (printMode === 'active') return { mode: 'active', activeScope: isComparing ? activeScope : 'primary', ...common };
    if (printMode === 'all') return { mode: 'all', allScope: canPrintSelectionScope ? allScope : 'session', ...common };

    if (printMode === 'range') {
      const rangeValidation = validateRange();
      if (!rangeValidation.ok) {
        setError(rangeValidation.msg || t('printDialog.errors.selectValidPages'));
        return null;
      }
      if (rangeValidation.from > rangeValidation.to) {
        return { mode: 'advanced', sequence: makeDescendingSequence(rangeValidation.from, rangeValidation.to), ...common };
      }
      return { mode: 'range', from: rangeValidation.from, to: rangeValidation.to, ...common };
    }

    const { ok, error: parseError, sequence } = parsePrintSequence(customText, totalPages);
    if (!ok || !sequence?.length) {
      setError(parseError || t('printDialog.errors.invalidCustom'));
      return null;
    }
    return { mode: 'advanced', sequence, ...common };
  }, [
    activeScope,
    canPrintSelectionScope,
    allScope,
    customText,
    extras,
    isComparing,
    makeDescendingSequence,
    pdfPrintEnabled,
    printBackend,
    printMode,
    restrictToActivePage,
    t,
    totalPages,
    validateRange,
    validateUserFields,
  ]);

  /**
   * @param {Event} [event]
   * @returns {void}
   */
  const submit = useCallback((event) => {
    event?.preventDefault?.();
    const detail = composeSubmitDetail('print');
    if (!detail) return;
    setError('');
    onSubmit(detail);
  }, [composeSubmitDetail, onSubmit]);

  /**
   * @returns {void}
   */
  const submitPdfDownload = useCallback(() => {
    const detail = composeSubmitDetail('download');
    if (!detail) return;
    setError('');
    onSubmit(detail);
  }, [composeSubmitDetail, onSubmit]);

  const onBackdropMouseDown = useCallback((event) => {
    if (event.target === event.currentTarget) {
      event.stopPropagation();
      onClose?.();
    }
  }, [onClose]);

  const loadingHint = t('printDialog.loadingHint', { page: activePageNumber });
  const extraSuffix = (hasOptions && needsExtra) ? t('printDialog.reason.extra.suffix') : '';

  return {
    headerCfg,
    dialogRef,
    backdropRef,
    printMode,
    setPrintMode,
    activeScope,
    setActiveScope,
    allScope,
    setAllScope,
    fromValue,
    setFromValue,
    toValue,
    setToValue,
    customText,
    setCustomText,
    selectedReason,
    setSelectedReason,
    printFormatChecked,
    setPrintFormatChecked,
    printBackend,
    setPrintBackend,
    pdfPrintEnabled,
    pdfDownloadEnabled,
    freeReason,
    setFreeReason,
    extraText,
    setExtraText,
    forWhomText,
    setForWhomText,
    error,
    setError,
    pageOptions,
    restrictToActivePage,
    isComparing,
    hasActiveSelection,
    canPrintSelectionScope,
    selectionIncludedCount,
    sessionTotalPages,
    showUserSection,
    showReason,
    showPrintFormat: showPrintFormatCheckbox,
    printFormatCfg,
    printFormatOptions,
    checkboxPrintFormatOption,
    showForWhom,
    reasonCfg,
    forWhomCfg,
    reasonOptions: reasonOptions || [],
    hasOptions: !!hasOptions,
    needsExtra,
    extraCfg,
    extraMax,
    reasonMax,
    forWhomMax,
    reasonPlaceholder,
    forWhomPlaceholder,
    extraPlaceholder,
    optionLabel,
    loadingHint,
    extraSuffix,
    submit,
    submitPdfDownload,
    onBackdropMouseDown,
    onDialogKeyDown,
  };
}
