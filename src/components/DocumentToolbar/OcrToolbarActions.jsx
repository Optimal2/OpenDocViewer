// File: src/components/DocumentToolbar/OcrToolbarActions.jsx
/**
 * The toolbar's OCR group, right after the image-adjustment group: a separator and the search
 * in the text layers (OcrSearchBar.jsx), behind its runtime switches:
 *
 * - `ocr.search.enabled` (default true; only the literal false turns it off) offers the search.
 *   Off, the search button's place keeps a status-only indicator of the page's recognition (its
 *   LED, tooltip and live region), so the user still sees that text is being recognised, but no
 *   field opens and no match is ever marked; the text layers and the browser's own find stay.
 * - `ocr.search.overridesCtrlF` (default false; only the literal true turns it on) lets Ctrl+F
 *   open the search instead of the browser's find, while the search is offered.
 *
 * Read-aloud is not a toolbar button: it lives in the page's context menu (ReadAloudMenuItem.jsx)
 * and its reading language in the language menu (LanguageMenuButton.jsx), both fed by
 * ReadAloudProvider, which DocumentViewer mounts while `ocr.speech.enabled` is not the literal
 * false.
 *
 * The wrapper is laid out as `display: contents` (styles/ocr.css), so the separator and the
 * search are the toolbar's own flex items and take the toolbar's spacing like every other loose
 * button and separator; the wrapper itself remains the print rule's and the tests' hook.
 * Mounted by DocumentToolbar only while `ocr.enabled` is the literal true: with OCR off this
 * module's switches are never read and the group does not exist.
 */
import React from 'react';
import PropTypes from 'prop-types';
import OcrSearchBar from './OcrSearchBar.jsx';
import { isOcrSearchCtrlFOverrideEnabled, isOcrSearchEnabled } from '../../utils/runtimeConfig.js';

/**
 * @param {Object} props
 * @param {number} props.pageNumber  Original session page number (1-based) of the displayed page.
 * @param {function(number): void} props.setPageNumber  Takes an original session page number.
 * @param {Array<Object>} props.allPages  The viewer's pages.
 * @returns {React.ReactElement}
 */
export default function OcrToolbarActions({ pageNumber, setPageNumber, allPages }) {
  const search = isOcrSearchEnabled();
  const ctrlF = search && isOcrSearchCtrlFOverrideEnabled();
  return (
    <div className="toolbar-ocr-actions" data-odv-ocr="actions" data-ocr-search={search ? 'on' : 'off'} data-ocr-search-ctrl-f={ctrlF ? 'on' : 'off'}>
      <div className="separator" />
      <OcrSearchBar pageNumber={pageNumber} setPageNumber={setPageNumber} allPages={allPages} searchEnabled={search} ctrlFOverride={ctrlF} />
    </div>
  );
}

OcrToolbarActions.propTypes = {
  pageNumber: PropTypes.number.isRequired,
  setPageNumber: PropTypes.func.isRequired,
  allPages: PropTypes.array,
};
