// File: src/ocr/__tests__/detectLanguage.test.js
/**
 * The language guess (src/ocr/detectLanguage.js): function words and distinctive letters pick
 * the language among the candidates, a short or ambiguous text gives no answer, candidates
 * without word lists are ignored, and only candidates can win.
 */
import { describe, expect, it } from 'vitest';
import { DETECTABLE_LANGUAGES, MIN_HITS, RUNNER_UP_RATIO, detectTextLanguage } from '../detectLanguage.js';

const words = (text) => text.split(/\s+/);
const SWEDISH = 'Tack för ert brev av den 14 oktober. Vi har gått igenom handlingarna och kan bekräfta att ärendet nu är registrerat hos oss med diarienummer 2026-4471.';
const ENGLISH = 'Thank you for your letter of 14 October. We have reviewed the documents and can confirm that the case is now registered with us under the reference number.';
const DANISH = 'Tak for jeres brev af den 14. oktober. Vi har gennemgået dokumenterne og kan bekræfte, at sagen nu er registreret hos os med journalnummer.';

describe('detectTextLanguage', () => {
  it('tells Swedish and English apart by their function words', () => {
    expect(detectTextLanguage(words(SWEDISH), ['sv', 'en']).language).toBe('sv');
    expect(detectTextLanguage(words(ENGLISH), ['sv', 'en']).language).toBe('en');
  });

  it('tells Swedish from its neighbours with its letters and distinctive words, and leaves Danish and Norwegian to tie', () => {
    expect(detectTextLanguage(words(SWEDISH), ['sv', 'da', 'nb']).language).toBe('sv');
    expect(detectTextLanguage(words(DANISH), ['sv', 'da', 'en']).language).toBe('da');
    // Danish and Norwegian share nearly all function words: with both as candidates a short
    // Danish text is unsure rather than guessed.
    expect(detectTextLanguage(words(DANISH), ['da', 'nb']).language).toBeNull();
  });

  it('is unsure on a short text, on numbers, and when the candidates tie', () => {
    expect(MIN_HITS).toBe(4);
    expect(RUNNER_UP_RATIO).toBe(1.5);
    expect(detectTextLanguage(words('Diarienummer 2026-4471'), ['sv', 'en']).language).toBeNull();
    expect(detectTextLanguage(words('12 34 56 78 90 11 22'), ['sv', 'en']).language).toBeNull();
    // "den" is Swedish and Danish alike: a tie decides nothing.
    expect(detectTextLanguage(words('den den den den den'), ['sv', 'da']).language).toBeNull();
    expect(detectTextLanguage([], ['sv', 'en']).language).toBeNull();
    expect(detectTextLanguage(null, null)).toEqual({ language: null, scores: {}, words: 0 });
  });

  it('chooses only among the candidates and ignores codes it has no words for', () => {
    // English text, but English is not a candidate: Swedish does not win it by default.
    const guess = detectTextLanguage(words(ENGLISH), ['sv', 'xx']);
    expect(guess.language).toBeNull();
    expect(Object.keys(guess.scores)).toEqual(['sv']);
    expect(detectTextLanguage(words(ENGLISH), ['EN']).language).toBe('en');
    expect(DETECTABLE_LANGUAGES).toEqual(expect.arrayContaining(['sv', 'en', 'de', 'da', 'nb', 'fi', 'fr', 'es', 'nl']));
  });

  it('stays unsure on a page in a language the viewer does not know, even when it shares short words with a candidate', () => {
    const GERMAN = 'Vielen Dank für Ihr Schreiben vom 14. Oktober. Wir haben die Unterlagen geprüft und können bestätigen, dass der Vorgang nun bei uns unter dem Aktenzeichen registriert ist.';
    const FRENCH = 'Nous vous remercions de votre lettre du 14 octobre. Nous avons examiné les documents et pouvons confirmer que le dossier est désormais enregistré chez nous sous le numéro.';
    const SPANISH = 'Gracias por su carta del 14 de octubre. Hemos revisado los documentos y podemos confirmar que el expediente ya está registrado con nosotros bajo el número de referencia.';
    for (const text of [GERMAN, FRENCH, SPANISH, DANISH]) {
      expect(detectTextLanguage(words(text), ['sv', 'en']).language).toBeNull();
    }
    // With German among the candidates the same German page is German.
    expect(detectTextLanguage(words(GERMAN), ['sv', 'en', 'de']).language).toBe('de');
    // Letters alone never lift a page over the threshold: three "den" and five ä are not Swedish.
    expect(detectTextLanguage(words('den Bären den Käse den Ärger für Väter Mütter'), ['sv']).language).toBeNull();
  });

  it('counts words with their punctuation stripped and reports how many it looked at', () => {
    const guess = detectTextLanguage(['Och,', '"att"', 'det.', 'som', '', null, 'är!'], ['sv', 'en']);
    expect(guess.language).toBe('sv');
    expect(guess.words).toBe(5);
    expect(guess.scores.sv).toBeGreaterThanOrEqual(5);
  });
});
