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
import {
  buildSelectedOptionDetails,
  ensureODVPrintCSS,
  normalizePdfOrientationMode,
  resolveOptionPrintText,
  safeRegex,
} from './printRangeDialogHelpers.js';
import { usePrintRangeConfig } from './hooks/usePrintRangeConfig.js';

export {
  ensureODVPrintCSS,
  getCfg,
  safeRegex,
} from './printRangeDialogHelpers.js';

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
 * @property {'auto'|'portrait'|'landscape'} [pdfOrientation]
 * @property {'html'|'pdf'} [printBackend]
 * @property {'print'|'download'} [printAction]
 */

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
 * @param {boolean=} params.selectionSequenceLocked
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
  selectionSequenceLocked = false,
  selectionIncludedCount = 0,
  sessionTotalPages = totalPages,
  t,
  i18n,
}) {
  const {
    headerCfg,
    showReason,
    showForWhom,
    reasonCfg,
    forWhomCfg,
    printFormatCfg,
    pdfOrientationFixedMode,
    pdfOrientationDefaultMode,
    pdfOrientationDefaultAuto,
    showPdfOrientation,
    pdfOrientationLabel,
    pdfOrientationHint,
    downloadPdfAction,
    printHtmlAction,
    printPdfAction,
    reuseLastPrintSettingsAction,
    pdfDownloadEnabled,
    printHtmlEnabled,
    printPdfEnabled,
    defaultPrintBackend,
    printFormatOptions,
    hasPrintFormatOptions,
    checkboxPrintFormatOption,
    showPrintFormatCheckbox,
    forcePrintFormatActive,
    defaultPrintFormatChecked,
    showUserSection,
    restrictToActivePage,
    defaultPrintMode,
    canPrintSelectionScope,
    sequenceLockedToSelection,
    reasonRegex,
    forWhomRegex,
    reasonMax,
    forWhomMax,
    reasonOptions,
    hasOptions,
    defaultReason,
  } = usePrintRangeConfig({
    isDocumentLoading,
    hasActiveSelection,
    selectionSequenceLocked,
    selectionIncludedCount,
    t,
    i18n,
  });

  const [printMode, setPrintMode] = useState(/** @type {'active'|'all'|'range'|'custom'} */ (defaultPrintMode));
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
  const [pdfAutoOrientationChecked, setPdfAutoOrientationChecked] = useState(pdfOrientationDefaultAuto);
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
  const previousDefaultPrintModeRef = useRef(defaultPrintMode);
  const previousDefaultPrintFormatCheckedRef = useRef(defaultPrintFormatChecked);
  const previousPdfOrientationDefaultAutoRef = useRef(pdfOrientationDefaultAuto);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      previousDefaultReasonRef.current = defaultReason;
      previousDefaultPrintModeRef.current = defaultPrintMode;
      previousDefaultPrintFormatCheckedRef.current = defaultPrintFormatChecked;
      previousPdfOrientationDefaultAutoRef.current = pdfOrientationDefaultAuto;
      return;
    }

    const openedNow = !wasOpenRef.current;
    const defaultReasonChanged = previousDefaultReasonRef.current !== defaultReason;
    const defaultPrintModeChanged = previousDefaultPrintModeRef.current !== defaultPrintMode;
    const defaultPrintFormatChanged = previousDefaultPrintFormatCheckedRef.current !== defaultPrintFormatChecked;
    const defaultPdfOrientationChanged = previousPdfOrientationDefaultAutoRef.current !== pdfOrientationDefaultAuto;
    wasOpenRef.current = true;
    previousDefaultReasonRef.current = defaultReason;
    previousDefaultPrintModeRef.current = defaultPrintMode;
    previousDefaultPrintFormatCheckedRef.current = defaultPrintFormatChecked;
    previousPdfOrientationDefaultAutoRef.current = pdfOrientationDefaultAuto;

    if (!openedNow && !defaultReasonChanged && !defaultPrintModeChanged && !defaultPrintFormatChanged && !defaultPdfOrientationChanged) return;

    setPrintMode(sequenceLockedToSelection && (defaultPrintMode === 'range' || defaultPrintMode === 'custom') ? 'all' : defaultPrintMode);
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
    setPdfAutoOrientationChecked(pdfOrientationDefaultAuto);
    setPrintBackend(defaultPrintBackend);
    setError('');
  }, [canPrintSelectionScope, defaultPrintBackend, defaultPrintFormatChecked, defaultPrintMode, defaultReason, isOpen, pdfOrientationDefaultAuto, sequenceLockedToSelection, totalPages]);

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
    if (!sequenceLockedToSelection) return;
    if (printMode === 'range' || printMode === 'custom') {
      setPrintMode('all');
    }
  }, [printMode, sequenceLockedToSelection]);

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

  const currentPdfOrientation = showPdfOrientation
    ? (pdfAutoOrientationChecked ? 'auto' : pdfOrientationFixedMode)
    : pdfOrientationDefaultMode;

  /**
   * Compose and validate the print payload for the current dialog state.
   * @param {'print'|'download'} action
   * @returns {(PrintSubmitDetail|null)}
   */
  const composeSubmitDetail = useCallback((action = 'print', backendOverride = null) => {
    const userValidation = validateUserFields();
    if (!userValidation.ok) {
      setError(userValidation.msg || t('printDialog.errors.review'));
      return null;
    }

    const requestedBackend = backendOverride || printBackend;
    const backend = action === 'download' ? 'pdf' : (printPdfEnabled && requestedBackend === 'pdf' ? 'pdf' : 'html');
    const common = { ...extras(), pdfOrientation: currentPdfOrientation, printBackend: backend, printAction: action };

    if (restrictToActivePage) return { mode: 'active', activeScope: 'primary', ...common };
    if (printMode === 'active') return { mode: 'active', activeScope: isComparing ? activeScope : 'primary', ...common };
    if (printMode === 'all' || sequenceLockedToSelection) {
      return { mode: 'all', allScope: canPrintSelectionScope ? allScope : 'session', ...common };
    }

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
    currentPdfOrientation,
    isComparing,
    makeDescendingSequence,
    printPdfEnabled,
    printBackend,
    printMode,
    restrictToActivePage,
    sequenceLockedToSelection,
    t,
    totalPages,
    validateRange,
    validateUserFields,
  ]);

  /**
   * @param {Event} [event]
   * @returns {void}
   */
  const submitWithBackend = useCallback((backend = 'html', action = 'print') => {
    const detail = composeSubmitDetail(action, backend);
    if (!detail) return;
    setError('');
    onSubmit(detail);
  }, [composeSubmitDetail, onSubmit]);

  const submit = useCallback((event) => {
    event?.preventDefault?.();
    submitWithBackend('html', 'print');
  }, [submitWithBackend]);

  /** @returns {void} */
  const submitPrintDirect = useCallback(() => { submitWithBackend('html', 'print'); }, [submitWithBackend]);

  /** @returns {void} */
  const submitPrintPdf = useCallback(() => { submitWithBackend('pdf', 'print'); }, [submitWithBackend]);

  /**
   * @returns {void}
   */
  const submitPdfDownload = useCallback(() => {
    submitWithBackend('pdf', 'download');
  }, [submitWithBackend]);

  /**
   * Restore the dialog state from the latest successfully prepared print.
   * This does not start printing; it lets the user review the restored values and
   * then use the normal print action.
   * @param {*} detail
   * @returns {void}
   */
  const restoreFromDetail = useCallback((detail) => {
    if (!detail || typeof detail !== 'object') return;
    setError('');

    const mode = String(detail.mode || 'active');
    const restoredPages = Array.isArray(detail.restoredPageNumbers)
      ? detail.restoredPageNumbers.map((value) => Math.floor(Number(value) || 0)).filter((value) => value > 0)
      : [];
    const restoreExplicitPages = restoredPages.length > 0
      && ((mode === 'active' && detail.activeScope !== 'compare-both') || (mode === 'all' && detail.allScope === 'selection'));

    if (restoreExplicitPages) {
      setPrintMode('custom');
      setCustomText(restoredPages.join(','));
    } else if (mode === 'all') {
      setPrintMode('all');
      setAllScope(detail.allScope === 'selection' && canPrintSelectionScope ? 'selection' : 'session');
    } else if (mode === 'range') {
      setPrintMode('range');
      setFromValue(String(Math.max(1, Math.floor(Number(detail.from) || 1))));
      setToValue(String(Math.max(1, Math.floor(Number(detail.to) || 1))));
    } else if (mode === 'advanced' && Array.isArray(detail.sequence)) {
      setPrintMode('custom');
      setCustomText(detail.sequence.map((value) => Math.floor(Number(value) || 0)).filter((value) => value > 0).join(','));
    } else {
      setPrintMode('active');
      setActiveScope(detail.activeScope === 'compare-both' && isComparing ? 'compare-both' : 'primary');
    }

    if (hasOptions) {
      const restoredReason = String(detail.reasonSelection?.value ?? detail.reason ?? defaultReason ?? '');
      const hasRestoredOption = reasonOptions?.some((option) => String(option?.value ?? '') === restoredReason);
      setSelectedReason(hasRestoredOption ? restoredReason : defaultReason);
      setExtraText(String(detail.reasonSelection?.freeText ?? ''));
      setFreeReason('');
    } else {
      setFreeReason(String(detail.reason || ''));
      setSelectedReason(defaultReason);
      setExtraText('');
    }

    setForWhomText(String(detail.forWhom || ''));
    const restoredFormatValue = String(detail.printFormatValue ?? detail.printFormatSelection?.value ?? detail.printFormat ?? '');
    setPrintFormatChecked(!!restoredFormatValue && !!checkboxPrintFormatOption);
    setPdfAutoOrientationChecked(normalizePdfOrientationMode(detail.pdfOrientation, pdfOrientationDefaultMode) === 'auto');
    setPrintBackend(detail.printBackend === 'pdf' && printPdfEnabled ? 'pdf' : defaultPrintBackend);
  }, [
    canPrintSelectionScope,
    checkboxPrintFormatOption,
    defaultPrintBackend,
    defaultReason,
    hasOptions,
    isComparing,
    pdfOrientationDefaultMode,
    printPdfEnabled,
    reasonOptions,
  ]);

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
    pdfAutoOrientationChecked,
    setPdfAutoOrientationChecked,
    printBackend,
    setPrintBackend,
    pdfPrintEnabled: printPdfEnabled,
    printHtmlEnabled,
    pdfDownloadEnabled,
    downloadPdfAction,
    printHtmlAction,
    printPdfAction,
    reuseLastPrintSettingsAction,
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
    selectionSequenceLocked: sequenceLockedToSelection,
    selectionIncludedCount,
    sessionTotalPages,
    showUserSection,
    showReason,
    showPrintFormat: showPrintFormatCheckbox,
    showPdfOrientation,
    pdfOrientationLabel,
    pdfOrientationHint,
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
    submitPrintDirect,
    submitPrintPdf,
    submitPdfDownload,
    restoreFromDetail,
    onBackdropMouseDown,
    onDialogKeyDown,
  };
}
