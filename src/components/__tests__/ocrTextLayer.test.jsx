// @vitest-environment jsdom
// File: src/components/__tests__/ocrTextLayer.test.jsx
/**
 * The OCR text layer is one transparent text flow in reading order: a line element per
 * recognised line whose line box reaches to the next line, inline words joined with no-break
 * spaces, each word shifted onto its image-pixel box, scaled to the stage like the page image
 * and rotated with it. It renders nothing without a `done` outcome, marks the words a selection
 * touches, and copy gives the text as it reads on the page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import OcrTextLayer, { OCR_WORD_SELECTED_CLASS } from '../OcrTextLayer.jsx';
import { countCharacters, isOcrLayerSelection, layoutOcrLines, measureWordWidth, ocrSelectionText, OCR_WORD_JOINER } from '../../utils/ocrTextLayout.js';

const WORDS = [
  { text: 'Hej', confidence: 95, bbox: { x0: 100, y0: 200, x1: 400, y1: 300 } },
  { text: 'världen', confidence: 88, bbox: { x0: 500, y0: 200, x1: 1100, y1: 300 } },
  { text: '', confidence: 0, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
  { text: 'nobox', confidence: 50 },
  { text: 'flat', confidence: 50, bbox: { x0: 10, y0: 10, x1: 10, y1: 30 } },
];
const OUTCOME = { status: 'done', text: 'Hej världen', confidence: 91, words: WORDS, imageWidth: 2000, imageHeight: 3000 };
const TWO_LINES = [
  { text: 'Rad', bbox: { x0: 100, y0: 100, x1: 200, y1: 150 } },
  { text: 'ett', bbox: { x0: 220, y0: 105, x1: 300, y1: 150 } },
  { text: 'Rad', bbox: { x0: 100, y0: 200, x1: 200, y1: 250 } },
  { text: 'två', bbox: { x0: 220, y0: 200, x1: 300, y1: 250 } },
];
const TWO_LINES_OUTCOME = { ...OUTCOME, words: TWO_LINES, imageWidth: 1000, imageHeight: 1000 };

describe('layoutOcrLines', () => {
  it('scales boxes from image pixels to the frame and fits each word to its box with letter-spacing', () => {
    const measure = (text, fontSize) => text.length * fontSize * 0.5;
    const { top, lines } = layoutOcrLines(WORDS, 2000, 3000, 1000, 1500, measure);
    expect(top).toBe(100);
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line).toMatchObject({ top: 100, height: 50, fontSize: 50, lineHeight: 50 });
    expect(line.words).toHaveLength(2);
    // "Hej" measures 75 px at 50 px; 25 px after each of its three characters makes it 150 px.
    expect(line.words[0]).toEqual({ text: 'Hej', left: 50, top: 100, width: 150, height: 50, fontSize: 50, letterSpacing: 25, shiftX: 50, shiftY: 0 });
    // "världen" follows the first word (150 px) and a no-break space (25 px) in the flow, at 175;
    // its box starts at 250.
    expect(line.words[1]).toMatchObject({ text: 'världen', left: 250, width: 300, shiftX: 75, shiftY: 0 });
    expect(line.words[1].letterSpacing).toBeCloseTo((300 - 7 * 25) / 7);
    expect(75 + line.words[0].letterSpacing * 3).toBe(150);
  });

  it('groups words into lines and gives each line box the distance to the next line', () => {
    const { top, lines } = layoutOcrLines(TWO_LINES, 1000, 1000, 1000, 1000, () => 10);
    expect(lines.map((line) => line.words.map((word) => word.text))).toEqual([['Rad', 'ett'], ['Rad', 'två']]);
    // The flow starts at line 1 (100); line 1's box reaches to line 2 (100 px), so line 2 lands
    // on its top (200) by stacking; the last line box is as tall as the line.
    expect(top).toBe(100);
    expect(lines[0]).toMatchObject({ top: 100, height: 50, lineHeight: 100 });
    expect(lines[1]).toMatchObject({ top: 200, height: 50, lineHeight: 50 });
    // "ett" starts 5 px below the top of its line.
    expect(lines[0].words[1]).toMatchObject({ top: 105, height: 45, fontSize: 45, shiftY: 5 });
    // Natural flow: "Rad" (10 + 30 × 3 = 100), the joiner (10), then "ett" at 110; its box is at 220.
    expect(lines[0].words[0].shiftX).toBe(100);
    expect(lines[0].words[1].shiftX).toBe(110);
  });

  it('keeps a line box at least as tall as its line when the next line starts above it', () => {
    // "över" joins the line of "under" (it does not start below it) and lifts that line's top
    // above the first line's top.
    const words = [
      { text: 'först', bbox: { x0: 0, y0: 100, x1: 100, y1: 150 } },
      { text: 'under', bbox: { x0: 0, y0: 500, x1: 100, y1: 550 } },
      { text: 'över', bbox: { x0: 200, y0: 90, x1: 300, y1: 140 } },
    ];
    const { lines } = layoutOcrLines(words, 1000, 1000, 1000, 1000, () => 10);
    expect(lines.map((line) => line.top)).toEqual([100, 90]);
    // The distance from line 1 to line 2 is negative, so line 1 keeps its own height; the last
    // line's box is its own height. Line 2's box lands at 150 by stacking, and its words are
    // shifted from there onto their own boxes.
    expect(lines.map((line) => line.lineHeight)).toEqual([50, 50]);
    expect(lines.map((line) => line.stackedTop)).toEqual([100, 150]);
    expect(lines[1].words.map((word) => word.shiftY)).toEqual([350, -60]);
  });

  it('shifts the words of overlapping lines from the box they land in onto their own places', () => {
    const words = [
      { text: 'a', bbox: { x0: 0, y0: 100, x1: 50, y1: 160 } },
      { text: 'b', bbox: { x0: 0, y0: 140, x1: 50, y1: 200 } },
      { text: 'c', bbox: { x0: 0, y0: 180, x1: 50, y1: 240 } },
    ];
    const { lines } = layoutOcrLines(words, 1000, 1000, 1000, 1000, () => 10);
    expect(lines.map((line) => line.lineHeight)).toEqual([60, 60, 60]);
    expect(lines.map((line) => line.stackedTop)).toEqual([100, 160, 220]);
    expect(lines.map((line) => line.words[0].shiftY)).toEqual([0, -20, -40]);
  });

  it('never tightens letter-spacing below -0.4 em for a box narrower than its text', () => {
    const { lines } = layoutOcrLines([{ text: 'abcdefghij', bbox: { x0: 0, y0: 0, x1: 100, y1: 50 } }], 100, 50, 100, 50, () => 1000);
    expect(lines[0].words[0].letterSpacing).toBe(-20);
  });

  it('counts typographic characters, not code points, for the letter-spacing', () => {
    expect(countCharacters('Hej')).toBe(3);
    expect(countCharacters('éx')).toBe(2);
    expect(countCharacters('\u{1F600}x')).toBe(2);
    const { lines } = layoutOcrLines([{ text: 'éx', bbox: { x0: 0, y0: 0, x1: 100, y1: 50 } }], 100, 50, 100, 50, () => 40);
    expect(lines[0].words[0].letterSpacing).toBe(30);
  });

  it('returns nothing for an empty image or frame', () => {
    expect(layoutOcrLines(WORDS, 0, 3000, 1000, 1500)).toEqual({ top: 0, lines: [] });
    expect(layoutOcrLines(WORDS, 2000, 3000, 0, 1500)).toEqual({ top: 0, lines: [] });
    expect(layoutOcrLines(null, 2000, 3000, 1000, 1500)).toEqual({ top: 0, lines: [] });
  });

  it('estimates the width without a canvas context (jsdom) and never returns zero', () => {
    expect(measureWordWidth('abc', 20)).toBeGreaterThan(0);
    expect(measureWordWidth('', 20)).toBe(1);
  });
});

describe('ocrSelectionText and isOcrLayerSelection', () => {
  let host;
  let outside;

  beforeEach(() => {
    host = document.createElement('div');
    host.className = 'ocr-text-layer';
    host.innerHTML = '<div class="ocr-text-layer-flow">'
      + `<span class="ocr-text-layer-line"><span class="ocr-text-layer-word">Hej</span>${OCR_WORD_JOINER}<span class="ocr-text-layer-word">världen</span></span>`
      + ' '
      + `<span class="ocr-text-layer-line"><span class="ocr-text-layer-word">Rad</span>${OCR_WORD_JOINER}<span class="ocr-text-layer-word">två</span></span>`
      + '</div>';
    outside = document.createElement('p');
    outside.textContent = 'utanför';
    document.body.append(host, outside);
  });

  afterEach(() => {
    window.getSelection().removeAllRanges();
    host.remove();
    outside.remove();
  });

  function select(startNode, startOffset, endNode, endOffset) {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection;
  }

  it('reads lines as lines and words as words', () => {
    const selection = select(host, 0, host, 1);
    expect(isOcrLayerSelection(selection)).toBe(true);
    expect(ocrSelectionText(selection)).toBe('Hej världen\nRad två');
  });

  it('keeps a partial selection across lines to the selected text', () => {
    const words = host.querySelectorAll('.ocr-text-layer-word');
    const selection = select(words[1].firstChild, 3, words[2].firstChild, 2);
    expect(ocrSelectionText(selection)).toBe('lden\nRa');
  });

  it('returns the selection text itself inside one word, and nothing for an empty selection', () => {
    const word = host.querySelector('.ocr-text-layer-word');
    expect(ocrSelectionText(select(word.firstChild, 1, word.firstChild, 3))).toBe('ej');
    window.getSelection().removeAllRanges();
    expect(ocrSelectionText(window.getSelection())).toBe('');
    expect(isOcrLayerSelection(window.getSelection())).toBe(false);
    expect(ocrSelectionText(null)).toBe('');
    expect(isOcrLayerSelection(null)).toBe(false);
  });

  it('does not treat a selection that reaches outside the layer as a layer selection', () => {
    const word = host.querySelector('.ocr-text-layer-word');
    expect(isOcrLayerSelection(select(word.firstChild, 0, outside.firstChild, 3))).toBe(false);
    expect(isOcrLayerSelection(select(outside.firstChild, 0, word.firstChild, 2))).toBe(false);
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
    window.getSelection().removeAllRanges();
    await act(async () => { root.unmount(); });
    container.remove();
  });

  async function render(props) {
    await act(async () => {
      root.render(createElement(OcrTextLayer, { outcome: OUTCOME, renderWidth: 1000, renderHeight: 1500, zoom: 1, label: 'Tolkad text, sida 1', pageNumber: 1, ...props }));
    });
  }

  function selectAll(element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  }

  it('renders one text flow with a line element and inline words shifted onto the scaled boxes, with the stage size and zoom of the image', async () => {
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

    const flow = frame.querySelector('.ocr-text-layer-flow');
    expect(flow.style.top).toBe('100px');
    const lines = [...flow.querySelectorAll('.ocr-text-layer-line')];
    expect(lines).toHaveLength(1);
    expect(lines[0].style.fontSize).toBe('50px');
    expect(lines[0].style.lineHeight).toBe('50px');

    const words = [...lines[0].querySelectorAll('.ocr-text-layer-word')];
    expect(words.map((span) => span.textContent)).toEqual(['Hej', 'världen']);
    expect(words[0].style.left).toBe('50px');
    expect(words[0].style.top).toBe('0px');
    expect(words[0].style.fontSize).toBe('50px');
    // Measured text width plus the spacing after each of the three characters is the 150 px box.
    const letterSpacing = parseFloat(words[0].style.letterSpacing);
    expect(measureWordWidth('Hej', 50) + letterSpacing * 3).toBeCloseTo(150, 3);
    // The words of a line are joined with no-break spaces: one flow, one line, no wrap inside.
    expect(layer.textContent).toBe(`Hej${OCR_WORD_JOINER}världen`);
  });

  it('separates lines with ordinary spaces and gives each line box the distance to the next line', async () => {
    await render({ outcome: TWO_LINES_OUTCOME, renderWidth: 1000, renderHeight: 1000 });
    const layer = container.querySelector('.ocr-text-layer');
    expect(layer.textContent).toBe(`Rad${OCR_WORD_JOINER}ett Rad${OCR_WORD_JOINER}två`);
    expect(layer.querySelector('.ocr-text-layer-flow').style.top).toBe('100px');
    const lines = [...layer.querySelectorAll('.ocr-text-layer-line')];
    expect(lines.map((line) => line.style.lineHeight)).toEqual(['100px', '50px']);
    expect(lines.map((line) => line.style.top)).toEqual(['', '']);
  });

  it('marks the words the selection touches, and only those', async () => {
    await render({ outcome: TWO_LINES_OUTCOME, renderWidth: 1000, renderHeight: 1000 });
    const words = [...container.querySelectorAll('.ocr-text-layer-word')];
    const range = document.createRange();
    range.setStart(words[1].firstChild, 1);
    range.setEnd(words[2].firstChild, 2);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    await act(async () => { document.dispatchEvent(new Event('selectionchange')); });
    expect(words.map((word) => word.classList.contains(OCR_WORD_SELECTED_CLASS))).toEqual([false, true, true, false]);
    // A selection that ends exactly where a word starts does not cover that word.
    const edge = document.createRange();
    edge.setStart(words[1].firstChild, 0);
    edge.setEnd(words[2].firstChild, 0);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(edge);
    await act(async () => { document.dispatchEvent(new Event('selectionchange')); });
    expect(words.map((word) => word.classList.contains(OCR_WORD_SELECTED_CLASS))).toEqual([false, true, false, false]);
    window.getSelection().removeAllRanges();
    await act(async () => { document.dispatchEvent(new Event('selectionchange')); });
    expect(words.map((word) => word.classList.contains(OCR_WORD_SELECTED_CLASS))).toEqual([false, false, false, false]);
  });

  it('copies the selected text as it reads on the page', async () => {
    await render({ outcome: TWO_LINES_OUTCOME, renderWidth: 1000, renderHeight: 1000 });
    const layer = container.querySelector('.ocr-text-layer');
    selectAll(layer.querySelector('.ocr-text-layer-flow'));
    const setData = vi.fn();
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData } });
    await act(async () => { layer.querySelector('.ocr-text-layer-word').dispatchEvent(event); });
    expect(setData).toHaveBeenCalledWith('text/plain', 'Rad ett\nRad två');
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves a copy of a selection that reaches outside the layer to the browser', async () => {
    await render({ outcome: TWO_LINES_OUTCOME, renderWidth: 1000, renderHeight: 1000 });
    const outside = document.createElement('p');
    outside.textContent = 'utanför';
    document.body.appendChild(outside);
    const word = container.querySelector('.ocr-text-layer-word');
    const range = document.createRange();
    range.setStart(word.firstChild, 0);
    range.setEnd(outside.firstChild, 3);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    const setData = vi.fn();
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData } });
    await act(async () => { word.dispatchEvent(event); });
    expect(setData).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    outside.remove();
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
    // The flow is laid out in the unrotated frame; it and its first word keep their place.
    expect(container.querySelector('.ocr-text-layer-flow').style.top).toBe('100px');
    expect(container.querySelector('.ocr-text-layer-word').style.left).toBe('50px');
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
    expect(layer.querySelector('.ocr-text-layer-flow').textContent).toBe('');
  });
});
