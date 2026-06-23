// File: src/components/DocumentToolbar/hooks/usePrintRangeConfig.js
/**
 * Runtime-configuration derivation for PrintRangeDialog.
 *
 * @module usePrintRangeConfig
 */

import { resolveLocalizedValue } from '../../../utils/localizedValue.js';
import { getPrintDefaultMode } from '../../../utils/runtimeConfig.js';
import { getPrintDefaultModePreference } from '../../../utils/viewerPreferences.js';
import {
  getCfg,
  hasTextValue,
  normalizePdfOrientationMode,
  resolvePrintAction,
  safeRegex,
} from '../printRangeDialogHelpers.js';

/**
 * @param {Object} params
 * @param {boolean} params.isDocumentLoading
 * @param {boolean=} params.hasActiveSelection
 * @param {boolean=} params.selectionSequenceLocked
 * @param {number=} params.selectionIncludedCount
 * @param {function(string, Object=): string} params.t
 * @param {*} params.i18n
 * @returns {Object}
 */
export function usePrintRangeConfig({
  isDocumentLoading,
  hasActiveSelection,
  selectionSequenceLocked,
  selectionIncludedCount,
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
  const printActionsCfg = cfg?.print?.actions || {};
  const pdfPrintCfg = cfg?.print?.pdf || {};
  const pdfPrintEnabled = pdfPrintCfg?.enabled === true;
  const pdfOrientationCfg = pdfPrintCfg?.orientation || {};
  const pdfOrientationFixedMode = normalizePdfOrientationMode(pdfOrientationCfg?.fixedMode || pdfOrientationCfg?.fixed || 'portrait', 'portrait');
  const pdfOrientationDefaultMode = normalizePdfOrientationMode(
    pdfOrientationCfg?.mode || pdfPrintCfg?.orientationMode || (pdfOrientationCfg?.defaultAuto === false ? pdfOrientationFixedMode : 'auto'),
    'auto'
  );
  const pdfOrientationDefaultAuto = pdfOrientationDefaultMode === 'auto';
  const showPdfOrientation = pdfPrintEnabled
    && pdfOrientationCfg?.enabled === true
    && pdfOrientationCfg?.showOption !== false;
  const pdfOrientationLabel = resolveLocalizedValue(
    pdfOrientationCfg?.checkboxLabel ?? pdfOrientationCfg?.label,
    i18n
  ) || t('printDialog.pdfOrientation.checkboxLabel', { defaultValue: 'Automatic page orientation' });
  const pdfOrientationHint = resolveLocalizedValue(
    pdfOrientationCfg?.tooltip ?? pdfOrientationCfg?.hint,
    i18n
  ) || t('printDialog.pdfOrientation.hint', { defaultValue: 'When selected, each generated page uses portrait or landscape based on the page image.' });
  const downloadPdfAction = resolvePrintAction(printActionsCfg, 'downloadPdf', i18n, {
    label: t('printDialog.footer.downloadPdf', { defaultValue: 'Save PDF' }),
    tooltip: t('printDialog.footer.downloadPdf', { defaultValue: 'Save PDF' }),
  });
  const printHtmlAction = resolvePrintAction(printActionsCfg, 'printHtml', i18n, {
    label: t('printDialog.footer.printHtml', { defaultValue: 'Print via HTML' }),
    tooltip: t('printDialog.output.direct.info', { defaultValue: 'Direct print uses the browser print preview. The browser orientation setting applies to the whole print job.' }),
  });
  const printPdfAction = resolvePrintAction(printActionsCfg, 'printPdf', i18n, {
    label: t('printDialog.footer.printPdf', { defaultValue: 'Print via PDF' }),
    tooltip: t('printDialog.output.safe.info', { defaultValue: 'OpenDocViewer generates a PDF. PDF pages use automatic orientation per page before the browser prints the PDF.' }),
  });
  const reuseLastPrintSettingsAction = resolvePrintAction({
    reuseLastPrintSettings: printActionsCfg?.reuseLastPrintSettings ?? printActionsCfg?.repeatLastPrint,
  }, 'reuseLastPrintSettings', i18n, {
    label: t('printDialog.reuseLastPrint.label', { defaultValue: 'Reuse latest print settings' }),
    tooltip: t('printDialog.reuseLastPrint.tooltip', { defaultValue: 'Fill in the dialog with the same choices as the latest print.' }),
  });
  const pdfDownloadEnabled = pdfPrintEnabled && pdfPrintCfg?.allowDownload === true && downloadPdfAction.enabled;
  const printHtmlEnabled = printHtmlAction.enabled;
  const printPdfEnabled = pdfPrintEnabled && printPdfAction.enabled;
  const defaultPrintBackend = printPdfEnabled && (!printHtmlEnabled || String(pdfPrintCfg?.defaultMode || 'direct').toLowerCase() === 'safe') ? 'pdf' : 'html';
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
  const showUserSection = !!(showReason || showForWhom || showPrintFormatCheckbox || showPdfOrientation);
  const restrictToActivePage = !!isDocumentLoading;
  const configuredDefaultPrintMode = getPrintDefaultMode(cfg);
  const userDefaultPrintMode = getPrintDefaultModePreference();
  const defaultPrintMode = restrictToActivePage ? 'active' : (userDefaultPrintMode || configuredDefaultPrintMode);
  const canPrintSelectionScope = !!hasActiveSelection && Math.max(0, Number(selectionIncludedCount) || 0) > 0;
  const sequenceLockedToSelection = !!selectionSequenceLocked && canPrintSelectionScope;
  const reasonRegex = safeRegex(reasonCfg?.regex, reasonCfg?.regexFlags);
  const forWhomRegex = safeRegex(forWhomCfg?.regex, forWhomCfg?.regexFlags);
  const reasonMax = Number.isFinite(reasonCfg?.maxLen) ? reasonCfg.maxLen : 255;
  const forWhomMax = Number.isFinite(forWhomCfg?.maxLen) ? forWhomCfg.maxLen : 120;

  const reasonOptions = Array.isArray(reasonCfg?.source?.options) ? reasonCfg.source.options : null;
  const hasOptions = Array.isArray(reasonOptions) && reasonOptions.length > 0;
  const defaultReason = reasonCfg?.default ?? (hasOptions ? (reasonOptions[0]?.value ?? '') : '');

  return {
    headerCfg,
    showReason,
    showForWhom,
    reasonCfg,
    forWhomCfg,
    printFormatCfg,
    pdfPrintEnabled,
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
  };
}
