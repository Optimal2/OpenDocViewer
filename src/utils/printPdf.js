// File: src/utils/printPdf.js
/**
 * File: src/utils/printPdf.js
 *
 * OpenDocViewer — Generated PDF print backend.
 *
 * PURPOSE
 *   Build a printable PDF from already-rendered page image URLs. This backend is intended as a
 *   browser-preview alternative for larger jobs where Chromium/Edge is slow to build print preview
 *   from a many-page HTML/IMG document.
 */

import i18next from 'i18next';
import logger from '../logging/systemLogger.js';
import { applyTemplateTokensEscaped, makeBaseTokenContext, makePageTokenContext, resolveCopyMarkerText } from './printTemplate.js';
import { resolveLocalizedValue } from './localizedValue.js';
import { isSafeImageSrc } from './printSanitize.js';
import { resolveWatermarkAssetSrc } from './printWatermark.js';

// A4 page dimensions in PostScript points. jsPDF uses 1 pt = 1/72 inch.
const A4_PAGE_PT = Object.freeze({ width: 595.28, height: 841.89, unit: 'pt' });
const A4_PORTRAIT = [A4_PAGE_PT.width, A4_PAGE_PT.height];
const A4_LANDSCAPE = [A4_PAGE_PT.height, A4_PAGE_PT.width];
const DEFAULT_PDF_FILENAME = 'opendocviewer-print.pdf';
const HEADER_FOOTER_COLOR = Object.freeze([35, 35, 35]);
const FOOTER_COLOR = Object.freeze([70, 70, 70]);
const MAX_HEADER_FOOTER_LINES = 3;
const MAX_FOOTER_LINES = 2;
const HEADER_FOOTER_LINE_HEIGHT = 1.18;
const MIN_WATERMARK_FONT_SIZE = 70;
const WATERMARK_FONT_SCALE = 0.19;
const WATERMARK_OPACITY = 0.09;
// Keep PDF and HTML watermarks visually aligned. 0 degrees means centered horizontal text.
const WATERMARK_ROTATION_ANGLE = 0;
const WATERMARK_SHADOW_OFFSET = 1.4;
const WATERMARK_IMAGE_WIDTH_SCALE = 0.82;
const WATERMARK_IMAGE_MAX_HEIGHT_SCALE = 0.42;

/**
 * @typedef {Object} PdfPrintOptions
 * @property {string=} reason
 * @property {string=} forWhom
 * @property {string=} printFormat
 * @property {Object=} reasonSelection
 * @property {Object=} printFormatSelection
 * @property {Object=} bundle
 * @property {Array<*>=} pageContexts
 * @property {Object=} printHeaderCfg
 * @property {Object=} printFooterCfg
 * @property {Object=} printFormatCfg
 * @property {Object=} pdfCfg
 * @property {AbortSignal=} signal
 * @property {function(Object): void=} onProgress
 */

/**
 * @param {*} value
 * @returns {number}
 */
function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Normalize canvas/PDF image quality to the browser-supported 0..1 range.
 * @param {*} value
 * @param {number} defaultValue
 * @returns {number}
 */
function normalizeQuality(value, defaultValue) {
  const n = Number(value);
  const fallback = Number.isFinite(defaultValue) ? defaultValue : 0.9;
  if (!Number.isFinite(n)) return Math.min(1, Math.max(0, fallback));
  return Math.min(1, Math.max(0, n));
}

/**
 * @returns {Error}
 */
function createAbortError() {
  try {
    return new DOMException('PDF generation was cancelled.', 'AbortError');
  } catch {
    const error = new Error('PDF generation was cancelled.');
    error.name = 'AbortError';
    return error;
  }
}

/**
 * @param {AbortSignal|undefined} signal
 * @returns {void}
 */
function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function isBoldFontWeight(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return false;
  if (text === 'bold' || text === 'bolder') return true;
  const numeric = Number.parseInt(text, 10);
  return Number.isFinite(numeric) && numeric >= 600;
}

/**
 * @param {string} style
 * @returns {{ bold?: boolean, italic?: boolean }}
 */
function parseInlineTextStyle(style) {
  const result = {};
  const text = String(style || '');
  if (!text) return result;
  text.split(';').forEach((part) => {
    const separator = part.indexOf(':');
    if (separator === -1) return;
    const property = part.slice(0, separator).trim().toLowerCase();
    const value = part.slice(separator + 1).trim().toLowerCase();
    if (property === 'font-weight' && isBoldFontWeight(value)) result.bold = true;
    if (property === 'font-style' && (value === 'italic' || value === 'oblique')) result.italic = true;
  });
  return result;
}

/**
 * @param {string} nodeName
 * @returns {boolean}
 */
function isBlockNode(nodeName) {
  return ['address', 'article', 'aside', 'blockquote', 'div', 'footer', 'header', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'main', 'p', 'section', 'tr'].includes(nodeName);
}

/**
 * @param {Array<Array<{ text: string, bold: boolean, italic: boolean }>>} lines
 * @returns {void}
 */
function ensureWritableRichLine(lines) {
  if (!lines.length) lines.push([]);
}

/**
 * @param {Array<Array<{ text: string, bold: boolean, italic: boolean }>>} lines
 * @returns {void}
 */
function appendRichLineBreak(lines) {
  if (!lines.length || lines[lines.length - 1].length > 0) lines.push([]);
}

/**
 * @param {Array<Array<{ text: string, bold: boolean, italic: boolean }>>} lines
 * @param {string} text
 * @param {{ bold?: boolean, italic?: boolean }} style
 * @returns {void}
 */
function appendRichText(lines, text, style) {
  const normalized = String(text || '').replace(/\u00a0/g, ' ');
  if (!normalized) return;
  const parts = normalized.split(/\r\n|\r|\n/);
  parts.forEach((part, index) => {
    if (index > 0) appendRichLineBreak(lines);
    const collapsed = part.replace(/[ \t\f\v]+/g, ' ');
    if (!collapsed.trim()) {
      if (lines.length && lines[lines.length - 1].length > 0) {
        const line = lines[lines.length - 1];
        line[line.length - 1].text += ' ';
      }
      return;
    }
    ensureWritableRichLine(lines);
    lines[lines.length - 1].push({
      text: collapsed,
      bold: !!style?.bold,
      italic: !!style?.italic,
    });
  });
}

/**
 * Parse a small, print-template-oriented HTML subset into styled text lines for jsPDF.
 * Full browser CSS layout is intentionally not attempted here; this supports the formatting
 * commonly used by ODV print headers/footers: line breaks, block breaks, bold, italic and
 * equivalent inline styles.
 * @param {string} html
 * @returns {Array<Array<{ text: string, bold: boolean, italic: boolean }>>}
 */
function htmlToRichLines(html) {
  const input = String(html || '');
  /** @type {Array<Array<{ text: string, bold: boolean, italic: boolean }>>} */
  const lines = [[]];
  try {
    const doc = new DOMParser().parseFromString(`<!doctype html><body>${input}`, 'text/html');
    doc.body?.querySelectorAll?.('script,style,template,noscript,iframe,object,embed')?.forEach((node) => node.remove());

    /**
     * @param {Node} node
     * @param {{ bold?: boolean, italic?: boolean }} inherited
     * @returns {void}
     */
    const walk = (node, inherited) => {
      if (node.nodeType === 3) {
        appendRichText(lines, node.textContent || '', inherited);
        return;
      }

      if (node.nodeType !== 1) return;
      const element = /** @type {Element} */ (node);
      const nodeName = element.nodeName.toLowerCase();
      if (nodeName === 'br') {
        appendRichLineBreak(lines);
        return;
      }

      const inlineStyle = parseInlineTextStyle(element.getAttribute('style') || '');
      const next = {
        bold: !!(inherited.bold || inlineStyle.bold || nodeName === 'b' || nodeName === 'strong' || nodeName === 'bold'),
        italic: !!(inherited.italic || inlineStyle.italic || nodeName === 'i' || nodeName === 'em'),
      };

      const block = isBlockNode(nodeName);
      if (block) appendRichLineBreak(lines);
      if (nodeName === 'li') appendRichText(lines, '- ', next);
      Array.from(element.childNodes || []).forEach((child) => walk(child, next));
      if (block) appendRichLineBreak(lines);
    };

    Array.from(doc.body?.childNodes || []).forEach((node) => walk(node, {}));
  } catch {
    appendRichText(lines, input.replace(/\u00a0/g, ' '), {});
  }

  return lines
    .map((line) => line
      .map((segment) => ({ ...segment, text: segment.text.replace(/\s+/g, ' ') }))
      .filter((segment) => segment.text))
    .filter((line) => line.length > 0);
}

/**
 * @param {*} cfg
 * @param {Object} tokenContext
 * @param {number} page
 * @param {number} total
 * @returns {Array<Array<{ text: string, bold: boolean, italic: boolean }>>}
 */
function renderOverlayRichLines(cfg, tokenContext, page, total) {
  if (!cfg || cfg.enabled === false) return [];
  const applyTo = cfg.applyTo || 'all';
  if (applyTo === 'first' && page !== 1) return [];
  if (applyTo === 'last' && page !== total) return [];
  const tpl = resolveLocalizedValue(cfg.template || '', i18next);
  if (!tpl) return [];
  const html = applyTemplateTokensEscaped(tpl, { ...tokenContext, page, totalPages: total });
  return htmlToRichLines(html);
}

/**
 * @param {string} src
 * @param {AbortSignal=} signal
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(src, signal) {
  return new Promise((resolve, reject) => {
    if (!isSafeImageSrc(src)) {
      reject(new Error('Unsafe image source rejected for PDF generation.'));
      return;
    }
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const img = new Image();
    const cleanup = () => {
      img.onload = null;
      img.onerror = null;
      try { signal?.removeEventListener?.('abort', onAbort); } catch {}
    };
    const onAbort = () => {
      cleanup();
      try { img.src = ''; } catch {}
      reject(createAbortError());
    };
    img.onload = () => {
      cleanup();
      resolve(img);
    };
    img.onerror = () => {
      cleanup();
      reject(new Error('Failed to load image for PDF generation.'));
    };
    try { signal?.addEventListener?.('abort', onAbort, { once: true }); } catch {}
    img.src = src;
  });
}

/**
 * @param {HTMLImageElement} img
 * @returns {'PNG'|'JPEG'|'WEBP'}
 */
function inferImageFormat(img) {
  const src = String(img.currentSrc || img.src || '').toLowerCase();
  if (src.startsWith('data:image/jpeg') || src.startsWith('data:image/jpg')) return 'JPEG';
  if (src.startsWith('data:image/webp')) return 'WEBP';
  return 'PNG';
}

/**
 * Convert image to a JPEG data URL only as a last-resort fallback when jsPDF cannot consume the
 * original image element/format directly.
 * @param {HTMLImageElement} img
 * @param {number} quality
 * @returns {string|null}
 */
function imageToJpegDataUrl(img, quality) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, img.naturalWidth || img.width || 1);
    canvas.height = Math.max(1, img.naturalHeight || img.height || 1);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/jpeg', Math.min(1, Math.max(0.1, quality || 0.92)));
  } catch (error) {
    logger.warn('PDF image fallback conversion failed', { error: String(error?.message || error) });
    return null;
  }
}

/**
 * @param {*} pdf
 * @param {HTMLImageElement} img
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {number} fallbackQuality
 * @returns {void}
 */
function addImageWithFallback(pdf, img, x, y, width, height, fallbackQuality) {
  const preferred = inferImageFormat(img);
  const attempts = Array.from(new Set([preferred, 'PNG', 'JPEG']));
  for (const format of attempts) {
    try {
      pdf.addImage(img, format, x, y, width, height, undefined, 'FAST');
      return;
    } catch (error) {
      // jsPDF accepts different image inputs depending on browser and source format.
      // Try the next supported format before falling back to canvas conversion.
      logger.debug('PDF addImage attempt failed', { format, error: String(error?.message || error) });
    }
  }
  const jpeg = imageToJpegDataUrl(img, fallbackQuality);
  if (!jpeg) throw new Error('Unable to add image to generated PDF.');
  pdf.addImage(jpeg, 'JPEG', x, y, width, height, undefined, 'FAST');
}

/**
 * @param {number} width
 * @param {number} height
 * @returns {Array.<number>}
 */
function pageFormatForImage(width, height) {
  return width > height ? A4_LANDSCAPE : A4_PORTRAIT;
}

/**
 * @param {*} pdf
 * @param {Array<{ text: string, bold: boolean, italic: boolean }>} line
 * @returns {boolean}
 */
function richLineHasText(line) {
  return Array.isArray(line) && line.some((segment) => String(segment?.text || '').trim());
}

/**
 * @param {{ bold?: boolean, italic?: boolean }} segment
 * @returns {'normal'|'bold'|'italic'|'bolditalic'}
 */
function segmentFontStyle(segment) {
  if (segment?.bold && segment?.italic) return 'bolditalic';
  if (segment?.bold) return 'bold';
  if (segment?.italic) return 'italic';
  return 'normal';
}

/**
 * @param {*} pdf
 * @param {{ text: string, bold?: boolean, italic?: boolean }} segment
 * @param {number} fontSize
 * @returns {number}
 */
function measureRichSegment(pdf, segment, fontSize) {
  pdf.setFont('helvetica', segmentFontStyle(segment));
  pdf.setFontSize(fontSize);
  return pdf.getTextWidth(String(segment?.text || ''));
}

/**
 * @param {*} pdf
 * @param {Array<Array<{ text: string, bold: boolean, italic: boolean }>>} richLines
 * @param {number} maxWidth
 * @param {number} fontSize
 * @param {number} maxLines
 * @returns {Array<Array<{ text: string, bold: boolean, italic: boolean }>>}
 */
function wrapRichLines(pdf, richLines, maxWidth, fontSize, maxLines) {
  /** @type {Array<Array<{ text: string, bold: boolean, italic: boolean }>>} */
  const out = [];
  const sourceLines = (Array.isArray(richLines) ? richLines : []).filter(richLineHasText);

  for (const sourceLine of sourceLines) {
    /** @type {Array<{ text: string, bold: boolean, italic: boolean }>} */
    let current = [];
    let currentWidth = 0;

    for (const segment of sourceLine) {
      const tokens = String(segment.text || '').match(/\S+\s*/g) || [];
      for (const token of tokens) {
        const nextSegment = { ...segment, text: token };
        const tokenWidth = measureRichSegment(pdf, nextSegment, fontSize);
        if (current.length && currentWidth + tokenWidth > maxWidth) {
          out.push(current);
          if (out.length >= maxLines) return out;
          current = [];
          currentWidth = 0;
        }
        current.push(nextSegment);
        currentWidth += tokenWidth;
      }
    }

    if (current.length) {
      out.push(current);
      if (out.length >= maxLines) return out;
    }
  }

  return out.slice(0, maxLines);
}

/**
 * @param {*} pdf
 * @param {Array<Array<{ text: string, bold: boolean, italic: boolean }>>} richLines
 * @param {number} x
 * @param {number} y
 * @param {number} maxWidth
 * @param {number} fontSize
 * @param {Array<number>} color
 * @param {number} maxLines
 * @returns {number} height consumed
 */
function drawRichTextBlock(pdf, richLines, x, y, maxWidth, fontSize, color, maxLines) {
  const lines = wrapRichLines(pdf, richLines, maxWidth, fontSize, maxLines);
  if (!lines.length) return 0;
  const lineHeight = fontSize * HEADER_FOOTER_LINE_HEIGHT;
  pdf.setFontSize(fontSize);
  pdf.setTextColor(...color);

  lines.forEach((line, index) => {
    const yPos = y + (index * lineHeight);
    let offset = 0;
    line.forEach((segment) => {
      const text = String(segment.text || '');
      if (!text) return;
      pdf.setFont('helvetica', segmentFontStyle(segment));
      pdf.text(text, x + offset, yPos);
      offset += pdf.getTextWidth(text);
    });
  });
  return lines.length * lineHeight;
}

/**
 * @param {*} pdf
 * @param {string} text
 * @param {number} pageWidth
 * @param {number} pageHeight
 * @returns {void}
 */
function drawWatermark(pdf, text, pageWidth, pageHeight) {
  const clean = String(text || '').trim();
  if (!clean) return;
  const fontSize = Math.max(MIN_WATERMARK_FONT_SIZE, Math.min(pageWidth, pageHeight) * WATERMARK_FONT_SCALE);
  const x = pageWidth / 2;
  const y = pageHeight / 2;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(fontSize);

  let restoreGState = false;
  try {
    if (typeof pdf.GState === 'function' && typeof pdf.setGState === 'function') {
      pdf.setGState(new pdf.GState({ opacity: WATERMARK_OPACITY }));
      restoreGState = true;
    }
  } catch (error) {
    // Older jsPDF builds can lack GState support. The fallback colors below still keep the
    // watermark visible without making PDF generation fail.
    logger.debug('PDF watermark opacity setup skipped', { error: String(error?.message || error) });
  }

  // Match the HTML print watermark as closely as jsPDF allows: large, centered, light fill
  // with a darker contrast layer so it remains visible on both bright and dark page images.
  pdf.setTextColor(255, 255, 255);
  pdf.text(clean, x, y, { align: 'center', angle: WATERMARK_ROTATION_ANGLE });
  pdf.setTextColor(0, 0, 0);
  pdf.text(clean, x + WATERMARK_SHADOW_OFFSET, y + WATERMARK_SHADOW_OFFSET, { align: 'center', angle: WATERMARK_ROTATION_ANGLE });

  if (restoreGState) {
    try {
      pdf.setGState(new pdf.GState({ opacity: 1 }));
    } catch (error) {
      logger.debug('PDF watermark opacity restore skipped', { error: String(error?.message || error) });
    }
  }
}

/**
 * Draw a prepared transparent PNG watermark, scaled to page width and centered.
 * @param {*} pdf
 * @param {HTMLImageElement} img
 * @param {number} pageWidth
 * @param {number} pageHeight
 * @returns {boolean}
 */
function drawWatermarkImage(pdf, img, pageWidth, pageHeight) {
  if (!img) return false;
  const naturalWidth = Math.max(1, img.naturalWidth || img.width || 1);
  const naturalHeight = Math.max(1, img.naturalHeight || img.height || 1);
  const aspect = naturalWidth / naturalHeight;
  let drawWidth = pageWidth * WATERMARK_IMAGE_WIDTH_SCALE;
  let drawHeight = drawWidth / aspect;
  const maxHeight = pageHeight * WATERMARK_IMAGE_MAX_HEIGHT_SCALE;
  if (drawHeight > maxHeight) {
    drawHeight = maxHeight;
    drawWidth = drawHeight * aspect;
  }

  const x = (pageWidth - drawWidth) / 2;
  const y = (pageHeight - drawHeight) / 2;
  try {
    pdf.addImage(img, 'PNG', x, y, drawWidth, drawHeight, undefined, 'FAST');
    return true;
  } catch (error) {
    logger.warn('PDF watermark image rendering failed; falling back to text watermark', { error: String(error?.message || error) });
    return false;
  }
}

/**
 * @param {PdfPrintOptions} options
 * @returns {Object}
 */
function makeTokenContext(options) {
  return makeBaseTokenContext(null, options.reason || '', options.forWhom || '', options.printFormat || '', {
    bundle: options.bundle || null,
    reasonSelection: options.reasonSelection || null,
    printFormatSelection: options.printFormatSelection || null,
  });
}

/**
 * @param {PdfPrintOptions} options
 * @param {Object} event
 * @returns {void}
 */
function reportProgress(options, event) {
  try {
    if (typeof options?.onProgress === 'function') options.onProgress(event);
  } catch (error) {
    // Progress reporting is best-effort UI feedback only; never fail the actual PDF job.
    logger.debug('PDF progress callback failed', { error: String(error?.message || error) });
  }
}

/**
 * Build a PDF blob from page image URLs and print metadata.
 * @param {Array<string>} dataUrls
 * @param {PdfPrintOptions=} options
 * @returns {Promise<Blob>}
 */
export async function createPrintPdfBlob(dataUrls, options = {}) {
  throwIfAborted(options.signal);
  const urls = (Array.isArray(dataUrls) ? dataUrls : []).filter((url) => typeof url === 'string' && url && isSafeImageSrc(url));
  if (!urls.length) throw new Error('No printable image URLs were available for PDF generation.');

  const pdfCfg = options.pdfCfg || {};
  const marginPt = Math.max(0, asNumber(pdfCfg.marginPt) || 8);
  const headerReservePt = Math.max(0, asNumber(pdfCfg.headerReservePt) || 18);
  const footerReservePt = Math.max(0, asNumber(pdfCfg.footerReservePt) || 14);
  const textFontSize = Math.max(5, asNumber(pdfCfg.textFontSize) || 7);
  const imageFallbackQuality = normalizeQuality(pdfCfg.imageFallbackQuality, 0.9);
  const bundle = options.bundle || null;
  const baseContext = makeTokenContext(options);
  const total = urls.length;
  let watermarkImage = null;
  const watermarkAssetSrc = resolveWatermarkAssetSrc(options.printFormatCfg?.watermark || {}, i18next);
  if (watermarkAssetSrc) {
    try {
      watermarkImage = await loadImage(watermarkAssetSrc, options.signal);
    } catch (error) {
      throwIfAborted(options.signal);
      logger.warn('PDF watermark image could not be loaded; falling back to text watermark', { error: String(error?.message || error) });
    }
  }

  reportProgress(options, { phase: 'loading-library', current: 0, total });
  throwIfAborted(options.signal);
  const { jsPDF } = await import('jspdf');
  throwIfAborted(options.signal);
  reportProgress(options, { phase: 'generating', current: 0, total });
  /** @type {*|null} */
  let pdf = null;

  for (let i = 0; i < urls.length; i += 1) {
    throwIfAborted(options.signal);
    reportProgress(options, { phase: 'generating', current: i, total });
    const img = await loadImage(urls[i], options.signal);
    throwIfAborted(options.signal);
    const naturalWidth = Math.max(1, img.naturalWidth || img.width || 1);
    const naturalHeight = Math.max(1, img.naturalHeight || img.height || 1);
    const [pageWidth, pageHeight] = pageFormatForImage(naturalWidth, naturalHeight);
    const orientation = pageWidth > pageHeight ? 'landscape' : 'portrait';

    if (!pdf) {
      pdf = new jsPDF({ orientation, unit: 'pt', format: [pageWidth, pageHeight], compress: true });
    } else {
      pdf.addPage([pageWidth, pageHeight], orientation);
    }

    const pageInfo = Array.isArray(options.pageContexts) ? options.pageContexts[i] : null;
    const pageContext = makePageTokenContext(baseContext, pageInfo, bundle);
    const headerLines = renderOverlayRichLines(options.printHeaderCfg || {}, pageContext, i + 1, total);
    const footerLines = renderOverlayRichLines(options.printFooterCfg || {}, pageContext, i + 1, total);
    const headerDrawLines = wrapRichLines(pdf, headerLines, pageWidth - (marginPt * 2), textFontSize, MAX_HEADER_FOOTER_LINES);
    const footerFontSize = Math.max(5, textFontSize - 0.5);
    const footerDrawLines = wrapRichLines(pdf, footerLines, pageWidth - (marginPt * 2), footerFontSize, MAX_FOOTER_LINES);
    const hasHeader = headerDrawLines.length > 0;
    const hasFooter = footerDrawLines.length > 0;
    const copyText = resolveCopyMarkerText(pageContext);
    const headerReserve = hasHeader ? Math.max(headerReservePt, (headerDrawLines.length * textFontSize * HEADER_FOOTER_LINE_HEIGHT) + 2) : 0;
    const footerReserve = hasFooter ? Math.max(footerReservePt, (footerDrawLines.length * footerFontSize * HEADER_FOOTER_LINE_HEIGHT) + 2) : 0;

    if (hasHeader) {
      drawRichTextBlock(pdf, headerDrawLines, marginPt, marginPt + textFontSize, pageWidth - (marginPt * 2), textFontSize, HEADER_FOOTER_COLOR, MAX_HEADER_FOOTER_LINES);
    }
    if (hasFooter) {
      const lineHeight = Math.max(5, footerFontSize * HEADER_FOOTER_LINE_HEIGHT);
      const firstY = pageHeight - marginPt - ((footerDrawLines.length - 1) * lineHeight);
      drawRichTextBlock(pdf, footerDrawLines, marginPt, firstY, pageWidth - (marginPt * 2), footerFontSize, FOOTER_COLOR, MAX_FOOTER_LINES);
    }

    const imageBoxX = marginPt;
    const imageBoxY = marginPt + headerReserve;
    const imageBoxWidth = pageWidth - (marginPt * 2);
    const imageBoxHeight = Math.max(1, pageHeight - (marginPt * 2) - headerReserve - footerReserve);
    const scale = Math.min(imageBoxWidth / naturalWidth, imageBoxHeight / naturalHeight);
    const drawWidth = naturalWidth * scale;
    const drawHeight = naturalHeight * scale;
    const drawX = imageBoxX + ((imageBoxWidth - drawWidth) / 2);
    const drawY = imageBoxY + ((imageBoxHeight - drawHeight) / 2);
    addImageWithFallback(pdf, img, drawX, drawY, drawWidth, drawHeight, imageFallbackQuality);

    if (copyText && options.printFormatCfg?.watermark?.enabled !== false) {
      if (watermarkImage && drawWatermarkImage(pdf, watermarkImage, pageWidth, pageHeight)) {
        reportProgress(options, { phase: 'generating', current: i + 1, total });
        continue;
      }
      drawWatermark(pdf, copyText, pageWidth, pageHeight);
    }
    reportProgress(options, { phase: 'generating', current: i + 1, total });
  }

  if (!pdf) throw new Error('PDF generation produced no document.');
  reportProgress(options, { phase: 'finalizing', current: total, total });
  throwIfAborted(options.signal);
  const blob = pdf.output('blob');
  throwIfAborted(options.signal);
  reportProgress(options, { phase: 'done', current: total, total });
  return blob;
}

/**
 * @param {Blob} blob
 * @param {string=} filename
 * @returns {void}
 */
export function downloadPdfBlob(blob, filename = DEFAULT_PDF_FILENAME) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || DEFAULT_PDF_FILENAME;
  document.body.appendChild(a);
  a.click();
  try {
    a.remove();
  } catch (error) {
    logger.debug('PDF download anchor cleanup failed', { error: String(error?.message || error) });
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * Print a generated PDF through a hidden iframe. The caller should invoke this from a user action.
 * @param {Blob} blob
 * @returns {void}
 */
export function printPdfBlob(blob) {
  const url = URL.createObjectURL(blob);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
    visibility: 'hidden',
  });

  let printed = false;
  let cleaned = false;
  const cleanup = (delayMs = 0) => {
    if (cleaned) return;
    cleaned = true;
    window.setTimeout(() => {
      try {
        frame.remove();
      } catch (error) {
        logger.debug('PDF print iframe cleanup failed', { error: String(error?.message || error) });
      }
      try {
        URL.revokeObjectURL(url);
      } catch (error) {
        logger.debug('PDF print object URL cleanup failed', { error: String(error?.message || error) });
      }
    }, Math.max(0, delayMs));
  };
  const scheduleFallbackCleanup = () => {
    // Edge/Chromium may keep the PDF preview dependent on the iframe/blob URL while
    // the preview dialog is open. Do not remove the iframe shortly after print(); it
    // can make the PDF preview disappear. afterprint normally cleans it up; this long
    // fallback avoids leaking the object URL if afterprint is not fired.
    window.setTimeout(() => cleanup(0), 10 * 60 * 1000);
  };
  const afterPrint = () => cleanup(120000);
  const invokePrint = () => {
    if (printed) return;
    printed = true;
    try {
      frame.contentWindow?.addEventListener?.('afterprint', afterPrint, { once: true });
    } catch (error) {
      logger.debug('PDF iframe afterprint listener setup failed', { error: String(error?.message || error) });
    }
    try {
      window.addEventListener('afterprint', afterPrint, { once: true });
    } catch (error) {
      logger.debug('Window afterprint listener setup failed', { error: String(error?.message || error) });
    }
    window.setTimeout(() => {
      try {
        frame.contentWindow?.focus?.();
        frame.contentWindow?.print?.();
      } catch (error) {
        logger.warn('Generated PDF print invocation failed', { error: String(error?.message || error) });
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      scheduleFallbackCleanup();
    }, 250);
  };
  frame.addEventListener('load', invokePrint, { once: true });
  frame.src = url;
  document.body.appendChild(frame);
  window.setTimeout(invokePrint, 1800);
}

/**
 * @param {{ current: * }} documentRenderRef
 * @param {Array<number>=} pageNumbers 1-based page numbers in desired PDF order.
 * @param {PdfPrintOptions=} options
 * @returns {Promise<Blob>}
 */
export async function createPdfFromDocumentHandle(documentRenderRef, pageNumbers, options = {}) {
  throwIfAborted(options.signal);
  const handle = documentRenderRef?.current;
  const getUrls = handle?.getAllPrintableDataUrls || handle?.exportAllPagesAsDataUrls;
  if (typeof getUrls !== 'function') throw new Error('Document handle does not expose printable page URLs.');
  const allUrls = await getUrls.call(handle);
  throwIfAborted(options.signal);
  if (!Array.isArray(allUrls) || !allUrls.length) throw new Error('No printable page URLs were returned.');
  const selected = Array.isArray(pageNumbers) && pageNumbers.length
    ? pageNumbers.map((pageNumber) => allUrls[Math.floor(Number(pageNumber)) - 1]).filter(Boolean)
    : allUrls;
  return createPrintPdfBlob(selected, options);
}

/**
 * @param {{ current: * }} documentRenderRef
 * @param {Array<number>=} pageNumbers
 * @param {Object=} options
 * @returns {Promise<void>}
 */
export async function handlePdfOutput(documentRenderRef, pageNumbers, options = {}) {
  throwIfAborted(options.signal);
  const selectedCount = Array.isArray(pageNumbers) && pageNumbers.length ? pageNumbers.length : 1;
  const blob = await createPdfFromDocumentHandle(documentRenderRef, pageNumbers, options);
  throwIfAborted(options.signal);
  if (options.action === 'download') {
    reportProgress(options, { phase: 'downloading', current: selectedCount, total: selectedCount });
    downloadPdfBlob(blob, options.filename || DEFAULT_PDF_FILENAME);
  } else {
    reportProgress(options, { phase: 'opening-preview', current: selectedCount, total: selectedCount });
    printPdfBlob(blob);
  }
}


/**
 * @param {*} el
 * @returns {string|null}
 */
function printableSourceFromElement(el) {
  const tag = String(el?.tagName || '').toLowerCase();
  if (tag === 'canvas') {
    try {
      const url = el.toDataURL('image/png');
      return typeof url === 'string' && url.startsWith('data:image') ? url : null;
    } catch (error) {
      logger.warn('Unable to export active canvas to PDF image', { error: String(error?.message || error) });
      return null;
    }
  }
  if (tag === 'img') {
    const url = el.currentSrc || el.src || '';
    return isSafeImageSrc(url) ? url : null;
  }
  return null;
}

/**
 * Generate/print/download a PDF from the currently rendered active page surface. This path preserves
 * active-page visual edits because it uses the visible canvas/img rather than the original page blob.
 * @param {{ current: * }} documentRenderRef
 * @param {Object=} options
 * @returns {Promise<void>}
 */
export async function handlePdfCurrent(documentRenderRef, options = {}) {
  throwIfAborted(options.signal);
  const node = documentRenderRef?.current?.getActiveCanvas?.();
  const src = printableSourceFromElement(node);
  if (!src) throw new Error('No active printable surface was available for generated PDF output.');
  const blob = await createPrintPdfBlob([src], { ...options, pageContexts: Array.isArray(options.pageContexts) ? options.pageContexts.slice(0, 1) : [] });
  throwIfAborted(options.signal);
  if (options.action === 'download') {
    reportProgress(options, { phase: 'downloading', current: 1, total: 1 });
    downloadPdfBlob(blob, options.filename || DEFAULT_PDF_FILENAME);
  } else {
    reportProgress(options, { phase: 'opening-preview', current: 1, total: 1 });
    printPdfBlob(blob);
  }
}

/**
 * Generate/print/download a two-page PDF from the currently rendered comparison surfaces.
 * @param {{ current: * }} primaryRenderRef
 * @param {{ current: * }} compareRenderRef
 * @param {Object=} options
 * @returns {Promise<void>}
 */
export async function handlePdfCurrentComparison(primaryRenderRef, compareRenderRef, options = {}) {
  throwIfAborted(options.signal);
  const primary = printableSourceFromElement(primaryRenderRef?.current?.getActiveCanvas?.());
  const compare = printableSourceFromElement(compareRenderRef?.current?.getActiveCanvas?.());
  const urls = [primary, compare].filter(Boolean);
  if (urls.length !== 2) throw new Error('Both comparison surfaces are required for generated PDF output.');
  const blob = await createPrintPdfBlob(urls, { ...options, pageContexts: Array.isArray(options.pageContexts) ? options.pageContexts.slice(0, 2) : [] });
  throwIfAborted(options.signal);
  if (options.action === 'download') {
    reportProgress(options, { phase: 'downloading', current: urls.length, total: urls.length });
    downloadPdfBlob(blob, options.filename || DEFAULT_PDF_FILENAME);
  } else {
    reportProgress(options, { phase: 'opening-preview', current: urls.length, total: urls.length });
    printPdfBlob(blob);
  }
}
