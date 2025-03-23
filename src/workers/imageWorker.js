// File: src/workers/imageWorker.js

/* eslint-disable no-restricted-globals */

// Alias self to ctx for worker context
const ctx = self;

/**
 * Main message handler for the worker.
 * Processes different file types (TIFF, PDF, and other images) and posts the results back.
 */
ctx.onmessage = async (event) => {
  const { jobs, fileExtension } = event.data;

  if (!jobs || jobs.length === 0) {
    return;
  }

  try {
    const jobResults = [];
    const fileExtLower = fileExtension.toLowerCase();

    if (['tiff', 'tif'].includes(fileExtLower)) {
      await processTiff(jobs, jobResults);
    } else {
      await processImage(jobs, fileExtLower, jobResults);
    }

    ctx.postMessage({ jobs: jobResults, fileExtension });
  } catch (error) {
    ctx.postMessage({ error: error.message, jobs });
  }
};

/**
 * Processes TIFF images.
 * @param {Array} jobs - The jobs to process.
 * @param {Array} jobResults - The results of the processed jobs.
 */
const processTiff = async (jobs, jobResults) => {
  const { decode, toRGBA8, decodeImage } = await import('utif2');
  
  try {
    for (const job of jobs) {
      const ifds = decode(job.arrayBuffer);

      for (let i = job.pageStartIndex; i < job.pageStartIndex + job.pagesInvolved; i++) {
        if (i >= ifds.length) break;
        const ifd = ifds[i];

        decodeImage(job.arrayBuffer, ifd);

        const rgba = toRGBA8(ifd);

        const canvas = new OffscreenCanvas(ifd.width, ifd.height);
        const context = canvas.getContext('2d');
        const imageData = context.createImageData(ifd.width, ifd.height);
        imageData.data.set(rgba);
        context.putImageData(imageData, 0, 0);
        const blob = await canvas.convertToBlob();
        const url = URL.createObjectURL(blob);

        jobResults.push({
          fullSizeUrl: url,
          fileIndex: job.index,
          pageIndex: i,
          fileExtension: 'tiff',
          allPagesIndex: job.allPagesStartingIndex + (i - job.pageStartIndex),
        });
      }
    }
  } catch (error) {
    jobs.forEach(job => {
      job.handleInMainThread = true;
    });
    ctx.postMessage({ error: error.message, jobs });
  }
};

/**
 * Processes other image types.
 * @param {Array} jobs - The jobs to process.
 * @param {string} fileExtension - The file extension of the images.
 * @param {Array} jobResults - The results of the processed jobs.
 */
const processImage = async (jobs, fileExtension, jobResults) => {
  for (const job of jobs) {
    const blob = new Blob([job.arrayBuffer], { type: `image/${fileExtension}` });
    const url = URL.createObjectURL(blob);

    jobResults.push({
      fullSizeUrl: url,
      fileIndex: job.index,
      pageIndex: 0,
      fileExtension,
      allPagesIndex: job.allPagesStartingIndex,
    });
  }
};

/* eslint-enable no-restricted-globals */
