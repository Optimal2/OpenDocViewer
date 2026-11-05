// File: src/components/DocumentToolbar/OcrToolbarActions.jsx
/**
 * The toolbar's OCR group, right of the end actions: the read-aloud button
 * (ReadSelectionButton.jsx) and the search in the text layers (OcrSearchBar.jsx), each behind
 * its own runtime switch so a site can offer one without the other:
 *
 * - `ocr.speech.enabled` (default true; only the literal false turns it off) mounts the
 *   read-aloud button. Off, the button is never mounted, so nothing follows the selection and
 *   speech synthesis is never touched.
 * - `ocr.search.enabled` (default true; only the literal false turns it off) offers the search.
 *   Off, the search button's place keeps a status-only indicator of the page's recognition (its
 *   LED, tooltip and live region), so the user still sees that text is being recognised, but no
 *   field opens and no match is ever marked; the text layers and the browser's own find stay.
 *
 * Mounted by DocumentToolbar only while `ocr.enabled` is the literal true: with OCR off this
 * module's switches are never read and the group does not exist.
 */
import React from 'react';
import PropTypes from 'prop-types';
import OcrSearchBar from './OcrSearchBar.jsx';
import ReadSelectionButton from './ReadSelectionButton.jsx';
import { isOcrSearchEnabled, isReadAloudEnabled } from '../../utils/runtimeConfig.js';

/**
 * @param {Object} props
 * @param {number} props.pageNumber  Original session page number (1-based) of the displayed page.
 * @param {function(number): void} props.setPageNumber  Takes an original session page number.
 * @param {Array<Object>} props.allPages  The viewer's pages.
 * @returns {React.ReactElement}
 */
export default function OcrToolbarActions({ pageNumber, setPageNumber, allPages }) {
  const readAloud = isReadAloudEnabled();
  const search = isOcrSearchEnabled();
  return (
    <div className="toolbar-ocr-actions" data-odv-ocr="actions" data-ocr-read-aloud={readAloud ? 'on' : 'off'} data-ocr-search={search ? 'on' : 'off'}>
      {readAloud ? <ReadSelectionButton /> : null}
      <OcrSearchBar pageNumber={pageNumber} setPageNumber={setPageNumber} allPages={allPages} searchEnabled={search} />
    </div>
  );
}

OcrToolbarActions.propTypes = {
  pageNumber: PropTypes.number.isRequired,
  setPageNumber: PropTypes.func.isRequired,
  allPages: PropTypes.array,
};
