// File: src/utils/printUtils.js
/**
 * File: src/utils/printUtils.js
 *
 * OpenDocViewer — Print Utilities Facade
 *
 * PURPOSE
 *   Re-export the stable print API and parser from the internal modules.
 *   Keep this file as the public import surface for printing helpers.
 *
 * NOTE
 *   UI components such as DocumentToolbar intentionally import from this facade instead of reaching
 *   into printCore.js directly. That keeps the print entry surface stable even if internal module
 *   structure changes later.
 */

import { handlePrint, handlePrintAll, handlePrintCurrentComparison, handlePrintRange, handlePrintSequence } from './printCore.js';
import { parsePrintSequence } from './printParse.js';

export { handlePrint, handlePrintAll, handlePrintCurrentComparison, handlePrintRange, handlePrintSequence, parsePrintSequence };

export default {
  handlePrint,
  handlePrintAll,
  handlePrintCurrentComparison,
  handlePrintRange,
  handlePrintSequence,
  parsePrintSequence
};
