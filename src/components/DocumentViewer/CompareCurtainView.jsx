// File: src/components/DocumentViewer/CompareCurtainView.jsx
/**
 * File: src/components/DocumentViewer/CompareCurtainView.jsx
 *
 * Curtain view of the compare mode: the two calibrated pages in one coordinate space, page A
 * (left/primary) below and page B (right/compare) above, page B clipped to one side of a
 * draggable border.
 *
 *   [curtain] Curtain  [Horizontal|Vertical]                                          [close]
 *   ┌ stage ────────────────────┬──────────────────────────────────────────────────────────┐
 *   │ A · page 3                ┃                                               B · page 7 │
 *   │ page A                    ┃ page B (clip-path: inset(0 0 0 p%))                      │
 *   └───────────────────────────┴──────────────────────────────────────────────────────────┘
 *
 * - Horizontal mode: the border is a horizontal line, dragged up/down; page B shows below it.
 *   Vertical mode: the border is a vertical line, dragged left/right; page B shows right of it.
 * - The clip is CSS `clip-path: inset(...)` on the top layer (utils/compareCurtain.js). While the
 *   border is dragged the clip and the grab bar are updated directly on the DOM and committed to
 *   the view state on release, so the pages are never re-rendered by a drag.
 * - The border is a slider: arrow keys move it 1 %, Shift 10 %. Each mode keeps its own position
 *   while the view is open.
 * - The calibration (per-page transforms) is read from the viewer context and never changed here.
 * - Escape or Close returns to the view the curtain was opened from (hooks/useCompareOverlay.js).
 * - "Print" opens the viewer's one print dialog (DocumentToolbar/usePrintPipeline.js) for this view
 *   and prints both pages composed onto ONE page with the current border, transforms, zoom and
 *   stage size. Hidden when compare.curtain.print.enabled is false.
 *
 * Design note: docs-src/compare-transform.md (section "Curtain view").
 *
 * @component
 */

import React, { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import DocumentRender from '../DocumentRender.jsx';
import {
  INITIAL_COMPARE_TRANSFORM_STATE,
  buildCompareTransformCss,
  selectCompareTransform,
} from '../../utils/compareTransform.js';
import { needsCanvas } from '../../utils/imageAdjustments.js';
import {
  COMPARE_CURTAIN_POSITION,
  INITIAL_COMPARE_CURTAIN_STATE,
  buildCurtainClipPath,
  buildCurtainHandleStyle,
  compareCurtainReducer,
  curtainPositionFromPointer,
  resolveCurtainKeyAction,
  selectCurtainPosition,
} from '../../utils/compareCurtain.js';
import { hasActiveModalDialog, shouldEscapeCloseView } from './compareViewKeys.js';
import { isCompareCurtainPrintEnabled } from '../../utils/runtimeConfig.js';

/** @typedef {('horizontal'|'vertical')} CurtainMode */

/**
 * Write the clip and the grab bar position straight to the DOM (drag path, no React render).
 *
 * @param {(HTMLElement|null)} layer
 * @param {(HTMLElement|null)} handle
 * @param {CurtainMode} mode
 * @param {number} position
 * @returns {void}
 */
function applyCurtainStyles(layer, handle, mode, position) {
  if (layer) layer.style.clipPath = buildCurtainClipPath(mode, position);
  if (handle) {
    const style = buildCurtainHandleStyle(mode, position);
    if ('top' in style) handle.style.top = style.top;
    else handle.style.left = style.left;
  }
}

/**
 * The stage's visible size in CSS px, so the printed page shows the same window as the screen.
 *
 * @param {(HTMLElement|null)} stage
 * @returns {({ width:number, height:number }|undefined)}
 */
function measureStage(stage) {
  const rect = stage?.getBoundingClientRect?.();
  const width = Number(rect?.width) || 0;
  const height = Number(rect?.height) || 0;
  return width > 0 && height > 0 ? { width, height } : undefined;
}

/**
 * @param {Object} props
 * @param {number} props.pageNumberA Original page number of page A (primary/left).
 * @param {number} props.pageNumberB Original page number of page B (compare/right).
 * @param {Array<any>} props.allPages
 * @param {number} props.zoom Shared base zoom.
 * @param {function(number): void} props.setZoom
 * @param {('FIT_PAGE'|'FIT_WIDTH'|'FIT_CUSTOM'|'ACTUAL_SIZE'|'CUSTOM')=} props.zoomMode
 * @param {Object=} props.customFitSizeLimits
 * @param {{ rotation:number, brightness:number, contrast:number, grayscale:number, invert:boolean }} props.imagePropertiesA
 * @param {{ rotation:number, brightness:number, contrast:number, grayscale:number, invert:boolean }} props.imagePropertiesB
 * @param {{ primary:Object, compare:Object }} props.transforms Calibrated per-page transforms (viewer context).
 * @param {function(): void} props.onClose
 * @param {function(Object): *=} props.onPrint Opens the shared print dialog for this view (usePrintPipeline).
 * @param {boolean=} props.printDisabled True while printing is unavailable (loading, PDF in progress).
 * @param {React.ReactNode=} props.printDialogs The shared print dialog host, rendered in this toolbar.
 * @returns {React.ReactElement}
 */
const CompareCurtainView = ({
  pageNumberA,
  pageNumberB,
  allPages,
  zoom,
  setZoom,
  zoomMode = 'CUSTOM',
  customFitSizeLimits = null,
  imagePropertiesA,
  imagePropertiesB,
  transforms = INITIAL_COMPARE_TRANSFORM_STATE,
  onClose,
  onPrint,
  printDisabled = false,
  printDialogs = null,
}) => {
  const { t } = useTranslation('common');
  const [curtain, dispatchCurtain] = useReducer(compareCurtainReducer, INITIAL_COMPARE_CURTAIN_STATE);
  const mode = curtain.mode;
  const position = selectCurtainPosition(curtain);
  const transformA = selectCompareTransform(transforms, 'primary');
  const transformB = selectCompareTransform(transforms, 'compare');
  const transformCssA = buildCompareTransformCss(transformA);
  const transformCssB = buildCompareTransformCss(transformB);

  const stageRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const layerBRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const handleRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const renderRefA = useRef(/** @type {any} */ (null));
  const renderRefB = useRef(/** @type {any} */ (null));
  const dragRef = useRef(/** @type {(null|{ pointerId:number, mode:CurtainMode, position:number })} */ (null));

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // The shared pipeline reads the view state when the dialog is submitted, not when it opens.
  const latestRef = useRef({ mode, position, transforms, zoom });
  latestRef.current = { mode, position, transforms, zoom };

  // Escape closes the view (also from a slider; text fields keep Escape for themselves).
  useEffect(() => {
    /** @param {KeyboardEvent} event */
    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key !== 'Escape' || hasActiveModalDialog()) return;
      if (!shouldEscapeCloseView(event.target)) return;
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // The border has focus on open, so the arrow keys work at once.
  useEffect(() => {
    try { handleRef.current?.focus?.({ preventScroll: true }); } catch {}
  }, []);

  const positionFromEvent = (event, dragMode) => {
    const stage = stageRef.current;
    if (!stage) return position;
    return curtainPositionFromPointer(dragMode, stage.getBoundingClientRect(), Number(event.clientX), Number(event.clientY));
  };

  const handlePointerDown = (event) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    const pointerId = Number(event.pointerId);
    dragRef.current = { pointerId, mode, position };
    handleRef.current?.classList.add('is-dragging');
    try { handleRef.current?.setPointerCapture?.(pointerId); } catch {}
    event.preventDefault();
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== Number(event.pointerId)) return;
    drag.position = positionFromEvent(event, drag.mode);
    applyCurtainStyles(layerBRef.current, handleRef.current, drag.mode, drag.position);
    event.preventDefault();
  };

  const finishDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== Number(event.pointerId)) return;
    dragRef.current = null;
    handleRef.current?.classList.remove('is-dragging');
    try {
      if (handleRef.current?.hasPointerCapture?.(drag.pointerId)) handleRef.current.releasePointerCapture(drag.pointerId);
    } catch {}
    if (event.type === 'pointerup') drag.position = positionFromEvent(event, drag.mode);
    dispatchCurtain({ type: 'setPosition', value: drag.position });
  };

  const handleKeyDown = (event) => {
    const action = resolveCurtainKeyAction(event);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    dispatchCurtain(action);
  };

  const handlePrint = () => {
    onPrint({
      view: 'curtain',
      primaryRenderRef: renderRefA,
      compareRenderRef: renderRefB,
      getView: () => {
        const latest = latestRef.current;
        return {
          mode: latest.mode,
          position: latest.position,
          transforms: latest.transforms,
          zoom: latest.zoom,
          stage: measureStage(stageRef.current),
        };
      },
    });
  };

  // Fit modes follow the curtain's own surface; page A sets the shared base zoom for both layers.
  const handleRenderedA = useCallback(() => {
    if (zoomMode === 'FIT_PAGE') renderRefA.current?.fitToScreen?.();
    else if (zoomMode === 'FIT_WIDTH') renderRefA.current?.fitToWidth?.();
    else if (zoomMode === 'FIT_CUSTOM') renderRefA.current?.fitToCustomWidth?.();
  }, [zoomMode]);

  // The pages only depend on page/zoom/calibration props, never on the border.
  const pageA = useMemo(() => (
    <DocumentRender
      ref={renderRefA}
      pageNumber={pageNumberA}
      zoom={zoom}
      surfaceTransform={transformCssA}
      initialRenderDone={() => {}}
      onRender={handleRenderedA}
      setZoom={setZoom}
      imageProperties={imagePropertiesA}
      isCanvasEnabled={needsCanvas(imagePropertiesA)}
      allPages={allPages}
      zoomMode={zoomMode}
      customFitSizeLimits={customFitSizeLimits}
    />
  ), [allPages, customFitSizeLimits, handleRenderedA, imagePropertiesA, pageNumberA, setZoom, transformCssA, zoom, zoomMode]);

  const pageB = useMemo(() => (
    <DocumentRender
      ref={renderRefB}
      pageNumber={pageNumberB}
      zoom={zoom}
      surfaceTransform={transformCssB}
      initialRenderDone={() => {}}
      setZoom={setZoom}
      imageProperties={imagePropertiesB}
      isCanvasEnabled={needsCanvas(imagePropertiesB)}
      allPages={allPages}
      zoomMode={zoomMode}
      customFitSizeLimits={customFitSizeLimits}
    />
  ), [allPages, customFitSizeLimits, imagePropertiesB, pageNumberB, setZoom, transformCssB, zoom, zoomMode]);

  const sideLabelA = t('compareCurtain.sideA', { page: pageNumberA, defaultValue: 'A · page {page}' });
  const sideLabelB = t('compareCurtain.sideB', { page: pageNumberB, defaultValue: 'B · page {page}' });
  const closeLabel = t('compareCurtain.close', { defaultValue: 'Close the curtain view and go back' });
  const printLabel = t('compareCurtain.print', { defaultValue: 'Print the curtain view as one page' });
  const showPrint = typeof onPrint === 'function' && isCompareCurtainPrintEnabled();
  const borderLabel = mode === 'horizontal'
    ? t('compareCurtain.borderHorizontal', {
      defaultValue: 'Border between page A (above) and page B (below). Arrow keys move it 1 %, Shift 10 %.',
    })
    : t('compareCurtain.border', {
      defaultValue: 'Border between page A (left) and page B (right). Arrow keys move it 1 %, Shift 10 %.',
    });

  const renderModeButton = (value, label) => (
    <button
      type="button"
      className={`odv-btn ${mode === value ? 'is-active' : ''}`}
      aria-pressed={mode === value}
      onClick={() => dispatchCurtain({ type: 'setMode', mode: value })}
    >
      {label}
    </button>
  );

  return (
    <div
      className="compare-curtain-view"
      role="region"
      aria-label={t('compareCurtain.region', { defaultValue: 'Curtain view: page A and page B on either side of a border' })}
    >
      <div
        className="toolbar compare-curtain-toolbar"
        role="toolbar"
        aria-label={t('compareCurtain.toolbar', { defaultValue: 'Curtain view controls' })}
      >
        <span className="compare-curtain-title">
          <span className="material-icons" aria-hidden="true">vertical_split</span>
          <span>{t('compareCurtain.title', { defaultValue: 'Curtain' })}</span>
        </span>

        <div
          className="compare-curtain-mode"
          role="group"
          aria-label={t('compareCurtain.mode', { defaultValue: 'Direction of the border' })}
        >
          {renderModeButton('horizontal', t('compareCurtain.horizontal', { defaultValue: 'Horizontal' }))}
          {renderModeButton('vertical', t('compareCurtain.vertical', { defaultValue: 'Vertical' }))}
        </div>

        {/* Print entry: hidden when compare.curtain.print.enabled is false */}
        {showPrint ? (
          <button
            type="button"
            className="odv-btn compare-curtain-print"
            title={printLabel}
            aria-label={printLabel}
            disabled={printDisabled}
            onClick={handlePrint}
          >
            <span className="material-icons" aria-hidden="true">print</span>
            <span>{t('compareCurtain.printShort', { defaultValue: 'Print' })}</span>
          </button>
        ) : null}

        <button
          type="button"
          className="odv-btn compare-curtain-close"
          title={closeLabel}
          aria-label={closeLabel}
          onClick={onClose}
        >
          <span className="material-icons" aria-hidden="true">close</span>
          <span>{t('compareCurtain.closeShort', { defaultValue: 'Close' })}</span>
        </button>

        {printDialogs}
      </div>

      <div
        ref={stageRef}
        className={`compare-curtain-stage is-${mode}`}
        // A native drag-and-drop would send pointercancel and end the border drag.
        onDragStart={(event) => { if (dragRef.current) event.preventDefault(); }}
      >
        <div className="compare-curtain-layer is-primary" style={{ zIndex: 1 }} data-odv-curtain-page="A">
          {pageA}
        </div>
        <div
          ref={layerBRef}
          className="compare-curtain-layer is-compare"
          style={{ zIndex: 2, clipPath: buildCurtainClipPath(mode, position) }}
          data-odv-curtain-page="B"
        >
          {pageB}
        </div>

        <span className="compare-curtain-label is-primary">{sideLabelA}</span>
        <span className="compare-curtain-label is-compare">{sideLabelB}</span>

        <div
          ref={handleRef}
          className="compare-curtain-handle"
          style={buildCurtainHandleStyle(mode, position)}
          role="slider"
          tabIndex={0}
          aria-label={borderLabel}
          aria-orientation={mode === 'horizontal' ? 'vertical' : 'horizontal'}
          aria-valuemin={COMPARE_CURTAIN_POSITION.min}
          aria-valuemax={COMPARE_CURTAIN_POSITION.max}
          aria-valuenow={position}
          aria-valuetext={`${position} %`}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onLostPointerCapture={finishDrag}
        >
          <span className="compare-curtain-grip" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
};

const transformShape = PropTypes.shape({
  scale: PropTypes.number.isRequired,
  dx: PropTypes.number.isRequired,
  dy: PropTypes.number.isRequired,
  rotation: PropTypes.number.isRequired,
});

const imagePropertiesShape = PropTypes.shape({
  rotation: PropTypes.number.isRequired,
  brightness: PropTypes.number.isRequired,
  contrast: PropTypes.number.isRequired,
  grayscale: PropTypes.number,
  invert: PropTypes.bool,
});

CompareCurtainView.propTypes = {
  pageNumberA: PropTypes.number.isRequired,
  pageNumberB: PropTypes.number.isRequired,
  allPages: PropTypes.array.isRequired,
  zoom: PropTypes.number.isRequired,
  setZoom: PropTypes.func.isRequired,
  zoomMode: PropTypes.oneOf(['FIT_PAGE', 'FIT_WIDTH', 'FIT_CUSTOM', 'ACTUAL_SIZE', 'CUSTOM']),
  customFitSizeLimits: PropTypes.object,
  imagePropertiesA: imagePropertiesShape.isRequired,
  imagePropertiesB: imagePropertiesShape.isRequired,
  transforms: PropTypes.shape({ primary: transformShape, compare: transformShape }),
  onClose: PropTypes.func.isRequired,
  onPrint: PropTypes.func,
  printDisabled: PropTypes.bool,
  printDialogs: PropTypes.node,
};

export default React.memo(CompareCurtainView);
