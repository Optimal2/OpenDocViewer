// File: src/utils/printUtils.js
/**
 * File: src/utils/printUtils.js
 *
 * OpenDocViewer — Print Utilities Facade
 *
 * PURPOSE
 *   Re-export the stable print API and parser from the internal modules.
 *   Keep this file as the public import surface for printing helpers.
 */

import { handlePrint, handlePrintAll, handlePrintRange, handlePrintSequence } from './printCore.js';
import { parsePrintSequence } from './printParse.js';

export { handlePrint, handlePrintAll, handlePrintRange, handlePrintSequence, parsePrintSequence };

export default {
  handlePrint,
  handlePrintAll,
  handlePrintRange,
  handlePrintSequence,
  parsePrintSequence
};
