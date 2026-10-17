// File: src/components/DocumentViewer/CompareOverlayView.jsx
/**
 * File: src/components/DocumentViewer/CompareOverlayView.jsx
 *
 * Overlay view of the compare mode: the two compared pages stacked in one coordinate space,
 * page A (left/primary) below and page B (right/compare) above, so differences show through.
 *
 *   [layers] Opacity [——●——] 50 %  [swap] [nudge] [reset to compare] [copy]      [close]
 *   [A: fine-tuning bar]  [B: fine-tuning bar]
 *   ┌ stage ─────────────────────────────────────────────────────────────────────────────┐
 *   │ page A with its transform, below; page B with its transform, above at 50 % opacity │
 *   └────────────────────────────────────────────────────────────────────────────────────┘
 *
 * - Each page is drawn with its own transform from the viewer context (utils/compareTransform.js)
 *   and calibrated with the same fine-tuning bars as the compare view.
 * - The slider sets the opacity of the page on top (0 = invisible, 100 = opaque); Left/Right step
 *   1 %, Shift 10 %, Home/End go to the bounds. Swap exchanges which page lies on top.
 * - Dragging the stage moves the top page; Ctrl+wheel zooms it 1 % per notch. In nudge mode the
 *   arrow keys move the top page (1 px, Shift 10 px).
 * - "Reset to compare" restores the transforms from when the view was opened; "copy calibration"
 *   writes `{ A, B }` as JSON to the clipboard for support cases.
 * - Escape or Close returns to the compare view (Escape also from the opacity slider; text fields
 *   keep Escape for themselves). The calibration (transforms, top page, opacity) lives in the viewer
 *   context, so it survives closing and reopening the view.
 * - "Curtain" opens the curtain view (CompareCurtainView.jsx) with this calibration; its Close
 *   returns here.
 * - "Print" opens the viewer's one print dialog (DocumentToolbar/usePrintPipeline.js) for this view
 *   and prints both pages composed onto ONE page with the current opacity, top page, transforms,
 *   zoom and stage size. Hidden when compare.overlay.print.enabled is false.
 *
 * Design note: docs-src/compare-transform.md (section "Overlay view").
 *
 * @component
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import DocumentRender from '../DocumentRender.jsx';
import CompareTransformControls from './CompareTransformControls.jsx';
import {
  INITIAL_COMPARE_TRANSFORM_STATE,
  buildCompareTransformCss,
  selectCompareTransform,
} from '../../utils/compareTransform.js';
import { needsCanvas } from '../../utils/imageAdjustments.js';
import {
  COMPARE_OVERLAY_OPACITY,
  clampOverlayOpacity,
  resolveOverlayNudgeKeyAction,
  resolveOverlayOpacityKeyAction,
  serializeCompareCalibration,
} from '../../utils/compareOverlay.js';
import CompareCurtainButton from './CompareCurtainButton.jsx';
import { hasActiveModalDialog, isOwnKeyTarget, shouldEscapeCloseView } from './compareViewKeys.js';
import { isCompareCurtainEnabled, isCompareOverlayEnabled, isCompareOverlayPrintEnabled } from '../../utils/runtimeConfig.js';

/** @typedef {'primary'|'compare'} OverlayTarget */

const TARGETS = /** @type {Array<OverlayTarget>} */ (['primary', 'compare']);
const DRAG_THRESHOLD_PX = 3;
const COPY_STATUS_MS = 4000;

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
 * @param {{ primary:Object, compare:Object }} props.transforms Per-page transforms (viewer context).
 * @param {function(Object): void} props.onTransformAction compareTransformReducer action dispatcher.
 * @param {Object=} props.imageHandlers Image adjustment handlers for the per-page panels
 *   (hooks/usePaneImageAdjustments.js `compareImageHandlers`).
 * @param {{ opacity:number, top:OverlayTarget }} props.overlay Overlay settings (viewer context).
 * @param {function(Object): void} props.onOverlayAction compareOverlayReducer action dispatcher.
 * @param {boolean} props.canResetToCompare
 * @param {function(): void} props.onResetToCompare
 * @param {function(): void} props.onClose
 * @param {function(): void=} props.onOpenCurtain Opens the curtain view with this calibration.
 * @param {function(Object): *=} props.onPrint Opens the shared print dialog for this view (usePrintPipeline).
 * @param {boolean=} props.printDisabled True while printing is unavailable (loading, PDF in progress).
 * @param {React.ReactNode=} props.printDialogs The shared print dialog host, rendered in this toolbar.
 * @returns {React.ReactElement}
 */
const CompareOverlayView = ({
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
  onTransformAction,
  imageHandlers,
  overlay,
  onOverlayAction,
  canResetToCompare,
  onResetToCompare,
  onClose,
  onOpenCurtain,
  onPrint,
  printDisabled = false,
  printDialogs = null,
}) => {
  const { t } = useTranslation('common');
  const top = overlay?.top === 'primary' ? 'primary' : 'compare';
  const opacity = clampOverlayOpacity(overlay?.opacity);
  const transformA = selectCompareTransform(transforms, 'primary');
  const transformB = selectCompareTransform(transforms, 'compare');

  const [barsExpanded, setBarsExpanded] = useState(
    /** @type {Record<OverlayTarget, boolean>} */ ({ primary: true, compare: true })
  );
  const [nudgeMode, setNudgeMode] = useState(false);
  const [copyStatus, setCopyStatus] = useState(/** @type {(''|'copied'|'failed')} */ (''));
  const [dragging, setDragging] = useState(false);

  const stageRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const layerRefs = useRef(/** @type {Record<OverlayTarget, (HTMLDivElement|null)>} */ ({ primary: null, compare: null }));
  const renderRefA = useRef(/** @type {any} */ (null));
  const renderRefB = useRef(/** @type {any} */ (null));
  const copyTimerRef = useRef(0);
  const dragRef = useRef(/** @type {(null|{
    pointerId: number,
    target: OverlayTarget,
    stage: HTMLElement,
    transform: { scale:number, dx:number, dy:number, rotation:number },
    startX: number,
    startY: number,
    dx: number,
    dy: number,
    moved: boolean
  })} */ (null));

  // Window listeners read the latest props without re-subscribing on every transform change.
  const latestRef = useRef({ top, opacity, zoom, transforms, onTransformAction, onClose, nudgeMode });
  latestRef.current = { top, opacity, zoom, transforms, onTransformAction, onClose, nudgeMode };

  // Escape closes the view; in nudge mode the arrow keys move the top page.
  useEffect(() => {
    /** @param {KeyboardEvent} event */
    const onKeyDown = (event) => {
      if (!isCompareOverlayEnabled()) return;
      if (event.defaultPrevented || event.isComposing) return;
      if (hasActiveModalDialog()) return;
      const latest = latestRef.current;
      if (event.key === 'Escape') {
        if (!shouldEscapeCloseView(event.target)) return;
        event.preventDefault();
        latest.onClose();
        return;
      }
      if (!latest.nudgeMode || isOwnKeyTarget(event.target)) return;
      const action = resolveOverlayNudgeKeyAction(event, latest.top);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      latest.onTransformAction(action);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Ctrl/Cmd+wheel over the stage: ±1 % scale on the top page (native listener, so it can cancel).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    /** @param {WheelEvent} event */
    const onWheel = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      event.stopPropagation();
      const deltaY = Number(event.deltaY) || 0;
      if (deltaY === 0) return;
      const latest = latestRef.current;
      latest.onTransformAction({ type: 'nudge', target: latest.top, field: 'scale', delta: deltaY < 0 ? 0.01 : -0.01 });
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => () => {
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
  }, []);

  // Dragging the stage moves the top page. The layer's stage style is updated directly while
  // dragging and the offset is committed to the viewer context on release (as in the compare view).
  const handlePointerDown = (event) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    const latest = latestRef.current;
    const layer = layerRefs.current[latest.top];
    const pageStage = layer?.querySelector?.('.document-render-container');
    if (!(pageStage instanceof HTMLElement)) return;
    const transform = selectCompareTransform(latest.transforms, latest.top);
    dragRef.current = {
      pointerId: Number(event.pointerId),
      target: latest.top,
      stage: pageStage,
      transform,
      startX: Number(event.clientX) || 0,
      startY: Number(event.clientY) || 0,
      dx: transform.dx,
      dy: transform.dy,
      moved: false,
    };
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== Number(event.pointerId)) return;
    const moveX = (Number(event.clientX) || 0) - drag.startX;
    const moveY = (Number(event.clientY) || 0) - drag.startY;
    if (!drag.moved && Math.hypot(moveX, moveY) < DRAG_THRESHOLD_PX) return;
    if (!drag.moved) {
      drag.moved = true;
      setDragging(true);
      try { stageRef.current?.setPointerCapture?.(drag.pointerId); } catch {}
    }
    // dx/dy are CSS px at transform scale 1, so a screen move of N px is N / scale.
    const scale = drag.transform.scale || 1;
    drag.dx = drag.transform.dx + moveX / scale;
    drag.dy = drag.transform.dy + moveY / scale;
    drag.stage.style.transform = buildCompareTransformCss({ ...drag.transform, dx: drag.dx, dy: drag.dy }) || 'none';
    event.preventDefault();
  };

  const finishDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== Number(event.pointerId)) return;
    dragRef.current = null;
    setDragging(false);
    try {
      if (stageRef.current?.hasPointerCapture?.(drag.pointerId)) stageRef.current.releasePointerCapture(drag.pointerId);
    } catch {}
    if (drag.moved) {
      latestRef.current.onTransformAction({ type: 'set', target: drag.target, transform: { dx: drag.dx, dy: drag.dy } });
    }
  };

  const handleOpacityKeyDown = (event) => {
    const action = resolveOverlayOpacityKeyAction(event);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    onOverlayAction(action);
  };

  const showCopyStatus = useCallback((status) => {
    setCopyStatus(status);
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => {
      copyTimerRef.current = 0;
      setCopyStatus('');
    }, COPY_STATUS_MS);
  }, []);

  const handleCopy = async () => {
    const json = serializeCompareCalibration(transforms, { primary: imagePropertiesA, compare: imagePropertiesB });
    try {
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
      if (!clipboard || typeof clipboard.writeText !== 'function') throw new Error('Clipboard unavailable');
      await clipboard.writeText(json);
      showCopyStatus('copied');
    } catch {
      showCopyStatus('failed');
    }
  };

  // The shared pipeline reads the view state when the dialog is submitted, not when it opens.
  const handlePrint = () => {
    onPrint({
      view: 'overlay',
      primaryRenderRef: renderRefA,
      compareRenderRef: renderRefB,
      getView: () => {
        const latest = latestRef.current;
        return {
          opacity: latest.opacity,
          top: latest.top,
          transforms: latest.transforms,
          zoom: latest.zoom,
          stage: measureStage(stageRef.current),
        };
      },
    });
  };

  // Fit modes follow the overlay's own surface; page A sets the shared base zoom for both layers.
  const handleRenderedA = useCallback(() => {
    if (zoomMode === 'FIT_PAGE') renderRefA.current?.fitToScreen?.();
    else if (zoomMode === 'FIT_WIDTH') renderRefA.current?.fitToWidth?.();
    else if (zoomMode === 'FIT_CUSTOM') renderRefA.current?.fitToCustomWidth?.();
  }, [zoomMode]);

  const pageLabel = (target) => (target === 'primary'
    ? t('compareOverlay.pageA', { defaultValue: 'Page A (left)' })
    : t('compareOverlay.pageB', { defaultValue: 'Page B (right)' }));

  const opacityLabel = t('compareOverlay.opacity', {
    page: pageLabel(top),
    defaultValue: `Opacity of the top page: ${pageLabel(top)}`,
  });
  const nudgeLabel = t('compareOverlay.nudge', { defaultValue: 'Nudge mode: arrow keys move the top page (Shift: 10 px)' });
  const swapLabel = t('compareOverlay.swap', { defaultValue: 'Swap which page is on top' });
  const resetLabel = t('compareOverlay.resetToCompare', { defaultValue: 'Reset to the alignment from the compare view' });
  const copyLabel = t('compareOverlay.copy', { defaultValue: 'Copy the calibration as JSON (for support)' });
  const closeLabel = t('compareOverlay.close', { defaultValue: 'Close the overlay view and return to the compare view' });
  const printLabel = t('compareOverlay.print', { defaultValue: 'Print the overlay view as one page' });
  const showPrint = typeof onPrint === 'function' && isCompareOverlayPrintEnabled();

  const renderLayer = (target) => {
    const isTop = target === top;
    const isA = target === 'primary';
    const imageProperties = isA ? imagePropertiesA : imagePropertiesB;
    return (
      <div
        key={target}
        ref={(node) => { layerRefs.current[target] = node; }}
        className={['compare-overlay-layer', `is-${target}`, isTop ? 'is-top' : ''].filter(Boolean).join(' ')}
        style={{ zIndex: isTop ? 2 : 1, opacity: isTop ? opacity / 100 : 1 }}
        data-odv-overlay-page={isA ? 'A' : 'B'}
      >
        <DocumentRender
          ref={isA ? renderRefA : renderRefB}
          pageNumber={isA ? pageNumberA : pageNumberB}
          zoom={zoom}
          surfaceTransform={buildCompareTransformCss(isA ? transformA : transformB)}
          onRender={isA ? handleRenderedA : undefined}
          setZoom={setZoom}
          imageProperties={imageProperties}
          isCanvasEnabled={needsCanvas(imageProperties)}
          allPages={allPages}
          zoomMode={zoomMode}
          customFitSizeLimits={customFitSizeLimits}
        />
      </div>
    );
  };

  if (!isCompareOverlayEnabled()) return null;
  return (
    <div
      className="compare-overlay-view"
      role="region"
      aria-label={t('compareOverlay.region', { defaultValue: 'Overlay view: page B over page A' })}
    >
      <div
        className="toolbar compare-overlay-toolbar"
        role="toolbar"
        aria-label={t('compareOverlay.toolbar', { defaultValue: 'Overlay view controls' })}
      >
        <span className="compare-overlay-title">
          <span className="material-icons" aria-hidden="true">layers</span>
          <span>{t('compareOverlay.title', { defaultValue: 'Overlay' })}</span>
        </span>

        <label className="compare-overlay-opacity-group" title={opacityLabel}>
          <span className="compare-overlay-opacity-label">
            {t('compareOverlay.opacityShort', { defaultValue: 'Opacity' })}
          </span>
          <input
            type="range"
            className="compare-overlay-opacity"
            min={COMPARE_OVERLAY_OPACITY.min}
            max={COMPARE_OVERLAY_OPACITY.max}
            step={COMPARE_OVERLAY_OPACITY.step}
            value={opacity}
            aria-label={opacityLabel}
            aria-valuetext={`${opacity} %`}
            onKeyDown={handleOpacityKeyDown}
            onChange={(event) => onOverlayAction({ type: 'setOpacity', value: Number(event.target.value) })}
          />
          <output className="compare-overlay-opacity-value" aria-hidden="true">{`${opacity} %`}</output>
        </label>

        <button
          type="button"
          className="odv-btn"
          title={swapLabel}
          aria-label={swapLabel}
          onClick={() => onOverlayAction({ type: 'swap' })}
        >
          <span className="material-icons" aria-hidden="true">swap_vert</span>
        </button>

        <button
          type="button"
          className={`odv-btn compare-overlay-nudge ${nudgeMode ? 'is-active' : ''}`}
          title={nudgeLabel}
          aria-label={nudgeLabel}
          aria-pressed={nudgeMode}
          onClick={() => setNudgeMode((current) => !current)}
        >
          <span className="material-icons" aria-hidden="true">control_camera</span>
        </button>

        <button
          type="button"
          className="odv-btn"
          title={resetLabel}
          aria-label={resetLabel}
          disabled={!canResetToCompare}
          onClick={onResetToCompare}
        >
          <span className="material-icons" aria-hidden="true">restore</span>
        </button>

        <button
          type="button"
          className="odv-btn"
          title={copyLabel}
          aria-label={copyLabel}
          onClick={handleCopy}
        >
          <span className="material-icons" aria-hidden="true">content_copy</span>
        </button>

        {/* Curtain entry: hidden when compare.curtain.enabled is false */}
        {typeof onOpenCurtain === 'function' && isCompareCurtainEnabled() ? (
          <CompareCurtainButton calibrated onOpen={onOpenCurtain} className="compare-overlay-curtain" showLabel />
        ) : null}

        {/* Print entry: hidden when compare.overlay.print.enabled is false */}
        {showPrint ? (
          <button
            type="button"
            className="odv-btn compare-overlay-print"
            title={printLabel}
            aria-label={printLabel}
            disabled={printDisabled}
            onClick={handlePrint}
          >
            <span className="material-icons" aria-hidden="true">print</span>
            <span>{t('compareOverlay.printShort', { defaultValue: 'Print' })}</span>
          </button>
        ) : null}

        <span className="compare-overlay-status" role="status" aria-live="polite">
          {copyStatus === 'copied' ? t('compareOverlay.copied', { defaultValue: 'Calibration copied' }) : null}
          {copyStatus === 'failed' ? t('compareOverlay.copyFailed', { defaultValue: 'Could not copy the calibration' }) : null}
        </span>

        <button
          type="button"
          className="odv-btn compare-overlay-close"
          title={closeLabel}
          aria-label={closeLabel}
          onClick={onClose}
        >
          <span className="material-icons" aria-hidden="true">close</span>
          <span>{t('compareOverlay.closeShort', { defaultValue: 'Close' })}</span>
        </button>

        {printDialogs}
      </div>

      <div className="compare-overlay-calibration">
        {TARGETS.map((target) => (
          <div key={target} className={`compare-overlay-calibration-page is-${target}`}>
            <span className="compare-overlay-page-tag" aria-hidden="true">{target === 'primary' ? 'A' : 'B'}</span>
            <CompareTransformControls
              pane={target}
              transform={target === 'primary' ? transformA : transformB}
              imageProperties={target === 'primary' ? imagePropertiesA : imagePropertiesB}
              imageHandlers={imageHandlers}
              expanded={barsExpanded[target]}
              onExpandedChange={(expanded) => setBarsExpanded((current) => ({ ...current, [target]: expanded }))}
              onAction={onTransformAction}
            />
          </div>
        ))}
      </div>

      <div
        ref={stageRef}
        className={['compare-overlay-stage', dragging ? 'is-dragging' : '', nudgeMode ? 'is-nudge' : ''].filter(Boolean).join(' ')}
        role="group"
        tabIndex={0}
        aria-label={t('compareOverlay.stage', {
          defaultValue: 'Overlaid pages. Drag to move the top page; Ctrl+wheel zooms it.',
        })}
        onPointerDown={handlePointerDown}
        // A native drag-and-drop would send pointercancel and end the drag after its first step.
        onDragStart={(event) => { if (dragRef.current) event.preventDefault(); }}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={finishDrag}
      >
        {TARGETS.map(renderLayer)}
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

CompareOverlayView.propTypes = {
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
  onTransformAction: PropTypes.func.isRequired,
  imageHandlers: PropTypes.object,
  overlay: PropTypes.shape({
    opacity: PropTypes.number.isRequired,
    top: PropTypes.oneOf(['primary', 'compare']).isRequired,
  }).isRequired,
  onOverlayAction: PropTypes.func.isRequired,
  canResetToCompare: PropTypes.bool.isRequired,
  onResetToCompare: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  onOpenCurtain: PropTypes.func,
  onPrint: PropTypes.func,
  printDisabled: PropTypes.bool,
  printDialogs: PropTypes.node,
};

export default React.memo(CompareOverlayView);
