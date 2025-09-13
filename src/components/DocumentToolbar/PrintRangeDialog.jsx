// File: src/components/DocumentToolbar/PrintRangeDialog.jsx
/**
 * File: src/components/DocumentToolbar/PrintRangeDialog.jsx
 *
 * Print dialog with Basic/Advanced modes and optional user-log fields.
 *
 * Exposes a modal that lets users pick "active/all/range/custom" pages and,
 * when configured, collect reason/forWhom for logging and header overlays.
 *
 * @component
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether the dialog is open.
 * @param {function():void} props.onClose - Called when the dialog should close.
 * @param {function(PrintSubmitDetail):void} props.onSubmit - Called with the chosen print details.
 * @param {number} props.totalPages - Total number of pages (validates range/custom).
 * @returns {(JSX.Element|null)}
 */

import React from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import styles from './PrintRangeDialog.module.css';
import {
  usePrintRangeController
} from './PrintRangeDialog.controller';

/**
 * Allowed print modes (string-literal union for JSDoc).
 * @typedef {("active"|"all"|"range"|"advanced")} PrintMode
 */

/**
 * Structured payload returned to the caller on submit.
 * @typedef {Object} PrintSubmitDetail
 * @property {PrintMode} mode
 * @property {number} [from] - Start page for "range" mode.
 * @property {number} [to] - End page for "range" mode.
 * @property {Array.<number>} [sequence] - Explicit page order for "advanced" mode.
 * @property {string|null} [reason] - Optional print reason (may be composed from option + extra text).
 * @property {string|null} [forWhom] - Optional "for whom" value.
 */

export default function PrintRangeDialog({ isOpen, onClose, onSubmit, totalPages }) {
  const { t } = useTranslation();

  const ctrl = usePrintRangeController({
    isOpen, onClose, onSubmit, totalPages, t, styles
  });

  if (!isOpen) return null;

  return (
    <div
      ref={ctrl.backdropRef}
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="print-title"
      onMouseDown={ctrl.onBackdropMouseDown}
    >
      <form ref={ctrl.dialogRef} onSubmit={ctrl.submit} className={styles.dialog} noValidate>
        <h3 id="print-title" className={styles.title}>
          {t('printDialog.title')} – {ctrl.titleSuffix}
        </h3>

        <p className={styles.desc}>
          {t('printDialog.desc', { active: t('printDialog.basic.active') })}
        </p>

        {ctrl.headerCfg?.enabled ? (
          <div className={styles.hint} role="note">
            {t('printDialog.headerNote')}
          </div>
        ) : null}

        {ctrl.modeGroup === 'basic' ? (
          <p className={styles.modeSwitch}>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => ctrl.setModeGroup('advanced')}
              aria-label={ctrl.switchTo}
            >
              {ctrl.switchTo}
            </button>
          </p>
        ) : (
          <p className={styles.modeSwitch}>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => ctrl.setModeGroup('basic')}
              aria-label={ctrl.switchBack}
            >
              {ctrl.switchBack}
            </button>
          </p>
        )}

        <h4 className={styles.sectionHeader}>{t('printDialog.pagesHeader')}</h4>

        {ctrl.modeGroup === 'basic' && (
          <div className={styles.section} role="group" aria-label="Basic choices">
            <div className={styles.radioList}>
              <label className={styles.radioRow}>
                <input
                  type="radio"
                  name="basicChoice"
                  value="active"
                  checked={ctrl.basicChoice === 'active'}
                  onChange={() => ctrl.setBasicChoice('active')}
                />
                <span>{t('printDialog.basic.active')}</span>
              </label>
              <label className={styles.radioRow}>
                <input
                  type="radio"
                  name="basicChoice"
                  value="all"
                  checked={ctrl.basicChoice === 'all'}
                  onChange={() => ctrl.setBasicChoice('all')}
                />
                <span>{t('printDialog.basic.all')}</span>
              </label>
            </div>
          </div>
        )}

        {ctrl.modeGroup === 'advanced' && (
          <div className={styles.section} role="group" aria-label="Advanced choices">
            <div className={styles.radioList}>
              <label className={styles.radioRow}>
                <input
                  type="radio"
                  name="advancedChoice"
                  value="range"
                  checked={ctrl.advancedChoice === 'range'}
                  onChange={() => ctrl.setAdvancedChoice('range')}
                />
                <span>{t('printDialog.advanced.range')}</span>
              </label>
              <label className={styles.radioRow}>
                <input
                  type="radio"
                  name="advancedChoice"
                  value="custom"
                  checked={ctrl.advancedChoice === 'custom'}
                  onChange={() => ctrl.setAdvancedChoice('custom')}
                />
                <span>{t('printDialog.advanced.custom')}</span>
              </label>
            </div>

            {ctrl.advancedChoice === 'range' && (
              <div className={styles.rangeRow}>
                <label className={styles.label}>
                  {t('printDialog.range.from')}
                  <select
                    value={ctrl.fromValue}
                    onChange={(e) => ctrl.setFromValue(e.target.value)}
                    className={styles.select}
                    aria-label={t('printDialog.range.from')}
                  >
                    {ctrl.pageOptions.map((v) => <option key={'from-' + v} value={v}>{v}</option>)}
                  </select>
                </label>

                <label className={styles.label}>
                  {t('printDialog.range.to')}
                  <select
                    value={ctrl.toValue}
                    onChange={(e) => ctrl.setToValue(e.target.value)}
                    className={styles.select}
                    aria-label={t('printDialog.range.to')}
                  >
                    {ctrl.pageOptions.map((v) => <option key={'to-' + v} value={v}>{v}</option>)}
                  </select>
                </label>

                <span className={styles.hint}>
                  {t('printDialog.range.allowedHint', { total: totalPages })}
                </span>
              </div>
            )}

            {ctrl.advancedChoice === 'custom' && (
              <div className={styles.advancedRow}>
                <label className={styles.label} style={{ width: '100%' }}>
                  <span className={styles.visuallyHidden}>{t('printDialog.advanced.custom')}</span>
                  <input
                    type="text"
                    className={styles.inputWide}
                    placeholder={t('printDialog.custom.placeholder')}
                    value={ctrl.customText}
                    onChange={(e) => ctrl.setCustomText(e.target.value)}
                    aria-label={t('printDialog.advanced.custom')}
                    inputMode="numeric"
                  />
                </label>
                <span className={styles.hint}>{t('printDialog.custom.hint')}</span>
              </div>
            )}
          </div>
        )}

        <hr className={styles.divider} />

        {ctrl.showUserSection && (
          <>
            <h4 className={styles.sectionHeader}>{t('printDialog.userSection.header')}</h4>
            <div className={styles.section} role="group" aria-label="User log">
              <div className={styles.fieldCol}>
                {ctrl.showReason && (
                  <label className={styles.labelBlock}>
                    {t('printDialog.reason.label')} {ctrl.reasonCfg?.required ? <span aria-hidden="true">*</span> : null}
                    {ctrl.hasOptions ? (
                      <>
                        <select
                          className={styles.select}
                          value={ctrl.selectedReason}
                          onChange={(e) => ctrl.setSelectedReason(e.target.value)}
                          aria-label={t('printDialog.reason.label')}
                        >
                          {ctrl.reasonOptions.map(opt => (
                            <option key={String(opt.value)} value={opt.value}>{opt.value}</option>
                          ))}
                        </select>

                        {ctrl.needsExtra && (
                          <div className={styles.subField}>
                            <label className={styles.visuallyHidden}>{t('printDialog.reason.extra.placeholder')}</label>
                            <input
                              type="text"
                              className={styles.inputWide}
                              placeholder={ctrl.extraCfg?.placeholder || t('printDialog.reason.extra.placeholder')}
                              maxLength={ctrl.extraMax || undefined}
                              value={ctrl.extraText}
                              onChange={(e) => ctrl.setExtraText(e.target.value)}
                              aria-label={t('printDialog.reason.extra.placeholder')}
                            />
                          </div>
                        )}
                      </>
                    ) : (
                      <input
                        type="text"
                        className={styles.inputWide}
                        placeholder={ctrl.reasonCfg?.placeholder || t('printDialog.reason.label')}
                        maxLength={ctrl.reasonMax || undefined}
                        value={ctrl.freeReason}
                        onChange={(e) => ctrl.setFreeReason(e.target.value)}
                        aria-label={t('printDialog.reason.label')}
                      />
                    )}
                    <span className={styles.hint}>
                      {ctrl.reasonCfg?.required
                        ? t('printDialog.reason.requiredHint', { max: (ctrl.hasOptions && ctrl.needsExtra && ctrl.extraMax) ? ctrl.extraMax : ctrl.reasonMax, extra: ctrl.extraSuffix })
                        : t('printDialog.reason.optionalHint', { max: (ctrl.hasOptions && ctrl.needsExtra && ctrl.extraMax) ? ctrl.extraMax : ctrl.reasonMax, extra: ctrl.extraSuffix })
                      }
                    </span>
                  </label>
                )}

                {ctrl.showForWhom && (
                  <label className={styles.labelBlock}>
                    {t('printDialog.forWhom.label')} {ctrl.forWhomCfg?.required ? <span aria-hidden="true">*</span> : null}
                    <input
                      type="text"
                      className={styles.inputWide}
                      placeholder={ctrl.forWhomCfg?.placeholder || t('printDialog.forWhom.label')}
                      maxLength={ctrl.forWhomMax || undefined}
                      value={ctrl.forWhomText}
                      onChange={(e) => ctrl.setForWhomText(e.target.value)}
                      aria-label={t('printDialog.forWhom.label')}
                    />
                    <span className={styles.hint}>
                      {ctrl.forWhomCfg?.required
                        ? t('printDialog.forWhom.requiredHint', { max: ctrl.forWhomMax })
                        : t('printDialog.forWhom.optionalHint', { max: ctrl.forWhomMax })
                      }
                    </span>
                  </label>
                )}
              </div>
              <span className={styles.hint} />
            </div>
          </>
        )}

        {ctrl.error ? <div role="alert" className={styles.error}>{ctrl.error}</div> : null}

        <div className={styles.footer}>
          <button
            type="button"
            className="odv-btn"
            onClick={() => { ctrl.setError(''); onClose(); }}
            aria-label={t('printDialog.footer.cancel')}
          >
            {t('printDialog.footer.cancel')}
          </button>
          <button type="submit" className="odv-btn" aria-label={t('printDialog.footer.continue')}>
            {t('printDialog.footer.continue')}
          </button>
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
