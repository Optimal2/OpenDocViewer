// File: src/components/DocumentSelectionPanel.jsx
/**
 * Hierarchical page-selection editor shown inside the thumbnail pane.
 *
 * The panel is intentionally draft-based:
 * - users can tick/untick freely without immediately affecting the viewer
 * - Save applies the filtered page set
 * - Cancel restores the last applied selection
 */

import React, { useEffect, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

/**
 * @param {Object} props
 * @param {boolean} props.checked
 * @param {boolean} props.indeterminate
 * @param {boolean} props.disabled
 * @param {function(*): void} props.onChange
 * @param {React.ReactNode} props.children
 * @param {string} [props.className]
 * @param {React.ReactNode} [props.meta]
 * @returns {React.ReactElement}
 */
function SelectionCheckboxRow({
  checked,
  indeterminate,
  disabled,
  onChange,
  children,
  className = '',
  meta = null,
}) {
  const inputRef = useRef(/** @type {(HTMLInputElement|null)} */ (null));

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = !!indeterminate;
  }, [indeterminate]);

  return (
    <label className={['thumbnail-selection-row', className].filter(Boolean).join(' ')}>
      <input
        ref={inputRef}
        type="checkbox"
        checked={!!checked}
        disabled={!!disabled}
        onChange={onChange}
      />
      <span className="thumbnail-selection-row-label">{children}</span>
      {meta ? <span className="thumbnail-selection-row-meta">{meta}</span> : null}
    </label>
  );
}

SelectionCheckboxRow.propTypes = {
  checked: PropTypes.bool.isRequired,
  indeterminate: PropTypes.bool,
  disabled: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
  children: PropTypes.node.isRequired,
  className: PropTypes.string,
  meta: PropTypes.node,
};

/**
 * @param {Object} props
 * @param {boolean} props.enabled
 * @param {{ readyPages:number, expectedPages:number, failedPages:number, pendingPages:number, allPagesReady:boolean }} props.pageLoadState
 * @param {Array<{ key:string, documentNumber:number, totalDocuments:number, pageCount:number, pages:Array<{ originalIndex:number, originalPageNumber:number, documentPageNumber:number }> }>} props.documents
 * @param {Array<boolean>} props.draftSelectionMask
 * @param {boolean} props.draftSelectionDirty
 * @param {boolean} props.selectionActive
 * @param {number} props.draftIncludedCount
 * @param {number} props.totalSessionPages
 * @param {function(boolean): void} props.onToggleAll
 * @param {function(string, boolean): void} props.onToggleDocument
 * @param {function(number, boolean): void} props.onTogglePage
 * @param {function(): void} props.onSave
 * @param {function(): void} props.onCancel
 * @returns {React.ReactElement}
 */
export default function DocumentSelectionPanel({
  enabled,
  pageLoadState,
  documents,
  draftSelectionMask,
  draftSelectionDirty,
  selectionActive,
  draftIncludedCount,
  totalSessionPages,
  onToggleAll,
  onToggleDocument,
  onTogglePage,
  onSave,
  onCancel,
}) {
  const { t } = useTranslation('common');

  const safeTotalSessionPages = Math.max(0, Number(totalSessionPages) || 0);
  const masterChecked = safeTotalSessionPages > 0 && draftIncludedCount >= safeTotalSessionPages;
  const masterIndeterminate = draftIncludedCount > 0 && draftIncludedCount < safeTotalSessionPages;
  const saveDisabled = !enabled || !draftSelectionDirty;
  const cancelDisabled = !draftSelectionDirty;

  const statusText = useMemo(() => {
    if (!enabled) {
      return t('thumbnails.selection.loadingStatus', {
        ready: Number(pageLoadState?.readyPages) || 0,
        total: Math.max(Number(pageLoadState?.expectedPages) || 0, safeTotalSessionPages || 0),
        pending: Number(pageLoadState?.pendingPages) || 0,
        defaultValue: 'Selection becomes available when all pages are fully loaded.',
      });
    }

    if (selectionActive) {
      return t('thumbnails.selection.activeStatus', {
        selected: draftIncludedCount,
        total: safeTotalSessionPages,
        defaultValue: `${draftIncludedCount} of ${safeTotalSessionPages} pages are currently included.`,
      });
    }

    return t('thumbnails.selection.readyStatus', {
      total: safeTotalSessionPages,
      defaultValue: `All ${safeTotalSessionPages} pages are currently included.`,
    });
  }, [draftIncludedCount, enabled, pageLoadState?.expectedPages, pageLoadState?.pendingPages, pageLoadState?.readyPages, safeTotalSessionPages, selectionActive, t]);

  return (
    <div className={['thumbnail-selection-panel', enabled ? 'is-enabled' : 'is-disabled'].join(' ')}>
      <div className="thumbnail-selection-status" role="status" aria-live="polite">
        {statusText}
      </div>

      <div className="thumbnail-selection-tree">
        <SelectionCheckboxRow
          className="is-master"
          checked={masterChecked}
          indeterminate={masterIndeterminate}
          disabled={!enabled}
          onChange={(event) => onToggleAll(event.target.checked)}
          meta={t('thumbnails.selection.pagesSummary', {
            selected: draftIncludedCount,
            total: safeTotalSessionPages,
            defaultValue: `${draftIncludedCount}/${safeTotalSessionPages}`,
          })}
        >
          {t('thumbnails.selection.allPages', { defaultValue: 'All pages' })}
        </SelectionCheckboxRow>

        {documents.map((document) => {
          const documentPages = Array.isArray(document.pages) ? document.pages : [];
          const selectedCount = documentPages.reduce((count, page) => count + (draftSelectionMask[page.originalIndex] === false ? 0 : 1), 0);
          const docChecked = documentPages.length > 0 && selectedCount === documentPages.length;
          const docIndeterminate = selectedCount > 0 && selectedCount < documentPages.length;

          return (
            <div key={document.key} className="thumbnail-selection-document">
              <SelectionCheckboxRow
                className="is-document"
                checked={docChecked}
                indeterminate={docIndeterminate}
                disabled={!enabled}
                onChange={(event) => onToggleDocument(document.key, event.target.checked)}
                meta={t('thumbnails.selection.pagesSummary', {
                  selected: selectedCount,
                  total: documentPages.length,
                  defaultValue: `${selectedCount}/${documentPages.length}`,
                })}
              >
                {t('thumbnails.selection.documentLabel', {
                  current: document.documentNumber,
                  total: document.totalDocuments,
                  defaultValue: `Document ${document.documentNumber}/${document.totalDocuments}`,
                })}
              </SelectionCheckboxRow>

              <div className="thumbnail-selection-page-list">
                {documentPages.map((page) => {
                  const checked = draftSelectionMask[page.originalIndex] !== false;
                  return (
                    <SelectionCheckboxRow
                      key={`page-${document.key}-${page.originalIndex}`}
                      className="is-page"
                      checked={checked}
                      indeterminate={false}
                      disabled={!enabled}
                      onChange={(event) => onTogglePage(page.originalIndex, event.target.checked)}
                    >
                      {t('thumbnails.selection.pageLabel', {
                        documentPage: page.documentPageNumber,
                        globalPage: page.originalPageNumber,
                        defaultValue: `Page ${page.documentPageNumber}`,
                      })}
                    </SelectionCheckboxRow>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="thumbnail-selection-footer">
        <button
          type="button"
          className="thumbnail-selection-button secondary"
          disabled={cancelDisabled}
          onClick={onCancel}
        >
          {t('thumbnails.selection.cancel', { defaultValue: 'Cancel' })}
        </button>
        <button
          type="button"
          className="thumbnail-selection-button primary"
          disabled={saveDisabled}
          onClick={onSave}
        >
          {t('thumbnails.selection.save', { defaultValue: 'Save selection' })}
        </button>
      </div>
    </div>
  );
}

DocumentSelectionPanel.propTypes = {
  enabled: PropTypes.bool.isRequired,
  pageLoadState: PropTypes.shape({
    readyPages: PropTypes.number,
    expectedPages: PropTypes.number,
    failedPages: PropTypes.number,
    pendingPages: PropTypes.number,
    allPagesReady: PropTypes.bool,
  }),
  documents: PropTypes.arrayOf(PropTypes.shape({
    key: PropTypes.string.isRequired,
    documentNumber: PropTypes.number.isRequired,
    totalDocuments: PropTypes.number.isRequired,
    pageCount: PropTypes.number,
    pages: PropTypes.arrayOf(PropTypes.shape({
      originalIndex: PropTypes.number.isRequired,
      originalPageNumber: PropTypes.number.isRequired,
      documentPageNumber: PropTypes.number.isRequired,
    })).isRequired,
  })).isRequired,
  draftSelectionMask: PropTypes.arrayOf(PropTypes.bool).isRequired,
  draftSelectionDirty: PropTypes.bool.isRequired,
  selectionActive: PropTypes.bool.isRequired,
  draftIncludedCount: PropTypes.number.isRequired,
  totalSessionPages: PropTypes.number.isRequired,
  onToggleAll: PropTypes.func.isRequired,
  onToggleDocument: PropTypes.func.isRequired,
  onTogglePage: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};
