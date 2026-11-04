// File: src/components/OcrTextLayer.jsx
/**
 * Selectable, invisible text over a recognised page image.
 *
 * One text flow in reading order: a line element per recognised line, inline word elements
 * joined with no-break spaces, lines separated by ordinary spaces in a 1 px wide block so that
 * each recognised line is one line box. The flow starts at the first line and the line boxes
 * are as tall as the distance to the next line, so the lines stack onto their recognised
 * places; each word is shifted onto its box with relative positioning (utils/ocrTextLayout.js).
 * The layer is scaled to the page stage exactly like the image: the outer layer takes the stage
 * size and the zoom transform of CanvasRenderer/ImageRenderer, the inner frame is the unrotated
 * image rotated about its centre like drawImageOnCanvas. The text is transparent, so the page
 * looks exactly as before while the browser's selection, copy and find (Ctrl+F, words and
 * phrases, also across a line break) work on it.
 *
 * The browser paints its selection highlight over the whole line box, which here is the gap
 * down to the next line, so the native highlight is transparent and the layer marks the
 * selected words itself (a class set on `selectionchange`, painted over the word's box). Copy
 * writes the text as it reads on the page (spaces between words, newlines between lines) when
 * the selection lies within text layers. The toolbar's OCR search (`search`: the term, the
 * current match and, limited to one page, that page, published through ViewerContext) is marked
 * here too: every match on the page gets a class on its words, the current match another, and
 * the current match is scrolled into view; a search limited to another page marks nothing.
 * The words may come from the engine or from a PDF page's own text layer (the outcome's
 * `source`, exposed as `data-ocr-source`); the layer treats both alike, the boxes of the latter
 * being in PDF points of the page's base viewport instead of pixels. Mounted only for a page
 * with a `done` outcome, so the default code path (OCR off) renders nothing here. Hidden in
 * print (styles/ocr.css).
 */
import React, { Fragment, useEffect, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import { isOcrLayerSelection, layoutOcrLines, ocrSelectionText, OCR_WORD_JOINER } from '../utils/ocrTextLayout.js';
import { findOcrMatchesInOutcome } from '../utils/ocrSearch.js';

/** Class of a word that the current selection touches. */
export const OCR_WORD_SELECTED_CLASS = 'ocr-text-layer-word--selected';
/** Class of a word inside a match of the toolbar's OCR search. */
export const OCR_WORD_MATCH_CLASS = 'ocr-text-layer-word--match';
/** Class of a word inside the current match of the toolbar's OCR search. */
export const OCR_WORD_CURRENT_MATCH_CLASS = 'ocr-text-layer-word--match-current';

/**
 * @param {Object} props
 * @param {Object} props.outcome  A `done` OCR outcome: `words`, `imageWidth`, `imageHeight`,
 *   `source` (`recognition` or `pdf-text`, src/ocr/queue.js) and `rulingLinePixels` (exposed as
 *   `data-ruling-lines-removed` when the line removal painted anything, for diagnostics and the
 *   end-to-end test; the geometry is unaffected, the copy had the same size as the page image).
 * @param {number} props.renderWidth  Stage width before zoom (the rotated page's layout size).
 * @param {number} props.renderHeight
 * @param {number} props.zoom
 * @param {number=} props.rotation  0, 90, 180 or 270 (default 0).
 * @param {string} props.label  Accessible name of the layer.
 * @param {number} props.pageNumber
 * @param {string=} props.pageKey  utils/ocrPageKey.js key of the page (matches `search.current.pageKey`).
 * @param {({ term:string, current:({ pageKey:string, ordinal:number }|null), onlyPageKey:(string|null) }|null)=} props.search
 *   The toolbar's OCR search: the normalised term, the current match and the page the search
 *   is limited to (null for every page), or null when closed.
 * @returns {(React.ReactElement|null)}
 */
function OcrTextLayer({ outcome, renderWidth, renderHeight, zoom, rotation = 0, label, pageNumber, pageKey = '', search = null }) {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const turn = ((Math.round(Number(rotation) || 0) % 360) + 360) % 360;
  const swapAxes = turn === 90 || turn === 270;
  const stageWidth = Math.max(0, Number(renderWidth) || 0);
  const stageHeight = Math.max(0, Number(renderHeight) || 0);
  const frameWidth = swapAxes ? stageHeight : stageWidth;
  const frameHeight = swapAxes ? stageWidth : stageHeight;
  const imageWidth = Math.max(0, Number(outcome?.imageWidth) || 0);
  const imageHeight = Math.max(0, Number(outcome?.imageHeight) || 0);
  const flowRef = useRef(null);

  const layout = useMemo(
    () => layoutOcrLines(outcome?.words, imageWidth, imageHeight, frameWidth, frameHeight),
    [frameHeight, frameWidth, imageHeight, imageWidth, outcome?.words]
  );

  // Marks of the toolbar's OCR search (utils/ocrSearch.js, the same function the toolbar counts
  // with): the words of every match on this page, the current match's words marked as such.
  // A search limited to one page (`onlyPageKey`) marks nothing on any other page.
  const searchTerm = search?.term && (!search.onlyPageKey || search.onlyPageKey === pageKey) ? search.term : '';
  const currentOrdinal = search?.current && search.current.pageKey === pageKey ? Number(search.current.ordinal) : -1;
  const searchMarks = useMemo(() => {
    const marks = new Map();
    if (!searchTerm || !outcome) return marks;
    findOcrMatchesInOutcome(outcome, searchTerm).forEach((match, ordinal) => {
      const kind = ordinal === currentOrdinal ? OCR_WORD_CURRENT_MATCH_CLASS : OCR_WORD_MATCH_CLASS;
      for (const index of match.wordIndexes) {
        if (kind === OCR_WORD_CURRENT_MATCH_CLASS || !marks.has(index)) marks.set(index, kind);
      }
    });
    return marks;
  }, [currentOrdinal, outcome, searchTerm]);

  // The current match is scrolled into the viewport (the pane scrolls; the viewer's layout is fixed).
  useEffect(() => {
    const flow = flowRef.current;
    if (!flow || currentOrdinal < 0 || !searchTerm) return;
    const word = flow.querySelector(`.${OCR_WORD_CURRENT_MATCH_CLASS}`);
    if (word && typeof word.scrollIntoView === 'function') {
      try { word.scrollIntoView({ block: 'center', inline: 'center' }); } catch { /* older engines */ }
    }
  }, [currentOrdinal, layout, searchTerm]);

  // Mark the words the selection covers; the native highlight is transparent (styles/ocr.css).
  useEffect(() => {
    const flow = flowRef.current;
    if (!flow || typeof document === 'undefined') return undefined;
    let anyMarked = false;
    const probe = document.createRange();
    const update = () => {
      const selection = window.getSelection?.();
      const range = selection && selection.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0) : null;
      const touchesFlow = !!range && range.intersectsNode(flow);
      if (!touchesFlow && !anyMarked) return;
      anyMarked = false;
      for (const word of flow.querySelectorAll('.ocr-text-layer-word')) {
        let covered = false;
        if (touchesFlow && range.intersectsNode(word)) {
          // Only a word the selection reaches into, not one it merely touches at its edge
          // (compared against the word's text, so a boundary just inside the element counts
          // as its edge too).
          probe.selectNodeContents(word.firstChild || word);
          covered = range.compareBoundaryPoints(Range.END_TO_START, probe) < 0
            && range.compareBoundaryPoints(Range.START_TO_END, probe) > 0;
        }
        word.classList.toggle(OCR_WORD_SELECTED_CLASS, covered);
        if (covered) anyMarked = true;
      }
    };
    document.addEventListener('selectionchange', update);
    update();
    return () => { document.removeEventListener('selectionchange', update); };
  }, [layout]);

  if (!outcome || outcome.status !== 'done' || !stageWidth || !stageHeight || !imageWidth || !imageHeight) return null;

  /** @type {React.CSSProperties} */
  const layerStyle = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: `${stageWidth}px`,
    height: `${stageHeight}px`,
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
  };
  /** @type {React.CSSProperties} */
  const frameStyle = {
    left: `${(stageWidth - frameWidth) / 2}px`,
    top: `${(stageHeight - frameHeight) / 2}px`,
    width: `${frameWidth}px`,
    height: `${frameHeight}px`,
    transform: turn ? `rotate(${turn}deg)` : undefined,
    transformOrigin: 'center center',
  };

  // A double-click on a word selects the word (native); it must not also toggle the viewport's
  // fit mode (DocumentRender's onDoubleClick).
  const stopDoubleClick = (event) => {
    if (event.target instanceof Element && event.target.closest('.ocr-text-layer-word')) event.stopPropagation();
  };

  // Copy gives the text as it reads on the page, not the no-break spaces and wrapping spaces
  // the DOM needs for find. A selection that reaches outside the text layers is left to the
  // browser, so nothing outside them is lost.
  const copyAsPageText = (event) => {
    const selection = typeof window !== 'undefined' ? window.getSelection?.() : null;
    if (!isOcrLayerSelection(selection) || !event.clipboardData) return;
    const text = ocrSelectionText(selection);
    if (!text) return;
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
  };

  return (
    <div
      className="ocr-text-layer"
      data-odv-ocr="text-layer"
      data-page-number={pageNumber}
      data-ocr-source={outcome.source === 'pdf-text' ? 'pdf-text' : 'recognition'}
      data-ruling-lines-removed={outcome.rulingLinePixels > 0 ? 'true' : undefined}
      role="group"
      aria-label={label}
      style={layerStyle}
      onDoubleClick={stopDoubleClick}
      onCopy={copyAsPageText}
    >
      <div className="ocr-text-layer-frame" style={frameStyle}>
        <div className="ocr-text-layer-flow" style={{ top: `${layout.top}px` }} ref={flowRef}>
          {layout.lines.map((line, lineIndex) => (
            <Fragment key={`${lineIndex}:${line.top}`}>
              {lineIndex > 0 ? ' ' : null}
              <span
                className="ocr-text-layer-line"
                style={{ fontSize: `${line.fontSize}px`, lineHeight: `${line.lineHeight}px` }}
              >
                {line.words.map((word, wordIndex) => (
                  <Fragment key={`${wordIndex}:${word.left}`}>
                    {wordIndex > 0 ? (
                      <span
                        className="ocr-text-layer-gap"
                        style={{ left: `${word.gapShiftX}px`, letterSpacing: `${word.gapLetterSpacing}px` }}
                      >
                        {OCR_WORD_JOINER}
                      </span>
                    ) : null}
                    <span
                      className={`ocr-text-layer-word${searchMarks.has(word.index) ? ` ${searchMarks.get(word.index)}` : ''}`}
                      data-word-index={word.index}
                      style={{
                        left: `${word.shiftX}px`,
                        top: `${word.shiftY}px`,
                        fontSize: `${word.fontSize}px`,
                        letterSpacing: `${word.letterSpacing}px`,
                      }}
                    >
                      {word.text}
                    </span>
                  </Fragment>
                ))}
              </span>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

OcrTextLayer.propTypes = {
  outcome: PropTypes.shape({
    status: PropTypes.string,
    source: PropTypes.string,
    words: PropTypes.array,
    imageWidth: PropTypes.number,
    imageHeight: PropTypes.number,
    rulingLinePixels: PropTypes.number,
  }),
  renderWidth: PropTypes.number.isRequired,
  renderHeight: PropTypes.number.isRequired,
  zoom: PropTypes.number.isRequired,
  rotation: PropTypes.number,
  label: PropTypes.string.isRequired,
  pageNumber: PropTypes.number.isRequired,
  pageKey: PropTypes.string,
  search: PropTypes.shape({
    term: PropTypes.string,
    current: PropTypes.shape({ pageKey: PropTypes.string, ordinal: PropTypes.number }),
    onlyPageKey: PropTypes.string,
  }),
};

export default OcrTextLayer;
