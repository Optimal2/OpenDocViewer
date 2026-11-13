import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { decode as decodePng } from 'fast-png';
import { loadSession } from './fixtureSession.mjs';

const fixture = (name) => readFileSync(new URL(`../fixtures/modern-images/${name}`, import.meta.url));
for (const backend of ['hybrid-by-format', 'main-only']) {
  for (const name of ['gradient.jxl', 'gradient16.jxl', 'reconstruction.jxl', 'gradient.avif']) {
    test(`${name} renders as a page and exports losslessly (${backend})`, async ({ page }) => {
      const wasmRequests = [];
      const workers = [];
      const pdfFallbacks = [];
      page.on('worker', (worker) => workers.push(worker.url()));
      page.on('console', (message) => { if (message.text().includes('PDF worker generation failed')) pdfFallbacks.push(message.text()); });
      page.on('request', (request) => { if (/jxl.*\.wasm/.test(request.url())) wasmRequests.push(request.url()); });
      await loadSession(page, {
        siteConfig: { documentLoading: { render: { backend } } },
        session: { session: { id: 'modern-image' }, documents: [{ documentId: 'image', files: [`/ui-fixtures/${name}`] }] },
        extraFixtures: new Map([[name, { body: fixture(name), contentType: 'application/octet-stream' }]]),
      });
      const image = page.locator('.document-render-container img[data-page-number="1"]').first();
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate((node) => node.complete ? node.naturalWidth : 0)).toBe(32);
      const thumbnail = page.locator('#thumbnail-1 img.thumbnail').first();
      await expect.poll(() => thumbnail.evaluate((node) => node.naturalWidth)).toBeGreaterThan(0);
      if (name.endsWith('.jxl')) expect(wasmRequests.length).toBeGreaterThan(0);
      else expect(wasmRequests).toHaveLength(0);

      const result = await image.evaluate(async (node) => {
        const blob = await (await fetch(node.src)).blob();
        const { createPrintPdfBlob } = await import('/src/utils/printPdf.js');
        const main = await createPrintPdfBlob([node.src], { pdfCfg: { workerEnabled: false } });
        const worker = await createPrintPdfBlob([node.src], { pdfCfg: { workerEnabled: true, workerPageThreshold: 1 } });
        const inspect = async (pdf) => {
          const text = new TextDecoder('latin1').decode(await pdf.arrayBuffer());
          return { image: text.includes('/Subtype /Image'), jpeg: text.includes('/DCTDecode'), lossless: text.includes('/FlateDecode') };
        };
        return { type: blob.type, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), main: await inspect(main), worker: await inspect(worker) };
      });
      if (name.endsWith('.jxl')) expect(result.type).toBe('image/png');
      expect(result.main).toEqual({ image: true, jpeg: false, lossless: true });
      expect(result.worker).toEqual({ image: true, jpeg: false, lossless: true });
      expect(pdfFallbacks).toEqual([]);
      expect(workers.some((url) => url.includes('pdfWorker'))).toBe(true);
      if (backend === 'hybrid-by-format') expect(workers.some((url) => url.includes('imageWorker'))).toBe(true);
      if (name.startsWith('gradient') && name.endsWith('.jxl')) {
        expect(decodePng(Uint8Array.from(result.bytes)).data).toEqual(decodePng(fixture(name.replace('.jxl', '.png'))).data);
      }
    });
  }
}
