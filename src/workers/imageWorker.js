// File: src/workers/imageWorker.js
/* eslint-disable no-restricted-globals */
const ctx = self;

// Reuse an OffscreenCanvas between pages (avoid reallocs)
let sharedCanvas = null;
let sharedCtx = null;
function getCanvas(w, h) {
  if (!sharedCanvas || sharedCanvas.width !== w || sharedCanvas.height !== h) {
    sharedCanvas = new OffscreenCanvas(w, h);
    sharedCtx = sharedCanvas.getContext('2d');
  }
  return sharedCtx;
}

const mimeFromExt = (ext) => {
  const e = ext.toLowerCase();
  if (e === 'jpg') return 'image/jpeg';
  if (e === 'tif') return 'image/tiff';
  return `image/${e}`;
};

ctx.onmessage = async (event) => {
  const { jobs, fileExtension } = event.data;
  if (!jobs?.length) return;

  try {
    const jobResults = [];
    const fileExtLower = fileExtension.toLowerCase();

    if (fileExtLower === 'tiff' || fileExtLower === 'tif') {
      await processTiff(jobs, jobResults);
    } else {
      await processImage(jobs, fileExtLower, jobResults);
    }

    ctx.postMessage({ jobs: jobResults, fileExtension });
  } catch (error) {
    // Don’t bounce big buffers back to main
    const safeJobs = jobs.map(j => ({
      index: j.index,
      pageStartIndex: j.pageStartIndex || 0,
      pagesInvolved: j.pagesInvolved || 1,
      allPagesStartingIndex: j.allPagesStartingIndex,
      fileExtension: j.fileExtension,
      handleInMainThread: true,
    }));
    ctx.postMessage({ error: String(error?.message || error), jobs: safeJobs });
  }
};

const processTiff = async (jobs, jobResults) => {
  const { decode, toRGBA8, decodeImage } = await import('utif2');

  for (const job of jobs) {
    const ifds = decode(job.arrayBuffer);

    for (let i = job.pageStartIndex; i < job.pageStartIndex + job.pagesInvolved; i++) {
      if (i >= ifds.length) break;
      const ifd = ifds[i];

      decodeImage(job.arrayBuffer, ifd);
      const rgba = toRGBA8(ifd); // Uint8Array

      const w = ifd.width, h = ifd.height;
      const ctx2d = getCanvas(w, h);
      // Avoid extra copy: share the same buffer via a clamped view
      const clamped = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
      const imageData = new ImageData(clamped, w, h);
      ctx2d.putImageData(imageData, 0, 0);

      const blob = await sharedCanvas.convertToBlob({ type: 'image/png' });

      jobResults.push({
        blob,
        fileIndex: job.index,
        pageIndex: i,
        fileExtension: 'tiff',
        allPagesIndex: job.allPagesStartingIndex + (i - job.pageStartIndex),
      });
    }

    // Help GC: drop large buffer reference ASAP
    job.arrayBuffer = null;
  }
};

const processImage = async (jobs, fileExtension, jobResults) => {
  const mime = mimeFromExt(fileExtension);

  for (const job of jobs) {
    const blob = new Blob([job.arrayBuffer], { type: mime });
    job.arrayBuffer = null; // free memory

    jobResults.push({
      blob,
      fileIndex: job.index,
      pageIndex: 0,
      fileExtension,
      allPagesIndex: job.allPagesStartingIndex,
    });
  }
};
/* eslint-enable no-restricted-globals */
