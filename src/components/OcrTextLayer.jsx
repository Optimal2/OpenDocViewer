// File: src/components/OcrTextLayer.jsx
/**
 * Selectable, invisible text over a recognised page image.
 *
 * One absolutely positioned span per recognised word, placed from Tesseract's pixel boxes and
 * scaled to the page stage exactly like the image: the outer layer takes the stage size and the
 * zoom transform of CanvasRenderer/ImageRenderer, the inner frame is the unrotated image rotated
 * about its centre like drawImageOnCanvas. The text is transparent, so the page looks exactly as
 * before while the browser's selection, copy and find (Ctrl+F) work on it. Mounted only for a
 * page with a `done` outcome, so the default code path (OCR off) renders nothing here. Hidden in
 * print (styles/ocr.css). Geometry lives in utils/ocrTextLayout.js.
 */
import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { layoutOcrWords } from '../utils/ocrTextLayout.js';

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

  const words = useMemo(
    () => layoutOcrWords(outcome?.words, imageWidth, imageHeight, frameWidth, frameHeight),
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
    >
      <div className="ocr-text-layer-frame" style={frameStyle}>
        {words.map((word, index) => (
          <span
            key={`${index}:${word.left}:${word.top}`}
            className="ocr-text-layer-word"
            style={{
              left: `${word.left}px`,
              top: `${word.top}px`,
              width: `${word.textWidth}px`,
              height: `${word.height}px`,
              fontSize: `${word.fontSize}px`,
              transform: `scaleX(${word.scaleX})`,
            }}
          >
            {word.text}{word.separator}
          </span>
        ))}
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
