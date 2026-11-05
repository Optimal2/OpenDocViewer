// File: src/utils/standardManual.js

import DOMPurify from 'dompurify';
import {
  standardManualOcrSectionRules,
  standardManualSectionRules,
  resolveStandardManualRuleStates,
} from './standardManualRules.js';

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';
const NUMBERED_PREFIX_PATTERN = /^(\s*)\d+\.(\s+)/;
const COMPARE_PRINT_HEADING_IDS = new Set(['utskrift', 'print', 'jmf-utskrift', 'jmf-print']);

/**
 * @param {*} html
 * @returns {string}
 */
function sanitizeManualHtml(html) {
  return DOMPurify.sanitize(String(html || ''), {
    ALLOW_UNKNOWN_PROTOCOLS: false,
    ADD_ATTR: ['target'],
    FORBID_ATTR: ['srcdoc'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  });
}

/**
 * @param {Element} heading
 * @returns {number}
 */
function headingLevel(heading) {
  return Number(String(heading.tagName || '').charAt(1)) || 6;
}

/**
 * The embedded guide is a hard boundary. Without it, removing the last heading of
 * one guide could also consume the following guide or the main manual's tail.
 *
 * @param {Element} heading
 * @param {HTMLElement} body
 * @returns {Element|HTMLElement}
 */
function guideContainerFor(heading, body) {
  return heading.closest('details.embedded') || heading.closest('.odv-manual') || body;
}

/**
 * @param {Element} heading
 * @param {HTMLElement} body
 * @returns {{container: Element|HTMLElement, boundary: Element|null}}
 */
function findHeadingSegment(heading, body) {
  const container = guideContainerFor(heading, body);
  const level = headingLevel(heading);
  const headings = Array.from(container.querySelectorAll(HEADING_SELECTOR)).filter(
    (candidate) => guideContainerFor(candidate, body) === container,
  );
  const ownIndex = headings.indexOf(heading);
  const boundary = headings.slice(ownIndex + 1).find((candidate) => headingLevel(candidate) <= level) || null;
  return { container, boundary };
}

/**
 * @param {Element} heading
 * @param {{container: Element|HTMLElement, boundary: Element|null}} segment
 * @param {boolean} includeHeading
 * @returns {Range}
 */
function headingSegmentRange(heading, segment, includeHeading = true) {
  const doc = heading.ownerDocument;
  const range = doc.createRange();
  if (includeHeading) range.setStartBefore(heading);
  else range.setStartAfter(heading);
  if (segment.boundary) range.setEndBefore(segment.boundary);
  else range.setEndAfter(segment.container.lastChild || heading);
  return range;
}

/**
 * Decode a same-document fragment. Cross-document links and the intentionally
 * target-less lightbox-close fragment are not treated as removed-target links.
 *
 * @param {HTMLAnchorElement} anchor
 * @returns {string|null}
 */
function localFragmentId(anchor) {
  const href = String(anchor.getAttribute('href') || '').trim();
  if (!href.startsWith('#') || href.length === 1) return null;
  try {
    return decodeURIComponent(href.slice(1));
  } catch {
    return null;
  }
}

/**
 * Remember ids and lightbox references before a subtree leaves the document.
 *
 * @param {DocumentFragment|Element} root
 * @param {Set<string>} removedIds
 * @param {Set<string>} lightboxCandidates
 */
function recordRemovedSubtree(root, removedIds, lightboxCandidates) {
  const descendants = Array.from(root.querySelectorAll?.('*') || []);
  const elements = root.nodeType === 1 ? [root, ...descendants] : descendants;
  for (const element of elements) {
    if (element.id) removedIds.add(element.id);
    if (String(element.tagName).toUpperCase() === 'A') {
      const fragment = localFragmentId(element);
      if (fragment) lightboxCandidates.add(fragment);
    }
  }
}

/**
 * @param {Element} heading
 * @param {HTMLElement} body
 * @param {Set<string>} removedIds
 * @param {Set<string>} lightboxCandidates
 */
function removeHeadingSegment(heading, body, removedIds, lightboxCandidates) {
  const segment = findHeadingSegment(heading, body);
  const fragment = headingSegmentRange(heading, segment).extractContents();
  recordRemovedSubtree(fragment, removedIds, lightboxCandidates);
}

/**
 * @param {string} id
 * @param {Array<string>} ruleIds
 * @returns {boolean}
 */
function matchesOcrRule(id, ruleIds) {
  const normalized = String(id || '').toLowerCase();
  return ruleIds.some((ruleId) => normalized === ruleId || normalized.endsWith(`-${ruleId}`));
}

/**
 * Apply exact-id and OCR heading rules to a parsed manual.
 *
 * @param {Document} doc
 * @param {Readonly<Record<string, boolean>>} states
 * @param {Set<string>} removedIds
 * @param {Set<string>} lightboxCandidates
 */
function filterHeadingRules(doc, states, removedIds, lightboxCandidates) {
  const body = doc.body;
  for (const rule of standardManualSectionRules) {
    if (rule.state !== 'never' && states[rule.state]) continue;
    const ids = new Set(rule.ids);
    const headings = Array.from(body.querySelectorAll(HEADING_SELECTOR));
    for (const heading of headings) {
      if (heading.isConnected && ids.has(heading.id)) {
        removeHeadingSegment(heading, body, removedIds, lightboxCandidates);
      }
    }
  }

  for (const rule of standardManualOcrSectionRules) {
    if (states[rule.state]) continue;
    const headings = Array.from(body.querySelectorAll(HEADING_SELECTOR));
    for (const heading of headings) {
      if (heading.isConnected && matchesOcrRule(heading.id, rule.ids)) {
        removeHeadingSegment(heading, body, removedIds, lightboxCandidates);
      }
    }
  }
}

/**
 * @param {Element} element
 * @param {Range} range
 * @returns {boolean}
 */
function isInsideRange(element, range) {
  try {
    return range.intersectsNode(element);
  } catch {
    return false;
  }
}

/**
 * @param {Element} paragraph
 * @returns {string}
 */
function normalizedText(paragraph) {
  return String(paragraph.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * @param {Element} paragraph
 * @returns {string}
 */
function leadingStrongText(paragraph) {
  return normalizedText(paragraph.querySelector('strong') || paragraph.ownerDocument.createElement('span'));
}

/**
 * Remove only the composed-print blocks disabled by site switches. The ordinary
 * side-by-side print instructions remain. No replacement wording is authored:
 * the numeric "three ways" introduction and shared composed-print details are
 * simply omitted when they no longer apply.
 *
 * @param {Document} doc
 * @param {Readonly<Record<string, boolean>>} states
 * @param {Set<string>} removedIds
 * @param {Set<string>} lightboxCandidates
 */
function filterComparePrintBlocks(doc, states, removedIds, lightboxCandidates) {
  const headings = Array.from(doc.body.querySelectorAll('h2')).filter(
    (heading) => COMPARE_PRINT_HEADING_IDS.has(heading.id),
  );
  for (const heading of headings) {
    const segment = findHeadingSegment(heading, doc.body);
    const range = headingSegmentRange(heading, segment, false);
    const elements = Array.from(segment.container.querySelectorAll('p, figure, ul'))
      .filter((element) => isInsideRange(element, range));
    const removals = new Set();

    for (const element of elements) {
      if (String(element.tagName).toUpperCase() === 'FIGURE') {
        const fragments = Array.from(element.querySelectorAll('a[href]')).map(localFragmentId);
        if (fragments.includes('lb-utskrift-overlagring') && !states.overlayPrint) removals.add(element);
        if (fragments.includes('lb-utskrift-gardin') && !states.curtainPrint) removals.add(element);
        continue;
      }
      if (String(element.tagName).toUpperCase() !== 'P') continue;

      const strong = leadingStrongText(element);
      const text = normalizedText(element);
      if (['skriv ut överlagringsvyn:', 'print the overlay view:'].includes(strong)) {
        if (!states.overlayPrint) removals.add(element);
      } else if (['skriv ut gardinvyn:', 'print the curtain view:'].includes(strong)) {
        if (!states.curtainPrint) removals.add(element);
      } else if (
        (text.startsWith('det finns tre sätt att få jämförelsen')
          || text.startsWith('there are three ways to get the comparison'))
        && (!states.overlayPrint || !states.curtainPrint)
      ) {
        removals.add(element);
      } else if (
        text.startsWith('när du skriver ut från en av de två vyerna')
        || text.startsWith('when you print from one of the two views')
      ) {
        if (!states.overlayPrint && !states.curtainPrint) {
          removals.add(element);
          const next = element.nextElementSibling;
          if (next && String(next.tagName).toUpperCase() === 'UL') removals.add(next);
        }
      } else if (
        (text.startsWith('knappen skriv ut i en vy visas')
          || text.startsWith('the print button in a view appears'))
        && !states.overlayPrint
        && !states.curtainPrint
      ) {
        removals.add(element);
      }
    }

    for (const element of removals) {
      if (!element.isConnected) continue;
      recordRemovedSubtree(element, removedIds, lightboxCandidates);
      element.remove();
    }
  }
}

/**
 * @param {Document} doc
 * @param {string} id
 * @param {Element} target
 * @returns {boolean}
 */
function hasRemainingFragmentLink(doc, id, target) {
  return Array.from(doc.querySelectorAll('a[href]')).some(
    (anchor) => !target.contains(anchor) && localFragmentId(anchor) === id,
  );
}

/**
 * Remove lightbox subtrees whose last thumbnail belonged to removed content.
 *
 * @param {Document} doc
 * @param {Set<string>} removedIds
 * @param {Set<string>} lightboxCandidates
 */
function pruneOrphanedLightboxes(doc, removedIds, lightboxCandidates) {
  for (const id of lightboxCandidates) {
    const target = doc.getElementById(id);
    if (!target || !target.classList.contains('lb') || hasRemainingFragmentLink(doc, id, target)) continue;
    recordRemovedSubtree(target, removedIds, lightboxCandidates);
    target.remove();
  }
}

/**
 * Authored contents repeat a section's full title, so unlinking alone would leave hidden headings
 * searchable. Remove only entries that target content removed by this filter. Side navigation uses
 * one link per list item, making the wrapper item part of that entry; ordinary prose links are not
 * handled here and retain their text through unlinkRemovedTargets instead.
 *
 * @param {Document} doc
 * @param {Set<string>} removedIds
 */
function removeAuthoredNavigationEntries(doc, removedIds) {
  for (const nav of Array.from(doc.querySelectorAll('nav.sidonav, nav.toc'))) {
    for (const anchor of Array.from(nav.querySelectorAll('a[href]'))) {
      const id = localFragmentId(anchor);
      if (!id || !removedIds.has(id) || doc.getElementById(id)) continue;
      const item = anchor.closest('li');
      if (item && nav.contains(item)) item.remove();
      else anchor.remove();
    }
  }
}

/**
 * Preserve link text and inline markup while removing only links to ids that this
 * filter actually removed. Existing target-less fragments (notably #lb-stang)
 * retain their script-free lightbox behavior.
 *
 * @param {Document} doc
 * @param {Set<string>} removedIds
 */
function unlinkRemovedTargets(doc, removedIds) {
  for (const anchor of Array.from(doc.querySelectorAll('a[href]'))) {
    const id = localFragmentId(anchor);
    if (!id || !removedIds.has(id) || doc.getElementById(id)) continue;
    anchor.replaceWith(...Array.from(anchor.childNodes));
  }
}

/**
 * @param {Element} root
 * @returns {Text|null}
 */
function firstNumberedTextNode(root) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4);
  let node = walker.nextNode();
  while (node) {
    if (NUMBERED_PREFIX_PATTERN.test(node.nodeValue || '')) return node;
    node = walker.nextNode();
  }
  return null;
}

/**
 * @param {Element} root
 * @param {number} number
 */
function replaceNumberPrefix(root, number) {
  const node = firstNumberedTextNode(root);
  if (!node) return;
  node.nodeValue = node.nodeValue.replace(NUMBERED_PREFIX_PATTERN, `$1${number}.$2`);
}

/**
 * Renumber visible h2 prefixes per guide and mirror those numbers into contents
 * and cross-links. Guides without authored numeric prefixes stay unnumbered.
 *
 * @param {Document} doc
 */
function renumberVisibleHeadings(doc) {
  const containers = [
    doc.body,
    ...Array.from(doc.body.querySelectorAll('.odv-manual, details.embedded')),
  ];
  const uniqueContainers = Array.from(new Set(containers));
  const headingNumbers = new Map();

  for (const container of uniqueContainers) {
    let number = 1;
    const headings = Array.from(container.querySelectorAll('h2')).filter(
      (heading) => guideContainerFor(heading, doc.body) === container,
    );
    for (const heading of headings) {
      if (!firstNumberedTextNode(heading)) continue;
      replaceNumberPrefix(heading, number);
      headingNumbers.set(heading, number);
      number += 1;
    }
  }

  for (const anchor of Array.from(doc.querySelectorAll('a[href]'))) {
    const id = localFragmentId(anchor);
    const target = id ? doc.getElementById(id) : null;
    if (target && headingNumbers.has(target)) replaceNumberPrefix(anchor, headingNumbers.get(target));
  }
}

/**
 * Filter and sanitize the bundled standard manual for a supplied runtime config.
 * The function reads no global configuration and mutates neither the config nor
 * the caller's string. It runs before the overlay builds contents, search or
 * lightbox behavior. Without a DOM parser it fails open and only sanitizes.
 *
 * @param {string} html
 * @param {Object} runtimeConfig
 * @returns {string} Filtered, sanitized HTML fragment with manual head styles retained.
 */
export function filterStandardManual(html, runtimeConfig) {
  if (typeof DOMParser === 'undefined') return sanitizeManualHtml(html);
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  if (!doc.body) return sanitizeManualHtml(html);

  const states = resolveStandardManualRuleStates(runtimeConfig);
  const removedIds = new Set();
  const lightboxCandidates = new Set();
  filterHeadingRules(doc, states, removedIds, lightboxCandidates);
  filterComparePrintBlocks(doc, states, removedIds, lightboxCandidates);
  pruneOrphanedLightboxes(doc, removedIds, lightboxCandidates);
  removeAuthoredNavigationEntries(doc, removedIds);
  unlinkRemovedTargets(doc, removedIds);
  renumberVisibleHeadings(doc);

  const headMarkup = doc.head
    ? Array.from(doc.head.querySelectorAll('style, link[rel="stylesheet"]'))
      .map((node) => node.outerHTML)
      .join('')
    : '';
  const bodyMarkup = doc.body.innerHTML;
  return sanitizeManualHtml(`${headMarkup}${bodyMarkup}`);
}
