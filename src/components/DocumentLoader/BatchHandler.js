// File: src/components/DocumentLoader/BatchHandler.js
import logger from '../../LogController';

/**
 * En mycket enkel scheduler:
 * - Gör varje jobb till en 1-jobbs-batch (ingen batchSize)
 * - Delar ut batchar till lediga workers i korta "pumpar"
 * - När en worker blir klar, kör vi nästa pump (ingen tight while-loop)
 */
export const batchHandler = (
  jobQueue,
  batchQueue,
  _batchSize,                 // ignoreras medvetet
  imageWorkers,
  handleWorkerMessage,
  insertPageAtIndex,
  sameBlob,
  isMounted
) => {
  // Flytta över alla jobb i batchQueue som 1-jobbs-batchar
  while (jobQueue.current.length > 0) {
    const job = jobQueue.current.shift();
    batchQueue.current.push({ jobs: [job], fileExtension: job.fileExtension });
  }

  logger.debug('BatchHandler: queued single-job batches', {
    queued: batchQueue.current.length
  });

  // Starta utdelningen
  pump(imageWorkers, batchQueue, handleWorkerMessage, insertPageAtIndex, sameBlob, isMounted);
};

/**
 * En "pump" som gör EN kort utdelnings-pass: tilldela batchar endast till lediga workers.
 * När en worker blir klar, anropas pump() igen. Ingen tight while-loop.
 */
function pump(
  imageWorkers,
  batchQueue,
  handleWorkerMessage,
  insertPageAtIndex,
  sameBlob,
  isMounted
) {
  if (!isMounted?.current) return;
  if (batchQueue.current.length === 0) return;

  let dispatched = 0;

  imageWorkers.forEach((worker) => {
    if (batchQueue.current.length === 0) return;
    if (worker.__busy) return;

    const batch = batchQueue.current.shift();
    worker.__busy = true;

    // Viktigt: sätt handlers innan postMessage
    worker.onmessage = (event) => {
      try {
        handleWorkerMessage(event, insertPageAtIndex, sameBlob, isMounted);
      } finally {
        worker.__busy = false;
        // Låt eventloopen andas innan nästa pass
        setTimeout(() => pump(imageWorkers, batchQueue, handleWorkerMessage, insertPageAtIndex, sameBlob, isMounted), 0);
      }
    };

    worker.onerror = (err) => {
      try {
        // Skicka tillbaka tomma resultat så UI får placeholders via handlern
        handleWorkerMessage(
          { data: { jobs: batch.jobs.map(j => ({
            fullSizeUrl: null,
            fileIndex: j.index,
            pageIndex: j.pageStartIndex || 0,
            fileExtension: j.fileExtension,
            allPagesIndex: j.allPagesStartingIndex
          }))}},
          insertPageAtIndex,
          sameBlob,
          isMounted
        );
      } finally {
        worker.__busy = false;
        setTimeout(() => pump(imageWorkers, batchQueue, handleWorkerMessage, insertPageAtIndex, sameBlob, isMounted), 0);
      }
    };

    logger.debug('Dispatching batch to worker', { jobs: batch.jobs.length, ext: batch.fileExtension });
	const transfer = [];
	if (batch?.jobs) {
	  for (const j of batch.jobs) {
		if (j?.arrayBuffer instanceof ArrayBuffer && j.arrayBuffer.byteLength) {
		  transfer.push(j.arrayBuffer);
		}
	  }
	}
	worker.postMessage(batch, transfer);
    dispatched++;
  });

  // Om inga workers var lediga just nu, gör inget mer. onmessage/onerror triggar nästa pump.
}
