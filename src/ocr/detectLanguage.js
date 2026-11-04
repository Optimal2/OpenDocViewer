// File: src/ocr/detectLanguage.js
/**
 * Guess the language of a page's text among a few candidate languages, from its words alone.
 *
 * The guess counts how many of the page's words are common function words of each language it
 * has a list for (a few dozen per language below) and adds a little for letters that belong to
 * one language more than to the others (å, ä, ö for Swedish; æ, ø for Danish and Norwegian; ß,
 * ü for German, and so on). Every list is scored, not only the candidates: a page in a language
 * the viewer does not recognise (German, with Swedish and English as candidates) shares many
 * short words with the candidates ("den", "de", "en") and would otherwise pass as one of them.
 * The best candidate wins only when it has at least MIN_HITS function-word hits of its own
 * (the letters do not count towards that), clearly more than the next candidate
 * (RUNNER_UP_RATIO), and at least as much as every language that is not a candidate; otherwise
 * the guess is "unsure" (null) and the caller keeps its default. A page of running text has
 * hundreds of words, so Swedish and English are told apart reliably; a page of numbers, a short
 * stamp, or a page in a language the viewer does not know gives no answer rather than a wrong
 * one. Danish and Norwegian share nearly all their function words and stay unsure between each
 * other. One pass over the words, one Set lookup per list each: well under a millisecond for a
 * dense page. Part of the lazy OCR chunk; the candidates come from the viewer's OCR languages
 * (hooks/useOcrTextLayers.js), so only languages the viewer recognises can be guessed.
 */

/** Fewest function-word hits the winning language needs. */
export const MIN_HITS = 4;
/** The winner must have at least this many times the runner-up's score. */
export const RUNNER_UP_RATIO = 1.5;
/** Score a distinctive letter adds, and the most such letters that count. */
const LETTER_SCORE = 0.3;
const MAX_LETTER_HITS = 10;

/**
 * Common function words per language (ISO 639-1), lower case. Shared words (och/og, det, är/er)
 * sit in several lists on purpose: the distinctive ones and the letters decide between
 * neighbours.
 * @type {Readonly<Object<string, Array<string>>>}
 */
const FUNCTION_WORDS = Object.freeze({
  sv: 'och att det som är en ett för med på av till inte den har de i om var kan ska från vi så men också eller denna detta vid under efter över mellan enligt endast finns blir här där sin sitt sina hur när vilket'.split(' '),
  en: 'the and of to in is that for it with as was on are be by this from or which not have has at an will can were their been also into than its after these only other more such your'.split(' '),
  de: 'und der die das ist nicht mit von den dem ein eine auf für sich des auch als wird werden bei nach über zu aus oder wenn durch sind haben hat noch einer einem einen zum zur im am kann'.split(' '),
  da: 'og at det er en et til af for med på den ikke der som de har i om kan skal fra vi så men også eller denne dette ved under efter over mellem ifølge kun bliver her hvor være sig hvis'.split(' '),
  nb: 'og at det er en et til av for med på den ikke der som de har i om kan skal fra vi så men også eller denne dette ved under etter over mellom ifølge bare blir her hvor være seg hvis'.split(' '),
  fi: 'ja on ei että se oli hän mutta myös kun niin tai jos ovat ole sen tämä joka kuin vain nyt sitä siitä hänen me te he olla voi vielä jo mitä kaikki sekä koska kanssa jälkeen ennen ilman mukaan'.split(' '),
  fr: 'le la les de des du et est en un une que qui dans pour pas sur par avec ce cette ces au aux il elle nous vous ils sont ont mais ou plus comme être son sa ses leur'.split(' '),
  es: 'el la los las de del y es en un una que por para con no se su sus al lo como más pero sin sobre este esta son han ha ser entre también hasta desde cuando muy ya todo'.split(' '),
  nl: 'de het een en van is dat op te in met voor zijn niet aan er ook als bij maar of om dan naar uit nog over door worden wordt deze dit hun zij hij kan moet wel geen tot'.split(' '),
});

/** Letters that point at a language more than at its neighbours. */
const DISTINCTIVE_LETTERS = Object.freeze({
  sv: /[äö]/g,
  da: /[æø]/g,
  nb: /[æø]/g,
  de: /[ßü]/g,
  fr: /[éèêçù]/g,
  es: /[ñ¿¡]/g,
});

/** @type {Map<string, Set<string>>} */
const wordSets = new Map();
for (const [language, words] of Object.entries(FUNCTION_WORDS)) wordSets.set(language, new Set(words));

/** The languages the guess knows function words for (ISO 639-1). */
export const DETECTABLE_LANGUAGES = Object.freeze([...wordSets.keys()]);

const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/**
 * @typedef {Object} TextLanguageGuess
 * @property {(string|null)} language  ISO 639-1 code, or null when unsure.
 * @property {Object<string, number>} scores  Score per candidate (function-word hits plus the
 *   letter bonus).
 * @property {number} words  Words that were looked at.
 */

/**
 * @param {Array<string>} words  The page's words in any order.
 * @param {Array<string>} candidates  ISO 639-1 codes to choose among; codes without function
 *   words are ignored. One candidate alone still needs MIN_HITS to be chosen, and still loses
 *   to a language it is not when that one fits the words better.
 * @returns {TextLanguageGuess}
 */
export function detectTextLanguage(words, candidates) {
  const wanted = new Set((Array.isArray(candidates) ? candidates : []).map((code) => String(code || '').toLowerCase()));
  const languages = DETECTABLE_LANGUAGES.filter((code) => wanted.has(code));
  const scores = {};
  const hits = {};
  const letterHits = {};
  for (const language of DETECTABLE_LANGUAGES) {
    scores[language] = 0;
    hits[language] = 0;
    letterHits[language] = 0;
  }
  let count = 0;
  if (languages.length > 0) {
    for (const raw of Array.isArray(words) ? words : []) {
      const word = String(raw ?? '').toLowerCase().replace(EDGE_PUNCTUATION, '');
      if (!word) continue;
      count += 1;
      for (const language of DETECTABLE_LANGUAGES) {
        if (wordSets.get(language).has(word)) {
          hits[language] += 1;
          scores[language] += 1;
        }
        const letters = DISTINCTIVE_LETTERS[language];
        if (letters && letterHits[language] < MAX_LETTER_HITS) {
          const found = (word.match(letters) || []).length;
          if (found > 0) {
            const counted = Math.min(found, MAX_LETTER_HITS - letterHits[language]);
            letterHits[language] += counted;
            scores[language] += counted * LETTER_SCORE;
          }
        }
      }
    }
  }
  const ranked = languages.map((language) => [language, scores[language]]).sort((a, b) => b[1] - a[1]);
  let language = null;
  if (ranked.length > 0) {
    const [best, bestScore] = ranked[0];
    const runnerUp = ranked.length > 1 ? ranked[1][1] : 0;
    const bestOther = Math.max(0, ...DETECTABLE_LANGUAGES.filter((code) => !wanted.has(code)).map((code) => scores[code]));
    if (hits[best] >= MIN_HITS && bestScore >= runnerUp * RUNNER_UP_RATIO && bestScore >= bestOther) language = best;
  }
  const candidateScores = {};
  for (const code of languages) candidateScores[code] = scores[code];
  return { language, scores: candidateScores, words: count };
}
