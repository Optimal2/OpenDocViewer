// File: src/components/PrintSelectionWorkspace.jsx
/**
 * Full-window print-selection workspace.
 *
 * This mode is intentionally separate from the legacy thumbnail-pane selection filter. It edits an
 * ordered draft print sequence and only commits that sequence when the user confirms with OK.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { getPublicAssetUrl } from '../utils/publicAssetUrl.js';

function clampPercent(value, fallback = 120) {
  const next = Math.round(Number(value));
  if (!Number.isFinite(next)) return fallback;
  return Math.max(50, Math.min(260, next));
}

function normalizeIndexSequence(sequence, totalPages) {
  const total = Math.max(0, Math.floor(Number(totalPages) || 0));
  const seen = new Set();
  const indexes = [];
  if (Array.isArray(sequence)) {
    for (const rawPageNumber of sequence) {
      const pageNumber = Math.floor(Number(rawPageNumber));
      const index = pageNumber - 1;
      if (!Number.isFinite(index) || index < 0 || index >= total || seen.has(index)) continue;
      seen.add(index);
      indexes.push(index);
    }
  }

  if (indexes.length > 0 || total <= 0) return indexes;
  return Array.from({ length: total }, (_, index) => index);
}

function sequencesEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function getPageImageUrl(page) {
  if (!page) return getPublicAssetUrl('placeholder.png');
  if (page.status === -1 || page.thumbnailStatus === -1) return getPublicAssetUrl('lost.png');
  if (page.thumbnailUsesFullAsset && page.fullSizeStatus === 1 && page.fullSizeUrl) return page.fullSizeUrl;
  if (page.thumbnailStatus === 1 && page.thumbnailUrl) return page.thumbnailUrl;
  if (page.fullSizeStatus === 1 && page.fullSizeUrl) return page.fullSizeUrl;
  return getPublicAssetUrl('placeholder.png');
}

function resolvePathValue(source, path) {
  if (!source || typeof source !== 'object') return '';
  const parts = String(path || '').split('.').filter(Boolean);
  let current = source;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return '';
    current = current[part];
  }
  if (current == null) return '';
  if (typeof current === 'string' || typeof current === 'number' || typeof current === 'boolean') {
    return String(current);
  }
  if (typeof current === 'object') {
    return String(current.selectedValue ?? current.lookupValue ?? current.value ?? current.displayValue ?? '');
  }
  return '';
}

function getDocumentEntry(bundle, documentId, documentNumber) {
  const documents = Array.isArray(bundle?.documents) ? bundle.documents : [];
  const id = String(documentId || '').trim();
  if (id) {
    const byId = documents.find((document) => String(document?.documentId || '').trim() === id);
    if (byId) return byId;
  }
  const ordinal = Math.max(1, Number(documentNumber) || 1);
  return documents[ordinal - 1] || null;
}

function applyTemplate(template, context, documentEntry) {
  return String(template || '').replace(/\{([^}]+)\}/g, (match, rawToken) => {
    const token = String(rawToken || '').trim();
    if (!token) return match;
    if (Object.prototype.hasOwnProperty.call(context, token)) return String(context[token] ?? '');
    if (token.startsWith('metadata.')) return resolvePathValue(documentEntry?.metadata, token.slice('metadata.'.length));
    if (token.startsWith('metadataDetails.')) return resolvePathValue(documentEntry?.metadataDetails, token.slice('metadataDetails.'.length));
    if (token.startsWith('metaById.')) return resolvePathValue(documentEntry?.metaById, token.slice('metaById.'.length));
    if (token.startsWith('meta.')) return resolvePathValue(documentEntry?.meta, token.slice('meta.'.length));
    return '';
  });
}

function buildPageItems(allPages) {
  const sourcePages = Array.isArray(allPages) ? allPages : [];
  return sourcePages.map((page, originalIndex) => ({
    page,
    originalIndex,
    pageNumber: originalIndex + 1,
    documentId: String(page?.documentId || '').trim(),
    documentNumber: Math.max(1, Number(page?.documentNumber) || 1),
    totalDocuments: Math.max(1, Number(page?.totalDocuments) || 1),
    documentPageNumber: Math.max(1, Number(page?.documentPageNumber) || 0) || null,
    documentPageCount: Math.max(1, Number(page?.documentPageCount) || 0) || null,
    imageUrl: getPageImageUrl(page),
    loading: !(page?.thumbnailStatus === 1 || page?.fullSizeStatus === 1 || page?.status === -1),
  }));
}

function buildDocumentGroups(pageItems, bundle, headerTemplate) {
  const groups = [];
  for (const item of pageItems) {
    const key = item.documentId || `doc:${item.documentNumber}`;
    let group = groups[groups.length - 1] || null;
    if (!group || group.key !== key) {
      const documentEntry = getDocumentEntry(bundle, item.documentId, item.documentNumber);
      group = {
        key,
        documentId: item.documentId,
        documentNumber: item.documentNumber,
        totalDocuments: item.totalDocuments,
        documentEntry,
        pages: [],
      };
      groups.push(group);
    }
    group.pages.push(item);
  }

  return groups.map((group) => {
    const first = group.pages[0] || null;
    const last = group.pages[group.pages.length - 1] || first;
    const context = {
      documentNumber: group.documentNumber,
      totalDocuments: group.totalDocuments,
      documentId: group.documentId,
      pageCount: group.pages.length,
      firstPage: first?.pageNumber ?? '',
      lastPage: last?.pageNumber ?? '',
    };
    return {
      ...group,
      header: applyTemplate(headerTemplate, context, group.documentEntry),
    };
  });
}

function rangeSelection(orderedIndexes, anchor, target) {
  const anchorPosition = orderedIndexes.indexOf(anchor);
  const targetPosition = orderedIndexes.indexOf(target);
  if (anchorPosition < 0 || targetPosition < 0) return [target];
  const from = Math.min(anchorPosition, targetPosition);
  const to = Math.max(anchorPosition, targetPosition);
  return orderedIndexes.slice(from, to + 1);
}

function uniqueOrdered(indexes, order) {
  const wanted = new Set(Array.isArray(indexes) ? indexes : []);
  return order.filter((index) => wanted.has(index));
}

function insertUnique(current, indexes, insertIndex) {
  const currentSet = new Set(current);
  const additions = indexes.filter((index) => !currentSet.has(index));
  if (additions.length <= 0) return current;
  const target = Math.max(0, Math.min(current.length, Math.floor(Number(insertIndex) || 0)));
  return [
    ...current.slice(0, target),
    ...additions,
    ...current.slice(target),
  ];
}

function moveWithinSequence(current, indexes, insertIndex) {
  const selectedSet = new Set(indexes);
  if (selectedSet.size <= 0) return current;
  const orderedSelection = current.filter((index) => selectedSet.has(index));
  if (orderedSelection.length <= 0) return current;

  const safeInsertIndex = Math.max(0, Math.min(current.length, Math.floor(Number(insertIndex) || 0)));
  const removedBeforeTarget = current
    .slice(0, safeInsertIndex)
    .reduce((count, index) => count + (selectedSet.has(index) ? 1 : 0), 0);
  const remaining = current.filter((index) => !selectedSet.has(index));
  const target = Math.max(0, Math.min(remaining.length, safeInsertIndex - removedBeforeTarget));

  return [
    ...remaining.slice(0, target),
    ...orderedSelection,
    ...remaining.slice(target),
  ];
}

const PrintSelectionWorkspace = ({
  allPages,
  bundle,
  initialSequence,
  documentHeaderTemplate,
  zoomPercent = 120,
  onCommit,
  onCancel,
}) => {
  const { t } = useTranslation('common');
  const totalPages = Array.isArray(allPages) ? allPages.length : 0;
  const pageItems = useMemo(() => buildPageItems(allPages), [allPages]);
  const itemByIndex = useMemo(() => new Map(pageItems.map((item) => [item.originalIndex, item])), [pageItems]);
  const naturalIndexes = useMemo(() => pageItems.map((item) => item.originalIndex), [pageItems]);
  const documentGroups = useMemo(
    () => buildDocumentGroups(pageItems, bundle, documentHeaderTemplate),
    [bundle, documentHeaderTemplate, pageItems]
  );
  const initialIndexes = useMemo(
    () => normalizeIndexSequence(initialSequence, totalPages),
    [initialSequence, totalPages]
  );

  const [draftIndexes, setDraftIndexes] = useState(initialIndexes);
  const [leftSelected, setLeftSelected] = useState([]);
  const [rightSelected, setRightSelected] = useState([]);
  const [leftAnchor, setLeftAnchor] = useState(null);
  const [rightAnchor, setRightAnchor] = useState(null);
  const [dragState, setDragState] = useState(null);
  const [rightDropIndex, setRightDropIndex] = useState(null);
  const [pulseIndex, setPulseIndex] = useState(null);
  const [leftPanelPercent, setLeftPanelPercent] = useState(50);
  const bodyRef = useRef(null);
  const rightPanelRef = useRef(null);

  useEffect(() => {
    setDraftIndexes(initialIndexes);
    setLeftSelected([]);
    setRightSelected([]);
    setLeftAnchor(null);
    setRightAnchor(null);
  }, [initialIndexes]);

  const draftSet = useMemo(() => new Set(draftIndexes), [draftIndexes]);
  const leftSelectedSet = useMemo(() => new Set(leftSelected), [leftSelected]);
  const rightSelectedSet = useMemo(() => new Set(rightSelected), [rightSelected]);
  const availableLeftIndexes = useMemo(
    () => naturalIndexes.filter((index) => !draftSet.has(index)),
    [draftSet, naturalIndexes]
  );
  const isDirty = useMemo(() => !sequencesEqual(draftIndexes, initialIndexes), [draftIndexes, initialIndexes]);
  const thumbSize = Math.round(92 * (clampPercent(zoomPercent) / 100));

  const revealIncludedPage = useCallback((originalIndex) => {
    const node = rightPanelRef.current?.querySelector?.(`[data-selection-page="${originalIndex}"]`);
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    }
    setPulseIndex(originalIndex);
    window.setTimeout(() => {
      setPulseIndex((current) => (current === originalIndex ? null : current));
    }, 1100);
  }, []);

  const selectLeft = useCallback((originalIndex, event) => {
    if (draftSet.has(originalIndex)) {
      revealIncludedPage(originalIndex);
      return;
    }

    const toggle = !!(event?.ctrlKey || event?.metaKey);
    const range = !!event?.shiftKey && leftAnchor != null;
    if (range) {
      const nextRange = rangeSelection(availableLeftIndexes, leftAnchor, originalIndex);
      setLeftSelected(nextRange);
    } else if (toggle) {
      setLeftSelected((current) => {
        const set = new Set(current);
        if (set.has(originalIndex)) set.delete(originalIndex);
        else set.add(originalIndex);
        return uniqueOrdered([...set], availableLeftIndexes);
      });
      setLeftAnchor(originalIndex);
    } else {
      setLeftSelected([originalIndex]);
      setLeftAnchor(originalIndex);
    }
    setRightSelected([]);
  }, [availableLeftIndexes, draftSet, leftAnchor, revealIncludedPage]);

  const selectRight = useCallback((originalIndex, event) => {
    const toggle = !!(event?.ctrlKey || event?.metaKey);
    const range = !!event?.shiftKey && rightAnchor != null;
    if (range) {
      setRightSelected(rangeSelection(draftIndexes, rightAnchor, originalIndex));
    } else if (toggle) {
      setRightSelected((current) => {
        const set = new Set(current);
        if (set.has(originalIndex)) set.delete(originalIndex);
        else set.add(originalIndex);
        return uniqueOrdered([...set], draftIndexes);
      });
      setRightAnchor(originalIndex);
    } else {
      setRightSelected([originalIndex]);
      setRightAnchor(originalIndex);
    }
    setLeftSelected([]);
  }, [draftIndexes, rightAnchor]);

  const addIndexes = useCallback((indexes, insertIndex = draftIndexes.length) => {
    const ordered = uniqueOrdered(indexes, naturalIndexes);
    setDraftIndexes((current) => insertUnique(current, ordered, insertIndex));
    setLeftSelected((current) => current.filter((index) => !ordered.includes(index)));
  }, [draftIndexes.length, naturalIndexes]);

  const removeIndexes = useCallback((indexes) => {
    const removeSet = new Set(indexes);
    if (removeSet.size <= 0) return;
    setDraftIndexes((current) => current.filter((index) => !removeSet.has(index)));
    setRightSelected((current) => current.filter((index) => !removeSet.has(index)));
  }, []);

  const addSelected = useCallback(() => addIndexes(leftSelected), [addIndexes, leftSelected]);
  const addAll = useCallback(() => addIndexes(availableLeftIndexes), [addIndexes, availableLeftIndexes]);
  const removeSelected = useCallback(() => removeIndexes(rightSelected), [removeIndexes, rightSelected]);
  const removeAll = useCallback(() => {
    setDraftIndexes([]);
    setRightSelected([]);
  }, []);

  const getDragIndexes = useCallback((side, originalIndex) => {
    if (side === 'right') {
      return rightSelectedSet.has(originalIndex)
        ? uniqueOrdered(rightSelected, draftIndexes)
        : [originalIndex];
    }
    if (draftSet.has(originalIndex)) return [];
    return leftSelectedSet.has(originalIndex)
      ? uniqueOrdered(leftSelected, availableLeftIndexes)
      : [originalIndex];
  }, [availableLeftIndexes, draftIndexes, draftSet, leftSelected, leftSelectedSet, rightSelected, rightSelectedSet]);

  const startDrag = useCallback((side, originalIndex, event) => {
    const indexes = getDragIndexes(side, originalIndex);
    if (indexes.length <= 0) {
      event.preventDefault();
      return;
    }
    if (side === 'left' && !leftSelectedSet.has(originalIndex)) setLeftSelected(indexes);
    if (side === 'right' && !rightSelectedSet.has(originalIndex)) setRightSelected(indexes);
    setDragState({ side, indexes });
    event.dataTransfer.effectAllowed = side === 'right' ? 'move' : 'copyMove';
    event.dataTransfer.setData('text/plain', indexes.map((index) => String(index + 1)).join(','));
  }, [getDragIndexes, leftSelectedSet, rightSelectedSet]);

  const clearDrag = useCallback(() => {
    setDragState(null);
    setRightDropIndex(null);
  }, []);

  const dropOnRight = useCallback((event, insertIndex) => {
    event.preventDefault();
    if (!dragState || dragState.indexes.length <= 0) return;
    if (dragState.side === 'right') {
      setDraftIndexes((current) => moveWithinSequence(current, dragState.indexes, insertIndex));
    } else {
      addIndexes(dragState.indexes, insertIndex);
    }
    clearDrag();
  }, [addIndexes, clearDrag, dragState]);

  const dropOnLeft = useCallback((event) => {
    event.preventDefault();
    if (dragState?.side === 'right') removeIndexes(dragState.indexes);
    clearDrag();
  }, [clearDrag, dragState, removeIndexes]);

  const cancel = useCallback(() => {
    if (isDirty) {
      const ok = window.confirm(t('printSelectionWorkspace.cancelConfirm', {
        defaultValue: 'Discard the draft print selection? All changes in this selection mode will be lost.',
      }));
      if (!ok) return;
    }
    onCancel?.();
  }, [isDirty, onCancel, t]);

  const commit = useCallback(() => {
    if (draftIndexes.length <= 0) return;
    onCommit?.(draftIndexes.map((index) => index + 1));
  }, [draftIndexes, onCommit]);

  const startPanelResize = useCallback((event) => {
    const bodyNode = bodyRef.current;
    if (!bodyNode) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    event.currentTarget.setPointerCapture?.(pointerId);

    /** @param {PointerEvent} moveEvent */
    const handleMove = (moveEvent) => {
      const rect = bodyNode.getBoundingClientRect();
      const raw = ((moveEvent.clientX - rect.left) / Math.max(1, rect.width)) * 100;
      setLeftPanelPercent(Math.max(28, Math.min(72, raw)));
    };

    /** @returns {void} */
    const handleDone = () => {
      window.removeEventListener('pointermove', handleMove, true);
      window.removeEventListener('pointerup', handleDone, true);
      window.removeEventListener('pointercancel', handleDone, true);
    };

    window.addEventListener('pointermove', handleMove, true);
    window.addEventListener('pointerup', handleDone, true);
    window.addEventListener('pointercancel', handleDone, true);
  }, []);

  const renderTile = useCallback((item, side, orderIndex = -1) => {
    const originalIndex = item.originalIndex;
    const included = draftSet.has(originalIndex);
    const selected = side === 'left' ? leftSelectedSet.has(originalIndex) : rightSelectedSet.has(originalIndex);
    const disabled = side === 'left' && included;
    const pulsing = pulseIndex === originalIndex;
    const title = side === 'left' && included
      ? t('printSelectionWorkspace.alreadyIncluded', { page: item.pageNumber, defaultValue: `Page ${item.pageNumber} is already included in the print selection.` })
      : t('printSelectionWorkspace.pageTitle', { page: item.pageNumber, defaultValue: `Page ${item.pageNumber}` });

    const tile = (
      <button
        key={`${side}-${originalIndex}`}
        type="button"
        data-selection-page={originalIndex}
        className={[
          'print-selection-tile',
          selected ? 'is-selected' : '',
          disabled ? 'is-included' : '',
          pulsing ? 'is-pulsing' : '',
        ].filter(Boolean).join(' ')}
        style={{ '--print-selection-thumb-size': `${thumbSize}px` }}
        title={title}
        aria-pressed={selected}
        aria-disabled={disabled}
        draggable={!disabled}
        onClick={(event) => (side === 'left' ? selectLeft(originalIndex, event) : selectRight(originalIndex, event))}
        onDoubleClick={() => (side === 'left' ? addIndexes([originalIndex]) : removeIndexes([originalIndex]))}
        onDragStart={(event) => startDrag(side, originalIndex, event)}
        onDragEnd={clearDrag}
        onDragOver={side === 'right' ? (event) => {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          const nextIndex = event.clientY > rect.top + (rect.height / 2) ? orderIndex + 1 : orderIndex;
          setRightDropIndex(nextIndex);
        } : undefined}
        onDrop={side === 'right' ? (event) => dropOnRight(event, rightDropIndex ?? orderIndex) : undefined}
      >
        <span className="print-selection-tile-stage">
          <img src={item.imageUrl} alt="" draggable={false} />
          {item.loading ? (
            <span className="print-selection-loading" aria-hidden="true">
              <span className="material-icons">hourglass_empty</span>
            </span>
          ) : null}
          {disabled ? (
            <span className="print-selection-included-overlay" aria-hidden="true">
              <span className="material-icons">done</span>
            </span>
          ) : null}
        </span>
        <span className="print-selection-tile-caption">
          {t('printSelectionWorkspace.pageLabel', { page: item.pageNumber, defaultValue: `Page ${item.pageNumber}` })}
        </span>
      </button>
    );

    if (side !== 'right') return tile;
    return (
      <React.Fragment key={`right-fragment-${originalIndex}`}>
        {rightDropIndex === orderIndex ? <span className="print-selection-drop-marker" aria-hidden="true" /> : null}
        {tile}
      </React.Fragment>
    );
  }, [
    addIndexes,
    clearDrag,
    draftSet,
    dropOnRight,
    leftSelectedSet,
    pulseIndex,
    removeIndexes,
    rightDropIndex,
    rightSelectedSet,
    selectLeft,
    selectRight,
    startDrag,
    t,
    thumbSize,
  ]);

  return (
    <section className="print-selection-workspace" aria-label={t('printSelectionWorkspace.title', { defaultValue: 'Print selection' })}>
      <div className="print-selection-workspace-header">
        <div>
          <h2>{t('printSelectionWorkspace.title', { defaultValue: 'Print selection' })}</h2>
          <p>
            {t('printSelectionWorkspace.subtitle', {
              selected: draftIndexes.length,
              total: totalPages,
              defaultValue: `${draftIndexes.length} of ${totalPages} pages selected for printing.`,
            })}
          </p>
        </div>
        <div className="print-selection-workspace-actions">
          <button type="button" className="print-selection-secondary" onClick={cancel}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button type="button" className="print-selection-primary" onClick={commit} disabled={draftIndexes.length <= 0}>
            {t('common.ok', { defaultValue: 'OK' })}
          </button>
        </div>
      </div>

      <div
        ref={bodyRef}
        className="print-selection-workspace-body"
        style={{ '--print-selection-left-panel': `${leftPanelPercent}%` }}
      >
        <div
          className="print-selection-panel print-selection-panel-left"
          onDragOver={(event) => { if (dragState?.side === 'right') event.preventDefault(); }}
          onDrop={dropOnLeft}
        >
          <div className="print-selection-panel-header">
            <h3>{t('printSelectionWorkspace.availablePages', { defaultValue: 'Available pages' })}</h3>
            <span>{t('printSelectionWorkspace.availableCount', { count: availableLeftIndexes.length, defaultValue: `${availableLeftIndexes.length} available` })}</span>
          </div>
          <div className="print-selection-panel-scroll">
            {documentGroups.map((group) => (
              <section key={group.key} className="print-selection-document-group">
                <div className="print-selection-document-header">
                  <span>{group.header}</span>
                </div>
                <div className="print-selection-grid">
                  {group.pages.map((item) => renderTile(item, 'left'))}
                </div>
              </section>
            ))}
          </div>
        </div>

        <div className="print-selection-transfer-column" aria-label={t('printSelectionWorkspace.transferActions', { defaultValue: 'Transfer pages' })}>
          <button
            type="button"
            className="print-selection-resize-handle"
            onPointerDown={startPanelResize}
            aria-label={t('printSelectionWorkspace.resizeDivider', { defaultValue: 'Resize print selection panels' })}
            title={t('printSelectionWorkspace.resizeDivider', { defaultValue: 'Resize print selection panels' })}
          >
            <span aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={removeAll}
            disabled={draftIndexes.length <= 0}
            title={t('printSelectionWorkspace.removeAll', { defaultValue: 'Remove all' })}
            aria-label={t('printSelectionWorkspace.removeAll', { defaultValue: 'Remove all' })}
          >
            <span className="material-icons" aria-hidden="true">keyboard_double_arrow_left</span>
          </button>
          <button
            type="button"
            onClick={removeSelected}
            disabled={rightSelected.length <= 0}
            title={t('printSelectionWorkspace.removeSelected', { defaultValue: 'Remove selected' })}
            aria-label={t('printSelectionWorkspace.removeSelected', { defaultValue: 'Remove selected' })}
          >
            <span className="material-icons" aria-hidden="true">chevron_left</span>
          </button>
          <button
            type="button"
            onClick={addSelected}
            disabled={leftSelected.length <= 0}
            title={t('printSelectionWorkspace.addSelected', { defaultValue: 'Add selected' })}
            aria-label={t('printSelectionWorkspace.addSelected', { defaultValue: 'Add selected' })}
          >
            <span className="material-icons" aria-hidden="true">chevron_right</span>
          </button>
          <button
            type="button"
            onClick={addAll}
            disabled={availableLeftIndexes.length <= 0}
            title={t('printSelectionWorkspace.addAll', { defaultValue: 'Add all' })}
            aria-label={t('printSelectionWorkspace.addAll', { defaultValue: 'Add all' })}
          >
            <span className="material-icons" aria-hidden="true">keyboard_double_arrow_right</span>
          </button>
        </div>

        <div className="print-selection-panel print-selection-panel-right">
          <div className="print-selection-panel-header">
            <h3>{t('printSelectionWorkspace.selectedPages', { defaultValue: 'Selected pages' })}</h3>
            <span>{t('printSelectionWorkspace.selectedCount', { count: draftIndexes.length, defaultValue: `${draftIndexes.length} selected` })}</span>
          </div>
          <div
            ref={rightPanelRef}
            className="print-selection-panel-scroll"
            onDragOver={(event) => {
              if (!dragState) return;
              event.preventDefault();
              setRightDropIndex(draftIndexes.length);
            }}
            onDrop={(event) => dropOnRight(event, rightDropIndex ?? draftIndexes.length)}
          >
            <div className="print-selection-grid">
              {draftIndexes.map((originalIndex, orderIndex) => {
                const item = itemByIndex.get(originalIndex);
                return item ? renderTile(item, 'right', orderIndex) : null;
              })}
              {rightDropIndex === draftIndexes.length ? <span className="print-selection-drop-marker" aria-hidden="true" /> : null}
            </div>
            {draftIndexes.length <= 0 ? (
              <div className="print-selection-empty" role="status">
                {t('printSelectionWorkspace.emptySelection', { defaultValue: 'No pages are selected for printing.' })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
};

PrintSelectionWorkspace.propTypes = {
  allPages: PropTypes.arrayOf(PropTypes.object).isRequired,
  bundle: PropTypes.object,
  initialSequence: PropTypes.arrayOf(PropTypes.number).isRequired,
  documentHeaderTemplate: PropTypes.string.isRequired,
  zoomPercent: PropTypes.number,
  onCommit: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};

export default React.memo(PrintSelectionWorkspace);
