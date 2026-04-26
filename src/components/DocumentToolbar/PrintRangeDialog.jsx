// File: src/components/DocumentToolbar/PrintRangeDialog.jsx
/**
 * File: src/components/DocumentToolbar/PrintRangeDialog.jsx
 *
 * Unified print dialog with a single print-method selector and shared print-details section.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { usePrintRangeController } from './usePrintRangeDialog.js';

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
 * @property {Object} [reasonSelection]
 * @property {Object} [printFormatSelection]
 * @property {'html'|'pdf'} [printBackend]
 * @property {'print'|'download'} [printAction]
 */

export default function PrintRangeDialog({
  isOpen,
  onClose,
  onSubmit,
  totalPages,
  isDocumentLoading = false,
  activePageNumber = 1,
  comparePageNumber = null,
  isComparing = false,
  hasActiveSelection = false,
  selectionIncludedCount = 0,
  sessionTotalPages = totalPages,
}) {
  const { t, i18n } = useTranslation('common');
  const [isPrintMenuOpen, setIsPrintMenuOpen] = useState(false);
  const printMenuRef = useRef(null);

  const ctrl = usePrintRangeController({
    isOpen,
    onClose,
    onSubmit,
    totalPages,
    isDocumentLoading,
    activePageNumber,
    isComparing,
    hasActiveSelection,
    selectionIncludedCount,
    sessionTotalPages,
    t,
    i18n,
  });

  useEffect(() => {
    if (!isPrintMenuOpen) return undefined;
    const onPointerDown = (event) => {
      if (printMenuRef.current?.contains?.(event.target)) return;
      setIsPrintMenuOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setIsPrintMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [isPrintMenuOpen]);

  const modeOptions = useMemo(() => ([
    { value: 'active', label: t('printDialog.modes.active', { defaultValue: 'Active page' }) },
    { value: 'all', label: t('printDialog.modes.all', { defaultValue: 'All pages' }) },
    { value: 'range', label: t('printDialog.modes.range', { defaultValue: 'Simple range' }) },
    { value: 'custom', label: t('printDialog.modes.custom', { defaultValue: 'Custom pages' }) },
  ]), [t]);

  const summaryText = useMemo(() => {
    if (ctrl.restrictToActivePage) {
      return t('printDialog.summaryActiveOnly', {
        page: activePageNumber,
        defaultValue: `Only the active page (${activePageNumber}) is currently available for printing.`,
      });
    }

    if (ctrl.printMode === 'active') {
      if (ctrl.isComparing && ctrl.activeScope === 'compare-both') {
        const comparePage = Number.isFinite(comparePageNumber) ? Math.max(1, Number(comparePageNumber)) : activePageNumber;
        return t('printDialog.summaryCompareBoth', {
          primary: activePageNumber,
          compare: comparePage,
          defaultValue: `Prepare both compare pages (${activePageNumber} and ${comparePage}).`,
        });
      }
      return t('printDialog.summaryActive', {
        page: activePageNumber,
        defaultValue: `Prepare the active page (${activePageNumber}).`,
      });
    }

    if (ctrl.printMode === 'all') {
      const count = ctrl.canPrintSelectionScope && ctrl.allScope === 'selection'
        ? ctrl.selectionIncludedCount
        : ctrl.sessionTotalPages;
      return t('printDialog.summaryAll', {
        count,
        defaultValue: `Prepare ${count} pages.`,
      });
    }

    if (ctrl.printMode === 'range') {
      return t('printDialog.summaryRange', {
        from: ctrl.fromValue,
        to: ctrl.toValue,
        defaultValue: `Prepare pages ${ctrl.fromValue}–${ctrl.toValue}.`,
      });
    }

    return t('printDialog.summaryCustom', {
      defaultValue: 'Prepare the pages listed in the Pages field under Pages and scope.',
    });
  }, [
    activePageNumber,
    comparePageNumber,
    ctrl.activeScope,
    ctrl.allScope,
    ctrl.canPrintSelectionScope,
    ctrl.fromValue,
    ctrl.isComparing,
    ctrl.printMode,
    ctrl.restrictToActivePage,
    ctrl.selectionIncludedCount,
    ctrl.sessionTotalPages,
    ctrl.toValue,
    t,
  ]);

  const showPagesSection = useMemo(() => {
    if (ctrl.restrictToActivePage) return false;
    if (ctrl.printMode === 'active') return !!ctrl.isComparing;
    if (ctrl.printMode === 'all') return !!ctrl.canPrintSelectionScope;
    if (ctrl.printMode === 'range' || ctrl.printMode === 'custom') return true;
    return false;
  }, [ctrl.canPrintSelectionScope, ctrl.isComparing, ctrl.printMode, ctrl.restrictToActivePage]);

  if (!isOpen) return null;

  return (
    <div
      ref={ctrl.backdropRef}
      className="odv-prd-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="print-title"
      data-odv-shortcuts="off"
      onMouseDown={ctrl.onBackdropMouseDown}
    >
      <form
        ref={ctrl.dialogRef}
        onSubmit={ctrl.submit}
        className="odv-prd-dialog"
        noValidate
        tabIndex={-1}
        data-odv-shortcuts="off"
        onKeyDown={ctrl.onDialogKeyDown}
      >
        <div className="odv-prd-header">
          <div className="odv-prd-headerText">
            <h3 id="print-title" className="odv-prd-title">{t('printDialog.title')}</h3>
            <p className="odv-prd-subtitle">
              {t('printDialog.subtitleUnified', {
                defaultValue: 'Choose a print method, then review the print details before preparing the job in your browser.',
              })}
            </p>
          </div>
          <button
            type="button"
            className="odv-prd-closeIcon"
            onClick={() => { ctrl.setError(''); onClose(); }}
            aria-label={t('printDialog.close', { defaultValue: 'Close' })}
            title={t('printDialog.close', { defaultValue: 'Close' })}
          >
            <span className="material-icons" aria-hidden="true">close</span>
          </button>
        </div>

        <div className="odv-prd-content">
          <section className="odv-prd-card odv-prd-card-first" aria-labelledby="odv-prd-method-header">
            <h4 id="odv-prd-method-header" className="odv-prd-sectionHeader">{t('printDialog.methodHeader', { defaultValue: 'Print method' })}</h4>
            <div className="odv-prd-fieldCol">
              <label className="odv-prd-labelBlock odv-prd-labelBlock-wide">
                <span>{t('printDialog.methodLabel', { defaultValue: 'Method' })}</span>
                <select
                  className="odv-prd-select odv-prd-selectWide"
                  value={ctrl.printMode}
                  onChange={(event) => ctrl.setPrintMode(event.target.value)}
                  disabled={ctrl.restrictToActivePage}
                  aria-label={t('printDialog.methodLabel', { defaultValue: 'Method' })}
                >
                  {modeOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <div className="odv-prd-summary" role="status" aria-live="polite">
                {summaryText}
              </div>
              {ctrl.restrictToActivePage ? (
                <div className="odv-prd-hint" role="note">{ctrl.loadingHint}</div>
              ) : null}
            </div>
          </section>

          {showPagesSection ? (
          <section className="odv-prd-card" aria-labelledby="odv-prd-pages-header">
            <h4 id="odv-prd-pages-header" className="odv-prd-sectionHeader">{t('printDialog.pagesHeader')}</h4>

            {ctrl.printMode === 'active' ? (
              <div className="odv-prd-section" role="group" aria-label={t('printDialog.aria.activeGroup', { defaultValue: 'Active page options' })}>
                {ctrl.isComparing && !ctrl.restrictToActivePage ? (
                  <div className="odv-prd-subField" role="group" aria-label={t('printDialog.activeScope.label')}>
                    <div className="odv-prd-radioList odv-prd-subRadioList">
                      <label className="odv-prd-radioRow">
                        <input
                          type="radio"
                          name="activeScope"
                          value="primary"
                          checked={ctrl.activeScope === 'primary'}
                          onChange={() => ctrl.setActiveScope('primary')}
                        />
                        <span>{t('printDialog.activeScope.primary')}</span>
                      </label>
                      <label className="odv-prd-radioRow">
                        <input
                          type="radio"
                          name="activeScope"
                          value="compare-both"
                          checked={ctrl.activeScope === 'compare-both'}
                          onChange={() => ctrl.setActiveScope('compare-both')}
                        />
                        <span>{t('printDialog.activeScope.compareBoth')}</span>
                      </label>
                    </div>
                    <span className="odv-prd-hint">{t('printDialog.activeScope.hint')}</span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {ctrl.printMode === 'all' ? (
              <div className="odv-prd-section" role="group" aria-label={t('printDialog.aria.allGroup', { defaultValue: 'All pages options' })}>
                {ctrl.canPrintSelectionScope ? (
                  <div className="odv-prd-subField" role="group" aria-label={t('printDialog.allScope.label')}>
                    <div className="odv-prd-radioList odv-prd-subRadioList">
                      <label className="odv-prd-radioRow">
                        <input
                          type="radio"
                          name="allScope"
                          value="selection"
                          checked={ctrl.allScope === 'selection'}
                          onChange={() => ctrl.setAllScope('selection')}
                        />
                        <span>{t('printDialog.allScope.selection', { count: ctrl.selectionIncludedCount })}</span>
                      </label>
                      <label className="odv-prd-radioRow">
                        <input
                          type="radio"
                          name="allScope"
                          value="session"
                          checked={ctrl.allScope === 'session'}
                          onChange={() => ctrl.setAllScope('session')}
                        />
                        <span>{t('printDialog.allScope.session', { count: ctrl.sessionTotalPages })}</span>
                      </label>
                    </div>
                    <span className="odv-prd-hint">{t('printDialog.allScope.hint')}</span>
                  </div>
                ) : (
                  <div className="odv-prd-staticValue">
                    {t('printDialog.allPagesValue', {
                      count: ctrl.sessionTotalPages,
                      defaultValue: `All ${ctrl.sessionTotalPages} session pages will be prepared.`,
                    })}
                  </div>
                )}
              </div>
            ) : null}

            {ctrl.printMode === 'range' ? (
              <div className="odv-prd-section" role="group" aria-label={t('printDialog.aria.rangeGroup', { defaultValue: 'Simple range options' })}>
                <div className="odv-prd-rangeRow">
                  <label className="odv-prd-labelBlock">
                    <span>{t('printDialog.range.from')}</span>
                    <select
                      value={ctrl.fromValue}
                      onChange={(event) => ctrl.setFromValue(event.target.value)}
                      className="odv-prd-select"
                      aria-label={t('printDialog.range.from')}
                    >
                      {ctrl.pageOptions.map((value) => <option key={`from-${value}`} value={value}>{value}</option>)}
                    </select>
                  </label>

                  <label className="odv-prd-labelBlock">
                    <span>{t('printDialog.range.to')}</span>
                    <select
                      value={ctrl.toValue}
                      onChange={(event) => ctrl.setToValue(event.target.value)}
                      className="odv-prd-select"
                      aria-label={t('printDialog.range.to')}
                    >
                      {ctrl.pageOptions.map((value) => <option key={`to-${value}`} value={value}>{value}</option>)}
                    </select>
                  </label>
                </div>
                <span className="odv-prd-hint">{t('printDialog.range.allowedHint', { total: totalPages })}</span>
              </div>
            ) : null}

            {ctrl.printMode === 'custom' ? (
              <div className="odv-prd-section" role="group" aria-label={t('printDialog.aria.customGroup', { defaultValue: 'Custom pages options' })}>
                <div className="odv-prd-advancedRow">
                  <label className="odv-prd-labelBlock odv-prd-labelBlock-wide">
                    <span>{t('printDialog.custom.label', { defaultValue: 'Pages' })}</span>
                    <input
                      type="text"
                      className="odv-prd-inputWide"
                      placeholder={t('printDialog.custom.placeholder')}
                      value={ctrl.customText}
                      onChange={(event) => ctrl.setCustomText(event.target.value)}
                      aria-label={t('printDialog.custom.label', { defaultValue: 'Pages' })}
                      inputMode="numeric"
                    />
                  </label>
                </div>
                <span className="odv-prd-hint">{t('printDialog.custom.hint')}</span>
              </div>
            ) : null}
          </section>
          ) : null}


          {ctrl.showUserSection ? (
            <section className="odv-prd-card" aria-labelledby="odv-prd-log-header">
              <h4 id="odv-prd-log-header" className="odv-prd-sectionHeader">{t('printDialog.userSection.header')}</h4>
              <div className="odv-prd-section" role="group" aria-label={t('printDialog.aria.userLogGroup')}>
                <div className="odv-prd-fieldCol">
                  {ctrl.showPrintFormat ? (
                    <label className="odv-prd-checkRow odv-prd-checkRow-inline">
                      <input
                        type="checkbox"
                        checked={!!ctrl.printFormatChecked}
                        onChange={(event) => ctrl.setPrintFormatChecked(event.target.checked)}
                        aria-label={t('printDialog.printFormat.checkboxLabel', { defaultValue: 'Add copy watermark' })}
                      />
                      <span
                        className="odv-prd-tooltipText"
                        title={t('printDialog.printFormat.hint', {
                          defaultValue: 'When selected, the configured copy text is available to the header/footer templates and can be printed as a watermark.',
                        })}
                      >
                        {ctrl.checkboxPrintFormatOption?.checkboxLabel
                          ? ctrl.optionLabel({ value: ctrl.checkboxPrintFormatOption.value, label: ctrl.checkboxPrintFormatOption.checkboxLabel })
                          : t('printDialog.printFormat.checkboxLabel', { defaultValue: 'Add copy watermark' })}
                      </span>
                    </label>
                  ) : null}

                  {ctrl.showReason ? (
                    <label className="odv-prd-labelBlock odv-prd-labelBlock-wide">
                      <span>{t('printDialog.reason.label')} {ctrl.reasonCfg?.required ? <span aria-hidden="true">*</span> : null}</span>
                      {ctrl.hasOptions ? (
                        <>
                          <select
                            className="odv-prd-select odv-prd-selectWide"
                            value={ctrl.selectedReason}
                            onChange={(event) => ctrl.setSelectedReason(event.target.value)}
                            aria-label={t('printDialog.reason.label')}
                          >
                            {ctrl.reasonOptions.map((opt) => (
                              <option key={String(opt.value)} value={opt.value}>{ctrl.optionLabel(opt)}</option>
                            ))}
                          </select>

                          {ctrl.needsExtra ? (
                            <div className="odv-prd-subField">
                              <label className="odv-prd-visuallyHidden">{t('printDialog.reason.extra.placeholder')}</label>
                              <input
                                type="text"
                                className="odv-prd-inputWide"
                                placeholder={ctrl.extraPlaceholder || t('printDialog.reason.extra.placeholder')}
                                maxLength={ctrl.extraMax || undefined}
                                value={ctrl.extraText}
                                onChange={(event) => ctrl.setExtraText(event.target.value)}
                                aria-label={t('printDialog.reason.extra.placeholder')}
                              />
                              <span className="odv-prd-hint">
                                {ctrl.reasonCfg?.required
                                  ? t('printDialog.reason.requiredHint', { max: ctrl.extraMax || ctrl.reasonMax, extra: ctrl.extraSuffix })
                                  : t('printDialog.reason.optionalHint', { max: ctrl.extraMax || ctrl.reasonMax, extra: ctrl.extraSuffix })}
                              </span>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <input
                            type="text"
                            className="odv-prd-inputWide"
                            placeholder={ctrl.reasonPlaceholder || t('printDialog.reason.label')}
                            maxLength={ctrl.reasonMax || undefined}
                            value={ctrl.freeReason}
                            onChange={(event) => ctrl.setFreeReason(event.target.value)}
                            aria-label={t('printDialog.reason.label')}
                          />
                          <span className="odv-prd-hint">
                            {ctrl.reasonCfg?.required
                              ? t('printDialog.reason.requiredHint', { max: ctrl.reasonMax, extra: '' })
                              : t('printDialog.reason.optionalHint', { max: ctrl.reasonMax, extra: '' })}
                          </span>
                        </>
                      )}
                    </label>
                  ) : null}

                  {ctrl.showForWhom ? (
                    <label className="odv-prd-labelBlock odv-prd-labelBlock-wide">
                      <span>{t('printDialog.forWhom.label')} {ctrl.forWhomCfg?.required ? <span aria-hidden="true">*</span> : null}</span>
                      <input
                        type="text"
                        className="odv-prd-inputWide"
                        placeholder={ctrl.forWhomPlaceholder || t('printDialog.forWhom.label')}
                        maxLength={ctrl.forWhomMax || undefined}
                        value={ctrl.forWhomText}
                        onChange={(event) => ctrl.setForWhomText(event.target.value)}
                        aria-label={t('printDialog.forWhom.label')}
                      />
                      <span className="odv-prd-hint">
                        {ctrl.forWhomCfg?.required
                          ? t('printDialog.forWhom.requiredHint', { max: ctrl.forWhomMax })
                          : t('printDialog.forWhom.optionalHint', { max: ctrl.forWhomMax })}
                      </span>
                    </label>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}
        </div>

        {ctrl.error ? <div className="odv-prd-error" role="alert">{ctrl.error}</div> : null}

        <div className="odv-prd-footer">
          <button type="button" className="odv-prd-action secondary" onClick={onClose}>
            {t('printDialog.footer.cancel')}
          </button>
          {ctrl.pdfDownloadEnabled ? (
            <button type="button" className="odv-prd-action secondary" onClick={ctrl.submitPdfDownload}>
              {t('printDialog.footer.downloadPdf', { defaultValue: 'Save PDF' })}
            </button>
          ) : null}
          <div className="odv-prd-splitAction" ref={printMenuRef}>
            <button
              type="button"
              className="odv-prd-action primary odv-prd-splitAction-main"
              onClick={ctrl.submitPrintDirect}
            >
              {t('printDialog.footer.prepare', { defaultValue: 'Prepare printing' })}
            </button>
            <button
              type="button"
              className="odv-prd-action primary odv-prd-splitAction-toggle"
              aria-haspopup="menu"
              aria-expanded={isPrintMenuOpen}
              aria-label={t('printDialog.output.menuLabel', { defaultValue: 'Choose print output mode' })}
              title={t('printDialog.output.menuLabel', { defaultValue: 'Choose print output mode' })}
              onClick={() => setIsPrintMenuOpen((value) => !value)}
            >
              <span className="material-icons" aria-hidden="true">expand_more</span>
            </button>
            {isPrintMenuOpen ? (
              <div className="odv-prd-splitMenu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="odv-prd-splitMenuItem"
                  title={t('printDialog.output.direct.info', { defaultValue: 'Direct print uses the browser print preview. The browser orientation setting applies to the whole print job.' })}
                  onClick={() => { setIsPrintMenuOpen(false); ctrl.submitPrintDirect(); }}
                >
                  <span className="odv-prd-menuItemCopy">
                    <span className="odv-prd-menuItemTitle">{t('printDialog.output.direct.label', { defaultValue: 'Direct print' })}</span>
                    <small>{t('printDialog.output.direct.hint', { defaultValue: 'Uses the browser print preview. Browser orientation applies to the whole job.' })}</small>
                  </span>
                </button>
                {ctrl.pdfPrintEnabled ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="odv-prd-splitMenuItem"
                    title={t('printDialog.output.safe.info', { defaultValue: 'OpenDocViewer generates a PDF. PDF pages use automatic orientation per page before the browser prints the PDF.' })}
                    onClick={() => { setIsPrintMenuOpen(false); ctrl.submitPrintPdf(); }}
                  >
                    <span className="odv-prd-menuItemCopy">
                      <span className="odv-prd-menuItemTitle">
                        {t('printDialog.output.safe.label', { defaultValue: 'Safe print' })}
                        <span
                          className="material-icons odv-prd-infoIcon"
                          aria-hidden="true"
                        >info</span>
                      </span>
                      <small>{t('printDialog.output.safe.hint', { defaultValue: 'Creates a PDF first. Each PDF page gets automatic portrait/landscape orientation.' })}</small>
                    </span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
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
  isDocumentLoading: PropTypes.bool,
  activePageNumber: PropTypes.number,
  comparePageNumber: PropTypes.oneOfType([PropTypes.number, PropTypes.oneOf([null])]),
  isComparing: PropTypes.bool,
  hasActiveSelection: PropTypes.bool,
  selectionIncludedCount: PropTypes.number,
  sessionTotalPages: PropTypes.number,
};
