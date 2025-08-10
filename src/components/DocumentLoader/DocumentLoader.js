// File: src/components/DocumentLoader/DocumentLoader.js
import { useEffect, useContext, useRef, useMemo, useCallback } from 'react';
import { ViewerContext } from '../../ViewerContext';
import logger from '../../LogController';
import { generateDocumentList, getTotalPages, getTiffMetadata } from './Utils';
import { createWorker, getNumberOfWorkers, handleWorkerMessage } from './WorkerHandler';
import { batchHandler } from './BatchHandler';
import { renderPDFInMainThread, renderTIFFInMainThread } from './MainThreadRenderer';
import { fileTypeFromBuffer } from 'file-type';

// Configurable constants
const batchSize = 20;
const maxWorkers = 20; // Max number of workers
const enableMetadataLogging = false; // Toggle TIFF metadata logging

/**
 * DocumentLoader component.
 * Loads and processes documents for rendering.
 *
 * @param {Object} props - Component props.
 * @param {string} props.folder - The folder containing the documents.
 * @param {string} props.extension - The extension of the document files.
 * @param {React.ReactNode} props.children - The child components to render.
 * @param {boolean} props.sameBlob - Flag indicating if the same blob should be used.
 * @param {number} props.endNumber - The number of documents to load.
 * @returns {JSX.Element} The DocumentLoader component.
 */
const DocumentLoader = ({ folder, extension, children, sameBlob, endNumber }) => {
  const { insertPageAtIndex, setError, setWorkerCount } = useContext(ViewerContext);
  const hasStarted = useRef(false);
  const isMounted = useRef(true);
  const jobQueue = useRef([]);
  const mainThreadJobQueue = useRef([]);
  const batchQueue = useRef([]);
  const currentPageIndex = useRef(0);

  // Create workers ONCE (render-safe). Do NOT set state here.
  const imageWorkers = useMemo(() => {
    const numWorkers = getNumberOfWorkers(maxWorkers);
    logger.debug(`Using ${numWorkers} workers.`);
    return Array.from({ length: numWorkers }, () => createWorker());
  }, []);

  // Set workerCount AFTER render (fixes the React warning)
  useEffect(() => {
    setWorkerCount(imageWorkers.length);
  }, [imageWorkers.length, setWorkerCount]);

  // Preload placeholder images for better user experience
  const preloadPlaceholderImage = useCallback((index) => {
    const placeholderImageUrl = `${process.env.PUBLIC_URL}/placeholder.png`;
    const placeholderPage = {
      fullSizeUrl: placeholderImageUrl,
      thumbnailUrl: placeholderImageUrl,
      loaded: false,
      status: 0,
      fileExtension: 'png',
      fileIndex: 0,
      pageIndex: 0,
    };
    logger.debug(`Preloading placeholder image for index ${index}`);
    insertPageAtIndex(placeholderPage, index);
  }, [insertPageAtIndex]);

  // Handle failed document load
  const handleFailedDocumentLoad = useCallback((url, fileIndex) => {
    logger.error(`Failed to load document at ${url}`);
    const failedPage = {
      fullSizeUrl: `${process.env.PUBLIC_URL}/lost.png`,
      thumbnailUrl: `${process.env.PUBLIC_URL}/lost.png`,
      loaded: false,
      status: -1,
      fileExtension: 'png',
      fileIndex,
      pageIndex: 0,
    };
    insertPageAtIndex(failedPage, currentPageIndex.current);
    currentPageIndex.current += 1;
  }, [insertPageAtIndex]);

  // Load document asynchronously based on the file extension
  const loadDocumentAsync = useCallback(async (url, index) => {
    try {
      logger.debug(`Loading document`, { url, index });
      const response = await fetch(url);
      logger.debug(`Fetch response`, { url, status: response.status });

      if (!response.ok) {
        throw new Error(`Failed to fetch document at ${url} with status ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();

      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        throw new Error(`Invalid or empty ArrayBuffer for document at ${url}`);
      }

      // Verify file type using `file-type`
      const fileType = await fileTypeFromBuffer(arrayBuffer);
      if (!fileType) {
        throw new Error(`Unexpected file type for document at ${url}: unknown`);
      }

      const fileExtension = fileType.ext;
      const totalPages = await getTotalPages(arrayBuffer, fileExtension);
      logger.debug(`Total pages detected`, { totalPages });

      if (fileExtension === 'pdf') {
        // Process PDF on main thread
        mainThreadJobQueue.current.push({
          arrayBuffer: arrayBuffer.slice(0),
          fileExtension,
          index,
          pageStartIndex: 0,
          pagesInvolved: totalPages,
          allPagesStartingIndex: currentPageIndex.current,
        });
        currentPageIndex.current += totalPages;

      } else if (['tiff', 'tif'].includes(fileExtension)) {
        if (enableMetadataLogging) {
          const metadata = getTiffMetadata(arrayBuffer);
          logger.debug(`TIFF metadata detected`, { metadata });
        }
        for (let pageIndex = 0; pageIndex < totalPages; pageIndex += batchSize) {
          const pagesInvolved = Math.min(batchSize, totalPages - pageIndex);
          if (pagesInvolved > 0) {
            const job = {
              arrayBuffer: arrayBuffer.slice(0),
              fileExtension,
              index,
              pageStartIndex: pageIndex,
              pagesInvolved,
              allPagesStartingIndex: currentPageIndex.current,
            };
            logger.debug(`Queueing job`, { job, currentPageIndex: currentPageIndex.current });
            jobQueue.current.push(job);
            currentPageIndex.current += pagesInvolved;
          }
        }
      } else {
        // Other single-image types
        const job = {
          arrayBuffer: arrayBuffer.slice(0),
          fileExtension,
          index,
          pageStartIndex: 0,
          pagesInvolved: 1,
          allPagesStartingIndex: currentPageIndex.current,
        };
        logger.debug(`Queueing job for image type`, { job, currentPageIndex: currentPageIndex.current });
        jobQueue.current.push(job);
        currentPageIndex.current += 1;
      }
    } catch (error) {
      handleFailedDocumentLoad(url, index);
      if (isMounted.current) {
        setError(error.message);
        logger.error(`Error loading document: ${error.message}`);
      }
    }
  }, [setError, handleFailedDocumentLoad]);

  // Process batches of jobs using workers
  const processBatches = useCallback(() => {
    batchHandler(jobQueue, batchQueue, batchSize, imageWorkers, handleWorkerMessage, insertPageAtIndex, sameBlob, isMounted);
  }, [imageWorkers, sameBlob, insertPageAtIndex]);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    const loadDocuments = async () => {
      preloadPlaceholderImage(currentPageIndex.current);
      const documentUrls = generateDocumentList(folder, extension, endNumber);
      logger.debug('Generated document URLs', { documentUrls });

      try {
        for (let i = 0; i < documentUrls.length; i++) {
          logger.debug(`Processing document URL`, { url: documentUrls[i], index: i });
          await loadDocumentAsync(documentUrls[i], i);
        }

        for (let i = 1; i < currentPageIndex.current; i++) {
          preloadPlaceholderImage(i);
        }

        processBatches();

        while (mainThreadJobQueue.current.length > 0) {
          const job = mainThreadJobQueue.current.shift();
          if (job.fileExtension === 'pdf') {
            await renderPDFInMainThread(job, insertPageAtIndex, sameBlob, isMounted);
          } else if (['tiff', 'tif'].includes(job.fileExtension)) {
            await renderTIFFInMainThread(job, insertPageAtIndex, sameBlob, isMounted);
          }
        }
      } catch (error) {
        if (isMounted.current) {
          setError(error.message);
          logger.error('Error loading documents', { error: error.message });
        }
      }
    };

    loadDocuments();

    return () => {
      isMounted.current = false;
      imageWorkers.forEach(worker => worker.terminate());
    };
  }, [folder, extension, setError, imageWorkers, endNumber, loadDocumentAsync, insertPageAtIndex, sameBlob, processBatches, preloadPlaceholderImage]);

  return children;
};

export default DocumentLoader;
