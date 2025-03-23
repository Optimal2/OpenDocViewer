// File: src/components/DocumentLoader/BatchHandler.js

import logger from '../../LogController';

/**
 * Handles the creation and dispatching of batches for image processing.
 *
 * @param {Object} jobQueue - The queue of jobs to process.
 * @param {Object} batchQueue - The queue of batches to process.
 * @param {number} batchSize - The size of each batch.
 * @param {Array} imageWorkers - Array of image workers.
 * @param {function} handleWorkerMessage - Function to handle worker messages.
 * @param {function} insertPageAtIndex - Function to insert a page at a specific index.
 * @param {boolean} sameBlob - Flag indicating if the same blob should be used.
 * @param {Object} isMounted - Ref indicating if the component is mounted.
 */
export const batchHandler = (
  jobQueue, 
  batchQueue, 
  batchSize,
  imageWorkers, 
  handleWorkerMessage, 
  insertPageAtIndex, 
  sameBlob, 
  isMounted
) => {
  const batches = {};

  // Group jobs by file extension
  while (jobQueue.current.length > 0) {
    const job = jobQueue.current.shift();
    if (!batches[job.fileExtension]) {
      batches[job.fileExtension] = [];
    }
    batches[job.fileExtension].push(job);
  }

  // Create batches based on file extension and batch size
  Object.keys(batches).forEach(ext => {
    const batchGroup = batches[ext];

    while (batchGroup.length > 0) {
      let currentBatch = [];
      let currentPages = 0;

      // Add the first job to the current batch
      const firstJob = batchGroup.shift();
      currentBatch.push(firstJob);
      currentPages += firstJob.pagesInvolved;

      // Add additional jobs to the current batch while currentPages < batchSize and batchGroup is not empty
      while (currentPages < batchSize && batchGroup.length > 0) {
        const nextJob = batchGroup[0];
        if (currentPages + nextJob.pagesInvolved > batchSize) {
          break;
        }
        currentBatch.push(nextJob);
        currentPages += nextJob.pagesInvolved;
        batchGroup.shift();
      }

      // Push the current batch to the batch queue
      batchQueue.current.push({ jobs: currentBatch, fileExtension: ext });
    }
  });

  logger.debug('Batch handler completed', { batchQueue: batchQueue.current });

  // Start dispatching batches
  batchDispatcher(imageWorkers, batchQueue, handleWorkerMessage, insertPageAtIndex, sameBlob, isMounted);
};

/**
 * Dispatches batches to available image workers.
 *
 * @param {Array} imageWorkers - Array of image workers.
 * @param {Object} batchQueue - The queue of batches to process.
 * @param {function} handleWorkerMessage - Function to handle worker messages.
 * @param {function} insertPageAtIndex - Function to insert a page at a specific index.
 * @param {boolean} sameBlob - Flag indicating if the same blob should be used.
 * @param {Object} isMounted - Ref indicating if the component is mounted.
 */
export const batchDispatcher = (
  imageWorkers, 
  batchQueue, 
  handleWorkerMessage, 
  insertPageAtIndex, 
  sameBlob, 
  isMounted
) => {
  while (batchQueue.current.length > 0) {
    imageWorkers.forEach(worker => {
      if (!worker.busy && batchQueue.current.length > 0) {
        const batch = batchQueue.current.shift();
        logger.debug('Dispatching batch to worker', { batch });
        worker.busy = true;
        worker.postMessage(batch);
        worker.onmessage = (event) => {
          handleWorkerMessage(event, insertPageAtIndex, sameBlob, isMounted);
          worker.busy = false;
          batchDispatcher(imageWorkers, batchQueue, handleWorkerMessage, insertPageAtIndex, sameBlob, isMounted);
        };
      }
    });
  }
};
