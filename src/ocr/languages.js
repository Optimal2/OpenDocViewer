// File: src/ocr/languages.js
/**
 * Membership check for OCR language codes against the models tesseract.js knows.
 *
 * runtimeConfig.getOcrLanguages only checks the form of a code (it must stay free of the engine
 * so the default code path carries no OCR weight). This module, part of the lazy OCR chunk, checks
 * that each code names a Tesseract model, so a typo such as `sve` is reported and dropped before
 * the worker tries to download a model that does not exist.
 */
import Tesseract from 'tesseract.js/dist/tesseract.esm.min.js';

/** Every language code tesseract.js lists a model for (lower-case, e.g. `swe`, `chi_sim`). */
export const KNOWN_OCR_LANGUAGES = Object.freeze(new Set(Object.values(Tesseract.languages || {})));

/**
 * Split codes into those tesseract.js knows a model for and the rest. Order is kept.
 *
 * @param {Array<string>} codes
 * @returns {{ known: Array<string>, unknown: Array<string> }}
 */
export function partitionOcrLanguages(codes) {
  const known = [];
  const unknown = [];
  for (const code of Array.isArray(codes) ? codes : []) {
    (KNOWN_OCR_LANGUAGES.has(code) ? known : unknown).push(code);
  }
  return { known, unknown };
}
