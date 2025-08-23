// File: src/components/DocumentLoader/WorkerHandler.js

import logger from '../../LogController';
import { renderTIFFInMainThread } from './MainThreadRenderer';
import { generateThumbnail } from './Utils';

/**
 * Creates a new web worker.
 */
export const createWorker = () =>
  new Worker(new URL('../../workers/imageWorker.js', import.meta.url), { type: 'module' });

/**
 * Gets the number of workers to create based on the number of CPU cores and a maximum limit.
 */
export const getNumberOfWorkers = (maxWorkers) => {
  const cores = navigator.hardwareConcurrency || 4;
  return Math.min(cores, maxWorkers);
};

/**
 * Handles messages received from a web worker.
 *
 * Supports:
 *  - { jobs: [{ blob? | fullSizeUrl?, ... }], fileExtension }
 *  - { error, jobs: [shape without big buffers], ... }
 */
export const handleWorkerMessage = (event, insertPageAtIndex, sameBlob, isMounted) => {
  const { data } = event;
  // Avoid logging large payloads/blobs
  logger.debug('Worker message received', {
    jobs: Array.isArray(data?.jobs) ? data.jobs.length : 0,
    error: !!data?.error
  });

  if (data?.error) {
    logger.info('Error in Worker', { error: data.error }); // expected sometimes; keep as info
    const { jobs = [] } = data;

    // Ensure main-thread fallback where applicable (TIFF)
    jobs.forEach(job => {
      job.handleInMainThread = true;
      if (['tiff', 'tif'].includes(job.fileExtension)) {
        renderTIFFInMainThread(job, insertPageAtIndex, sameBlob, isMounted);
      }
    });
    return;
  }

  if (data?.handleInMainThread) {
    // Back-compat path (single job or array)
    if (['tiff', 'tif'].includes(data.job?.fileExtension)) {
      logger.debug('Main thread processing TIFF job', { job: data.job });
      renderTIFFInMainThread(data.job, insertPageAtIndex, sameBlob, isMounted);
    } else if (Array.isArray(data.jobs)) {
      data.jobs.forEach(job => {
        if (['tiff', 'tif'].includes(job.fileExtension)) {
          logger.debug('Main thread processing TIFF job', { job });
          renderTIFFInMainThread(job, insertPageAtIndex, sameBlob, isMounted);
        }
      });
    }
    return;
  }

  if (Array.isArray(data?.jobs)) {
    data.jobs.forEach(async (job) => {
      try {
        const { fileIndex, pageIndex, fileExtension, allPagesIndex } = job;

        // New: prefer blob from worker; fall back to fullSizeUrl if present
        let fullSizeUrl = job.fullSizeUrl || null;
        if (!fullSizeUrl && job.blob instanceof Blob) {
          fullSizeUrl = URL.createObjectURL(job.blob);
          // NOTE: Consider revoking this URL when the page is destroyed/unloaded to avoid leaks.
        }

        if (fullSizeUrl) {
          const page = {
            fullSizeUrl,
            thumbnailUrl: sameBlob
              ? fullSizeUrl
              : await generateThumbnail(fullSizeUrl, 200, 200),
            loaded: true,
            status: 1,
            fileExtension,
            fileIndex,
            pageIndex,
            allPagesIndex,
          };
          logger.debug('Inserting page', { allPagesIndex });
          insertPageAtIndex(page, allPagesIndex);
        } else {
          // Placeholder if the worker couldn’t produce an image
          const placeholderImageUrl = 'placeholder.png';
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
          logger.debug('Inserting placeholder page', { allPagesIndex });
          insertPageAtIndex(placeholderPage, allPagesIndex);
        }
      } catch (e) {
        logger.error('handleWorkerMessage: per-job failure', { error: String(e) });
      }
    });
  }
};
