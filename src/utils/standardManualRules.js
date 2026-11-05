// File: src/utils/standardManualRules.js

import {
  isCompareCurtainEnabled,
  isCompareCurtainPrintEnabled,
  isCompareOverlayEnabled,
  isCompareOverlayPrintEnabled,
  getPrintSelectionWorkspaceConfig,
  isDocumentMetadataUiEnabled,
  isFineTuneEnabled,
  isOcrEnabled,
  isOcrSearchEnabled,
  isPdfSignatureInspectionEnabled,
  isReadAloudEnabled,
} from './runtimeConfig.js';

const MANUAL_LANGUAGES = Object.freeze(['sv', 'en']);

/**
 * @param {string} file
 * @param {string} id
 * @param {string} [guide]
 * @returns {Readonly<Object>} Frozen required-document descriptor.
 */
function requiredDocument(file, id, guide) {
  return Object.freeze({ file, id, ...(guide ? { guide } : {}) });
}

/**
 * Declare the actual authored aliases for one logical section. Standalone and embedded manuals do
 * not share one literal id: for example, Swedish uses `overlagring`/`jmf-overlagring`, while English
 * uses `overlay`/`jmf-overlay`. Every alias is therefore explicit data; neither the filter nor the
 * generator invents an id by adding a prefix or translating another language's id.
 *
 * @param {string} id Stable logical-rule id shared by both languages.
 * @param {string} state Runtime state consumed by the pure filter.
 * @param {string} guideName Standalone source guide basename.
 * @param {string} swedishStandalone Actual id in the standalone Swedish guide.
 * @param {string} swedishEmbedded Actual id in the Swedish combined manual.
 * @param {string} englishStandalone Actual id in the standalone English guide.
 * @param {string} englishEmbedded Actual id in the English combined manual.
 * @param {string} [embeddedGuideName] Actual combined-guide suffix when it differs from the filename.
 * @param {string} [behavior] Whole-heading removal or a named structural partial-section cleanup.
 * @returns {Readonly<Object>}
 */
function localizedGuideRule(
  id,
  state,
  guideName,
  swedishStandalone,
  swedishEmbedded,
  englishStandalone,
  englishEmbedded,
  embeddedGuideName = guideName,
  behavior = 'heading',
) {
  return Object.freeze({
    id,
    state,
    behavior,
    documents: Object.freeze({
      sv: Object.freeze([
        requiredDocument(`manual-${guideName}.sv.html`, swedishStandalone),
        requiredDocument('manual.sv.html', swedishEmbedded, `guide-${embeddedGuideName}`),
      ]),
      en: Object.freeze([
        requiredDocument(`manual-${guideName}.en.html`, englishStandalone),
        requiredDocument('manual.en.html', englishEmbedded, `guide-${embeddedGuideName}`),
      ]),
    }),
  });
}

/**
 * Generator-validated logical rules. Each language must cover the same standalone and embedded
 * documents, and every listed id must exist in that exact document (and embedded guide, when given).
 * Speculative OCR ids are deliberately absent: the current manuals contain no OCR heading section.
 */
export const standardManualLogicalRules = Object.freeze([
  localizedGuideRule('compare.calibration', 'fineTune', 'jamforelse',
    'kalibrera', 'jmf-kalibrera', 'calibrate', 'jmf-calibrate'),
  localizedGuideRule('compare.fineTune', 'fineTune', 'jamforelse',
    'finjustera', 'jmf-finjustera', 'finetune', 'jmf-finetune'),
  localizedGuideRule('compare.overlay', 'overlay', 'jamforelse',
    'overlagring', 'jmf-overlagring', 'overlay', 'jmf-overlay'),
  localizedGuideRule('compare.curtain', 'curtain', 'jamforelse',
    'gardin', 'jmf-gardin', 'curtain', 'jmf-curtain'),
  localizedGuideRule('compare.installationSwitches', 'never', 'jamforelse',
    'avstangt', 'jmf-avstangt', 'disabled', 'jmf-disabled'),
  localizedGuideRule('selection.open', 'selectionWorkspace', 'urval',
    'oppna', 'urval-oppna', 'open', 'urval-open'),
  localizedGuideRule('selection.add', 'selectionWorkspace', 'urval',
    'laggtill', 'urval-laggtill', 'add', 'urval-add'),
  localizedGuideRule('selection.order', 'selectionWorkspace', 'urval',
    'ordning', 'urval-ordning', 'order', 'urval-order'),
  localizedGuideRule('selection.preview', 'selectionWorkspace', 'urval',
    'forhandsvisa', 'urval-forhandsvisa', 'preview', 'urval-preview'),
  localizedGuideRule('selection.save', 'selectionWorkspace', 'urval',
    'spara', 'urval-spara', 'save', 'urval-save'),
  localizedGuideRule('selection.remove', 'selectionWorkspace', 'urval',
    'tabort', 'urval-tabort', 'remove', 'urval-remove', 'urval', 'selectionRemove'),
  localizedGuideRule('selection.active', 'selectionWorkspace', 'urval',
    'aktivt', 'urval-aktivt', 'active', 'urval-active', 'urval', 'selectionActive'),
  localizedGuideRule('selection.reset', 'selectionWorkspace', 'urval',
    'aterstall', 'urval-aterstall', 'reset', 'urval-reset', 'urval', 'selectionReset'),
  localizedGuideRule('advanced.metadata', 'metadata', 'avancerat',
    'metadata', 'fler-metadata', 'metadata', 'fler-metadata', 'fler'),
  localizedGuideRule('advanced.signatures', 'pdfSignatures', 'avancerat',
    'signaturer', 'fler-signaturer', 'signatures', 'fler-signatures', 'fler'),
]);

/**
 * Exact-id heading rules. Each state key is resolved by
 * {@link resolveStandardManualRuleStates}; `never` is unconditionally hidden.
 */
export const standardManualSectionRules = Object.freeze(
  ['fineTune', 'overlay', 'curtain', 'never', 'selectionWorkspace', 'metadata', 'pdfSignatures'].map((state) => (
    Object.freeze({
      state,
      ids: Object.freeze(standardManualLogicalRules
        .filter((rule) => rule.state === state && rule.behavior === 'heading')
        .flatMap((rule) => MANUAL_LANGUAGES.flatMap((language) => (
          rule.documents[language].map((document) => document.id)
        )))),
    })
  )),
);

/** Structural cleanup for selection sections that also contain ordinary Delete/printing help. */
export const standardManualSelectionPartialRules = Object.freeze(
  standardManualLogicalRules
    .filter((rule) => rule.state === 'selectionWorkspace' && rule.behavior !== 'heading')
    .map((rule) => Object.freeze({
      behavior: rule.behavior,
      ids: Object.freeze(MANUAL_LANGUAGES.flatMap((language) => (
        rule.documents[language].map((document) => document.id)
      ))),
    })),
);

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

/** A flat compatibility list of every real element id referenced by the logical manifest. */
export const standardManualRuleIds = Object.freeze([...new Set(
  standardManualLogicalRules.flatMap((rule) => MANUAL_LANGUAGES.flatMap((language) => (
    rule.documents[language].map((document) => document.id)
  ))),
)]);

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
    selectionWorkspace: failOpen(() => getPrintSelectionWorkspaceConfig(runtimeConfig).enabled),
    printHtml: failOpen(() => runtimeConfig?.print?.actions?.printHtml?.enabled !== false),
    printPdf: failOpen(() => runtimeConfig?.print?.pdf?.enabled === true
      && runtimeConfig?.print?.actions?.printPdf?.enabled !== false),
    reuseLastPrintSettings: failOpen(() => runtimeConfig?.print?.pdf?.enabled === true
      && runtimeConfig?.print?.actions?.printPdf?.enabled !== false
      && runtimeConfig?.print?.actions?.reuseLastPrintSettings?.enabled !== false),
    pdfOrientation: failOpen(() => runtimeConfig?.print?.pdf?.enabled === true
      && runtimeConfig?.print?.actions?.printPdf?.enabled !== false
      && runtimeConfig?.print?.pdf?.orientation?.enabled === true
      && runtimeConfig?.print?.pdf?.orientation?.showOption !== false),
    metadata: failOpen(() => isDocumentMetadataUiEnabled(runtimeConfig)),
    pdfSignatures: failOpen(() => isPdfSignatureInspectionEnabled(runtimeConfig)),
    ocrSearch: failOpen(() => isOcrEnabled(runtimeConfig) && isOcrSearchEnabled(runtimeConfig)),
    ocrSpeech: failOpen(() => isOcrEnabled(runtimeConfig) && isReadAloudEnabled(runtimeConfig)),
  });
}
