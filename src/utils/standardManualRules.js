// File: src/utils/standardManualRules.js

import {
  isCompareCurtainEnabled,
  isCompareCurtainPrintEnabled,
  isCompareOverlayEnabled,
  isCompareOverlayPrintEnabled,
  isFineTuneEnabled,
  isOcrEnabled,
  isOcrSearchEnabled,
  isReadAloudEnabled,
} from './runtimeConfig.js';

/**
 * Return the standalone and embedded-comparison forms of a Swedish/English id pair.
 * @param {string} swedish
 * @param {string} english
 * @returns {Array<string>}
 */
function compareGuideIds(swedish, english) {
  return [swedish, english, `jmf-${swedish}`, `jmf-${english}`];
}

/**
 * Exact-id heading rules. Each state key is resolved by
 * {@link resolveStandardManualRuleStates}; `never` is unconditionally hidden.
 */
export const standardManualSectionRules = Object.freeze([
  Object.freeze({
    state: 'fineTune',
    ids: Object.freeze([
      ...compareGuideIds('kalibrera', 'calibrate'),
      ...compareGuideIds('finjustera', 'finetune'),
    ]),
  }),
  Object.freeze({ state: 'overlay', ids: Object.freeze(compareGuideIds('overlagring', 'overlay')) }),
  Object.freeze({ state: 'curtain', ids: Object.freeze(compareGuideIds('gardin', 'curtain')) }),
  Object.freeze({ state: 'never', ids: Object.freeze(compareGuideIds('avstangt', 'disabled')) }),
]);

/**
 * OCR headings use the same id in standalone and embedded guides. The embedded
 * prefix is deliberately matched by the filter instead of being enumerated here:
 * the current manuals have no OCR sections yet, and a later guide prefix must not
 * silently make the switches ineffective.
 */
export const standardManualOcrSectionRules = Object.freeze([
  Object.freeze({
    state: 'ocrSearch',
    ids: Object.freeze(['ocr-sok', 'ocr-sokning', 'ocr-search']),
  }),
  Object.freeze({
    state: 'ocrSpeech',
    ids: Object.freeze(['ocr-upplasning', 'ocr-las-upp', 'ocr-read-aloud', 'ocr-speech']),
  }),
]);

/** A flat list of every exact element id in the generator-validated rule manifest. */
export const standardManualRuleIds = Object.freeze(
  standardManualSectionRules.flatMap((rule) => rule.ids),
);

/**
 * Read a UI predicate without letting a host-owned Proxy/getter hide manual content.
 * Malformed values are handled by the runtimeConfig accessors themselves; an actual
 * read failure fails open, like the other unreadable feature states.
 *
 * @param {function(): boolean} predicate
 * @returns {boolean}
 */
function failOpen(predicate) {
  try {
    return predicate();
  } catch {
    return true;
  }
}

/**
 * Resolve every site switch that can hide standard-manual content. Print help is
 * visible only when both the view and its print action are available, matching the
 * composed UI surface rather than the print accessor in isolation.
 *
 * @param {Object} runtimeConfig Supplied merged configuration; never read from globals or mutated.
 * @returns {Readonly<Record<string, boolean>>}
 */
export function resolveStandardManualRuleStates(runtimeConfig) {
  return Object.freeze({
    fineTune: failOpen(() => isFineTuneEnabled(runtimeConfig)),
    overlay: failOpen(() => isCompareOverlayEnabled(runtimeConfig)),
    curtain: failOpen(() => isCompareCurtainEnabled(runtimeConfig)),
    overlayPrint: failOpen(
      () => isCompareOverlayEnabled(runtimeConfig) && isCompareOverlayPrintEnabled(runtimeConfig),
    ),
    curtainPrint: failOpen(
      () => isCompareCurtainEnabled(runtimeConfig) && isCompareCurtainPrintEnabled(runtimeConfig),
    ),
    ocrSearch: failOpen(() => isOcrEnabled(runtimeConfig) && isOcrSearchEnabled(runtimeConfig)),
    ocrSpeech: failOpen(() => isOcrEnabled(runtimeConfig) && isReadAloudEnabled(runtimeConfig)),
  });
}
