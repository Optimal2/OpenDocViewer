// File: src/ocr/__tests__/classify.test.js
/**
 * Page classification: raster pages are recognised, PDF pages are probed for a text layer first,
 * anything else is skipped; and the text-layer assessment calls a layer empty, garbled or usable
 * by the documented thresholds.
 */
import { describe, expect, it } from 'vitest';
import {
  OCR_PAGE_DECISION,
  OCR_SKIP_REASON,
  PDF_TEXT_LAYER_THRESHOLDS,
  assessPdfTextLayer,
  classifyPageSource,
} from '../classify.js';

describe('classifyPageSource', () => {
  it.each(['png', 'PNG', 'jpg', 'jpeg', 'jfif', 'tif', 'tiff', 'bmp', 'gif', 'webp', ' Tiff '])(
    'recognises a raster page (%s)',
    (fileExtension) => {
      expect(classifyPageSource({ fileExtension, status: 1 })).toEqual({ decision: OCR_PAGE_DECISION.RECOGNIZE, reason: undefined });
    }
  );

  it('probes the text layer of a PDF page first', () => {
    expect(classifyPageSource({ fileExtension: 'pdf', status: 1 })).toEqual({ decision: OCR_PAGE_DECISION.PROBE_TEXT, reason: undefined });
  });

  it('skips a failed page before looking at its format', () => {
    expect(classifyPageSource({ fileExtension: 'png', status: -1 })).toEqual({ decision: OCR_PAGE_DECISION.SKIP, reason: OCR_SKIP_REASON.FAILED_PAGE });
    expect(classifyPageSource(null)).toEqual({ decision: OCR_PAGE_DECISION.SKIP, reason: OCR_SKIP_REASON.FAILED_PAGE });
  });

  it.each(['', 'txt', 'docx', 'svg'])('skips a format the viewer does not rasterise (%j)', (fileExtension) => {
    expect(classifyPageSource({ fileExtension, status: 1 })).toEqual({ decision: OCR_PAGE_DECISION.SKIP, reason: OCR_SKIP_REASON.UNSUPPORTED });
  });
});

describe('assessPdfTextLayer', () => {
  it('calls a usable layer usable and counts its characters', () => {
    const result = assessPdfTextLayer(['Patientjournal, sida 1 av 3.', ' Besök den 12 mars 2024 ']);
    expect(result).toMatchObject({ usable: true, verdict: 'usable', privateUse: 0 });
    expect(result.characters).toBe(42);
    expect(result.letters).toBe(40);
  });

  it('calls fewer visible characters than the threshold empty (a scanned page with a page number)', () => {
    expect(assessPdfTextLayer(['  ', '12', '\n'])).toMatchObject({ usable: false, verdict: 'empty', characters: 2 });
    expect(assessPdfTextLayer([])).toMatchObject({ usable: false, verdict: 'empty', characters: 0 });
    expect(assessPdfTextLayer(null)).toMatchObject({ usable: false, verdict: 'empty' });
    expect(PDF_TEXT_LAYER_THRESHOLDS.minCharacters).toBe(20);
  });

  it('calls a layer of private-use glyphs garbled (a font without a ToUnicode map)', () => {
    const privateUse = Array.from({ length: 30 }, (_, index) => String.fromCharCode(0xe000 + index)).join('');
    expect(assessPdfTextLayer([privateUse])).toMatchObject({ usable: false, verdict: 'garbled', privateUse: 30, letters: 0 });
    expect(assessPdfTextLayer(['Rubrik med text här', '������'])).toMatchObject({ verdict: 'garbled' });
  });

  it('calls a layer with mostly symbols garbled but tolerates ordinary punctuation', () => {
    expect(assessPdfTextLayer(['|||| ---- ==== ++++ **** ####'])).toMatchObject({ usable: false, verdict: 'garbled' });
    expect(assessPdfTextLayer(['Summa: 1 234,50 kr (inkl. moms) — se bilaga 2!'])).toMatchObject({ usable: true });
  });

  it('counts letters of any script, including åäö and digits', () => {
    const result = assessPdfTextLayer(['Åäö ÅÄÖ é ü 0123456789 Ωλ']);
    expect(result.letters).toBe(20);
    expect(result.characters).toBe(20);
    expect(result.usable).toBe(true);
  });

  it('honours threshold overrides', () => {
    expect(assessPdfTextLayer(['abc'], { minCharacters: 3 })).toMatchObject({ usable: true });
    expect(assessPdfTextLayer(['abc def ghi jkl mno pqr stu vwx'], { minLetterShare: 0.99 })).toMatchObject({ usable: true });
    expect(assessPdfTextLayer(['abc def ghi jkl mno pqr stu vw.'], { minLetterShare: 0.99 })).toMatchObject({ verdict: 'garbled' });
  });
});
