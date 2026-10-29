// File: src/hooks/useOcrModule.js
/**
 * Loads the OCR module once the runtime switch (`ocr.enabled`) is the literal true.
 *
 * This is the viewer's only contact with src/ocr/: it goes through src/utils/ocrLoader.js, whose
 * `import()` is the single reference to that folder, so while the switch is off nothing is
 * fetched, no worker starts and the hook returns null without side effects. While on, the lazy
 * ocr chunk is downloaded once per session and the module is returned when it has arrived.
 *
 * Recognition itself (engine, page queue, text layer) is wired in the following versions; this
 * hook only makes the module available to them.
 */
import { useEffect, useState } from 'react';
import logger from '../logging/systemLogger.js';
import { loadOcrModule } from '../utils/ocrLoader.js';
import { isOcrEnabled } from '../utils/runtimeConfig.js';

/**
 * @returns {(Object|null)} The OCR module (src/ocr/index.js) once loaded, otherwise null.
 */
export default function useOcrModule() {
  const enabled = isOcrEnabled();
  const [ocrModule, setOcrModule] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    loadOcrModule()
      .then((loaded) => {
        if (active) setOcrModule(loaded);
      })
      .catch((error) => {
        logger.warn('OCR module could not be loaded; OCR stays off for this session', {
          error: String(error?.message || error),
        });
      });
    return () => {
      active = false;
    };
  }, [enabled]);

  return enabled ? ocrModule : null;
}
