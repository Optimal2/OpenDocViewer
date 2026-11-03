// File: tests/ui/signature-first-check-app/main.js
// This entry exists only in the dedicated measurement build. It exposes the
// real production inspector, including its production worker and comparator.
import { getDocumentSignatures } from '../../../src/utils/pdfSignatureInspector.js';

window.__ODV_FIRST_CHECK_MEASUREMENT__ = Object.freeze({ getDocumentSignatures });
