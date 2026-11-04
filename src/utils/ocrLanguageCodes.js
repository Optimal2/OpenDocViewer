// File: src/utils/ocrLanguageCodes.js
/**
 * Tesseract language codes (`ocr.languages`) and the ISO 639-1 language each one reads: what
 * the read-aloud menu offers and the language guess chooses among. A table and a lookup only,
 * so the hook that wires the OCR queue can import it without pulling the speech module into
 * the start-up bundle.
 */

/** @type {Readonly<Object<string, string>>} */
export const OCR_TO_SPEECH_LANGUAGE = Object.freeze({
  swe: 'sv', eng: 'en', deu: 'de', dan: 'da', nor: 'nb', fin: 'fi', fra: 'fr', spa: 'es', nld: 'nl',
  ita: 'it', por: 'pt', pol: 'pl', ces: 'cs', hun: 'hu', ron: 'ro', tur: 'tr', rus: 'ru', ukr: 'uk',
  ell: 'el', est: 'et', lav: 'lv', lit: 'lt', isl: 'is', ara: 'ar', heb: 'he', jpn: 'ja', kor: 'ko',
  chi_sim: 'zh', chi_tra: 'zh',
});

/**
 * The ISO 639-1 languages of a list of Tesseract codes, each once, in order; codes without a
 * known language are left out.
 * @param {Array<string>} ocrCodes
 * @returns {Array<string>}
 */
export function speechLanguagesForOcr(ocrCodes) {
  const languages = [];
  for (const code of Array.isArray(ocrCodes) ? ocrCodes : []) {
    const language = OCR_TO_SPEECH_LANGUAGE[String(code || '').toLowerCase()];
    if (language && !languages.includes(language)) languages.push(language);
  }
  return languages;
}
