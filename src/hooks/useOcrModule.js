// File: src/hooks/useOcrModule.js
/**
 * Loads the OCR module once a page can have a text layer: `ocr.enabled` is the literal true, or
 * `pdfTextLayer.enabled` is (a PDF page's own text without OCR).
 *
 * This is the viewer's only contact with src/ocr/: it goes through src/utils/ocrLoader.js, whose
 * `import()` calls are the only references to that folder, so while both switches are off
 * nothing is fetched, no worker starts and the hook returns null without side effects. With OCR
 * on, the lazy ocr chunk is downloaded once per session; with only the PDF text on, the
 * text-only entry is (no engine code). The module is returned when it has arrived.
 *
 * What is done with it (engine, page queue, text layer) is hooks/useOcrTextLayers.js; this hook
 * only makes the module available.
 */
import { useEffect, useState } from 'react';
import logger from '../logging/systemLogger.js';
import { loadOcrModule } from '../utils/ocrLoader.js';
import { isPageTextEnabled } from '../utils/runtimeConfig.js';

/**
 * @returns {(Object|null)} The OCR module (src/ocr/index.js), or its text-only entry
 *   (src/ocr/pdfText.js) while only `pdfTextLayer.enabled` is on, once loaded; otherwise null.
 */
export default function useOcrModule() {
  const enabled = isPageTextEnabled();
  const [ocrModule, setOcrModule] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    loadOcrModule()
      .then((loaded) => {
        if (active) setOcrModule(loaded);
      })
      .catch((error) => {
        logger.warn('OCR module could not be loaded; pages get no text layer in this session', {
          error: String(error?.message || error),
        });
      });
    return () => {
      active = false;
    };
  }, [enabled]);

  return enabled ? ocrModule : null;
}
