// @vitest-environment jsdom
// File: src/components/__tests__/ocrTextLayer.test.jsx
/**
 * The OCR text layer places one transparent span per recognised word from the image-pixel boxes,
 * scaled to the stage like the page image and rotated with it, renders nothing without a `done`
 * outcome, and keeps the words as real DOM text in reading order (selection, copy, find and
 * screen readers all see plain text).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import OcrTextLayer from '../OcrTextLayer.jsx';
import { layoutOcrWords, measureWordWidth } from '../../utils/ocrTextLayout.js';

const WORDS = [
  { text: 'Hej', confidence: 95, bbox: { x0: 100, y0: 200, x1: 400, y1: 300 } },
  { text: 'världen', confidence: 88, bbox: { x0: 500, y0: 200, x1: 1100, y1: 300 } },
  { text: '', confidence: 0, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
  { text: 'nobox', confidence: 50 },
  { text: 'flat', confidence: 50, bbox: { x0: 10, y0: 10, x1: 10, y1: 30 } },
];
const OUTCOME = { status: 'done', text: 'Hej världen', confidence: 91, words: WORDS, imageWidth: 2000, imageHeight: 3000 };

describe('layoutOcrWords', () => {
  it('scales boxes from image pixels to the frame and fits the text width with a horizontal scale', () => {
    const measure = (text, fontSize) => text.length * fontSize * 0.5;
    const placed = layoutOcrWords(WORDS, 2000, 3000, 1000, 1500, measure);
    expect(placed).toHaveLength(2);
    expect(placed[0]).toEqual({ text: 'Hej', left: 50, top: 100, width: 150, height: 50, fontSize: 50, textWidth: 75, scaleX: 150 / 75, separator: ' ' });
    // Layout width × horizontal scale is the word box, so the scaled span covers exactly the ink.
    expect(placed[0].textWidth * placed[0].scaleX).toBeCloseTo(150);
    expect(placed[1].left).toBe(250);
    expect(placed[1].width).toBe(300);
    expect(placed[1].scaleX).toBeCloseTo(300 / (7 * 50 * 0.5));
    expect(placed[1].separator).toBe('');
  });

  it('separates words with spaces and lines with newlines, so copied text reads like the page', () => {
    const lines = [
      { text: 'Rad', bbox: { x0: 100, y0: 100, x1: 200, y1: 150 } },
      { text: 'ett', bbox: { x0: 220, y0: 105, x1: 300, y1: 150 } },
      { text: 'Rad', bbox: { x0: 100, y0: 200, x1: 200, y1: 250 } },
      { text: 'två', bbox: { x0: 220, y0: 200, x1: 300, y1: 250 } },
    ];
    const placed = layoutOcrWords(lines, 1000, 1000, 1000, 1000, () => 10);
    expect(placed.map((word) => word.separator)).toEqual([' ', '\n', ' ', '']);
    expect(placed.map((word) => word.text + word.separator).join('')).toBe('Rad ett\nRad två');
  });

  it('returns nothing for an empty image or frame', () => {
    expect(layoutOcrWords(WORDS, 0, 3000, 1000, 1500)).toEqual([]);
    expect(layoutOcrWords(WORDS, 2000, 3000, 0, 1500)).toEqual([]);
    expect(layoutOcrWords(null, 2000, 3000, 1000, 1500)).toEqual([]);
  });

  it('estimates the width without a canvas context (jsdom) and never returns zero', () => {
    expect(measureWordWidth('abc', 20)).toBeGreaterThan(0);
    expect(measureWordWidth('', 20)).toBe(1);
  });
});

describe('OcrTextLayer', () => {
  let root;
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  });

  async function render(props) {
    await act(async () => {
      root.render(createElement(OcrTextLayer, { outcome: OUTCOME, renderWidth: 1000, renderHeight: 1500, zoom: 1, label: 'Tolkad text, sida 1', pageNumber: 1, ...props }));
    });
  }

  it('renders one transparent span per word at the scaled box, with the stage size and zoom of the image', async () => {
    await render({ zoom: 1.5 });
    const layer = container.querySelector('.ocr-text-layer');
    expect(layer).not.toBeNull();
    expect(layer.getAttribute('data-odv-ocr')).toBe('text-layer');
    expect(layer.getAttribute('role')).toBe('group');
    expect(layer.getAttribute('aria-label')).toBe('Tolkad text, sida 1');
    expect(layer.getAttribute('data-page-number')).toBe('1');
    expect(layer.style.width).toBe('1000px');
    expect(layer.style.height).toBe('1500px');
    expect(layer.style.transform).toBe('scale(1.5)');
    expect(layer.style.transformOrigin).toBe('top left');

    const frame = layer.querySelector('.ocr-text-layer-frame');
    expect(frame.style.left).toBe('0px');
    expect(frame.style.width).toBe('1000px');
    expect(frame.style.transform).toBe('');

    const words = [...layer.querySelectorAll('.ocr-text-layer-word')];
    expect(words.map((span) => span.textContent)).toEqual(['Hej ', 'världen']);
    expect(words[0].style.left).toBe('50px');
    expect(words[0].style.top).toBe('100px');
    // Laid out at the measured text width, scaled to the 150 px box.
    const textWidth = parseFloat(words[0].style.width);
    const scaleX = Number(words[0].style.transform.match(/^scaleX\(([\d.]+)\)$/)[1]);
    expect(textWidth * scaleX).toBeCloseTo(150, 3);
    expect(words[0].style.height).toBe('50px');
    expect(words[0].style.fontSize).toBe('50px');
    expect(layer.textContent).toBe('Hej världen');
  });

  it('keeps a double-click on a word from reaching the viewport (fit-mode toggle), but lets other clicks through', async () => {
    const seen = [];
    await act(async () => {
      root.render(createElement('div', { onDoubleClick: () => seen.push('viewport') },
        createElement(OcrTextLayer, { outcome: OUTCOME, renderWidth: 1000, renderHeight: 1500, zoom: 1, label: 'x', pageNumber: 1 })));
    });
    const word = container.querySelector('.ocr-text-layer-word');
    await act(async () => { word.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    expect(seen).toEqual([]);
    const frame = container.querySelector('.ocr-text-layer-frame');
    await act(async () => { frame.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    expect(seen).toEqual(['viewport']);
  });

  it.each([
    [180, { width: '1000px', height: '1500px', left: '0px', top: '0px', transform: 'rotate(180deg)' }],
    [270, { width: '1000px', height: '1500px', left: '250px', top: '-250px', transform: 'rotate(270deg)' }],
    [-90, { width: '1000px', height: '1500px', left: '250px', top: '-250px', transform: 'rotate(270deg)' }],
  ])('rotates the frame for %s degrees', async (rotation, expected) => {
    const swap = Math.abs(rotation) % 180 === 90;
    await render({ renderWidth: swap ? 1500 : 1000, renderHeight: swap ? 1000 : 1500, rotation });
    const frame = container.querySelector('.ocr-text-layer-frame');
    for (const [property, value] of Object.entries(expected)) expect(frame.style[property]).toBe(value);
  });

  it('rotates the frame about the stage centre like the canvas for a rotated page', async () => {
    // The stage is the rotated page: 1500 wide, 1000 high for a 2000x3000 image turned 90°.
    await render({ renderWidth: 1500, renderHeight: 1000, rotation: 90 });
    const frame = container.querySelector('.ocr-text-layer-frame');
    expect(frame.style.width).toBe('1000px');
    expect(frame.style.height).toBe('1500px');
    expect(frame.style.left).toBe('250px');
    expect(frame.style.top).toBe('-250px');
    expect(frame.style.transform).toBe('rotate(90deg)');
    const first = container.querySelector('.ocr-text-layer-word');
    expect(first.style.left).toBe('50px');
    expect(first.style.top).toBe('100px');
  });

  it.each([
    ['no outcome', { outcome: null }],
    ['a queued page', { outcome: { status: 'queued' } }],
    ['a skipped page', { outcome: { status: 'skipped', reason: 'text-layer' } }],
    ['an outcome without image size', { outcome: { ...OUTCOME, imageWidth: 0 } }],
    ['a stage without size', { renderWidth: 0 }],
  ])('renders nothing for %s', async (_label, props) => {
    await render(props);
    expect(container.querySelector('.ocr-text-layer')).toBeNull();
    expect(container.innerHTML).toBe('');
  });

  it('marks a layer whose copy had ruling lines removed, and only that one', async () => {
    await render({ outcome: { ...OUTCOME, rulingLinePixels: 1234 } });
    expect(container.querySelector('.ocr-text-layer').getAttribute('data-ruling-lines-removed')).toBe('true');
    // Geometry is the same: the copy had the page image's size.
    expect(container.querySelector('.ocr-text-layer-word').style.left).toBe('50px');
    await render({ outcome: { ...OUTCOME, rulingLinePixels: 0 } });
    expect(container.querySelector('.ocr-text-layer').hasAttribute('data-ruling-lines-removed')).toBe(false);
    await render({ outcome: OUTCOME });
    expect(container.querySelector('.ocr-text-layer').hasAttribute('data-ruling-lines-removed')).toBe(false);
  });

  it('renders an empty layer for a page recognised without words', async () => {
    await render({ outcome: { ...OUTCOME, words: [], text: '' } });
    const layer = container.querySelector('.ocr-text-layer');
    expect(layer).not.toBeNull();
    expect(layer.querySelectorAll('.ocr-text-layer-word')).toHaveLength(0);
  });
});
