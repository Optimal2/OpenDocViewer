// File: src/components/OcrTextLayer.jsx
/**
 * Selectable, invisible text over a recognised page image.
 *
 * One text flow in reading order: a line element per recognised line, inline word elements
 * joined with no-break spaces, lines separated by ordinary spaces in a 1 px wide block so that
 * each recognised line is one line box. Every line and word is shifted onto its recognised box
 * with relative positioning (utils/ocrTextLayout.js), scaled to the page stage exactly like the
 * image: the outer layer takes the stage size and the zoom transform of CanvasRenderer/
 * ImageRenderer, the inner frame is the unrotated image rotated about its centre like
 * drawImageOnCanvas. The text is transparent, so the page looks exactly as before while the
 * browser's selection, copy and find (Ctrl+F, words and phrases, also across a line break) work
 * on it. Copy writes the text as it reads on the page (spaces between words, newlines between
 * lines). Mounted only for a page with a `done` outcome, so the default code path (OCR off)
 * renders nothing here. Hidden in print (styles/ocr.css).
 */
import React, { Fragment, useMemo } from 'react';
import PropTypes from 'prop-types';
import { layoutOcrLines, ocrSelectionText, OCR_WORD_JOINER } from '../utils/ocrTextLayout.js';

/**
 * @param {Object} props
 * @param {Object} props.outcome  A `done` OCR outcome: `words`, `imageWidth`, `imageHeight`, and
 *   `rulingLinePixels` (exposed as `data-ruling-lines-removed` when the line removal painted
 *   anything, for diagnostics and the end-to-end test; the geometry is unaffected, the copy had
 *   the same size as the page image).
 * @param {number} props.renderWidth  Stage width before zoom (the rotated page's layout size).
 * @param {number} props.renderHeight
 * @param {number} props.zoom
 * @param {number=} props.rotation  0, 90, 180 or 270 (default 0).
 * @param {string} props.label  Accessible name of the layer.
 * @param {number} props.pageNumber
 * @returns {(React.ReactElement|null)}
 */
function OcrTextLayer({ outcome, renderWidth, renderHeight, zoom, rotation = 0, label, pageNumber }) {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const turn = ((Math.round(Number(rotation) || 0) % 360) + 360) % 360;
  const swapAxes = turn === 90 || turn === 270;
  const stageWidth = Math.max(0, Number(renderWidth) || 0);
  const stageHeight = Math.max(0, Number(renderHeight) || 0);
  const frameWidth = swapAxes ? stageHeight : stageWidth;
  const frameHeight = swapAxes ? stageWidth : stageHeight;
  const imageWidth = Math.max(0, Number(outcome?.imageWidth) || 0);
  const imageHeight = Math.max(0, Number(outcome?.imageHeight) || 0);

  const lines = useMemo(
    () => layoutOcrLines(outcome?.words, imageWidth, imageHeight, frameWidth, frameHeight),
    [frameHeight, frameWidth, imageHeight, imageWidth, outcome?.words]
  );

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
  // the DOM needs for find.
  const copyAsPageText = (event) => {
    const selection = typeof window !== 'undefined' ? window.getSelection?.() : null;
    const text = ocrSelectionText(selection);
    if (!text || !event.clipboardData) return;
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
  };

  return (
    <div
      className="ocr-text-layer"
      data-odv-ocr="text-layer"
      data-page-number={pageNumber}
      data-ruling-lines-removed={outcome.rulingLinePixels > 0 ? 'true' : undefined}
      role="group"
      aria-label={label}
      style={layerStyle}
      onDoubleClick={stopDoubleClick}
      onCopy={copyAsPageText}
    >
      <div className="ocr-text-layer-frame" style={frameStyle}>
        <div className="ocr-text-layer-flow">
          {lines.map((line, lineIndex) => (
            <Fragment key={`${lineIndex}:${line.top}`}>
              {lineIndex > 0 ? ' ' : null}
              <span
                className="ocr-text-layer-line"
                style={{ top: `${line.shiftY}px`, fontSize: `${line.fontSize}px` }}
              >
                {line.words.map((word, wordIndex) => (
                  <Fragment key={`${wordIndex}:${word.left}`}>
                    {wordIndex > 0 ? OCR_WORD_JOINER : null}
                    <span
                      className="ocr-text-layer-word"
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
};

export default OcrTextLayer;
