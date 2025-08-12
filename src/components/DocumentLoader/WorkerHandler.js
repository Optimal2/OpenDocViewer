// File: src/components/DocumentLoader/WorkerHandler.js

import logger from '../../LogController';
import { renderTIFFInMainThread } from './MainThreadRenderer';
import { generateThumbnail } from './Utils';

/**
 * Creates a new web worker.
 * 
 * @returns {Worker} A new web worker.
 */
export const createWorker = () =>
  new Worker(new URL('../../workers/imageWorker.js', import.meta.url), { type: 'module' });


/**
 * Gets the number of workers to create based on the number of CPU cores and a maximum limit.
 * 
 * @param {number} maxWorkers - The maximum number of workers.
 * @returns {number} The number of workers to create.
 */
export const getNumberOfWorkers = (maxWorkers) => {
  const cores = navigator.hardwareConcurrency || 4;
  return Math.min(cores, maxWorkers);
};

/**
 * Handles messages received from a web worker.
 * 
 * @param {MessageEvent} event - The message event from the worker.
 * @param {Function} insertPageAtIndex - Function to insert a page at a specific index.
 * @param {boolean} sameBlob - Flag indicating if the same blob should be used for thumbnails.
 * @param {Object} isMounted - Ref object to check if the component is mounted.
 */
export const handleWorkerMessage = (event, insertPageAtIndex, sameBlob, isMounted) => {
  logger.debug('Worker message received', event.data);

  if (event.data.error) {
    logger.info('Error in Worker', { error: event.data.error }); // log level info since we expect this to happen often
    const { jobs } = event.data;
    jobs.forEach(job => {
      job.handleInMainThread = true;
    });
    logger.debug('Jobs marked for handling in main thread', { jobs });
    jobs.forEach(job => {
      if (['tiff', 'tif'].includes(job.fileExtension)) {
        renderTIFFInMainThread(job, insertPageAtIndex, sameBlob, isMounted);
      }
    });
  } else if (event.data.handleInMainThread) {
    if (['tiff', 'tif'].includes(event.data.job?.fileExtension)) {
      logger.debug('Main thread processing TIFF job', { job: event.data.job });
      renderTIFFInMainThread(event.data.job, insertPageAtIndex, sameBlob, isMounted);
    } else {
      event.data.jobs.forEach(job => {
        if (['tiff', 'tif'].includes(job.fileExtension)) {
          logger.debug('Main thread processing TIFF job', { job });
          renderTIFFInMainThread(job, insertPageAtIndex, sameBlob, isMounted);
        }
      });
    }
  } else if (event.data.jobs) {
    event.data.jobs.forEach(async (job) => {
      const { fullSizeUrl, fileIndex, pageIndex, fileExtension, allPagesIndex } = job;
      if (fullSizeUrl) {
        const page = {
          fullSizeUrl,
          thumbnailUrl: sameBlob ? fullSizeUrl : await generateThumbnail(fullSizeUrl, 200, 200),
          loaded: true,
          status: 1,
          fileExtension,
          fileIndex,
          pageIndex,
          allPagesIndex,
        };
        logger.debug('Inserting page', { allPagesIndex, page });
        insertPageAtIndex(page, allPagesIndex);
      } else {
        const placeholderImageUrl = `${process.env.PUBLIC_URL}/placeholder.png`;
        const placeholderPage = {
          fullSizeUrl: placeholderImageUrl,
          thumbnailUrl: placeholderImageUrl,
          loaded: false,
          status: -1,
          fileExtension,
          fileIndex,
          pageIndex,
          allPagesIndex,
        };
        logger.debug('Inserting placeholder page', { allPagesIndex, placeholderPage });
        insertPageAtIndex(placeholderPage, allPagesIndex);
      }
    });
  }
};
