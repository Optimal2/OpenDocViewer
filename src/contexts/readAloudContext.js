// File: src/contexts/readAloudContext.js
/**
 * The read-aloud state shared by the page's context menu ("Read the selection aloud" /
 * "Stop reading aloud", components/ReadAloudMenuItem.jsx) and the toolbar's language menu
 * (the "Reading language" section, DocumentToolbar/LanguageMenuButton.jsx). Provided by
 * components/ReadAloudProvider.jsx only while `ocr.enabled` is the literal true and
 * `ocr.speech.enabled` is not the literal false; everywhere else the value is null and the
 * consumers render nothing, so the default code path neither follows the selection nor
 * touches speech synthesis.
 *
 * @typedef {Object} ReadAloudState
 * @property {boolean} available  The browser has speech synthesis.
 * @property {({ text:string, language:(string|null) }|null)} selection  The selection inside
 *   the text layers (utils/ocrTextLayout.js), or null.
 * @property {boolean} speaking
 * @property {boolean} voiceMissing  No voice that runs on the machine for the reading language
 *   (online voices are never used).
 * @property {string} lang  The reading language as a locale ('sv-SE').
 * @property {string} langName  Its name in the UI language ("svenska").
 * @property {(string|null)} reason  Why the selection cannot be read right now (no selection,
 *   no local voice), or null when it can.
 * @property {function(): boolean} speak  Read the selection; false when nothing was spoken.
 * @property {function(): void} stop
 * @property {boolean} autoDetect  The language guess is on (`ocr.speech.autoDetectLanguage`).
 * @property {string} languageTitle  "Reading language", for the menu section.
 * @property {Array<{ value:string, label:string, disabled:boolean }>} entries  The reading
 *   language choices: '' automatic (only with the guess on and more than one language to choose
 *   from), then one per OCR language that has a voice installed on the machine; one such
 *   language is listed alone; none gives a single greyed line ('none') saying so.
 * @property {string} selectedValue  The current choice among `entries`.
 * @property {string} currentLabel  Its label.
 * @property {function(string): void} chooseLanguage  Keep a choice ('' automatic, or an
 *   ISO 639-1 language) in the viewer preferences.
 */
import { createContext } from 'react';

/** @type {React.Context<(ReadAloudState|null)>} */
const ReadAloudContext = createContext(/** @type {(ReadAloudState|null)} */ (null));

export default ReadAloudContext;
