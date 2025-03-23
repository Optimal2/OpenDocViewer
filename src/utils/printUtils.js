// File: src/utils/printUtils.js

import logger from '../LogController';

/**
 * Handles the print functionality for the document viewer.
 * @param {object} documentRenderRef - The reference to the document render component.
 */
export const handlePrint = (documentRenderRef) => {
  logger.info('handlePrint called');
  if (documentRenderRef.current) {
    logger.info('documentRenderRef is available');
    const activeElement = documentRenderRef.current.getActiveCanvas();
    if (activeElement) {
      logger.info('Active element is available');
      const isCanvas = activeElement.tagName.toLowerCase() === 'canvas';
      const dataUrl = isCanvas ? activeElement.toDataURL() : activeElement.src;

      const { width, height } = isCanvas ? activeElement : activeElement.getBoundingClientRect();
      const isLandscape = width > height;

      const windowContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Print ${isCanvas ? 'canvas' : 'image'}</title>
            <style>
              @media print {
                body {
                  margin: 0;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  height: 100vh;
                }
                img {
                  max-width: 100vw;
                  max-height: 100vh;
                  width: auto;
                  height: auto;
                }
                @page {
                  size: ${isLandscape ? 'landscape' : 'portrait'};
                  margin: 0;
                }
              }
            </style>
          </head>
          <body>
            <img src="${dataUrl}" alt="Printable Document">
          </body>
        </html>`;

      const printWin = window.open('', '', 'width=800,height=600');
      if (printWin) {
        logger.info('Print window opened');
        printWin.document.open();
        printWin.document.write(windowContent);
        printWin.document.close();
        printWin.focus();

        setTimeout(() => {
          printWin.print();
          logger.info('Print command issued');

          setTimeout(() => {
            printWin.close();
            logger.info('Print window closed');
          }, 500);
        }, 300);
      } else {
        logger.error('Failed to open print window');
      }
    } else {
      logger.error('Active element is not available');
    }
  } else {
    logger.error('documentRenderRef is not available');
  }
};
