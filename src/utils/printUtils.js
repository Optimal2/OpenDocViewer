// File: src/utils/printUtils.js
/**
 * OpenDocViewer — Print Utilities Facade
 *
 * Re-export the stable print API and parser from the internal modules.
 * Keep this file as the public import surface for printing helpers.
 *
 * UI components such as DocumentToolbar intentionally import from this facade instead of reaching
 * into printCore.js directly. That keeps the print entry surface stable even if internal module
 * structure changes later.
 *
 * @module printUtils
 */

import { handlePrint, handlePrintAll, handlePrintCurrentComparison, handlePrintRange, handlePrintSequence } from './printCore.js';
import { parsePrintSequence } from './printParse.js';
import { handlePdfOutput, handlePdfCurrent, handlePdfCurrentComparison, createPrintPdfBlob, printPdfBlob, downloadPdfBlob } from './printPdf.js';

/**
 * Print the current selection/range through the HTML path.
 * @exports handlePrint
 */
export { handlePrint };
/**
 * Print all pages through the HTML path.
 * @exports handlePrintAll
 */
export { handlePrintAll };
/**
 * Print the current comparison pane through the HTML path.
 * @exports handlePrintCurrentComparison
 */
export { handlePrintCurrentComparison };
/**
 * Print a specific page range through the HTML path.
 * @exports handlePrintRange
 */
export { handlePrintRange };
/**
 * Print a parsed custom page sequence through the HTML path.
 * @exports handlePrintSequence
 */
export { handlePrintSequence };
/**
 * Parse a user-entered "Custom pages" string into a page sequence.
 * @exports parsePrintSequence
 */
export { parsePrintSequence };
/**
 * Generate a PDF for the current selection/range and open the print dialog.
 * @exports handlePdfOutput
 */
export { handlePdfOutput };
/**
 * Generate a PDF for the current page and open the print dialog.
 * @exports handlePdfCurrent
 */
export { handlePdfCurrent };
/**
 * Generate a PDF for the current comparison pane and open the print dialog.
 * @exports handlePdfCurrentComparison
 */
export { handlePdfCurrentComparison };
/**
 * Create a printable PDF blob from the current print job.
 * @exports createPrintPdfBlob
 */
export { createPrintPdfBlob };
/**
 * Print a generated PDF blob.
 * @exports printPdfBlob
 */
export { printPdfBlob };
/**
 * Download a generated PDF blob.
 * @exports downloadPdfBlob
 */
export { downloadPdfBlob };

/**
 * Default print utilities namespace.
 * @namespace printUtils.default
 * @property {function(...*):*} handlePrint
 * @property {function(...*):*} handlePrintAll
 * @property {function(...*):*} handlePrintCurrentComparison
 * @property {function(...*):*} handlePrintRange
 * @property {function(...*):*} handlePrintSequence
 * @property {function(string, number):Object} parsePrintSequence
 * @property {function(...*):*} handlePdfOutput
 * @property {function(...*):*} handlePdfCurrent
 * @property {function(...*):*} handlePdfCurrentComparison
 * @property {function(...*):Blob} createPrintPdfBlob
 * @property {function(Blob):void} printPdfBlob
 * @property {function(Blob, string):void} downloadPdfBlob
 */
export default {
  handlePrint,
  handlePrintAll,
  handlePrintCurrentComparison,
  handlePrintRange,
  handlePrintSequence,
  parsePrintSequence,
  handlePdfOutput,
  handlePdfCurrent,
  handlePdfCurrentComparison,
  createPrintPdfBlob,
  printPdfBlob,
  downloadPdfBlob,
};
