// File: src/components/DocumentToolbar/HelpOverlayDialog.jsx
/**
 * Full-screen help overlay for OpenDocViewer.
 *
 * The overlay is intentionally text-only for now so it stays lightweight and easy to maintain while
 * still giving users a concise in-product manual for the most important workflows.
 */

import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

/**
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {function(): void} props.onClose
 * @returns {(React.ReactElement|null)}
 */
export default function HelpOverlayDialog({ isOpen, onClose }) {
  const { t } = useTranslation('common');
  const dialogRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));

  useEffect(() => {
    if (!isOpen) return undefined;

    dialogRef.current?.focus?.();

    /** @param {KeyboardEvent} event */
    const handleEscape = (event) => {
      if (String(event?.key || '') !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
    };

    window.addEventListener('keydown', handleEscape, true);
    return () => {
      window.removeEventListener('keydown', handleEscape, true);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="odv-help-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="odv-help-title"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        onClose?.();
      }}
    >
      <div
        ref={dialogRef}
        className="odv-help-dialog"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="odv-help-header">
          <div>
            <h2 id="odv-help-title" className="odv-help-title">
              {t('help.title', { defaultValue: 'OpenDocViewer help' })}
            </h2>
            <p className="odv-help-subtitle">
              {t('help.subtitle', {
                defaultValue: 'A short guide to navigation, comparison, thumbnails, selection, image adjustments, and printing.',
              })}
            </p>
          </div>
          <button
            type="button"
            className="odv-help-close-icon"
            onClick={onClose}
            aria-label={t('help.close', { defaultValue: 'Close' })}
            title={t('help.close', { defaultValue: 'Close' })}
          >
            <span className="material-icons" aria-hidden="true">close</span>
          </button>
        </div>

        <div className="odv-help-body">
          <section className="odv-help-section">
            <h3>{t('help.sections.navigation.title', { defaultValue: 'Navigation' })}</h3>
            <p>{t('help.sections.navigation.intro', {
              defaultValue: 'Use the toolbar, Page Up/Page Down, Arrow Up/Arrow Down, Home, and End to move through the material.',
            })}</p>
            <ul>
              <li>{t('help.sections.navigation.pageMode', {
                defaultValue: 'Normal navigation moves page by page.',
              })}</li>
              <li>{t('help.sections.navigation.shiftMode', {
                defaultValue: 'Hold Shift in compare mode to steer the right pane instead of the left/main pane.',
              })}</li>
              <li>{t('help.sections.navigation.ctrlMode', {
                defaultValue: 'Hold Ctrl when multiple documents are loaded to move whole documents instead of single pages.',
              })}</li>
              <li>{t('help.sections.navigation.ctrlShiftMode', {
                defaultValue: 'Hold Ctrl + Shift in compare mode to navigate whole documents in the right pane.',
              })}</li>
            </ul>
          </section>

          <section className="odv-help-section">
            <h3>{t('help.sections.compare.title', { defaultValue: 'Compare mode' })}</h3>
            <p>{t('help.sections.compare.body', {
              defaultValue: 'Enable compare mode to show two pages side by side. The left page is the primary page. The right page is the compare page.',
            })}</p>
          </section>

          <section className="odv-help-section">
            <h3>{t('help.sections.thumbnails.title', { defaultValue: 'Thumbnails and document grouping' })}</h3>
            <p>{t('help.sections.thumbnails.body', {
              defaultValue: 'The thumbnail strip shows document boundaries and page metadata. T shows the current page number in the visible selection. D shows the document number. S shows the page number inside that document.',
            })}</p>
            <ul>
              <li>{t('help.sections.thumbnails.boundaries', {
                defaultValue: 'The sticky document label at the top of the strip follows your current scroll position.',
              })}</li>
              <li>{t('help.sections.thumbnails.contextMenu', {
                defaultValue: 'Right-click a thumbnail or a large page to hide the current page or the whole document from the active selection.',
              })}</li>
            </ul>
          </section>

          <section className="odv-help-section">
            <h3>{t('help.sections.selection.title', { defaultValue: 'Selection' })}</h3>
            <p>{t('help.sections.selection.body', {
              defaultValue: 'The Selection tab lets you include or exclude whole documents or individual pages. Save applies the filter. Cancel restores the last saved selection.',
            })}</p>
            <p>{t('help.sections.selection.empty', {
              defaultValue: 'If the saved selection hides everything, the viewer shows an empty-selection message with actions to restore the full session or reopen the Selection tab.',
            })}</p>
          </section>

          <section className="odv-help-section">
            <h3>{t('help.sections.adjustments.title', { defaultValue: 'Image adjustments' })}</h3>
            <p>{t('help.sections.adjustments.body', {
              defaultValue: 'Rotation, brightness, contrast, and reset are always available in the toolbar. The viewer stays on fast image rendering until you actually apply a non-neutral adjustment, then that pane switches to canvas rendering automatically.',
            })}</p>
            <ul>
              <li>{t('help.sections.adjustments.primary', {
                defaultValue: 'Without Shift, adjustments target the left/main page.',
              })}</li>
              <li>{t('help.sections.adjustments.compare', {
                defaultValue: 'With Shift in compare mode, adjustments target the right compare page.',
              })}</li>
              <li>{t('help.sections.adjustments.reset', {
                defaultValue: 'Adjustments reset when you move to another page.',
              })}</li>
            </ul>
          </section>

          <section className="odv-help-section">
            <h3>{t('help.sections.printing.title', { defaultValue: 'Printing' })}</h3>
            <p>{t('help.sections.printing.body', {
              defaultValue: 'Open the print dialog from the toolbar. In simple mode you can print the current page or all pages. When compare mode is active, current-page printing can include either only the main page or both compare pages.',
            })}</p>
            <p>{t('help.sections.printing.selection', {
              defaultValue: 'If a saved selection hides any pages, “All pages” can use either the current selection or the full session.',
            })}</p>
          </section>

          <section className="odv-help-section">
            <h3>{t('help.sections.shortcuts.title', { defaultValue: 'Closing dialogs' })}</h3>
            <p>{t('help.sections.shortcuts.body', {
              defaultValue: 'Press Escape to close the print dialog or this help overlay.',
            })}</p>
          </section>
        </div>

        <div className="odv-help-footer">
          <button type="button" className="odv-help-close-button" onClick={onClose}>
            {t('help.close', { defaultValue: 'Close' })}
          </button>
        </div>
      </div>
    </div>
  );
}

HelpOverlayDialog.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};
