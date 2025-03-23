// File: src/components/DocumentLoader/Utils.js

import logger from '../../LogController';
import { decode as decodeUTIF } from 'utif2';

/**
 * Generates a list of document file paths.
 *
 * @param {string} folder - The folder containing the documents.
 * @param {string} extension - The file extension of the documents.
 * @param {number} [endNumber=300] - The number of documents to generate.
 * @returns {string[]} An array of document file paths.
 */
export const generateDocumentList = (folder, extension, endNumber = 300) => {
  const documents = [];
  for (let i = 1; i <= endNumber; i++) {
    const fileName = i.toString().padStart(3, '0') + `.${extension}`;
    const filePath = `/${folder}/${fileName}`;
    documents.push(filePath);
  }
  logger.debug('Generated document list', { documents });
  return documents;
};

/**
 * Fetches a document from a URL and returns its array buffer.
 *
 * @param {string} url - The URL of the document to fetch.
 * @returns {Promise<ArrayBuffer>} A promise that resolves to the array buffer of the document.
 * @throws {Error} If the fetch request fails.
 */
export const fetchAndArrayBuffer = async (url) => {
  logger.debug('Fetching array buffer', { url });
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch document at ${url}`);
  }
  return response.arrayBuffer();
};

/**
 * Gets the total number of pages in a document based on its array buffer and file extension.
 *
 * @param {ArrayBuffer} arrayBuffer - The array buffer of the document.
 * @param {string} fileExtension - The file extension of the document.
 * @returns {Promise<number>} A promise that resolves to the total number of pages in the document.
 */
export const getTotalPages = async (arrayBuffer, fileExtension) => {
  const fileExtLower = fileExtension.toLowerCase();
  if (fileExtLower === 'pdf') {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
    const arrayBufferCopy = arrayBuffer.slice(0);
    const pdf = await pdfjsLib.getDocument({ data: arrayBufferCopy }).promise;
    logger.debug('PDF document loaded', { numPages: pdf.numPages });
    return pdf.numPages;
  } else if (['tiff', 'tif'].includes(fileExtLower)) {
    const ifds = decodeUTIF(arrayBuffer);
    logger.debug('TIFF document loaded', { numPages: ifds.length });
    return ifds.length;
  }
  return 1;
};

/**
 * Gets metadata from a TIFF document.
 *
 * @param {ArrayBuffer} arrayBuffer - The array buffer of the TIFF document.
 * @returns {Object[]} An array of metadata objects for each page in the TIFF document.
 */
export const getTiffMetadata = (arrayBuffer) => {
  try {
    const ifds = decodeUTIF(arrayBuffer);
    const metadata = ifds.map(ifd => {
      const compressionType = ifd["t259"] ? ifd["t259"][0] : 1; // Default to 1 (no compression) if not found
      return {
        compressionType,
        photometricInterpretation: ifd["t262"] ? ifd["t262"][0] : 'unknown',
        bitsPerSample: ifd["t258"] ? ifd["t258"] : 'unknown',
        samplesPerPixel: ifd["t277"] ? ifd["t277"][0] : 'unknown',
        planarConfiguration: ifd["t284"] ? ifd["t284"][0] : 'unknown',
        extraSamples: ifd["t338"] ? ifd["t338"] : 'none'
      };
    });
    return metadata;
  } catch (error) {
    logger.error('Error getting TIFF metadata using UTIF2', { error: error.toString() });
    return 'unknown';
  }
};

/**
 * Generates a thumbnail for an image.
 *
 * @param {string} imageUrl - The URL of the image.
 * @param {number} maxWidth - The maximum width of the thumbnail.
 * @param {number} maxHeight - The maximum height of the thumbnail.
 * @returns {Promise<string>} A promise that resolves to the data URL of the thumbnail.
 */
export const generateThumbnail = (imageUrl, maxWidth, maxHeight) => {
  logger.debug('Generating thumbnail', { imageUrl });
  return new Promise((resolve) => {
    const img = new Image();
    img.src = imageUrl;
    img.onload = () => {
      const aspectRatio = img.width / img.height;
      let width = maxWidth;
      let height = maxHeight;

      if (img.width > img.height) {
        height = Math.min(maxHeight, maxWidth / aspectRatio);
        width = height * aspectRatio;
      } else {
        width = Math.min(maxWidth, maxHeight * aspectRatio);
        height = width / aspectRatio;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const thumbnail = canvas.toDataURL();
      resolve(thumbnail);
    };
  });
};
