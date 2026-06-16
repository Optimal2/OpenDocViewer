// File: src/components/PrintSelectionWorkspace.jsx
/**
 * Full-window print-selection workspace.
 *
 * This mode is intentionally separate from the legacy thumbnail-pane selection filter. It edits an
 * ordered draft page sequence and saves that sequence explicitly from the workspace toolbar.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { getPublicAssetUrl } from '../utils/publicAssetUrl.js';
import { resolveLocalizedValue } from '../utils/localizedValue.js';

const MIN_THUMBNAIL_PERCENT = 70;
const DEFAULT_THUMBNAIL_PERCENT = 120;
const MAX_THUMBNAIL_PERCENT = 320;
const DEFAULT_ORDER_POSITION = Number.MAX_SAFE_INTEGER;
// Matches host/SQL-style date values used by metadata templates:
// yyyy-MM-dd, optionally followed by a time part separated by T or whitespace.
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?)?/;

function clampPercent(value, fallback = DEFAULT_THUMBNAIL_PERCENT) {
  const next = Math.round(Number(value));
  if (!Number.isFinite(next)) return fallback;
  return Math.max(MIN_THUMBNAIL_PERCENT, Math.min(MAX_THUMBNAIL_PERCENT, next));
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

function getDraftChangeRevealIndex(previous, next) {
  const before = Array.isArray(previous) ? previous : [];
  const after = Array.isArray(next) ? next : [];
  const count = Math.max(before.length, after.length);
  for (let index = 0; index < count; index += 1) {
    if (before[index] === after[index]) continue;
    return after[index] ?? after[Math.max(0, index - 1)] ?? after[index + 1] ?? null;
  }
  return after[0] ?? null;
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

function parseInteger(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function zeroPad(value, length = 2) {
  return String(value).padStart(length, '0');
}

function formatDateParts(parts, pattern) {
  const replacements = {
    yyyy: String(parts.year),
    MM: zeroPad(parts.month),
    dd: zeroPad(parts.day),
    HH: zeroPad(parts.hour),
    mm: zeroPad(parts.minute),
    ss: zeroPad(parts.second),
    SSS: zeroPad(parts.millisecond, 3),
  };
  const resolvedPattern = String(pattern || 'yyyy-MM-dd');
  return resolvedPattern.replace(/yyyy|SSS|MM|dd|HH|mm|ss/g, (token) => replacements[token] ?? token);
}

function formatDateValue(value, pattern) {
  const text = String(value ?? '').trim();
  if (!text) return '';

  const textParts = ISO_DATE_PATTERN.exec(text);
  if (textParts) {
    return formatDateParts({
      year: textParts[1],
      month: textParts[2],
      day: textParts[3],
      hour: textParts[4] || '00',
      minute: textParts[5] || '00',
      second: textParts[6] || '00',
      millisecond: textParts[7] || '000',
    }, pattern);
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;

  return formatDateParts({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
    millisecond: date.getMilliseconds(),
  }, pattern);
}

function applyTemplateFilter(value, rawFilter) {
  const filterText = String(rawFilter || '').trim();
  if (!filterText) return value;

  const separatorIndex = filterText.indexOf(':');
  const name = (separatorIndex === -1 ? filterText : filterText.slice(0, separatorIndex)).trim().toLowerCase();
  const argumentText = separatorIndex === -1 ? '' : filterText.slice(separatorIndex + 1).trim();
  const text = String(value ?? '');

  switch (name) {
    case 'date':
      return formatDateValue(text, argumentText || 'yyyy-MM-dd');
    case 'substring':
    case 'substr':
    case 'slice': {
      const args = argumentText.split(',').map((entry) => parseInteger(entry));
      const start = args[0] ?? 0;
      const end = args[1];
      return end == null ? text.slice(start) : text.slice(start, end);
    }
    case 'trim':
      return text.trim();
    case 'lower':
    case 'lowercase':
      return text.toLowerCase();
    case 'upper':
    case 'uppercase':
      return text.toUpperCase();
    default:
      return text;
  }
}

function applyTemplateFilters(value, filters) {
  let next = value;
  for (const filter of filters) {
    next = applyTemplateFilter(next, filter);
  }
  return next;
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
  return String(template || '').replace(/\{\{([^}]+)\}\}|\{([^}]+)\}/g, (match, rawDoubleToken, rawSingleToken) => {
    const tokenParts = String(rawDoubleToken || rawSingleToken || '').split('|').map((part) => part.trim());
    const token = tokenParts.shift() || '';
    const filters = tokenParts.filter(Boolean);
    if (!token) return match;
    let value = '';
    if (Object.prototype.hasOwnProperty.call(context, token)) {
      value = String(context[token] ?? '');
      return applyTemplateFilters(value, filters);
    }
    if (token.includes('.')) {
      const fromContext = resolvePathValue(context, token);
      if (fromContext) return applyTemplateFilters(fromContext, filters);
    }
    if (token.startsWith('metadata.')) value = resolvePathValue(documentEntry?.metadata, token.slice('metadata.'.length));
    else if (token.startsWith('metadataDetails.')) value = resolvePathValue(documentEntry?.metadataDetails, token.slice('metadataDetails.'.length));
    else if (token.startsWith('metaById.')) value = resolvePathValue(documentEntry?.metaById, token.slice('metaById.'.length));
    else if (token.startsWith('meta.')) value = resolvePathValue(documentEntry?.meta, token.slice('meta.'.length));
    return applyTemplateFilters(value, filters);
  });
}

function buildPageTemplateContext(item, totalPages, printPageNumber = null, documentEntry = null) {
  const documentPageNumber = getDocumentPageNumber(item);
  const documentPageCount = getDocumentPageCount(item);
  const documentId = String(item?.documentId || documentEntry?.documentId || '').trim();
  const documentTitle = String(documentEntry?.title || documentEntry?.name || documentId || '').trim();
  const sourcePage = Math.max(1, Number(item?.pageNumber) || 1);
  const safePrintPage = Math.max(0, Math.floor(Number(printPageNumber) || 0));
  return {
    page: sourcePage,
    sourcePage,
    printPage: safePrintPage || '',
    totalPages: Math.max(0, Math.floor(Number(totalPages) || 0)),
    documentNumber: Math.max(1, Number(item?.documentNumber) || 1),
    totalDocuments: Math.max(1, Number(item?.totalDocuments) || 1),
    documentId,
    documentTitle,
    documentPageNumber,
    documentPageCount: documentPageCount || '',
    doc: {
      ...(documentEntry && typeof documentEntry === 'object' ? documentEntry : {}),
      id: documentId,
      documentId,
      documentNumber: Math.max(1, Number(item?.documentNumber) || 1),
      totalDocuments: Math.max(1, Number(item?.totalDocuments) || 1),
      documentPageNumber,
      documentPageCount: documentPageCount || '',
      title: documentTitle,
    },
  };
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

function hasReliableDocumentGrouping(pageItems, bundle) {
  const documents = Array.isArray(bundle?.documents) ? bundle.documents : [];
  const items = Array.isArray(pageItems) ? pageItems : [];
  if (documents.length <= 0 || items.length <= 0) return false;

  const documentIds = documents
    .map((document) => String(document?.documentId || '').trim())
    .filter(Boolean);
  if (documentIds.length !== documents.length || new Set(documentIds).size !== documentIds.length) return false;

  const expectedTotalDocuments = documents.length;
  const documentCounts = new Map(documentIds.map((documentId) => [documentId, 0]));
  const documentPageCounts = new Map();

  for (const item of items) {
    const page = item?.page || null;
    const documentId = String(page?.documentId || '').trim();
    const documentNumber = Math.floor(Number(page?.documentNumber) || 0);
    const totalDocuments = Math.floor(Number(page?.totalDocuments) || 0);
    const documentPageNumber = Math.floor(Number(page?.documentPageNumber) || 0);
    const documentPageCount = Math.floor(Number(page?.documentPageCount) || 0);

    if (!documentId || !documentCounts.has(documentId)) return false;
    if (documentNumber < 1 || documentNumber > expectedTotalDocuments) return false;
    if (totalDocuments !== expectedTotalDocuments) return false;
    if (documentPageNumber < 1 || documentPageCount < 1 || documentPageNumber > documentPageCount) return false;

    documentCounts.set(documentId, (documentCounts.get(documentId) || 0) + 1);
    const previousPageCount = documentPageCounts.get(documentId);
    if (previousPageCount != null && previousPageCount !== documentPageCount) return false;
    documentPageCounts.set(documentId, documentPageCount);
  }

  for (const documentId of documentIds) {
    const count = documentCounts.get(documentId) || 0;
    const pageCount = documentPageCounts.get(documentId) || 0;
    if (count <= 0 || pageCount <= 0 || count !== pageCount) return false;
  }

  return true;
}

function formatMetricValue(value) {
  return String(Math.max(0, Math.floor(Number(value) || 0)));
}

function getDocumentPageNumber(item) {
  return Math.max(1, Number(item?.documentPageNumber) || Number(item?.pageNumber) || 1);
}

function getDocumentPageCount(item) {
  return Math.max(0, Number(item?.documentPageCount) || 0);
}

function formatMetricFraction(value, total) {
  const safeValue = Math.max(0, Math.floor(Number(value) || 0));
  const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
  return safeTotal > 0 ? `${safeValue}/${safeTotal}` : formatMetricValue(safeValue);
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

function buildDraftDocumentGroups(draftIndexes, itemByIndex, bundle, headerTemplate) {
  const groups = [];
  for (let orderIndex = 0; orderIndex < draftIndexes.length; orderIndex += 1) {
    const item = itemByIndex.get(draftIndexes[orderIndex]);
    if (!item) continue;
    const key = getDocumentGroupKeyForItem(item);
    let group = groups[groups.length - 1] || null;
    if (!group || group.key !== key) {
      const documentEntry = getDocumentEntry(bundle, item.documentId, item.documentNumber);
      group = {
        key,
        blockKey: `${key}:${groups.length}`,
        documentId: item.documentId,
        documentNumber: item.documentNumber,
        totalDocuments: item.totalDocuments,
        documentEntry,
        pages: [],
      };
      groups.push(group);
    }
    group.pages.push({ item, orderIndex });
  }

  return groups.map((group) => {
    const first = group.pages[0]?.item || null;
    const last = group.pages[group.pages.length - 1]?.item || first;
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

function uniqueOrdered(indexes, order) {
  const wanted = new Set(Array.isArray(indexes) ? indexes : []);
  return order.filter((index) => wanted.has(index));
}

function unionOrdered(indexes, additions, order) {
  return uniqueOrdered([...(Array.isArray(indexes) ? indexes : []), ...(Array.isArray(additions) ? additions : [])], order);
}

function toggleOrderedIndex(indexes, index, order) {
  const current = new Set(uniqueOrdered(indexes, order));
  if (current.has(index)) current.delete(index);
  else current.add(index);
  return order.filter((candidate) => current.has(candidate));
}

function getRangeSelection(anchorIndex, targetIndex, order) {
  const anchorPosition = order.indexOf(anchorIndex);
  const targetPosition = order.indexOf(targetIndex);
  if (anchorPosition < 0 || targetPosition < 0) return uniqueOrdered([targetIndex], order);
  const start = Math.min(anchorPosition, targetPosition);
  const end = Math.max(anchorPosition, targetPosition);
  return order.slice(start, end + 1);
}

function resolveRangeOrToggleSelection(current, targetIndex, order, anchorIndex, options = {}) {
  const allowedIndexes = Array.isArray(options.allowedIndexes) ? options.allowedIndexes : order;
  const allowedSet = new Set(allowedIndexes);
  if (!allowedSet.has(targetIndex)) return uniqueOrdered(current, order).filter((index) => allowedSet.has(index));

  const normalizedCurrent = uniqueOrdered(current, order).filter((index) => allowedSet.has(index));
  const append = !!options.append;
  const range = !!options.range;

  if (range) {
    const rangeIndexes = getRangeSelection(anchorIndex, targetIndex, order).filter((index) => allowedSet.has(index));
    return append ? unionOrdered(normalizedCurrent, rangeIndexes, order) : uniqueOrdered(rangeIndexes, order);
  }

  if (append) return toggleOrderedIndex(normalizedCurrent, targetIndex, order);
  if (normalizedCurrent.includes(targetIndex)) return normalizedCurrent;
  return uniqueOrdered([targetIndex], order);
}

function sortByOrder(indexes, order) {
  const orderPosition = new Map(order.map((index, position) => [index, position]));
  return [...(Array.isArray(indexes) ? indexes : [])]
    .sort((a, b) => (orderPosition.get(a) ?? DEFAULT_ORDER_POSITION) - (orderPosition.get(b) ?? DEFAULT_ORDER_POSITION));
}

function getDocumentGroupKeyForItem(item) {
  if (!item) return '';
  return item.documentId || `doc:${item.documentNumber}`;
}

function getDocumentKeyForIndex(index, itemByIndex) {
  return getDocumentGroupKeyForItem(itemByIndex.get(index));
}

function getIndexesForDocument(indexes, itemByIndex, documentKey) {
  return (Array.isArray(indexes) ? indexes : [])
    .filter((index) => getDocumentKeyForIndex(index, itemByIndex) === documentKey);
}

function getBestIncreasingDocumentEntryIndexes(entries) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const count = safeEntries.length;
  if (count <= 0) return new Set();

  const lengths = Array(count).fill(1);
  const sums = safeEntries.map((entry) => getDocumentPageNumber(entry.item));
  const previous = Array(count).fill(-1);

  for (let index = 0; index < count; index += 1) {
    const pageNumber = getDocumentPageNumber(safeEntries[index].item);
    for (let candidate = 0; candidate < index; candidate += 1) {
      const candidatePageNumber = getDocumentPageNumber(safeEntries[candidate].item);
      if (candidatePageNumber >= pageNumber) continue;
      const candidateLength = lengths[candidate] + 1;
      const candidateSum = sums[candidate] + pageNumber;
      if (
        candidateLength > lengths[index]
        || (candidateLength === lengths[index] && candidateSum < sums[index])
      ) {
        lengths[index] = candidateLength;
        sums[index] = candidateSum;
        previous[index] = candidate;
      }
    }
  }

  let best = 0;
  for (let index = 1; index < count; index += 1) {
    if (
      lengths[index] > lengths[best]
      || (lengths[index] === lengths[best] && sums[index] < sums[best])
    ) {
      best = index;
    }
  }

  const keep = new Set();
  for (let index = best; index >= 0; index = previous[index]) {
    keep.add(safeEntries[index].index);
    if (previous[index] < 0) break;
  }
  return keep;
}

function analyzeDraftDocumentOrder(indexes, itemByIndex) {
  const entries = (Array.isArray(indexes) ? indexes : [])
    .map((index) => ({ index, item: itemByIndex.get(index) }))
    .filter((entry) => entry.item);
  const documentRuns = [];
  const documentRunsByKey = new Map();

  for (const entry of entries) {
    const key = getDocumentGroupKeyForItem(entry.item);
    const currentRun = documentRuns[documentRuns.length - 1] || null;
    if (currentRun?.key === key) currentRun.entries.push(entry);
    else {
      const run = { key, entries: [entry] };
      documentRuns.push(run);
      if (!documentRunsByKey.has(key)) documentRunsByKey.set(key, []);
      documentRunsByKey.get(key).push(run);
    }
  }

  const warnings = new Map();
  for (const run of documentRuns) {
    const keep = getBestIncreasingDocumentEntryIndexes(run.entries);
    for (const entry of run.entries) {
      if (keep.has(entry.index)) continue;
      warnings.set(entry.index, 'page-order');
    }
  }

  const hasBoundaryViolation = Array.from(documentRunsByKey.values()).some((runs) => runs.length > 1);
  return { warnings, hasBoundaryViolation };
}

function mergeAdditionsIntoDocumentBlocks(current, additions, itemByIndex, naturalIndexes) {
  let next = [...current];
  const additionKeys = [];
  for (const index of sortByOrder(additions, naturalIndexes)) {
    const key = getDocumentKeyForIndex(index, itemByIndex);
    if (key && !additionKeys.includes(key)) additionKeys.push(key);
  }

  for (const key of additionKeys) {
    const documentAdditions = sortByOrder(
      additions.filter((index) => getDocumentKeyForIndex(index, itemByIndex) === key && !next.includes(index)),
      naturalIndexes
    );
    if (documentAdditions.length <= 0) continue;

    const positions = next
      .map((index, position) => ({ index, position }))
      .filter((entry) => getDocumentKeyForIndex(entry.index, itemByIndex) === key)
      .map((entry) => entry.position);

    if (positions.length <= 0) {
      next = insertByNaturalOrder(next, documentAdditions, naturalIndexes);
      continue;
    }

    const start = Math.min(...positions);
    const end = Math.max(...positions) + 1;
    const block = next.slice(start, end);
    const merged = sortByOrder([...new Set([...block, ...documentAdditions])], naturalIndexes);
    next = [
      ...next.slice(0, start),
      ...merged,
      ...next.slice(end),
    ];
  }

  return next;
}

function moveDocumentBlock(current, documentKey, targetDocumentKey, placement, itemByIndex) {
  if (!documentKey || !targetDocumentKey || documentKey === targetDocumentKey) return current;
  const moving = current.filter((index) => getDocumentKeyForIndex(index, itemByIndex) === documentKey);
  if (moving.length <= 0) return current;
  const remaining = current.filter((index) => getDocumentKeyForIndex(index, itemByIndex) !== documentKey);
  const targetPositions = remaining
    .map((index, position) => ({ index, position }))
    .filter((entry) => getDocumentKeyForIndex(entry.index, itemByIndex) === targetDocumentKey)
    .map((entry) => entry.position);
  if (targetPositions.length <= 0) return current;

  const insertIndex = placement === 'after'
    ? Math.max(...targetPositions) + 1
    : Math.min(...targetPositions);
  return [
    ...remaining.slice(0, insertIndex),
    ...moving,
    ...remaining.slice(insertIndex),
  ];
}

function insertDocumentBlock(current, indexes, targetDocumentKey, placement, itemByIndex, naturalIndexes) {
  const additions = sortByOrder(indexes, naturalIndexes).filter((index) => !current.includes(index));
  if (additions.length <= 0) return current;
  if (!targetDocumentKey) return insertUnique(current, additions, current.length);

  const targetPositions = current
    .map((index, position) => ({ index, position }))
    .filter((entry) => getDocumentKeyForIndex(entry.index, itemByIndex) === targetDocumentKey)
    .map((entry) => entry.position);
  if (targetPositions.length <= 0) return insertUnique(current, additions, current.length);

  const insertIndex = placement === 'after'
    ? Math.max(...targetPositions) + 1
    : Math.min(...targetPositions);
  return insertUnique(current, additions, insertIndex);
}

function rectsIntersect(first, second) {
  return first.left < second.right
    && first.right > second.left
    && first.top < second.bottom
    && first.bottom > second.top;
}

function normalizeSelectionRect(start, current) {
  const left = Math.min(start.x, current.x);
  const top = Math.min(start.y, current.y);
  const right = Math.max(start.x, current.x);
  const bottom = Math.max(start.y, current.y);
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
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

function insertByNaturalOrder(current, indexes, naturalIndexes) {
  const orderPosition = new Map(naturalIndexes.map((index, position) => [index, position]));
  let next = [...current];

  for (const index of sortByOrder(indexes, naturalIndexes)) {
    if (next.includes(index)) continue;
    const naturalPosition = orderPosition.get(index) ?? DEFAULT_ORDER_POSITION;
    const insertIndex = next.findIndex((existingIndex) => (
      (orderPosition.get(existingIndex) ?? DEFAULT_ORDER_POSITION) > naturalPosition
    ));
    next = insertUnique(next, [index], insertIndex < 0 ? next.length : insertIndex);
  }

  return next;
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

function isActivationKey(event) {
  const key = String(event?.key || '');
  return key === 'Enter' || key === ' ';
}

function isModifierOnlyKey(event) {
  const key = String(event?.key || '');
  return key === 'Shift' || key === 'Control' || key === 'Meta';
}

function stopSelectionEvent(event) {
  if (!event) return;
  const eventType = String(event.type || '');
  if (eventType !== 'pointerdown' && eventType !== 'mousedown') {
    event.preventDefault?.();
  }
  event.stopPropagation?.();
}

function getPanelPointerPosition(panelNode, event) {
  const rect = panelNode.getBoundingClientRect();
  return {
    x: Number(event.clientX || 0) - rect.left + panelNode.scrollLeft,
    y: Number(event.clientY || 0) - rect.top + panelNode.scrollTop,
  };
}

function getTilePanelRect(panelNode, tileNode) {
  const panelRect = panelNode.getBoundingClientRect();
  const tileRect = tileNode.getBoundingClientRect();
  const left = tileRect.left - panelRect.left + panelNode.scrollLeft;
  const top = tileRect.top - panelRect.top + panelNode.scrollTop;
  return {
    left,
    top,
    right: left + tileRect.width,
    bottom: top + tileRect.height,
  };
}

function shouldIgnoreModifiedCommandClick(event) {
  if (!(event?.ctrlKey || event?.shiftKey || event?.metaKey)) return false;
  event.preventDefault?.();
  event.stopPropagation?.();
  return true;
}

function isAppendSelectionGesture(event) {
  return !!(event?.ctrlKey || event?.metaKey);
}

function isRangeSelectionGesture(event) {
  return !!event?.shiftKey;
}

const PrintSelectionWorkspace = ({
  allPages,
  bundle,
  initialSequence,
  documentHeaderTemplate,
  previewInfoTemplate,
  zoomPercent = 120,
  onToolbarStateChange,
  onSave,
  onCancel,
}) => {
  const { t, i18n } = useTranslation('common');
  const totalPages = Array.isArray(allPages) ? allPages.length : 0;
  const pageItems = useMemo(() => buildPageItems(allPages), [allPages]);
  const itemByIndex = useMemo(() => new Map(pageItems.map((item) => [item.originalIndex, item])), [pageItems]);
  const naturalIndexes = useMemo(() => pageItems.map((item) => item.originalIndex), [pageItems]);
  const resolvedDocumentHeaderTemplate = useMemo(() => (
    resolveLocalizedValue(documentHeaderTemplate, i18n) || 'Document {documentNumber} of {totalDocuments} · {pageCount} pages'
  ), [documentHeaderTemplate, i18n]);
  const resolvedPreviewInfoTemplate = useMemo(() => (
    resolveLocalizedValue(previewInfoTemplate, i18n) || 'Page {sourcePage} of {totalPages} · {documentNumber}-{documentPageNumber}'
  ), [i18n, previewInfoTemplate]);
  const documentModeAvailable = useMemo(
    () => hasReliableDocumentGrouping(pageItems, bundle),
    [bundle, pageItems]
  );
  const documentGroups = useMemo(
    () => buildDocumentGroups(pageItems, bundle, resolvedDocumentHeaderTemplate),
    [bundle, pageItems, resolvedDocumentHeaderTemplate]
  );
  const initialIndexes = useMemo(
    () => normalizeIndexSequence(initialSequence, totalPages),
    [initialSequence, totalPages]
  );
  const initialIndexesSignature = useMemo(
    () => initialIndexes.join(','),
    [initialIndexes]
  );
  const previousInitialIndexesSignatureRef = useRef(initialIndexesSignature);

  const [draftIndexes, setDraftIndexes] = useState(initialIndexes);
  const [leftSelected, setLeftSelected] = useState([]);
  const [rightSelected, setRightSelected] = useState([]);
  const [workspaceMode, setWorkspaceMode] = useState(() => (documentModeAvailable ? 'documents' : 'pages'));
  const [panelMode, setPanelMode] = useState('both');
  const [hideIncludedLeftPages, setHideIncludedLeftPages] = useState(false);
  const [lightboxState, setLightboxState] = useState(null);
  const [selectionBox, setSelectionBox] = useState(null);
  const [draftHistory, setDraftHistory] = useState({ undo: null, redo: null });
  const [dragState, setDragState] = useState(null);
  const [rightDropIntent, setRightDropIntent] = useState(null);
  const [pulseIndex, setPulseIndex] = useState(null);
  const [leavePromptOpen, setLeavePromptOpen] = useState(false);
  const [leftPanelPercent, setLeftPanelPercent] = useState(50);
  const [thumbnailPercent, setThumbnailPercent] = useState(() => clampPercent(zoomPercent));
  const bodyRef = useRef(null);
  const leftPanelRef = useRef(null);
  const rightPanelRef = useRef(null);
  const rightGridRef = useRef(null);
  const leftSelectionAnchorRef = useRef(null);
  const rightSelectionAnchorRef = useRef(null);

  useEffect(() => {
    if (previousInitialIndexesSignatureRef.current === initialIndexesSignature) return;
    previousInitialIndexesSignatureRef.current = initialIndexesSignature;
    setDraftIndexes(initialIndexes);
    setLeftSelected([]);
    setRightSelected([]);
    leftSelectionAnchorRef.current = null;
    rightSelectionAnchorRef.current = null;
    setDraftHistory({ undo: null, redo: null });
  }, [initialIndexes, initialIndexesSignature]);

  useEffect(() => {
    if (documentModeAvailable || workspaceMode !== 'documents') return;
    setWorkspaceMode('pages');
    setLeftSelected([]);
    setRightSelected([]);
    leftSelectionAnchorRef.current = null;
    rightSelectionAnchorRef.current = null;
  }, [documentModeAvailable, workspaceMode]);

  useEffect(() => {
    if (panelMode !== 'left') return;
    setPanelMode('both');
  }, [panelMode]);

  const draftSet = useMemo(() => new Set(draftIndexes), [draftIndexes]);
  const leftSelectedSet = useMemo(() => new Set(leftSelected), [leftSelected]);
  const rightSelectedSet = useMemo(() => new Set(rightSelected), [rightSelected]);
  const draftDocumentGroups = useMemo(
    () => buildDraftDocumentGroups(draftIndexes, itemByIndex, bundle, resolvedDocumentHeaderTemplate),
    [bundle, draftIndexes, itemByIndex, resolvedDocumentHeaderTemplate]
  );
  const draftDocumentOrderAnalysis = useMemo(
    () => analyzeDraftDocumentOrder(draftIndexes, itemByIndex),
    [draftIndexes, itemByIndex]
  );
  const documentModeCompatible = !draftDocumentOrderAnalysis.hasBoundaryViolation;
  const availableLeftIndexes = useMemo(
    () => naturalIndexes.filter((index) => !draftSet.has(index)),
    [draftSet, naturalIndexes]
  );
  const leftSourceIndexes = hideIncludedLeftPages ? availableLeftIndexes : naturalIndexes;
  const leftSourceIndexSet = useMemo(() => new Set(leftSourceIndexes), [leftSourceIndexes]);
  const leftDocumentGroups = useMemo(() => (
    documentGroups
      .map((group) => ({
        ...group,
        pages: group.pages.filter((item) => leftSourceIndexSet.has(item.originalIndex)),
      }))
      .filter((group) => group.pages.length > 0)
  ), [documentGroups, leftSourceIndexSet]);
  const visibleLeftPanel = panelMode !== 'right';
  const visibleRightPanel = panelMode !== 'left';
  const panelModeClass = `is-panel-mode-${panelMode}`;
  const workspaceModeIsDocuments = workspaceMode === 'documents';
  const draftWarningMap = useMemo(
    () => (workspaceModeIsDocuments ? draftDocumentOrderAnalysis.warnings : new Map()),
    [draftDocumentOrderAnalysis.warnings, workspaceModeIsDocuments]
  );
  const lightboxIndex = lightboxState?.index ?? null;
  const lightboxSide = lightboxState?.side === 'right' ? 'right' : 'left';
  const lightboxIndexes = Array.isArray(lightboxState?.indexes) ? lightboxState.indexes : naturalIndexes;
  const lightboxPosition = lightboxIndex == null ? -1 : lightboxIndexes.indexOf(lightboxIndex);
  const lightboxItem = lightboxIndex == null ? null : itemByIndex.get(lightboxIndex) || null;
  const lightboxItemIncluded = lightboxIndex != null && draftSet.has(lightboxIndex);
  const lightboxDocumentEntry = lightboxItem ? getDocumentEntry(bundle, lightboxItem.documentId, lightboxItem.documentNumber) : null;
  const lightboxInfoText = lightboxItem
    ? applyTemplate(
        resolvedPreviewInfoTemplate,
        buildPageTemplateContext(
          lightboxItem,
          totalPages,
          lightboxSide === 'right' ? lightboxPosition + 1 : null,
          lightboxDocumentEntry
        ),
        lightboxDocumentEntry
      )
    : '';
  const showLightboxAdd = !!lightboxItem && lightboxSide === 'left';
  const showLightboxRemove = !!lightboxItem && (lightboxSide === 'right' || !hideIncludedLeftPages);
  const lightboxCanAdd = showLightboxAdd && !lightboxItemIncluded;
  const lightboxCanRemove = showLightboxRemove && lightboxItemIncluded;
  const lightboxSelectionStatusClass = lightboxItemIncluded ? 'is-in-selection' : 'is-out-of-selection';
  const isDirty = useMemo(() => !sequencesEqual(draftIndexes, initialIndexes), [draftIndexes, initialIndexes]);
  const thumbSize = Math.round(92 * (thumbnailPercent / 100));
  const canUndoDraftChange = Array.isArray(draftHistory.undo);
  const canRedoDraftChange = Array.isArray(draftHistory.redo);
  const undoActionTitle = t('printSelectionWorkspace.undoTitle', { defaultValue: 'Undo the latest print-selection change.' });
  const redoActionTitle = t('printSelectionWorkspace.redoTitle', { defaultValue: 'Redo the latest undone print-selection change.' });
  const resetDraftChangesTitle = t('printSelectionWorkspace.resetDraftChangesTitle', {
    defaultValue: 'Discard unsaved changes and return to the latest saved page selection.',
  });

  useEffect(() => {
    if (leftSelected.length <= 0) {
      leftSelectionAnchorRef.current = null;
      return;
    }
    if (!leftSelectedSet.has(leftSelectionAnchorRef.current)) {
      leftSelectionAnchorRef.current = leftSelected[leftSelected.length - 1] ?? null;
    }
  }, [leftSelected, leftSelectedSet]);

  useEffect(() => {
    if (rightSelected.length <= 0) {
      rightSelectionAnchorRef.current = null;
      return;
    }
    if (!rightSelectedSet.has(rightSelectionAnchorRef.current)) {
      rightSelectionAnchorRef.current = rightSelected[rightSelected.length - 1] ?? null;
    }
  }, [rightSelected, rightSelectedSet]);

  const applyDraftChange = useCallback((producer) => {
    setDraftIndexes((current) => {
      const next = typeof producer === 'function' ? producer(current) : producer;
      if (!Array.isArray(next) || sequencesEqual(current, next)) return current;
      setDraftHistory({ undo: current, redo: null });
      return next;
    });
  }, []);

  const getSelectableLeftIndexes = useCallback((indexes) => (
    uniqueOrdered(indexes, naturalIndexes).filter((index) => !draftSet.has(index))
  ), [draftSet, naturalIndexes]);

  useEffect(() => {
    setLeftSelected((current) => getSelectableLeftIndexes(current));
    setRightSelected((current) => uniqueOrdered(current, draftIndexes));
  }, [draftIndexes, getSelectableLeftIndexes]);

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

  const revealDraftChange = useCallback((previous, next) => {
    const originalIndex = getDraftChangeRevealIndex(previous, next);
    if (originalIndex == null) return;
    const reveal = () => revealIncludedPage(originalIndex);
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(reveal);
    else window.setTimeout(reveal, 0);
  }, [revealIncludedPage]);

  const selectLeft = useCallback((originalIndex, event) => {
    stopSelectionEvent(event);
    if (draftSet.has(originalIndex)) {
      revealIncludedPage(originalIndex);
      return;
    }

    const selectableIndexes = getSelectableLeftIndexes(leftSourceIndexes);
    const next = resolveRangeOrToggleSelection(leftSelected, originalIndex, leftSourceIndexes, leftSelectionAnchorRef.current, {
      allowedIndexes: selectableIndexes,
      append: isAppendSelectionGesture(event),
      range: isRangeSelectionGesture(event),
    });
    setLeftSelected(next);
    setRightSelected([]);
    leftSelectionAnchorRef.current = originalIndex;
    rightSelectionAnchorRef.current = null;
  }, [draftSet, getSelectableLeftIndexes, leftSelected, leftSourceIndexes, revealIncludedPage]);

  const selectRight = useCallback((originalIndex, event) => {
    stopSelectionEvent(event);
    const next = resolveRangeOrToggleSelection(rightSelected, originalIndex, draftIndexes, rightSelectionAnchorRef.current, {
      allowedIndexes: draftIndexes,
      append: isAppendSelectionGesture(event),
      range: isRangeSelectionGesture(event),
    });
    setRightSelected(next);
    setLeftSelected([]);
    rightSelectionAnchorRef.current = originalIndex;
    leftSelectionAnchorRef.current = null;
  }, [draftIndexes, rightSelected]);

  const selectDocument = useCallback((side, documentKey, event) => {
    stopSelectionEvent(event);
    const order = side === 'left' ? naturalIndexes : draftIndexes;
    const indexes = getIndexesForDocument(order, itemByIndex, documentKey);
    if (side === 'left') {
      const selectable = getSelectableLeftIndexes(indexes);
      setLeftSelected(selectable);
      setRightSelected([]);
      leftSelectionAnchorRef.current = selectable[0] ?? null;
      rightSelectionAnchorRef.current = null;
      if (selectable.length <= 0 && indexes.length > 0) revealIncludedPage(indexes[0]);
      return;
    }

    const selectedIndexes = uniqueOrdered(indexes, draftIndexes);
    setRightSelected(selectedIndexes);
    setLeftSelected([]);
    rightSelectionAnchorRef.current = selectedIndexes[0] ?? null;
    leftSelectionAnchorRef.current = null;
  }, [draftIndexes, getSelectableLeftIndexes, itemByIndex, naturalIndexes, revealIncludedPage]);

  const addIndexes = useCallback((indexes, insertIndex = null) => {
    const ordered = getSelectableLeftIndexes(indexes);
    applyDraftChange((current) => (
      workspaceModeIsDocuments
        ? (insertIndex == null
            ? mergeAdditionsIntoDocumentBlocks(current, ordered, itemByIndex, naturalIndexes)
            : insertUnique(current, ordered, insertIndex))
        : (insertIndex == null
            ? insertByNaturalOrder(current, ordered, naturalIndexes)
            : insertUnique(current, ordered, insertIndex))
    ));
    setLeftSelected((current) => current.filter((index) => !ordered.includes(index)));
  }, [applyDraftChange, getSelectableLeftIndexes, itemByIndex, naturalIndexes, workspaceModeIsDocuments]);

  const removeIndexes = useCallback((indexes) => {
    const removeSet = new Set(uniqueOrdered(indexes, draftIndexes));
    if (removeSet.size <= 0) return;
    applyDraftChange((current) => current.filter((index) => !removeSet.has(index)));
    setRightSelected((current) => current.filter((index) => !removeSet.has(index)));
  }, [applyDraftChange, draftIndexes]);

  const addSelected = useCallback(() => addIndexes(leftSelected), [addIndexes, leftSelected]);
  const addAll = useCallback(() => addIndexes(availableLeftIndexes), [addIndexes, availableLeftIndexes]);
  const removeSelected = useCallback(() => removeIndexes(rightSelected), [removeIndexes, rightSelected]);
  const removeAll = useCallback(() => {
    applyDraftChange([]);
    setRightSelected([]);
    rightSelectionAnchorRef.current = null;
  }, [applyDraftChange]);

  const removeIndexFromLightboxList = useCallback((removedIndex) => {
    setLightboxState((current) => {
      if (!current) return current;
      const currentIndexes = Array.isArray(current.indexes) ? current.indexes : [];
      const previousPosition = Math.max(0, currentIndexes.indexOf(removedIndex));
      const nextIndexes = currentIndexes.filter((index) => index !== removedIndex);
      if (nextIndexes.length <= 0) return null;
      const nextIndex = current.index === removedIndex
        ? nextIndexes[Math.min(previousPosition, nextIndexes.length - 1)]
        : current.index;
      return {
        ...current,
        index: nextIndexes.includes(nextIndex) ? nextIndex : nextIndexes[Math.min(previousPosition, nextIndexes.length - 1)],
        indexes: nextIndexes,
      };
    });
  }, []);

  const addLightboxPage = useCallback(() => {
    if (lightboxIndex == null || draftSet.has(lightboxIndex)) return;
    addIndexes([lightboxIndex]);
    if (lightboxSide === 'left' && hideIncludedLeftPages) removeIndexFromLightboxList(lightboxIndex);
  }, [addIndexes, draftSet, hideIncludedLeftPages, lightboxIndex, lightboxSide, removeIndexFromLightboxList]);

  const removeLightboxPage = useCallback(() => {
    if (lightboxIndex == null || !draftSet.has(lightboxIndex)) return;
    removeIndexes([lightboxIndex]);
    if (lightboxSide === 'right') removeIndexFromLightboxList(lightboxIndex);
  }, [draftSet, lightboxIndex, lightboxSide, removeIndexFromLightboxList, removeIndexes]);

  const runLightboxPrimaryAction = useCallback(() => {
    if (!lightboxItem) return false;
    if (lightboxCanAdd) {
      addLightboxPage();
      return true;
    }
    if (lightboxCanRemove) {
      removeLightboxPage();
      return true;
    }
    return false;
  }, [addLightboxPage, lightboxCanAdd, lightboxCanRemove, lightboxItem, removeLightboxPage]);

  const addDocument = useCallback((documentKey, event) => {
    stopSelectionEvent(event);
    addIndexes(getIndexesForDocument(naturalIndexes, itemByIndex, documentKey));
  }, [addIndexes, itemByIndex, naturalIndexes]);
  const removeDocument = useCallback((documentKey, event) => {
    stopSelectionEvent(event);
    removeIndexes(getIndexesForDocument(draftIndexes, itemByIndex, documentKey));
  }, [draftIndexes, itemByIndex, removeIndexes]);

  const undoDraftChange = useCallback(() => {
    setDraftIndexes((current) => {
      if (Array.isArray(draftHistory.undo)) {
        setDraftHistory({ undo: null, redo: current });
        revealDraftChange(current, draftHistory.undo);
        return draftHistory.undo;
      }
      return current;
    });
    setLeftSelected([]);
    setRightSelected([]);
    leftSelectionAnchorRef.current = null;
    rightSelectionAnchorRef.current = null;
  }, [draftHistory.undo, revealDraftChange]);

  const redoDraftChange = useCallback(() => {
    setDraftIndexes((current) => {
      if (Array.isArray(draftHistory.redo)) {
        setDraftHistory({ undo: current, redo: null });
        revealDraftChange(current, draftHistory.redo);
        return draftHistory.redo;
      }
      return current;
    });
    setLeftSelected([]);
    setRightSelected([]);
    leftSelectionAnchorRef.current = null;
    rightSelectionAnchorRef.current = null;
  }, [draftHistory.redo, revealDraftChange]);

  const setThumbnailSize = useCallback((value) => {
    setThumbnailPercent(clampPercent(value));
  }, []);

  const runTransferCommand = useCallback((event, command) => {
    if (shouldIgnoreModifiedCommandClick(event)) return;
    command?.();
  }, []);

  const handleTransferCommandKeyDown = useCallback((event, command) => {
    if (isModifierOnlyKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (!isActivationKey(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (shouldIgnoreModifiedCommandClick(event)) return;
    command?.();
  }, []);

  const getDragIndexes = useCallback((side, originalIndex) => {
    const documentKey = getDocumentKeyForIndex(originalIndex, itemByIndex);
    const keepCurrentDocument = (indexes, order) => uniqueOrdered(
      getIndexesForDocument(indexes, itemByIndex, documentKey),
      order
    );

    if (side === 'right') {
      if (rightSelectedSet.has(originalIndex)) {
        return workspaceModeIsDocuments
          ? keepCurrentDocument(rightSelected, draftIndexes)
          : uniqueOrdered(rightSelected, draftIndexes);
      }
      return uniqueOrdered([originalIndex], draftIndexes);
    }
    if (draftSet.has(originalIndex)) return [];
    if (leftSelectedSet.has(originalIndex)) {
      return workspaceModeIsDocuments
        ? keepCurrentDocument(leftSelected, availableLeftIndexes)
        : uniqueOrdered(leftSelected, availableLeftIndexes);
    }
    return getSelectableLeftIndexes([originalIndex]);
  }, [
    availableLeftIndexes,
    draftIndexes,
    draftSet,
    getSelectableLeftIndexes,
    itemByIndex,
    leftSelected,
    leftSelectedSet,
    rightSelected,
    rightSelectedSet,
    workspaceModeIsDocuments,
  ]);

  const startDrag = useCallback((side, originalIndex, event) => {
    event?.stopPropagation?.();
    const indexes = getDragIndexes(side, originalIndex);
    if (indexes.length <= 0) {
      event.preventDefault();
      return;
    }
    if (side === 'left' && !leftSelectedSet.has(originalIndex)) {
      setLeftSelected(indexes);
      leftSelectionAnchorRef.current = indexes[0] ?? null;
      rightSelectionAnchorRef.current = null;
    }
    if (side === 'right' && !rightSelectedSet.has(originalIndex)) {
      setRightSelected(indexes);
      rightSelectionAnchorRef.current = indexes[0] ?? null;
      leftSelectionAnchorRef.current = null;
    }
    setDragState({
      side,
      indexes,
      kind: 'page',
      documentKey: getDocumentKeyForIndex(originalIndex, itemByIndex),
    });
    event.dataTransfer.effectAllowed = side === 'right' ? 'move' : 'copyMove';
    event.dataTransfer.setData('text/plain', indexes.map((index) => String(index + 1)).join(','));
  }, [getDragIndexes, itemByIndex, leftSelectedSet, rightSelectedSet]);

  const startDocumentDrag = useCallback((side, documentKey, event) => {
    event?.stopPropagation?.();
    const order = side === 'left' ? availableLeftIndexes : draftIndexes;
    const indexes = side === 'left'
      ? getSelectableLeftIndexes(getIndexesForDocument(order, itemByIndex, documentKey))
      : getIndexesForDocument(order, itemByIndex, documentKey);
    if (indexes.length <= 0) {
      event.preventDefault();
      return;
    }
    if (side === 'left') {
      setLeftSelected(indexes);
      setRightSelected([]);
      leftSelectionAnchorRef.current = indexes[0] ?? null;
      rightSelectionAnchorRef.current = null;
    } else {
      setRightSelected(indexes);
      setLeftSelected([]);
      rightSelectionAnchorRef.current = indexes[0] ?? null;
      leftSelectionAnchorRef.current = null;
    }
    setDragState({
      side,
      kind: 'document',
      documentKey,
      indexes,
    });
    event.dataTransfer.effectAllowed = side === 'right' ? 'move' : 'copyMove';
    event.dataTransfer.setData('text/plain', indexes.map((index) => String(index + 1)).join(','));
  }, [availableLeftIndexes, draftIndexes, getSelectableLeftIndexes, itemByIndex]);

  const clearDrag = useCallback(() => {
    setDragState(null);
    setRightDropIntent(null);
  }, []);

  const dropOnLeft = useCallback((event) => {
    event.preventDefault();
    if (dragState?.side === 'right') removeIndexes(dragState.indexes);
    clearDrag();
  }, [clearDrag, dragState, removeIndexes]);

  const handleLeftDragOver = useCallback((event) => {
    if (dragState?.side !== 'right') return;
    event.preventDefault();
    setRightDropIntent(null);
  }, [dragState]);

  const selectTilesInRect = useCallback((side, panelNode, selectionRect, options = {}) => {
    if (!(panelNode instanceof HTMLElement)) return;
    const selectedIndexes = Array.from(panelNode.querySelectorAll('.print-selection-tile[data-selection-page]'))
      .filter((tileNode) => rectsIntersect(selectionRect, getTilePanelRect(panelNode, tileNode)))
      .map((tileNode) => Math.max(0, Math.floor(Number(tileNode.getAttribute('data-selection-page')) || 0)));
    const baseSelection = Array.isArray(options.baseSelection) ? options.baseSelection : [];
    const append = !!options.append;

    if (side === 'left') {
      const selectedLeftIndexes = getSelectableLeftIndexes(selectedIndexes);
      const next = append
        ? getSelectableLeftIndexes(unionOrdered(baseSelection, selectedLeftIndexes, leftSourceIndexes))
        : selectedLeftIndexes;
      setLeftSelected(next);
      setRightSelected([]);
      leftSelectionAnchorRef.current = next[next.length - 1] ?? null;
      rightSelectionAnchorRef.current = null;
      return;
    }

    const selectedRightIndexes = uniqueOrdered(selectedIndexes, draftIndexes);
    const next = append
      ? unionOrdered(baseSelection, selectedRightIndexes, draftIndexes)
      : selectedRightIndexes;
    setRightSelected(next);
    setLeftSelected([]);
    rightSelectionAnchorRef.current = next[next.length - 1] ?? null;
    leftSelectionAnchorRef.current = null;
  }, [draftIndexes, getSelectableLeftIndexes, leftSourceIndexes]);

  const startMarqueeSelection = useCallback((side, event) => {
    if (event.button !== 0) return;
    if (dragState) return;
    if (event.target?.closest?.('.print-selection-tile, .print-selection-document-header, button, a, input, textarea, select, summary')) return;

    const panelNode = event.currentTarget;
    if (!(panelNode instanceof HTMLElement)) return;

    event.preventDefault();
    event.stopPropagation();

    const pointerId = event.pointerId;
    const start = getPanelPointerPosition(panelNode, event);
    const append = isAppendSelectionGesture(event);
    const baseSelection = side === 'left' ? leftSelected : rightSelected;
    let moved = false;
    panelNode.setPointerCapture?.(pointerId);
    setSelectionBox({
      side,
      left: start.x,
      top: start.y,
      width: 0,
      height: 0,
    });

    const move = (moveEvent) => {
      const current = getPanelPointerPosition(panelNode, moveEvent);
      moved = moved
        || Math.abs(current.x - start.x) > 3
        || Math.abs(current.y - start.y) > 3;
      const rect = normalizeSelectionRect(start, current);
      setSelectionBox({
        side,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });
      selectTilesInRect(side, panelNode, rect, { append, baseSelection });
    };

    const done = () => {
      panelNode.removeEventListener('pointermove', move);
      panelNode.removeEventListener('pointerup', done);
      panelNode.removeEventListener('pointercancel', done);
      setSelectionBox(null);
      if (!moved) {
        if (append) return;
        if (side === 'left') {
          setLeftSelected([]);
          leftSelectionAnchorRef.current = null;
        } else {
          setRightSelected([]);
          rightSelectionAnchorRef.current = null;
        }
      }
    };

    panelNode.addEventListener('pointermove', move);
    panelNode.addEventListener('pointerup', done);
    panelNode.addEventListener('pointercancel', done);
  }, [dragState, leftSelected, rightSelected, selectTilesInRect]);

  const getPageDropIntentFromTiles = useCallback((event, tileNodes, fallbackIndex = 0) => {
    const panelNode = rightPanelRef.current;
    if (!panelNode) return null;

    const panelRect = panelNode.getBoundingClientRect();
    const metrics = Array.from(tileNodes || [])
      .map((tileNode) => {
        const stageNode = tileNode.querySelector('.print-selection-tile-stage') || tileNode;
        const orderIndex = Math.max(0, Math.floor(Number(tileNode.getAttribute('data-print-order-index')) || 0));
        const rect = stageNode.getBoundingClientRect();
        return {
          orderIndex,
          rect,
          centerX: rect.left + (rect.width / 2),
          centerY: rect.top + (rect.height / 2),
        };
      })
      .filter((metric) => metric.rect.width > 0 && metric.rect.height > 0)
      .sort((a, b) => a.orderIndex - b.orderIndex);

    const markerStyleFromRect = (rect, viewportLeft) => ({
      left: Math.round(viewportLeft - panelRect.left + panelNode.scrollLeft),
      top: Math.round(rect.top - panelRect.top + panelNode.scrollTop),
      height: Math.round(rect.height),
    });

    if (metrics.length <= 0) {
      return {
        type: 'page',
        index: fallbackIndex,
        markerStyle: null,
      };
    }

    const rows = [];
    for (const metric of metrics) {
      const row = rows.find((candidate) => Math.abs(candidate.centerY - metric.centerY) <= Math.max(16, metric.rect.height * 0.45));
      if (row) {
        row.items.push(metric);
        row.top = Math.min(row.top, metric.rect.top);
        row.bottom = Math.max(row.bottom, metric.rect.bottom);
        row.centerY = row.items.reduce((sum, item) => sum + item.centerY, 0) / row.items.length;
      } else {
        rows.push({
          centerY: metric.centerY,
          top: metric.rect.top,
          bottom: metric.rect.bottom,
          items: [metric],
        });
      }
    }
    rows.sort((a, b) => a.centerY - b.centerY);
    rows.forEach((row) => row.items.sort((a, b) => a.centerX - b.centerX));

    const clientX = Number(event?.clientX) || 0;
    const clientY = Number(event?.clientY) || 0;
    let row = rows[rows.length - 1];
    for (const candidate of rows) {
      if (clientY <= candidate.bottom + 14) {
        row = candidate;
        break;
      }
    }

    const items = row.items;
    const first = items[0];
    const last = items[items.length - 1];
    if (clientX <= first.centerX) {
      return {
        type: 'page',
        index: first.orderIndex,
        markerStyle: markerStyleFromRect(first.rect, first.rect.left - 7),
      };
    }

    for (let itemIndex = 0; itemIndex + 1 < items.length; itemIndex += 1) {
      const current = items[itemIndex];
      const next = items[itemIndex + 1];
      const midpoint = current.centerX + ((next.centerX - current.centerX) / 2);
      if (clientX <= midpoint) {
        return {
          type: 'page',
          index: current.orderIndex + 1,
          markerStyle: markerStyleFromRect(current.rect, (current.rect.right + next.rect.left) / 2),
        };
      }
    }

    return {
      type: 'page',
      index: last.orderIndex + 1,
      markerStyle: markerStyleFromRect(last.rect, last.rect.right + 7),
    };
  }, []);

  const getFlatRightDropIntentFromEvent = useCallback((event) => {
    const gridNode = rightGridRef.current;
    if (!gridNode) return { type: 'page', index: draftIndexes.length, markerStyle: null };
    return getPageDropIntentFromTiles(
      event,
      gridNode.querySelectorAll('.print-selection-tile[data-print-order-index]'),
      draftIndexes.length
    );
  }, [draftIndexes.length, getPageDropIntentFromTiles]);

  const getDocumentDropMarkerStyle = useCallback((sectionNode, placement) => {
    const panelNode = rightPanelRef.current;
    if (!panelNode || !(sectionNode instanceof HTMLElement)) return null;
    const panelRect = panelNode.getBoundingClientRect();
    const sectionRect = sectionNode.getBoundingClientRect();
    return {
      left: 12,
      top: Math.round((placement === 'after' ? sectionRect.bottom : sectionRect.top) - panelRect.top + panelNode.scrollTop),
      width: Math.max(44, Math.round(panelRect.width - 24)),
    };
  }, []);

  const getDocumentModeDropIntentFromEvent = useCallback((event) => {
    const panelNode = rightPanelRef.current;
    if (!panelNode || !dragState) return null;
    const sectionNodes = Array.from(panelNode.querySelectorAll('.print-selection-document-group-right[data-document-key]'));

    if (dragState.kind === 'document') {
      if (dragState.side === 'left') {
        const sourceExistsInDraft = draftIndexes.some((index) => getDocumentKeyForIndex(index, itemByIndex) === dragState.documentKey);
        if (sourceExistsInDraft) return { type: 'document-merge', markerStyle: null };
        if (sectionNodes.length <= 0) return { type: 'document-add', targetDocumentKey: '', placement: 'after', markerStyle: null };
      } else if (sectionNodes.length <= 0) {
        return null;
      }

      const clientY = Number(event?.clientY) || 0;
      let targetSection = sectionNodes[sectionNodes.length - 1];
      let placement = 'after';
      for (const sectionNode of sectionNodes) {
        const rect = sectionNode.getBoundingClientRect();
        if (clientY <= rect.top + (rect.height / 2)) {
          targetSection = sectionNode;
          placement = 'before';
          break;
        }
      }
      const targetDocumentKey = targetSection.getAttribute('data-document-key') || '';
      if (targetDocumentKey === dragState.documentKey) return null;
      return {
        type: dragState.side === 'left' ? 'document-add' : 'document',
        targetDocumentKey,
        placement,
        markerStyle: getDocumentDropMarkerStyle(targetSection, placement),
      };
    }

    const sourceDocumentKey = dragState.documentKey || '';
    const sectionNode = event.target?.closest?.('.print-selection-document-group-right[data-document-key]');
    if (sectionNode) {
      const targetDocumentKey = sectionNode.getAttribute('data-document-key') || '';
      if (targetDocumentKey !== sourceDocumentKey) return null;
      const tileNodes = sectionNode.querySelectorAll('.print-selection-tile[data-print-order-index]');
      const fallbackIndex = draftIndexes.findIndex((index) => getDocumentKeyForIndex(index, itemByIndex) === sourceDocumentKey);
      return getPageDropIntentFromTiles(event, tileNodes, Math.max(0, fallbackIndex));
    }

    const sourceExistsInDraft = draftIndexes.some((index) => getDocumentKeyForIndex(index, itemByIndex) === sourceDocumentKey);
    if (dragState.side === 'left' && !sourceExistsInDraft) {
      return { type: 'page', index: draftIndexes.length, markerStyle: null };
    }
    return null;
  }, [draftIndexes, dragState, getDocumentDropMarkerStyle, getPageDropIntentFromTiles, itemByIndex]);

  const handleRightDragOver = useCallback((event) => {
    if (!dragState) return;
    const intent = workspaceModeIsDocuments
      ? getDocumentModeDropIntentFromEvent(event)
      : getFlatRightDropIntentFromEvent(event);
    if (!intent) {
      setRightDropIntent(null);
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = dragState.side === 'right' ? 'move' : 'copy';
    setRightDropIntent(intent);
  }, [dragState, getDocumentModeDropIntentFromEvent, getFlatRightDropIntentFromEvent, workspaceModeIsDocuments]);

  const handleRightDrop = useCallback((event) => {
    if (!dragState) return;
    const intent = rightDropIntent
      || (workspaceModeIsDocuments ? getDocumentModeDropIntentFromEvent(event) : getFlatRightDropIntentFromEvent(event));
    if (!intent) {
      clearDrag();
      return;
    }

    event.preventDefault();
    if (workspaceModeIsDocuments && dragState.kind === 'document' && (intent.type === 'document' || intent.type === 'document-add' || intent.type === 'document-merge')) {
      if (intent.type === 'document' && dragState.side === 'right') {
        applyDraftChange((current) => moveDocumentBlock(
          current,
          dragState.documentKey,
          intent.targetDocumentKey,
          intent.placement,
          itemByIndex
        ));
      } else if (intent.type === 'document-add') {
        applyDraftChange((current) => insertDocumentBlock(
          current,
          dragState.indexes,
          intent.targetDocumentKey,
          intent.placement,
          itemByIndex,
          naturalIndexes
        ));
      } else if (intent.type === 'document-merge') {
        addIndexes(dragState.indexes);
      }
    } else if (intent.type === 'page') {
      if (dragState.side === 'right') {
        applyDraftChange((current) => moveWithinSequence(current, dragState.indexes, intent.index));
      } else {
        addIndexes(dragState.indexes, intent.index);
      }
    }
    clearDrag();
  }, [
    addIndexes,
    applyDraftChange,
    clearDrag,
    dragState,
    getDocumentModeDropIntentFromEvent,
    getFlatRightDropIntentFromEvent,
    itemByIndex,
    naturalIndexes,
    rightDropIntent,
    workspaceModeIsDocuments,
  ]);

  const closeWorkspace = useCallback(() => {
    onCancel?.();
  }, [onCancel]);

  const saveDraft = useCallback(() => {
    if (draftIndexes.length <= 0) return;
    onSave?.(draftIndexes.map((index) => index + 1));
  }, [draftIndexes, onSave]);

  const leaveWorkspace = useCallback(() => {
    if (isDirty) {
      setLeavePromptOpen(true);
      return;
    }
    closeWorkspace();
  }, [closeWorkspace, isDirty]);

  const saveAndLeaveWorkspace = useCallback(() => {
    if (draftIndexes.length <= 0) return;
    saveDraft();
    setLeavePromptOpen(false);
    closeWorkspace();
  }, [closeWorkspace, draftIndexes.length, saveDraft]);

  const discardAndLeaveWorkspace = useCallback(() => {
    setLeavePromptOpen(false);
    closeWorkspace();
  }, [closeWorkspace]);

  const continueEditingWorkspace = useCallback(() => {
    setLeavePromptOpen(false);
  }, []);

  const changeWorkspaceMode = useCallback((nextMode) => {
    const normalizedMode = String(nextMode || 'documents') === 'pages' ? 'pages' : 'documents';
    if (normalizedMode === workspaceMode) return;
    if (normalizedMode === 'documents' && !documentModeAvailable) return;
    if (normalizedMode === 'documents' && !documentModeCompatible) {
      const reset = window.confirm(t('printSelectionWorkspace.documentModeResetConfirm', {
        defaultValue: 'The current page order crosses document boundaries. Reset to the original document/page order and switch to document mode?',
      }));
      if (!reset) return;
      applyDraftChange(naturalIndexes);
    }
    setWorkspaceMode(normalizedMode);
    setLeftSelected([]);
    setRightSelected([]);
    leftSelectionAnchorRef.current = null;
    rightSelectionAnchorRef.current = null;
  }, [applyDraftChange, documentModeAvailable, documentModeCompatible, naturalIndexes, t, workspaceMode]);

  const changePanelMode = useCallback((nextMode) => {
    setPanelMode(String(nextMode || '') === 'right' ? 'right' : 'both');
  }, []);

  const resetDraftChanges = useCallback(() => {
    if (!isDirty) return;
    applyDraftChange(initialIndexes);
    setLeftSelected([]);
    setRightSelected([]);
    leftSelectionAnchorRef.current = null;
    rightSelectionAnchorRef.current = null;
  }, [applyDraftChange, initialIndexes, isDirty]);

  const openLightbox = useCallback((originalIndex, side, event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!itemByIndex.has(originalIndex)) return;
    const normalizedSide = side === 'right' ? 'right' : 'left';
    const sourceIndexes = normalizedSide === 'right'
      ? draftIndexes
      : (hideIncludedLeftPages ? availableLeftIndexes : naturalIndexes);
    const indexes = sourceIndexes.filter((index) => itemByIndex.has(index));
    setLightboxState({ index: originalIndex, indexes, side: normalizedSide });
  }, [availableLeftIndexes, draftIndexes, hideIncludedLeftPages, itemByIndex, naturalIndexes]);

  const openPanelLightbox = useCallback((side, event) => {
    const normalizedSide = side === 'right' ? 'right' : 'left';
    const indexes = normalizedSide === 'right' ? draftIndexes : leftSourceIndexes;
    const firstIndex = indexes.find((index) => itemByIndex.has(index));
    if (firstIndex == null) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      return;
    }
    openLightbox(firstIndex, normalizedSide, event);
  }, [draftIndexes, itemByIndex, leftSourceIndexes, openLightbox]);

  const closeLightbox = useCallback(() => {
    setLightboxState(null);
  }, []);

  const stepLightbox = useCallback((delta) => {
    setLightboxState((current) => {
      if (!current) return current;
      const indexes = Array.isArray(current.indexes) && current.indexes.length > 0 ? current.indexes : naturalIndexes;
      const currentPosition = indexes.indexOf(current.index);
      const fallbackPosition = 0;
      const nextPosition = Math.max(
        0,
        Math.min(indexes.length - 1, (currentPosition < 0 ? fallbackPosition : currentPosition) + delta)
      );
      return { ...current, index: indexes[nextPosition] ?? current.index };
    });
  }, [naturalIndexes]);

  useEffect(() => {
    setLightboxState((current) => {
      if (!current) return current;
      const sourceIndexes = current.side === 'right'
        ? draftIndexes
        : (hideIncludedLeftPages ? availableLeftIndexes : naturalIndexes);
      const indexes = sourceIndexes.filter((index) => itemByIndex.has(index));
      if (indexes.length <= 0) return null;
      if (sequencesEqual(indexes, current.indexes || []) && indexes.includes(current.index)) return current;
      const previousPosition = Math.max(0, (current.indexes || []).indexOf(current.index));
      const nextIndex = indexes.includes(current.index)
        ? current.index
        : indexes[Math.min(previousPosition, indexes.length - 1)];
      return { ...current, index: nextIndex, indexes };
    });
  }, [availableLeftIndexes, draftIndexes, hideIncludedLeftPages, itemByIndex, naturalIndexes]);

  useEffect(() => {
    if (!lightboxItem) return undefined;

    /** @param {KeyboardEvent} event */
    const handleKeyDown = (event) => {
      const key = String(event?.key || '');
      if (key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeLightbox();
        return;
      }
      if (key === 'ArrowLeft') {
        event.preventDefault();
        event.stopPropagation();
        stepLightbox(-1);
        return;
      }
      if (key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        stepLightbox(1);
        return;
      }
      if (key === ' ' || key === 'Spacebar' || event.code === 'Space') {
        if (!runLightboxPrimaryAction()) return;
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [closeLightbox, lightboxItem, runLightboxPrimaryAction, stepLightbox]);

  useEffect(() => {
    /** @param {KeyboardEvent} event */
    const handleKeyDown = (event) => {
      if (String(event?.key || '') !== 'Escape') return;
      if (lightboxItem) return;
      event.preventDefault();
      event.stopPropagation();
      leaveWorkspace();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [leaveWorkspace, lightboxItem]);

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
    const draggingSource = dragState?.side === side && dragState.indexes.includes(originalIndex);
    const warningLevel = side === 'right' ? draftWarningMap.get(originalIndex) || '' : '';
    const contextPageNumber = side === 'right' && orderIndex >= 0 ? orderIndex + 1 : item.pageNumber;
    const documentPageNumber = getDocumentPageNumber(item);
    const documentPageCount = getDocumentPageCount(item);
    const documentFraction = formatMetricFraction(item.documentNumber, item.totalDocuments);
    const documentPageFraction = formatMetricFraction(documentPageNumber, documentPageCount);
    const baseTitle = side === 'left' && included
      ? t('printSelectionWorkspace.alreadyIncluded', { page: item.pageNumber, defaultValue: `Page ${item.pageNumber} is already included in the print selection.` })
      : side === 'right'
        ? t('printSelectionWorkspace.printPageTitle', {
            printPage: contextPageNumber,
            sourcePage: item.pageNumber,
            document: item.documentNumber,
            documentPage: documentPageNumber,
            defaultValue: `Print page ${contextPageNumber}. Source page ${item.pageNumber}, document ${item.documentNumber}, document page ${documentPageNumber}.`,
          })
        : t('printSelectionWorkspace.sourcePageTitle', {
            page: item.pageNumber,
            document: item.documentNumber,
            documentPage: documentPageNumber,
            defaultValue: `Source page ${item.pageNumber}. Document ${item.documentNumber}, document page ${documentPageNumber}.`,
          });
    const warningTitle = warningLevel === 'page-order'
        ? t('printSelectionWorkspace.pageOrderWarning', {
            defaultValue: 'This page is out of the original order within its document.',
          })
        : '';
    const title = warningTitle ? `${baseTitle} ${warningTitle}` : baseTitle;
    const metricBadges = [
      {
        key: 'context-page',
        position: 'top-left',
        prefix: '',
        value: formatMetricValue(contextPageNumber),
        title: side === 'right'
          ? t('printSelectionWorkspace.printOrderBadgeTitle', {
              page: contextPageNumber,
              defaultValue: `Print page ${contextPageNumber} in the draft output`,
            })
          : t('thumbnails.metrics.totalPageBadgeTitle', {
              defaultValue: 'Visible page number in the current selection',
          }),
      },
      {
        key: 'document-page-source',
        position: 'bottom-left',
        prefix: '',
        value: `${formatMetricValue(item.documentNumber)}-${formatMetricValue(documentPageNumber)}`,
        title: `${t('thumbnails.metrics.documentBadgeTitle', {
          defaultValue: 'Document number in current session',
        })} ${documentFraction}. ${t('thumbnails.metrics.documentPageBadgeTitle', {
          defaultValue: 'Page number within the current document',
        })} ${documentPageFraction}.`,
      },
    ];
    const activateTile = (event) => {
      if (side === 'left') selectLeft(originalIndex, event);
      else selectRight(originalIndex, event);
    };
    const handleTilePointerDown = (event) => {
      if (event.button !== 0) return;
      if (event.target?.closest?.('.print-selection-tile-preview')) return;
      activateTile(event);
    };
    const handleTileClick = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const handleTileKeyDown = (event) => {
      if (isModifierOnlyKey(event)) {
        event.stopPropagation();
        return;
      }
      if (!isActivationKey(event)) return;
      activateTile(event);
    };
    const handleTileDoubleClick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (side === 'left') addIndexes([originalIndex]);
      else removeIndexes([originalIndex]);
    };

    const tile = (
      <div
        key={`${side}-${originalIndex}`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        data-selection-page={originalIndex}
        data-print-order-index={side === 'right' ? orderIndex : undefined}
        className={[
          'print-selection-tile',
          selected ? 'is-selected' : '',
          disabled ? 'is-included' : '',
          draggingSource ? 'is-dragging-source' : '',
          pulsing ? 'is-pulsing' : '',
          warningLevel === 'page-order' ? 'has-order-warning' : '',
        ].filter(Boolean).join(' ')}
        style={{ '--print-selection-thumb-size': `${thumbSize}px` }}
        title={title}
        aria-pressed={selected}
        aria-disabled={disabled}
        draggable={!disabled}
        onPointerDown={handleTilePointerDown}
        onClick={handleTileClick}
        onDoubleClick={handleTileDoubleClick}
        onDragStart={(event) => startDrag(side, originalIndex, event)}
        onDragEnd={clearDrag}
        onKeyDown={handleTileKeyDown}
      >
        <span className="print-selection-tile-stage">
          {metricBadges.map((metric) => (
            <span
              key={metric.key}
              className={`print-selection-metric-badge metric-${metric.key} position-${metric.position}`}
              title={metric.title}
            >
              {metric.prefix ? <span className="print-selection-metric-badge-prefix">{metric.prefix}</span> : null}
              <span className="print-selection-metric-badge-value">{metric.value}</span>
            </span>
          ))}
          <img src={item.imageUrl} alt="" draggable={false} />
          {item.loading ? (
            <span className="print-selection-loading" aria-hidden="true">
              <span className="material-icons">hourglass_empty</span>
            </span>
          ) : null}
          <button
            type="button"
            className="print-selection-tile-preview"
            onClick={(event) => openLightbox(originalIndex, side, event)}
            title={t('printSelectionWorkspace.previewPage', { defaultValue: 'Show page' })}
            aria-label={t('printSelectionWorkspace.previewPage', { defaultValue: 'Show page' })}
          >
            <span className="material-icons" aria-hidden="true">visibility</span>
          </button>
          {disabled ? (
            <span className="print-selection-included-overlay" aria-hidden="true">
              <span className="material-icons">done</span>
            </span>
          ) : null}
        </span>
      </div>
    );

    return tile;
  }, [
    addIndexes,
    clearDrag,
    dragState,
    draftSet,
    draftWarningMap,
    leftSelectedSet,
    openLightbox,
    pulseIndex,
    removeIndexes,
    rightSelectedSet,
    selectLeft,
    selectRight,
    startDrag,
    t,
    thumbSize,
  ]);

  const handleWorkspaceKeyDownCapture = useCallback((event) => {
    if (String(event?.key || '') === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      leaveWorkspace();
      return;
    }
    if (!isModifierOnlyKey(event)) return;
    event.stopPropagation();
  }, [leaveWorkspace]);

  const toolbarState = useMemo(() => ({
    workspaceMode,
    panelMode,
    selectedCount: draftIndexes.length,
    totalPages,
    thumbnailPercent,
    documentModeAvailable,
    canUndoDraftChange,
    canRedoDraftChange,
    canResetDraftChanges: isDirty,
    undoActionTitle,
    redoActionTitle,
    resetDraftChangesTitle,
    canSaveDraftChange: draftIndexes.length > 0 && isDirty,
    onWorkspaceModeChange: changeWorkspaceMode,
    onPanelModeChange: changePanelMode,
    onThumbnailSizeChange: setThumbnailSize,
    onUndoDraftChange: undoDraftChange,
    onRedoDraftChange: redoDraftChange,
    onResetDraftChanges: resetDraftChanges,
    onSaveDraftChange: saveDraft,
    onLeaveWorkspace: leaveWorkspace,
  }), [
    canRedoDraftChange,
    canUndoDraftChange,
    changeWorkspaceMode,
    changePanelMode,
    documentModeAvailable,
    draftIndexes.length,
    isDirty,
    leaveWorkspace,
    panelMode,
    redoActionTitle,
    redoDraftChange,
    resetDraftChanges,
    resetDraftChangesTitle,
    saveDraft,
    setThumbnailSize,
    thumbnailPercent,
    totalPages,
    undoActionTitle,
    undoDraftChange,
    workspaceMode,
  ]);

  useEffect(() => {
    onToolbarStateChange?.(toolbarState);
  }, [onToolbarStateChange, toolbarState]);

  useEffect(() => () => {
    onToolbarStateChange?.(null);
  }, [onToolbarStateChange]);

  return (
    <section
      className="print-selection-workspace"
      role="dialog"
      aria-modal="true"
      data-odv-shortcuts="off"
      aria-label={t('printSelectionWorkspace.title', { defaultValue: 'Print selection' })}
      onClick={(event) => event.stopPropagation()}
      onKeyDownCapture={handleWorkspaceKeyDownCapture}
    >
      <div
        ref={bodyRef}
        className={`print-selection-workspace-body ${panelModeClass}`}
        style={{
          '--print-selection-left-panel': `${leftPanelPercent}%`,
          '--print-selection-thumb-size': `${thumbSize}px`,
        }}
      >
        {visibleLeftPanel ? (
          <div
            className="print-selection-panel print-selection-panel-left"
            onDragOver={handleLeftDragOver}
            onDrop={dropOnLeft}
          >
            <div className="print-selection-panel-header">
              <div className="print-selection-panel-header-main">
                <div className="print-selection-panel-title-row">
                  <button
                    type="button"
                    className="print-selection-panel-preview-button"
                    onClick={(event) => openPanelLightbox('left', event)}
                    disabled={leftSourceIndexes.length <= 0}
                    title={leftSourceIndexes.length > 0
                      ? t('printSelectionWorkspace.previewAvailablePages', { defaultValue: 'Preview available pages from the first page' })
                      : t('printSelectionWorkspace.previewAvailablePagesDisabled', { defaultValue: 'There are no available pages to preview' })}
                    aria-label={leftSourceIndexes.length > 0
                      ? t('printSelectionWorkspace.previewAvailablePages', { defaultValue: 'Preview available pages from the first page' })
                      : t('printSelectionWorkspace.previewAvailablePagesDisabled', { defaultValue: 'There are no available pages to preview' })}
                  >
                    <span className="material-icons" aria-hidden="true">visibility</span>
                  </button>
                  <h3>{t('printSelectionWorkspace.availablePages', { defaultValue: 'Available pages' })}</h3>
                </div>
                <label className="print-selection-hide-included-toggle">
                  <input
                    type="checkbox"
                    checked={hideIncludedLeftPages}
                    onChange={(event) => setHideIncludedLeftPages(!!event.target.checked)}
                  />
                  <span>{t('printSelectionWorkspace.hideIncludedPages', { defaultValue: 'Hide added pages' })}</span>
                </label>
              </div>
              <span>{hideIncludedLeftPages
                ? t('printSelectionWorkspace.remainingCount', { count: availableLeftIndexes.length, defaultValue: `${availableLeftIndexes.length} remaining` })
                : t('printSelectionWorkspace.sourceCount', { count: leftSourceIndexes.length, defaultValue: `${leftSourceIndexes.length} pages` })}</span>
            </div>
            <div
              ref={leftPanelRef}
              className="print-selection-panel-scroll"
              onPointerDown={(event) => startMarqueeSelection('left', event)}
            >
              {workspaceModeIsDocuments ? (
                leftDocumentGroups.map((group) => (
                  <section key={group.key} className="print-selection-document-group">
                    <div
                      className="print-selection-document-header print-selection-document-header-draggable"
                      draggable
                      onPointerDown={(event) => selectDocument('left', group.key, event)}
                      onDoubleClick={(event) => addDocument(group.key, event)}
                      onDragStart={(event) => startDocumentDrag('left', group.key, event)}
                      onDragEnd={clearDrag}
                      title={t('printSelectionWorkspace.dragDocumentTitle', { defaultValue: 'Drag to move this document in the draft order.' })}
                    >
                      <span>{group.header}</span>
                    </div>
                    <div className="print-selection-grid">
                      {group.pages.map((item) => renderTile(item, 'left'))}
                    </div>
                  </section>
                ))
              ) : (
                <div className="print-selection-grid">
                  {leftSourceIndexes.map((originalIndex) => {
                    const item = itemByIndex.get(originalIndex);
                    return item ? renderTile(item, 'left') : null;
                  })}
                </div>
              )}
              {leftSourceIndexes.length <= 0 ? (
                <div className="print-selection-empty" role="status">
                  {t('printSelectionWorkspace.noAvailablePages', { defaultValue: 'No remaining source pages.' })}
                </div>
              ) : null}
              {selectionBox?.side === 'left' ? (
                <span
                  className="print-selection-marquee"
                  style={{
                    left: `${selectionBox.left}px`,
                    top: `${selectionBox.top}px`,
                    width: `${selectionBox.width}px`,
                    height: `${selectionBox.height}px`,
                  }}
                  aria-hidden="true"
                />
              ) : null}
            </div>
          </div>
        ) : null}

        {visibleLeftPanel && visibleRightPanel ? (
          <div className="print-selection-transfer-column" aria-label={t('printSelectionWorkspace.transferActions', { defaultValue: 'Transfer pages' })}>
          <button
            type="button"
            className="print-selection-resize-zone print-selection-resize-zone-top"
            onPointerDown={startPanelResize}
            aria-label={t('printSelectionWorkspace.resizeDivider', { defaultValue: 'Resize print selection panels' })}
            title={t('printSelectionWorkspace.resizeDivider', { defaultValue: 'Resize print selection panels' })}
          >
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </button>
          <div className="print-selection-transfer-buttons">
            <button
              type="button"
              onClick={(event) => runTransferCommand(event, removeAll)}
              onKeyDown={(event) => handleTransferCommandKeyDown(event, removeAll)}
              disabled={draftIndexes.length <= 0}
              title={t('printSelectionWorkspace.removeAll', { defaultValue: 'Remove all' })}
              aria-label={t('printSelectionWorkspace.removeAll', { defaultValue: 'Remove all' })}
            >
              <span className="material-icons" aria-hidden="true">keyboard_double_arrow_left</span>
            </button>
            <button
              type="button"
              onClick={(event) => runTransferCommand(event, removeSelected)}
              onKeyDown={(event) => handleTransferCommandKeyDown(event, removeSelected)}
              disabled={rightSelected.length <= 0}
              title={t('printSelectionWorkspace.removeSelected', { defaultValue: 'Remove selected' })}
              aria-label={t('printSelectionWorkspace.removeSelected', { defaultValue: 'Remove selected' })}
            >
              <span className="material-icons" aria-hidden="true">chevron_left</span>
            </button>
            <button
              type="button"
              onClick={(event) => runTransferCommand(event, addSelected)}
              onKeyDown={(event) => handleTransferCommandKeyDown(event, addSelected)}
              disabled={leftSelected.length <= 0}
              title={t('printSelectionWorkspace.addSelected', { defaultValue: 'Add selected' })}
              aria-label={t('printSelectionWorkspace.addSelected', { defaultValue: 'Add selected' })}
            >
              <span className="material-icons" aria-hidden="true">chevron_right</span>
            </button>
            <button
              type="button"
              onClick={(event) => runTransferCommand(event, addAll)}
              onKeyDown={(event) => handleTransferCommandKeyDown(event, addAll)}
              disabled={availableLeftIndexes.length <= 0}
              title={t('printSelectionWorkspace.addAll', { defaultValue: 'Add all' })}
              aria-label={t('printSelectionWorkspace.addAll', { defaultValue: 'Add all' })}
            >
              <span className="material-icons" aria-hidden="true">keyboard_double_arrow_right</span>
            </button>
          </div>
          <button
            type="button"
            className="print-selection-resize-zone print-selection-resize-zone-bottom"
            onPointerDown={startPanelResize}
            aria-label={t('printSelectionWorkspace.resizeDivider', { defaultValue: 'Resize print selection panels' })}
            title={t('printSelectionWorkspace.resizeDivider', { defaultValue: 'Resize print selection panels' })}
          >
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </button>
          </div>
        ) : null}

        {visibleRightPanel ? (
          <div className="print-selection-panel print-selection-panel-right">
            <div className="print-selection-panel-header">
              <div className="print-selection-panel-title-row">
                <button
                  type="button"
                  className="print-selection-panel-preview-button"
                  onClick={(event) => openPanelLightbox('right', event)}
                  disabled={draftIndexes.length <= 0}
                  title={draftIndexes.length > 0
                    ? t('printSelectionWorkspace.previewSelectedPages', { defaultValue: 'Preview selected pages from the first page' })
                    : t('printSelectionWorkspace.previewSelectedPagesDisabled', { defaultValue: 'There are no selected pages to preview' })}
                  aria-label={draftIndexes.length > 0
                    ? t('printSelectionWorkspace.previewSelectedPages', { defaultValue: 'Preview selected pages from the first page' })
                    : t('printSelectionWorkspace.previewSelectedPagesDisabled', { defaultValue: 'There are no selected pages to preview' })}
                >
                  <span className="material-icons" aria-hidden="true">visibility</span>
                </button>
                <h3>{t('printSelectionWorkspace.selectedPages', { defaultValue: 'Selected pages' })}</h3>
              </div>
              <span>{t('printSelectionWorkspace.selectedCount', { count: draftIndexes.length, defaultValue: `${draftIndexes.length} selected` })}</span>
            </div>
            <div
              ref={rightPanelRef}
              className="print-selection-panel-scroll"
              onPointerDown={(event) => startMarqueeSelection('right', event)}
              onDragOver={handleRightDragOver}
              onDrop={handleRightDrop}
            >
              {workspaceModeIsDocuments ? (
                draftDocumentGroups.map((group) => (
                  <section
                    key={group.blockKey}
                    className="print-selection-document-group print-selection-document-group-right"
                    data-document-key={group.key}
                  >
                    <div
                      className="print-selection-document-header print-selection-document-header-draggable"
                      draggable
                      onPointerDown={(event) => selectDocument('right', group.key, event)}
                      onDoubleClick={(event) => removeDocument(group.key, event)}
                      onDragStart={(event) => startDocumentDrag('right', group.key, event)}
                      onDragEnd={clearDrag}
                      title={t('printSelectionWorkspace.dragDocumentTitle', { defaultValue: 'Drag to move this document in the draft order.' })}
                    >
                      <span>{group.header}</span>
                      <span>{t('printSelectionWorkspace.documentPageCount', { count: group.pages.length, defaultValue: `${group.pages.length} pages` })}</span>
                    </div>
                    <div className="print-selection-grid">
                      {group.pages.map(({ item, orderIndex }) => renderTile(item, 'right', orderIndex))}
                    </div>
                  </section>
                ))
              ) : (
                <div ref={rightGridRef} className="print-selection-grid">
                  {draftIndexes.map((originalIndex, orderIndex) => {
                    const item = itemByIndex.get(originalIndex);
                    return item ? renderTile(item, 'right', orderIndex) : null;
                  })}
                </div>
              )}
              {rightDropIntent?.markerStyle ? (
                <span
                  className={`print-selection-drop-marker ${rightDropIntent.type === 'document' || rightDropIntent.type === 'document-add' ? 'is-document-marker' : ''}`}
                  style={rightDropIntent.markerStyle}
                  aria-hidden="true"
                />
              ) : null}
              {selectionBox?.side === 'right' ? (
                <span
                  className="print-selection-marquee"
                  style={{
                    left: `${selectionBox.left}px`,
                    top: `${selectionBox.top}px`,
                    width: `${selectionBox.width}px`,
                    height: `${selectionBox.height}px`,
                  }}
                  aria-hidden="true"
                />
              ) : null}
              {draftIndexes.length <= 0 ? (
                <div className="print-selection-empty" role="status">
                  {t('printSelectionWorkspace.emptySelection', { defaultValue: 'No pages are selected for printing.' })}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {lightboxItem ? (
        <div className={`print-selection-lightbox ${lightboxSelectionStatusClass}`} role="dialog" aria-modal="true" aria-label={t('printSelectionWorkspace.previewDialog', { defaultValue: 'Page preview' })}>
          <div className="print-selection-lightbox-info">
            {lightboxInfoText || t('printSelectionWorkspace.previewContext', {
              page: lightboxItem.pageNumber,
              total: totalPages,
              document: lightboxItem.documentNumber,
              documentPage: getDocumentPageNumber(lightboxItem),
              defaultValue: `Page ${lightboxItem.pageNumber} of ${totalPages}. Document ${lightboxItem.documentNumber}, document page ${getDocumentPageNumber(lightboxItem)}.`,
            })}
          </div>
          <div className="print-selection-lightbox-actions" aria-label={t('printSelectionWorkspace.previewActions', { defaultValue: 'Preview actions' })}>
            {showLightboxAdd ? (
              <button
                type="button"
                className={`print-selection-lightbox-action print-selection-lightbox-add-action ${lightboxCanAdd ? 'is-active' : ''}`}
                onClick={addLightboxPage}
                disabled={!lightboxCanAdd}
                title={lightboxCanAdd
                  ? t('printSelectionWorkspace.previewAddPage', { defaultValue: 'Add this page to the selection' })
                  : t('printSelectionWorkspace.previewPageAlreadyAdded', { defaultValue: 'This page is already in the selection' })}
                aria-label={lightboxCanAdd
                  ? t('printSelectionWorkspace.previewAddPage', { defaultValue: 'Add this page to the selection' })
                  : t('printSelectionWorkspace.previewPageAlreadyAdded', { defaultValue: 'This page is already in the selection' })}
              >
                <span className="material-icons" aria-hidden="true">add</span>
              </button>
            ) : null}
            {showLightboxRemove ? (
              <button
                type="button"
                className={`print-selection-lightbox-action print-selection-lightbox-remove-action ${lightboxCanRemove ? 'is-active' : ''}`}
                onClick={removeLightboxPage}
                disabled={!lightboxCanRemove}
                title={lightboxCanRemove
                  ? t('printSelectionWorkspace.previewRemovePage', { defaultValue: 'Remove this page from the selection' })
                  : t('printSelectionWorkspace.previewPageNotAdded', { defaultValue: 'This page is not in the selection' })}
                aria-label={lightboxCanRemove
                  ? t('printSelectionWorkspace.previewRemovePage', { defaultValue: 'Remove this page from the selection' })
                  : t('printSelectionWorkspace.previewPageNotAdded', { defaultValue: 'This page is not in the selection' })}
              >
                <span className="material-icons" aria-hidden="true">remove</span>
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="print-selection-lightbox-close"
            onClick={closeLightbox}
            title={t('common.close', { defaultValue: 'Close' })}
            aria-label={t('common.close', { defaultValue: 'Close' })}
          >
            <span className="material-icons" aria-hidden="true">close</span>
          </button>
          <div className="print-selection-lightbox-body">
            <button
              type="button"
              className="print-selection-lightbox-step"
              onClick={() => stepLightbox(-1)}
              disabled={lightboxPosition <= 0}
              title={t('common.previous', { defaultValue: 'Previous' })}
              aria-label={t('common.previous', { defaultValue: 'Previous' })}
            >
              <span className="material-icons" aria-hidden="true">chevron_left</span>
            </button>
            <div className="print-selection-lightbox-image">
              <div className={`print-selection-lightbox-page ${lightboxSelectionStatusClass}`}>
                <img src={lightboxItem.imageUrl} alt={t('viewer.pageAlt', { page: lightboxItem.pageNumber, defaultValue: `Page ${lightboxItem.pageNumber}` })} />
              </div>
            </div>
            <button
              type="button"
              className="print-selection-lightbox-step"
              onClick={() => stepLightbox(1)}
              disabled={lightboxPosition < 0 || lightboxPosition >= lightboxIndexes.length - 1}
              title={t('common.next', { defaultValue: 'Next' })}
              aria-label={t('common.next', { defaultValue: 'Next' })}
            >
              <span className="material-icons" aria-hidden="true">chevron_right</span>
            </button>
          </div>
        </div>
      ) : null}
      {leavePromptOpen ? (
        <div className="print-selection-unsaved-overlay" role="presentation">
          <div
            className="print-selection-unsaved-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="print-selection-unsaved-title"
          >
            <h2 id="print-selection-unsaved-title">
              {t('printSelectionWorkspace.unsavedChangesTitle', { defaultValue: 'Unsaved changes' })}
            </h2>
            <p>{t('printSelectionWorkspace.unsavedChangesBody', {
              defaultValue: 'You have unsaved selection changes. Do you want to save them before leaving edit mode?',
            })}</p>
            <div className="print-selection-unsaved-actions">
              <button
                type="button"
                className="print-selection-primary print-selection-save-action"
                onClick={saveAndLeaveWorkspace}
                disabled={draftIndexes.length <= 0}
              >
                {t('printSelectionWorkspace.saveChanges', { defaultValue: 'Save changes' })}
              </button>
              <button
                type="button"
                className="print-selection-secondary"
                onClick={discardAndLeaveWorkspace}
              >
                {t('printSelectionWorkspace.discardChanges', { defaultValue: 'Discard changes' })}
              </button>
              <button
                type="button"
                className="print-selection-secondary"
                onClick={continueEditingWorkspace}
              >
                {t('printSelectionWorkspace.continueEditing', { defaultValue: 'Continue editing' })}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};

PrintSelectionWorkspace.propTypes = {
  allPages: PropTypes.arrayOf(PropTypes.object).isRequired,
  bundle: PropTypes.object,
  initialSequence: PropTypes.arrayOf(PropTypes.number).isRequired,
  documentHeaderTemplate: PropTypes.oneOfType([PropTypes.string, PropTypes.object]).isRequired,
  previewInfoTemplate: PropTypes.oneOfType([PropTypes.string, PropTypes.object]).isRequired,
  zoomPercent: PropTypes.number,
  onToolbarStateChange: PropTypes.func,
  onSave: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};

export default React.memo(PrintSelectionWorkspace);
