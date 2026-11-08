// File: src/components/DocumentToolbar/ManualOverlayDialog.jsx
/**
 * Manual overlay: modal dialog chrome (title bar, reload and close buttons, focus trap, Escape and
 * backdrop handling) around the shared {@link ManualView}, which loads, filters, searches and
 * navigates the manual.
 *
 * Manual text and linked assets stay out of the compiled React bundle (site HTML under help/site/)
 * or in lazily loaded generated chunks (the standard manual).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import ManualView from '../Manual/ManualView.jsx';

const MANUAL_MEDIA_SELECTOR = 'audio[controls], video[controls]';
const MANUAL_FOCUSABLE_SELECTOR = `button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), ${MANUAL_MEDIA_SELECTOR}`;

/** Id of the dialog title. */
const MANUAL_TITLE_ID = 'odv-help-title';

/**
 * Ids the dialog renders around the manual view. The contents tree is built before the dialog is
 * fully rendered, so the heading ids it generates must avoid these explicitly.
 */
const MANUAL_DIALOG_IDS = Object.freeze([MANUAL_TITLE_ID]);

/**
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {function(): void} props.onClose
 * @param {{ current:(HTMLElement|null) }} [props.returnFocusRef] Toolbar button that gets focus back
 *   when the dialog closes.
 * @returns {(React.ReactElement|null)}
 */
export default function ManualOverlayDialog({ isOpen, onClose, returnFocusRef = undefined }) {
  const { t } = useTranslation('common');
  const dialogRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const mediaTabRef = useRef(null);
  const wasOpenRef = useRef(false);
  const [documentState, setDocumentState] = useState({ loading: false, error: '', resolvedUrl: '' });
  const [refreshToken, setRefreshToken] = useState(0);

  const handleRefresh = useCallback(() => {
    setRefreshToken(Date.now());
  }, []);

  // Focus the dialog once per opening. On close focus returns to the opener; the manual view
  // unmounts first and puts back any URL fragment a lightbox link set.
  useEffect(() => {
    mediaTabRef.current?.remove();
    mediaTabRef.current = null;
    if (isOpen) {
      wasOpenRef.current = true;
      dialogRef.current?.focus?.();
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    const opener = returnFocusRef?.current;
    if (opener && typeof opener.focus === 'function' && opener.isConnected !== false) {
      opener.focus();
    }
  }, [isOpen, returnFocusRef]);

  /** Keep forward and reverse Tab navigation inside the open modal dialog. */
  const handleManualTabTrap = (event) => {
    mediaTabRef.current?.remove();
    mediaTabRef.current = null;
    if (String(event?.key || '') !== 'Tab') return;
    const dialogNode = dialogRef.current;
    if (!dialogNode) return;
    const focusable = Array.from(dialogNode.querySelectorAll(MANUAL_FOCUSABLE_SELECTOR))
      .filter((element) => {
        // :disabled includes inherited fieldset disability and preserves the first-legend exception.
        if (element.matches(':disabled') || element.tabIndex < 0
          || element.closest('[hidden], [aria-hidden="true"]')) return false;
        // Browser layout excludes display:none, collapsed-details and visibility-hidden targets.
        // jsdom has no checkVisibility; its attribute-based fallback above preserves the unit fixture.
        return typeof element.checkVisibility !== 'function'
          || element.checkVisibility({ checkVisibilityCSS: true });
      })
      .map((element, domOrder) => ({ element, domOrder, tabIndex: element.tabIndex }))
      .sort((a, b) => {
        // Sequential focus navigation visits positive values in ascending order before zero and
        // default targets. DOM order breaks ties within each group, including custom manual HTML.
        if (a.tabIndex > 0 && b.tabIndex > 0 && a.tabIndex !== b.tabIndex) return a.tabIndex - b.tabIndex;
        if ((a.tabIndex > 0) !== (b.tabIndex > 0)) return a.tabIndex > 0 ? -1 : 1;
        return a.domOrder - b.domOrder;
      })
      .map(({ element }) => element);
    if (focusable.length === 0) {
      event.preventDefault();
      dialogNode.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const outside = active === dialogNode || !dialogNode.contains(active);
    const activeIndex = focusable.indexOf(active);
    if (outside) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (activeIndex >= 0) {
      // Move explicitly through the sequence: after a positive target the browser can otherwise
      // continue in DOM order to a zero target outside the dialog instead of the first zero here.
      // A programmatically focused tabindex=-1 heading keeps the browser's native starting point.
      const delta = event.shiftKey ? -1 : 1;
      const nextIndex = (activeIndex + delta + focusable.length) % focusable.length;
      const next = focusable[nextIndex];
      if (active.matches(MANUAL_MEDIA_SELECTOR)) {
        // The host stays document.activeElement while Tab visits its UA shadow controls.
        // A same-index guard catches host exit before the browser can leave the document.
        // Consecutive media hosts keep their native focus-scope ordering without a guard.
        if (!next.matches(MANUAL_MEDIA_SELECTOR)) {
          const end = document.createElement('span');
          end.tabIndex = active.tabIndex;
          active.insertAdjacentElement(event.shiftKey ? 'beforebegin' : 'afterend', end);
          end.addEventListener('focus', () => {
            end.remove();
            mediaTabRef.current = null;
            next.focus();
          }, { once: true });
          mediaTabRef.current = end;
        }
        return;
      }
      if (next.matches(MANUAL_MEDIA_SELECTOR)) {
        // A temporary native starting point also enters the last UA control in reverse, even
        // when positive tabindex order differs from DOM order. Remove it on native focus exit.
        const start = document.createElement('span');
        start.tabIndex = -1;
        next.insertAdjacentElement(event.shiftKey ? 'afterend' : 'beforebegin', start);
        start.addEventListener('blur', () => {
          start.remove();
          mediaTabRef.current = null;
        }, { once: true });
        mediaTabRef.current = start;
        start.focus({ preventScroll: true });
        return;
      }
      event.preventDefault();
      next.focus();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="odv-help-backdrop odv-help-backdrop--manual"
      role="dialog"
      aria-modal="true"
      aria-labelledby={MANUAL_TITLE_ID}
      data-odv-shortcuts="off"
      onMouseDownCapture={() => {
        mediaTabRef.current?.remove();
        mediaTabRef.current = null;
      }}
      onKeyDownCapture={(event) => {
        if (String(event?.key || '') !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onClose?.();
      }}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        onClose?.();
      }}
    >
      <div
        ref={dialogRef}
        className="odv-help-dialog odv-manual-dialog"
        tabIndex={-1}
        data-odv-shortcuts="off"
        onKeyDown={handleManualTabTrap}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="odv-help-header">
          <div>
            <h2 id={MANUAL_TITLE_ID} className="odv-help-title">
              {t('help.menu.manual', { defaultValue: 'Manual' })}
            </h2>
            <p className="odv-help-subtitle">
              {documentState.resolvedUrl
                ? t('help.loadedFrom', {
                    path: documentState.resolvedUrl,
                    defaultValue: `Loaded from ${documentState.resolvedUrl}`,
                  })
                : t('help.subtitle', {
                    defaultValue: 'OpenDocViewer manual content loaded from a site-local HTML file.',
                  })}
            </p>
          </div>
          <div className="odv-help-header-actions">
            <button
              type="button"
              className="odv-help-close-icon"
              onClick={handleRefresh}
              disabled={documentState.loading}
              aria-label={t('help.refreshManual', { defaultValue: 'Reload manual from server' })}
              title={t('help.refreshManual', { defaultValue: 'Reload manual from server' })}
            >
              <span className="material-icons" aria-hidden="true">refresh</span>
            </button>
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
        </div>

        <ManualView
          refreshToken={refreshToken}
          onDocumentStateChange={setDocumentState}
          onEscape={onClose}
          reservedIds={MANUAL_DIALOG_IDS}
        />

        <div className="odv-help-footer">
          <button type="button" className="odv-help-close-button" onClick={onClose}>
            {t('help.close', { defaultValue: 'Close' })}
          </button>
        </div>
      </div>
    </div>
  );
}

ManualOverlayDialog.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  returnFocusRef: PropTypes.shape({ current: PropTypes.any }),
};
