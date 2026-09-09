/** Print reproducible PDF display raster measurements; no browser or document fetch required. */
import { resolvePdfRenderScale } from '../src/utils/pdfResolution.js';

const viewerWidthCss = 1500; // Representative content width on a 1920-pixel-wide display.
const pages = [['A5', 420, 595], ['A4', 595, 842], ['A3', 842, 1191]];
console.log(`Viewer width: ${viewerWidthCss} CSS pixels; normal memory tier.`);
console.log('| Page | Policy | DPR | Scale | Bitmap pixels | MP |');
console.log('| --- | --- | --- | --- | --- | --- |');
for (const [format, pageWidthPt, pageHeightPt] of pages) {
  for (const [mode, fixedScale, devicePixelRatio] of [['fixed', 2, 1], ['fixed', 4, 1], ['auto', 2, 1], ['auto', 2, 2]]) {
    const result = resolvePdfRenderScale({
      pageWidthPt, pageHeightPt, viewerWidthCss, devicePixelRatio,
      config: { pdfResolution: { mode, fixedScale } }, memoryTier: 'unknown',
    });
    console.log(`| ${format} | ${mode} | ${devicePixelRatio} | ${result.scale.toFixed(3)} | ${Math.ceil(pageWidthPt * result.scale)} × ${Math.ceil(pageHeightPt * result.scale)} | ${(result.pixels / 1e6).toFixed(3)} |`);
  }
}
