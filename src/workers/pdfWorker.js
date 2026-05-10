// File: src/workers/pdfWorker.js
/**
 * OpenDocViewer - generated PDF worker.
 *
 * v1 uses one dedicated worker to keep expensive jsPDF assembly off the UI thread.
 * The job shape includes workerPlan.workerCount/workerBatchSize so a later version can
 * split very large print jobs into partial PDFs and merge them after parallel workers finish.
 */

const workerScope = self;

const A4_PORTRAIT = [595.28, 841.89];
const A4_LANDSCAPE = [841.89, 595.28];
const HEADER_FOOTER_COLOR = Object.freeze([35, 35, 35]);
const FOOTER_COLOR = Object.freeze([70, 70, 70]);
const MAX_HEADER_FOOTER_LINES = 3;
const MAX_FOOTER_LINES = 2;
const HEADER_FOOTER_LINE_HEIGHT = 1.18;
const HEADER_FOOTER_RESERVE_PADDING_PT = 2;
const FOOTER_FONT_SIZE_REDUCTION = 0.5;
const MIN_WATERMARK_FONT_SIZE = 70;
const WATERMARK_FONT_SCALE = 0.19;
const WATERMARK_OPACITY = 0.09;
const WATERMARK_ROTATION_ANGLE = 0;
const WATERMARK_SHADOW_OFFSET = 1.4;
const WATERMARK_IMAGE_WIDTH_SCALE = 0.82;
const WATERMARK_IMAGE_MAX_HEIGHT_SCALE = 0.42;
const JPEG_FALLBACK_DEFAULT_QUALITY = 0.9;
const JPEG_FALLBACK_MIN_QUALITY = 0.6;
const JPEG_FALLBACK_MAX_CANVAS_DIMENSION = 4096;
const PDF_COLUMN_GAP_PT = 12;
const PDF_COLUMN_MIN_WIDTH_PT = 32;
const TWO_COLUMN_LEFT_WIDTH_RATIO = 0.42;
const PDF_PROGRESS_PAGE_START_FRACTION = 0.35;
const ELLIPSIS = '...';
const RICH_SEGMENT_WHITESPACE_RE = /\s+/g;
const RICH_SEGMENT_WORD_TOKEN_RE = /\S+\s*/g;

function postProgress(event) {
  workerScope.postMessage({ type: 'progress', event });
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function normalizeQuality(value, rawDefaultValue, minValue = 0) {
  const n = Number(value);
  const min = clamp01(minValue);
  const candidate = Number.isFinite(n) ? n : rawDefaultValue;
  const result = Number.isFinite(candidate) ? clamp01(candidate) : clamp01(JPEG_FALLBACK_DEFAULT_QUALITY);
  return Math.max(min, result);
}

function resolveJsPdfConstructor(module) {
  const candidates = [
    module?.jsPDF,
    module?.default?.jsPDF,
    module?.default,
  ];
  return candidates.find((candidate) => typeof candidate === 'function') || null;
}

async function loadJsPdf() {
  const module = await import('jspdf');
  const jsPDF = resolveJsPdfConstructor(module);
  if (typeof jsPDF !== 'function') {
    throw new Error('The PDF worker could not resolve the jsPDF constructor from the bundled module.');
  }
  return jsPDF;
}

function imageExtensionFromUrl(src) {
  try {
    const url = new URL(src, workerScope.location?.href || undefined);
    const match = /\.([a-z0-9]+)$/i.exec(url.pathname);
    return match ? match[1].toLowerCase() : '';
  } catch {
    const clean = String(src || '').split(/[?#]/, 1)[0] || '';
    const match = /\.([a-z0-9]+)$/i.exec(clean);
    return match ? match[1].toLowerCase() : '';
  }
}

function formatFromMimeOrUrl(mimeType, src) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'JPEG';
  if (mime.includes('webp')) return 'WEBP';
  if (mime.includes('png')) return 'PNG';
  const ext = imageExtensionFromUrl(src);
  if (ext === 'jpg' || ext === 'jpeg') return 'JPEG';
  if (ext === 'webp') return 'WEBP';
  return 'PNG';
}

function imageFormatAttempts(preferred) {
  if (preferred === 'PNG') return ['PNG', 'JPEG'];
  if (preferred === 'JPEG') return ['JPEG', 'PNG'];
  return ['WEBP', 'PNG', 'JPEG'];
}

function blobToDataUrl(blob) {
  if (typeof workerScope.FileReaderSync === 'function') {
    return Promise.resolve(new workerScope.FileReaderSync().readAsDataURL(blob));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read image blob as data URL.'));
    reader.readAsDataURL(blob);
  });
}

async function loadImageData(src) {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Failed to fetch image for PDF worker: ${response.status}`);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    return {
      dataUrl: await blobToDataUrl(blob),
      blob,
      width: Math.max(1, bitmap.width || 1),
      height: Math.max(1, bitmap.height || 1),
      format: formatFromMimeOrUrl(blob.type, src),
    };
  } finally {
    try { bitmap.close(); } catch {}
  }
}

async function loadImagesConcurrently(urls, concurrency) {
  const results = new Array(urls.length);
  const workerCount = Math.min(Math.max(1, Number(concurrency) || 1), urls.length);
  const pendingIndexes = Array.from({ length: urls.length }, (_, index) => urls.length - 1 - index);
  let completed = 0;
  const takeNextIndex = () => pendingIndexes.pop() ?? null;

  async function loadNext() {
    for (let index = takeNextIndex(); index !== null; index = takeNextIndex()) {
      results[index] = await loadImageData(urls[index]);
      completed += 1;
      postProgress({ phase: 'loading-images', current: completed, total: urls.length });
    }
  }

  await Promise.all(Array.from({ length: workerCount }, loadNext));
  return results;
}

function pageFormatForImage(width, height) {
  return width > height ? A4_LANDSCAPE : A4_PORTRAIT;
}

function createJsPdfOptions(pageWidth, pageHeight, orientation) {
  return {
    orientation,
    unit: 'pt',
    format: [pageWidth, pageHeight],
    compress: true,
  };
}

function getRichLineColumns(line) {
  if (Array.isArray(line?.columns)) {
    return line.columns
      .map((column) => ({
        align: ['left', 'right', 'center'].includes(String(column?.align || '').toLowerCase())
          ? String(column.align).toLowerCase()
          : 'left',
        segments: normalizeRichSegments(column?.segments),
        width: Number.isFinite(column?.width) ? Number(column.width) : undefined,
        xOffset: Number.isFinite(column?.xOffset) ? Number(column.xOffset) : undefined,
      }))
      .filter((column) => richLineHasText(column.segments));
  }

  if (!Array.isArray(line)) return [];
  const segments = normalizeRichSegments(line);
  const align = segments.find((segment) => segment.align && segment.align !== 'left')?.align || 'left';
  return richLineHasText(segments) ? [{ align, segments }] : [];
}

function richLineHasText(segments) {
  return Array.isArray(segments) && segments.some((segment) => String(segment?.text || '').trim());
}

function richLineIsEmpty(line) {
  if (Array.isArray(line)) return line.length === 0;
  const columns = Array.isArray(line?.columns) ? line.columns : [];
  return !columns.some((column) => Array.isArray(column?.segments) && richLineHasText(column.segments));
}

function normalizeRichSegments(segments) {
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => ({
      text: String(segment?.text || '').replace(RICH_SEGMENT_WHITESPACE_RE, ' '),
      bold: !!segment?.bold,
      italic: !!segment?.italic,
      align: ['left', 'right', 'center'].includes(String(segment?.align || '').toLowerCase())
        ? String(segment.align).toLowerCase()
        : 'left',
    }))
    .filter((segment) => segment.text);
}

function segmentFontStyle(segment) {
  if (segment?.bold && segment?.italic) return 'bolditalic';
  if (segment?.bold) return 'bold';
  if (segment?.italic) return 'italic';
  return 'normal';
}

function measureRichSegment(pdf, segment, fontSize) {
  pdf.setFont('helvetica', segmentFontStyle(segment));
  pdf.setFontSize(fontSize);
  return pdf.getTextWidth(String(segment?.text || ''));
}

function measureRichSegments(pdf, segments, fontSize) {
  return (Array.isArray(segments) ? segments : [])
    .reduce((sum, segment) => sum + measureRichSegment(pdf, segment, fontSize), 0);
}

function createDefaultSegment(text) {
  return { text, bold: false, italic: false, align: 'left' };
}

function fitRichSegmentTextToWidth(pdf, segment, maxWidth, fontSize) {
  const chars = Array.from(String(segment?.text || ''));
  if (!chars.length || maxWidth <= 0) return '';
  let low = 1;
  let high = chars.length;
  let best = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = chars.slice(0, mid).join('');
    if (measureRichSegment(pdf, { ...segment, text: candidate }, fontSize) <= maxWidth) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return chars.slice(0, best).join('');
}

function fitRichSegmentsToWidth(pdf, segments, maxWidth, fontSize) {
  const widthLimit = Math.max(0, Number(maxWidth) || 0);
  const source = normalizeRichSegments(segments);
  const measured = source.map((segment) => ({
    segment,
    width: measureRichSegment(pdf, segment, fontSize),
  }));
  const totalWidth = measured.reduce((sum, item) => sum + item.width, 0);
  if (totalWidth <= widthLimit) return source;
  const ellipsisSegment = createDefaultSegment(ELLIPSIS);
  const ellipsisWidth = measureRichSegment(pdf, ellipsisSegment, fontSize);
  const fitted = [];
  let width = 0;
  for (const item of measured) {
    const { segment } = item;
    const text = String(segment.text || '');
    if (!text) continue;
    if (width + item.width + ellipsisWidth > widthLimit) {
      const fittedText = fitRichSegmentTextToWidth(pdf, segment, widthLimit - width - ellipsisWidth, fontSize);
      if (fittedText) fitted.push({ ...segment, text: fittedText });
      fitted.push(ellipsisSegment);
      return fitted;
    }
    fitted.push(segment);
    width += item.width;
  }
  return fitted;
}

function layoutRichColumns(pdf, columns, maxWidth, fontSize) {
  const constrainedWidth = Math.max(0, maxWidth);
  const clean = (Array.isArray(columns) ? columns : [])
    .map((column) => {
      const segments = normalizeRichSegments(column.segments);
      return {
        align: column.align || 'left',
        segments,
        naturalWidth: measureRichSegments(pdf, segments, fontSize),
      };
    })
    .filter((column) => richLineHasText(column.segments));
  if (!clean.length) return [];
  if (clean.length === 1) {
    return clean.map((column) => ({
      align: column.align,
      segments: fitRichSegmentsToWidth(pdf, column.segments, constrainedWidth, fontSize),
      width: constrainedWidth,
      xOffset: 0,
    }));
  }
  if (constrainedWidth <= 0) {
    return clean.map((column) => ({
      align: column.align,
      segments: [],
      width: 0,
      xOffset: 0,
    }));
  }

  const maxGapForWidth = constrainedWidth / (clean.length - 1);
  const gap = Math.min(PDF_COLUMN_GAP_PT, maxGapForWidth);
  const totalGap = gap * (clean.length - 1);
  const available = Math.max(0, constrainedWidth - totalGap);
  const minColumnWidth = Math.min(PDF_COLUMN_MIN_WIDTH_PT, available / clean.length);
  const naturalTotal = clean.reduce((sum, column) => sum + column.naturalWidth, 0);
  let widths;

  if (naturalTotal <= available) {
    widths = clean.map((column) => column.naturalWidth);
  } else if (clean.length === 2) {
    const leftNatural = clean[0].naturalWidth;
    const leftWidth = Math.min(leftNatural, Math.max(minColumnWidth, available * TWO_COLUMN_LEFT_WIDTH_RATIO));
    widths = [leftWidth, Math.max(minColumnWidth, available - leftWidth)];
  } else {
    const equalWidth = Math.max(minColumnWidth, available / clean.length);
    widths = clean.map(() => equalWidth);
  }

  let cursor = 0;
  return clean.map((column, index) => {
    const width = Math.max(minColumnWidth, widths[index] || minColumnWidth);
    const result = {
      align: column.align,
      segments: fitRichSegmentsToWidth(pdf, column.segments, width, fontSize),
      width,
      xOffset: cursor,
    };
    cursor += width + gap;
    const isLastColumn = index === clean.length - 1;
    const isTrailingSpaceBetweenColumn = clean.length === 2 && isLastColumn;
    if (isLastColumn && (column.align === 'right' || isTrailingSpaceBetweenColumn)) {
      result.xOffset = Math.max(0, constrainedWidth - width);
    }
    return result;
  });
}

function wrapRichLines(pdf, richLines, maxWidth, fontSize, maxLines) {
  const out = [];
  const sourceLines = (Array.isArray(richLines) ? richLines : []).filter((line) => !richLineIsEmpty(line));

  for (const sourceLine of sourceLines) {
    const columns = getRichLineColumns(sourceLine);
    if (columns.length > 1 || (columns.length === 1 && columns[0].align !== 'left')) {
      out.push({ columns: layoutRichColumns(pdf, columns, maxWidth, fontSize) });
      if (out.length >= maxLines) return out;
      continue;
    }

    const segments = columns[0]?.segments || [];
    let current = [];
    let currentWidth = 0;

    for (const segment of segments) {
      const tokens = String(segment.text || '').match(RICH_SEGMENT_WORD_TOKEN_RE) || [];
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

function drawRichSegments(pdf, segments, x, y) {
  let offset = 0;
  (Array.isArray(segments) ? segments : []).forEach((segment) => {
    const text = String(segment.text || '');
    if (!text) return;
    pdf.setFont('helvetica', segmentFontStyle(segment));
    pdf.text(text, x + offset, y);
    offset += pdf.getTextWidth(text);
  });
  return offset;
}

function drawRichTextBlock(pdf, richLines, x, y, maxWidth, fontSize, color, maxLines) {
  const lines = wrapRichLines(pdf, richLines, maxWidth, fontSize, maxLines);
  if (!lines.length) return 0;
  const lineHeight = fontSize * HEADER_FOOTER_LINE_HEIGHT;
  pdf.setFontSize(fontSize);
  pdf.setTextColor(...color);

  lines.forEach((line, index) => {
    const yPos = y + (index * lineHeight);
    const columns = getRichLineColumns(line);
    columns.forEach((column) => {
      const width = Number.isFinite(column.width) ? Number(column.width) : maxWidth;
      const xOffset = Number.isFinite(column.xOffset) ? Number(column.xOffset) : 0;
      const textWidth = measureRichSegments(pdf, column.segments, fontSize);
      const alignOffset = column.align === 'right'
        ? Math.max(0, width - textWidth)
        : column.align === 'center'
          ? Math.max(0, (width - textWidth) / 2)
          : 0;
      drawRichSegments(pdf, column.segments, x + xOffset + alignOffset, yPos);
    });
  });
  return lines.length * lineHeight;
}

function calculateOverlayReserve(hasOverlay, reservePt, lineCount, fontSize) {
  if (!hasOverlay) return 0;
  const contentReserve = (Math.max(0, lineCount) * Math.max(0, fontSize) * HEADER_FOOTER_LINE_HEIGHT)
    + HEADER_FOOTER_RESERVE_PADDING_PT;
  return Math.max(Math.max(0, reservePt), contentReserve);
}

function imageToJpegDataUrl(image, quality) {
  if (typeof OffscreenCanvas !== 'function') return null;
  try {
    const sourceWidth = Math.max(1, image.width || 1);
    const sourceHeight = Math.max(1, image.height || 1);
    const scale = Math.min(1, JPEG_FALLBACK_MAX_CANVAS_DIMENSION / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    return createImageBitmap(image.blob)
      .then((bitmap) => {
        try {
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(bitmap, 0, 0, width, height);
        } finally {
          try { bitmap.close(); } catch {}
        }
        return canvas.convertToBlob({
          type: 'image/jpeg',
          quality: normalizeQuality(quality, JPEG_FALLBACK_DEFAULT_QUALITY, JPEG_FALLBACK_MIN_QUALITY),
        });
      })
      .then((blob) => blobToDataUrl(blob));
  } catch {
    return null;
  }
}

async function addImageWithFallback(pdf, image, x, y, width, height, fallbackQuality) {
  for (const format of imageFormatAttempts(image.format)) {
    try {
      pdf.addImage(image.dataUrl, format, x, y, width, height, undefined, 'FAST');
      return;
    } catch {
      // Try the next jsPDF-supported format before canvas JPEG fallback.
    }
  }

  const jpeg = await imageToJpegDataUrl(image, fallbackQuality);
  if (!jpeg) throw new Error('Unable to add image to generated PDF inside worker.');
  pdf.addImage(jpeg, 'JPEG', x, y, width, height, undefined, 'FAST');
}

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
  } catch {
    // Keep watermark rendering best-effort for jsPDF builds without GState support.
  }

  pdf.setTextColor(255, 255, 255);
  pdf.text(clean, x, y, { align: 'center', angle: WATERMARK_ROTATION_ANGLE });
  pdf.setTextColor(0, 0, 0);
  pdf.text(clean, x + WATERMARK_SHADOW_OFFSET, y + WATERMARK_SHADOW_OFFSET, { align: 'center', angle: WATERMARK_ROTATION_ANGLE });

  if (restoreGState) {
    try { pdf.setGState(new pdf.GState({ opacity: 1 })); } catch {}
  }
}

function drawWatermarkImage(pdf, image, pageWidth, pageHeight) {
  if (!image) return false;
  const aspect = Math.max(1, image.width || 1) / Math.max(1, image.height || 1);
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
    pdf.addImage(image.dataUrl, 'PNG', x, y, drawWidth, drawHeight, undefined, 'FAST');
    return true;
  } catch {
    return false;
  }
}

async function createPdf(job) {
  const urls = Array.isArray(job?.urls) ? job.urls : [];
  if (!urls.length) throw new Error('PDF worker received no page URLs.');
  const total = urls.length;
  const pdfCfg = job?.pdfCfg || {};
  const workerPlan = job?.workerPlan || {};
  const marginPt = Math.max(0, Number(pdfCfg.marginPt) || 8);
  const headerReservePt = Math.max(0, Number(pdfCfg.headerReservePt) || 18);
  const footerReservePt = Math.max(0, Number(pdfCfg.footerReservePt) || 14);
  const textFontSize = Math.max(5, Number(pdfCfg.textFontSize) || 7);
  const imageFallbackQuality = normalizeQuality(pdfCfg.imageFallbackQuality, JPEG_FALLBACK_DEFAULT_QUALITY);

  postProgress({ phase: 'loading-library', current: 0, total });
  const jsPDF = await loadJsPdf();
  const watermarkImage = job?.watermarkAssetSrc
    ? await loadImageData(job.watermarkAssetSrc).catch(() => null)
    : null;

  postProgress({ phase: 'loading-images', current: 0, total });
  const images = await loadImagesConcurrently(urls, workerPlan.imageLoadConcurrency);
  postProgress({ phase: 'generating', current: 0, total });

  let pdf = null;
  for (let i = 0; i < images.length; i += 1) {
    postProgress({
      phase: 'generating-page',
      current: i,
      progressValue: Math.min(total, i + PDF_PROGRESS_PAGE_START_FRACTION),
      page: i + 1,
      total,
    });

    const image = images[i];
    const [pdfPageWidth, pdfPageHeight] = pageFormatForImage(image.width, image.height);
    const orientation = pdfPageWidth > pdfPageHeight ? 'landscape' : 'portrait';
    if (!pdf) pdf = new jsPDF(createJsPdfOptions(pdfPageWidth, pdfPageHeight, orientation));
    else pdf.addPage([pdfPageWidth, pdfPageHeight], orientation);

    const pagePlan = Array.isArray(job?.pagePlans) ? job.pagePlans[i] || {} : {};
    const headerLines = Array.isArray(pagePlan.headerLines) ? pagePlan.headerLines : [];
    const footerLines = Array.isArray(pagePlan.footerLines) ? pagePlan.footerLines : [];
    const headerDrawLines = wrapRichLines(pdf, headerLines, pdfPageWidth - (marginPt * 2), textFontSize, MAX_HEADER_FOOTER_LINES);
    const footerFontSize = Math.max(5, textFontSize - FOOTER_FONT_SIZE_REDUCTION);
    const footerDrawLines = wrapRichLines(pdf, footerLines, pdfPageWidth - (marginPt * 2), footerFontSize, MAX_FOOTER_LINES);
    const hasHeader = headerDrawLines.length > 0;
    const hasFooter = footerDrawLines.length > 0;
    const headerReserve = calculateOverlayReserve(hasHeader, headerReservePt, headerDrawLines.length, textFontSize);
    const footerReserve = calculateOverlayReserve(hasFooter, footerReservePt, footerDrawLines.length, footerFontSize);

    if (hasHeader) {
      drawRichTextBlock(pdf, headerDrawLines, marginPt, marginPt + textFontSize, pdfPageWidth - (marginPt * 2), textFontSize, HEADER_FOOTER_COLOR, MAX_HEADER_FOOTER_LINES);
    }
    if (hasFooter) {
      const lineHeight = Math.max(5, footerFontSize * HEADER_FOOTER_LINE_HEIGHT);
      const firstY = pdfPageHeight - marginPt - footerFontSize - ((footerDrawLines.length - 1) * lineHeight);
      drawRichTextBlock(pdf, footerDrawLines, marginPt, firstY, pdfPageWidth - (marginPt * 2), footerFontSize, FOOTER_COLOR, MAX_FOOTER_LINES);
    }

    const imageBoxX = marginPt;
    const imageBoxY = marginPt + headerReserve;
    const imageBoxWidth = pdfPageWidth - (marginPt * 2);
    const imageBoxHeight = Math.max(1, pdfPageHeight - (marginPt * 2) - headerReserve - footerReserve);
    const scale = Math.min(imageBoxWidth / image.width, imageBoxHeight / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const drawX = imageBoxX + ((imageBoxWidth - drawWidth) / 2);
    const drawY = imageBoxY + ((imageBoxHeight - drawHeight) / 2);
    await addImageWithFallback(pdf, image, drawX, drawY, drawWidth, drawHeight, imageFallbackQuality);

    const copyText = String(pagePlan.copyText || '').trim();
    if (copyText && job?.watermarkEnabled !== false) {
      if (!watermarkImage || !drawWatermarkImage(pdf, watermarkImage, pdfPageWidth, pdfPageHeight)) {
        drawWatermark(pdf, copyText, pdfPageWidth, pdfPageHeight);
      }
    }
    postProgress({ phase: 'generating', current: i + 1, total });
  }

  if (!pdf) throw new Error('PDF worker produced no document.');
  postProgress({ phase: 'finalizing', current: total, total });
  const blob = pdf.output('blob');
  postProgress({ phase: 'done', current: total, total });
  return blob;
}

workerScope.onmessage = async (event) => {
  const data = event?.data || {};
  if (data.type !== 'createPdf') return;
  try {
    const blob = await createPdf(data.job || {});
    workerScope.postMessage({ type: 'result', blob });
  } catch (error) {
    workerScope.postMessage({ type: 'error', error: String(error?.message || error) });
  }
};
