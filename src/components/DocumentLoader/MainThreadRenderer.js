// File: src/components/DocumentLoader/MainThreadRenderer.js
import logger from '../../LogController';
import { decode as decodeUTIF, decodeImage as decodeUTIFImage, toRGBA8 } from 'utif2';
import { generateThumbnail } from './Utils';
import { handleWorkerMessage } from './WorkerHandler';

// Import the matching pdf.js API and resolve the worker URL from the same package version
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

/**
 * Renders PDF documents in the main thread.
 *
 * @param {Object} job - The job object containing document data.
 * @param {function} insertPageAtIndex - Function to insert a page at a specific index.
 * @param {boolean} sameBlob - Flag indicating if the same blob should be used.
 * @param {Object} isMounted - Reference to the mounted state of the component.
 */
export const renderPDFInMainThread = async (job, insertPageAtIndex, sameBlob, isMounted) => {
  try {
    // Ensure the worker matches the API version that was bundled
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

    const pdf = await pdfjsLib.getDocument({ data: job.arrayBuffer }).promise;
    for (let i = job.pageStartIndex + 1; i <= job.pageStartIndex + job.pagesInvolved; i++) {
      if (i > pdf.numPages) break;
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({ canvasContext: context, viewport }).promise;

      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        logger.debug(`Main thread processed PDF page`, {
          url,
          fileIndex: job.index,
          pageIndex: i - 1,
        });
        handleWorkerMessage(
          {
            data: {
              jobs: [
                {
                  fullSizeUrl: url,
                  fileIndex: job.index,
                  pageIndex: i - 1,
                  fileExtension: 'pdf',
                  allPagesIndex: job.allPagesStartingIndex + (i - 1 - job.pageStartIndex),
                },
              ],
            },
          },
          insertPageAtIndex,
          sameBlob,
          isMounted
        );
      }, 'image/png');
    }
  } catch (error) {
    const placeholderImageUrl = `${process.env.PUBLIC_URL}/placeholder.png`;
    const placeholderPage = {
      fullSizeUrl: placeholderImageUrl,
      thumbnailUrl: placeholderImageUrl,
      loaded: false,
      status: -1,
      fileExtension: job.fileExtension,
      fileIndex: job.index,
      pageIndex: job.pageIndex,
      allPagesIndex: job.allPagesStartingIndex + (job.pageIndex - job.pageStartIndex),
    };
    logger.error('Error processing PDF in main thread', { error: error.message });
    insertPageAtIndex(placeholderPage, job.allPagesStartingIndex + (job.pageIndex - job.pageStartIndex));
  }
};

/**
 * Renders TIFF documents in the main thread.
 */
export const renderTIFFInMainThread = async (job, insertPageAtIndex, sameBlob, isMounted) => {
  try {
    const ifds = decodeUTIF(job.arrayBuffer);
    for (let i = job.pageStartIndex; i < job.pageStartIndex + job.pagesInvolved; i++) {
      if (i >= ifds.length) break;
      const ifd = ifds[i];
      const compression = ifd['t259'] ? ifd['t259'][0] : 'unknown';
      const photometricInterpretation = ifd['t262'] ? ifd['t262'][0] : 'unknown';
      const bitsPerSample = ifd['t258'] ? ifd['t258'] : 'unknown';
      const samplesPerPixel = ifd['t277'] ? ifd['t277'][0] : 'unknown';
      const planarConfiguration = ifd['t284'] ? ifd['t284'][0] : 'unknown';
      const extraSamples = ifd['t338'] ? ifd['t338'] : 'none';

      logger.info(
        `Processing TIFF page ${i}, Compression: ${compression}, PhotometricInterpretation: ${photometricInterpretation}, BitsPerSample: ${bitsPerSample}, SamplesPerPixel: ${samplesPerPixel}, PlanarConfiguration: ${planarConfiguration}, ExtraSamples: ${extraSamples}, File Index: ${job.index}, Page Index: ${i}, All Pages Index: ${job.allPagesStartingIndex + (i - job.pageStartIndex)}`
      );

      decodeUTIFImage(job.arrayBuffer, ifd);
      const rgba = toRGBA8(ifd);

      const canvas = document.createElement('canvas');
      canvas.width = ifd.width;
      canvas.height = ifd.height;
      const context = canvas.getContext('2d');
      const imageData = context.createImageData(ifd.width, ifd.height);
      imageData.data.set(rgba);
      context.putImageData(imageData, 0, 0);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve));
      const url = URL.createObjectURL(blob);

      if (blob) {
        logger.debug(`Main thread processed TIFF page`, {
          url,
          fileIndex: job.index,
          pageIndex: i,
        });
        insertPageAtIndex(
          {
            fullSizeUrl: url,
            thumbnailUrl: sameBlob ? url : await generateThumbnail(url, 200, 200),
            loaded: true,
            status: 1,
            fileExtension: 'tiff',
            fileIndex: job.index,
            pageIndex: i,
            allPagesIndex: job.allPagesStartingIndex + (i - job.pageStartIndex),
          },
          job.allPagesStartingIndex + (i - job.pageStartIndex)
        );
      } else {
        throw new Error('Failed to create blob URL');
      }
    }
  } catch (error) {
    const placeholderImageUrl = `${process.env.PUBLIC_URL}/placeholder.png`;
    const placeholderPage = {
      fullSizeUrl: placeholderImageUrl,
      thumbnailUrl: placeholderImageUrl,
      loaded: false,
      status: -1,
      fileExtension: job.fileExtension,
      fileIndex: job.index,
      pageIndex: job.pageIndex,
      allPagesIndex: job.allPagesStartingIndex + (job.pageIndex - job.pageStartIndex),
    };
    logger.error('Error processing TIFF in main thread', { error: error.message });
    insertPageAtIndex(placeholderPage, job.allPagesStartingIndex + (job.pageIndex - job.pageStartIndex));
  }
};
